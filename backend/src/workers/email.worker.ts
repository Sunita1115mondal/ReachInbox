
import "dotenv/config";

import { Worker, Job } from "bullmq";

import { prisma } from "../config/database";
import { redis } from "../config/redis";
import { transporter } from "../config/mailer";
import { emailQueue } from "../queues/email.queue";
import { reserveHourlySlot } from "../services/rate-limit.service";
import { notifyHourlyLimitReached } from "../services/slack-notification.service";
import type { EmailJobData } from "../queues/email.queue";

const concurrency = Number(process.env.WORKER_CONCURRENCY) || 5;

// Process one email job
async function processEmail(job: Job<EmailJobData>): Promise<void> {
  const { emailId } = job.data;

  console.log(`📨 Processing email: ${emailId}`);

  // 1. Fetch email from PostgreSQL
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true },
  });

  if (!email) {
    throw new Error(`Email record not found: ${emailId}`);
  }

  // 2. Prevent duplicate sending or cancelled emails
  if (email.status === "SENT") {
    console.log(`⏭️ Email already sent: ${emailId}`);
    return;
  }

  if (email.status === "CANCELLED") {
    console.log(`⏭️ Email cancelled: ${emailId}`);
    return;
  }

  // 3. Check sender availability
  if (!email.sender.isActive) {
    throw new Error(`Sender is inactive: ${email.sender.email}`);
  }

  // 4. Reserve an hourly sending slot
  const reservation = await reserveHourlySlot(
    email.senderId,
    emailId,
    email.sender.hourlyLimit
  );

  // 5. Reschedule if the hourly limit has been reached
  if (reservation.isRescheduled) {
    const futureJobId = `${emailId}-rate-${reservation.hourStart.getTime()}`;

    const delay = Math.max(
      0,
      reservation.hourStart.getTime() - Date.now()
    );

    await emailQueue.add("send-email", job.data, {
      jobId: futureJobId,
      delay,
    });

    await prisma.$transaction([
      prisma.email.update({
        where: { id: emailId },
        data: {
          status: "QUEUED",
          scheduledAt: reservation.hourStart,
          queueJobId: futureJobId,
        },
      }),

      prisma.emailEvent.create({
        data: {
          emailId,
          type: "QUEUED",
          message: "Rescheduled due to hourly sending limit",
          metadata: {
            jobId: futureJobId,
            reservedHour: reservation.hourStart.toISOString(),
          },
        },
      }),
    ]);

    // 6. Notify the connected Slack workspace
    await notifyHourlyLimitReached(
      email.senderId,
      reservation.hourStart
    );

    console.log(
      `⏳ Email ${emailId} rescheduled to ${reservation.hourStart.toISOString()}`
    );

    return;
  }

  // 7. Mark email as PROCESSING
  await prisma.email.update({
    where: { id: emailId },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
    },
  });

  await prisma.emailEvent.create({
    data: {
      emailId,
      type: "PROCESSING",
      message: "Email processing started",
      metadata: {
        jobId: job.id ?? "",
        attempt: job.attemptsMade + 1,
        reservedHour: reservation.hourStart.toISOString(),
      },
    },
  });

  // 8. Send email through Ethereal SMTP
  let info;

  try {
    info = await transporter.sendMail({
      from: process.env.SMTP_FROM || email.sender.email,
      to: email.recipientEmail,
      subject: email.subject,
      text: email.body,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown SMTP error";

    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: "QUEUED",
        lastError: message,
      },
    });

    console.error(`❌ SMTP attempt failed: ${emailId}`, message);

    // BullMQ will retry according to the queue configuration.
    throw error;
  }

  // 9. Update PostgreSQL after successful SMTP acceptance
  await prisma.$transaction([
    prisma.email.update({
      where: { id: emailId },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lastError: null,
      },
    }),

    prisma.emailEvent.create({
      data: {
        emailId,
        type: "SENT",
        message: "Email accepted by SMTP server",
        metadata: {
          messageId: info.messageId,
          jobId: job.id ?? "",
        },
      },
    }),
  ]);

  console.log(`✅ Email sent: ${email.recipientEmail}`);
  console.log(`📧 Message ID: ${info.messageId}`);
}

// Create and configure BullMQ worker
export function createEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(
    "email-queue",
    processEmail,
    {
      connection: redis,
      concurrency,
    }
  );

  worker.on("ready", () => {
    console.log(`✅ Email worker ready (concurrency: ${concurrency})`);
  });

  worker.on("completed", (job) => {
    console.log(`🎉 Job completed: ${job.id}`);
  });

  worker.on("failed", async (job, error) => {
    if (!job) return;

    console.error(`⚠️ Job failed: ${job.id}`, error.message);

    const maxAttempts = job.opts.attempts ?? 1;

    if (job.attemptsMade >= maxAttempts) {
      try {
        await prisma.$transaction([
          prisma.email.updateMany({
            where: {
              id: job.data.emailId,
              status: { not: "SENT" },
            },
            data: {
              status: "FAILED",
              lastError: error.message,
            },
          }),

          prisma.emailEvent.create({
            data: {
              emailId: job.data.emailId,
              type: "FAILED",
              message: "Email failed after all retry attempts",
              metadata: {
                attempts: job.attemptsMade,
                error: error.message,
              },
            },
          }),
        ]);

        console.error(`❌ Email permanently failed: ${job.data.emailId}`);
      } catch (dbError) {
        console.error("Failed to update final email status:", dbError);
      }
    }
  });

  worker.on("error", (error) => {
    console.error("❌ Email worker error:", error);
  });

  return worker;
}
