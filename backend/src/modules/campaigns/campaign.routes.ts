
import { Router, Request } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { prisma } from "../../config/database";
import { emailQueue } from "../../queues/email.queue";
import { requireAuth, AuthRequest } from "../../middleware/auth.middleware";

const router = Router();

// All campaign endpoints require authentication.
router.use(requireAuth);

// Get authenticated user's ID.
const getUserId = (req: Request): string => {
  return (req as AuthRequest).user!.id;
};

// ==========================================
// VALIDATION SCHEMA
// ==========================================

const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1),
  scheduledAt: z.coerce.date(),
  recipients: z.array(
    z.object({
      email: z.string().trim().email().transform((v) => v.toLowerCase()),
      name: z.string().trim().optional(),
    })
  ).min(1).max(500),
});

// ==========================================
// 1. CREATE CAMPAIGN
// POST /api/campaigns
// ==========================================

router.post("/", async (req, res) => {
  try {
    const userId = getUserId(req);

    const parsed = createCampaignSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid campaign details",
        errors: parsed.error.flatten(),
      });
    }

    const { name, subject, body, scheduledAt, recipients } = parsed.data;

    if (scheduledAt.getTime() <= Date.now()) {
      return res.status(400).json({
        success: false,
        message: "scheduledAt must be in the future",
      });
    }

    const uniqueEmails = new Set(recipients.map((r) => r.email));

    if (uniqueEmails.size !== recipients.length) {
      return res.status(400).json({
        success: false,
        message: "Duplicate recipient email addresses are not allowed",
      });
    }

    const senderEmail = process.env.SMTP_USER;

    if (!senderEmail) {
      return res.status(500).json({
        success: false,
        message: "SMTP_USER is not configured",
      });
    }

    // Create or find a sender belonging to this authenticated user.
    const sender = await prisma.sender.upsert({
      where: {
        userId_email: {
          userId,
          email: senderEmail,
        },
      },
      create: {
        userId,
        email: senderEmail,
      },
      update: {},
    });

    if (!sender.isActive) {
      return res.status(400).json({
        success: false,
        message: "Sender account is inactive",
      });
    }

    // Create campaign and email records.
    const campaign = await prisma.campaign.create({
      data: {
        userId,
        name,
        subject,
        body,
        status: "SCHEDULED",
        totalEmails: recipients.length,
        emails: {
          create: recipients.map((recipient, index) => ({
            senderId: sender.id,
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            subject,
            body,
            status: "SCHEDULED",
            scheduledAt: new Date(
              scheduledAt.getTime() +
              index * sender.minDelaySeconds * 1000
            ),
            idempotencyKey: randomUUID(),
            events: {
              create: {
                type: "CREATED",
                message: "Email added to campaign",
              },
            },
          })),
        },
      },
      include: {
        emails: true,
      },
    });

    // Add emails to BullMQ.
    for (const email of campaign.emails) {
      const delay = Math.max(
        0,
        email.scheduledAt.getTime() - Date.now()
      );

      const job = await emailQueue.add(
        "send-email",
        {
          emailId: email.id,
          campaignId: campaign.id,
          senderId: sender.id,
          recipientEmail: email.recipientEmail,
          subject: email.subject,
          body: email.body,
        },
        {
          jobId: email.id,
          delay,
        }
      );

      await prisma.$transaction([
        prisma.email.update({
          where: { id: email.id },
          data: {
            status: "QUEUED",
            queueJobId: String(job.id ?? email.id),
          },
        }),
        prisma.emailEvent.create({
          data: {
            emailId: email.id,
            type: "QUEUED",
            message: "Email added to BullMQ queue",
            metadata: {
              jobId: job.id ?? email.id,
              delay,
            },
          },
        }),
      ]);
    }

    return res.status(201).json({
      success: true,
      message: "Campaign created and emails scheduled successfully",
      campaign: {
        id: campaign.id,
        name: campaign.name,
        subject: campaign.subject,
        totalEmails: campaign.totalEmails,
        status: campaign.status,
      },
      emails: campaign.emails.map((email) => ({
        id: email.id,
        recipientEmail: email.recipientEmail,
        scheduledAt: email.scheduledAt,
        status: "QUEUED",
      })),
    });

  } catch (error) {
    console.error("Campaign creation error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create campaign",
    });
  }
});

// ==========================================
// 2. GET ALL CAMPAIGNS
// GET /api/campaigns
// ==========================================

router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);

    const campaigns = await prisma.campaign.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        _count: {
          select: {
            emails: true,
          },
        },
        emails: {
          select: {
            status: true,
          },
        },
      },
    });

    const result = campaigns.map((campaign) => {
      const counts = {
        scheduled: 0,
        queued: 0,
        processing: 0,
        sent: 0,
        failed: 0,
        cancelled: 0,
      };

      for (const email of campaign.emails) {
        switch (email.status) {
          case "SCHEDULED":
            counts.scheduled++;
            break;
          case "QUEUED":
            counts.queued++;
            break;
          case "PROCESSING":
            counts.processing++;
            break;
          case "SENT":
            counts.sent++;
            break;
          case "FAILED":
            counts.failed++;
            break;
          case "CANCELLED":
            counts.cancelled++;
            break;
        }
      }

      return {
        id: campaign.id,
        name: campaign.name,
        subject: campaign.subject,
        status: campaign.status,
        totalEmails: campaign.totalEmails,
        emailCount: campaign._count.emails,
        counts,
        createdAt: campaign.createdAt,
      };
    });

    return res.json({
      success: true,
      total: result.length,
      campaigns: result,
    });

  } catch (error) {
    console.error("Fetch campaigns error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch campaigns",
    });
  }
});

// ==========================================
// 3. GET ALL EMAILS / FILTER BY STATUS
// GET /api/campaigns/emails
// ==========================================

router.get("/emails", async (req, res) => {
  try {
    const userId = getUserId(req);

    const statusSchema = z.enum([
      "SCHEDULED",
      "QUEUED",
      "PROCESSING",
      "SENT",
      "FAILED",
      "CANCELLED",
    ]);

    const statusValue =
      typeof req.query.status === "string"
        ? req.query.status.toUpperCase()
        : undefined;

    const parsedStatus = statusSchema.safeParse(statusValue);

    if (statusValue && !parsedStatus.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid email status",
        allowedStatuses: statusSchema.options,
      });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number(req.query.limit) || 20)
    );

    const where = {
      campaign: {
        userId,
      },
      ...(parsedStatus.success && parsedStatus.data
        ? { status: parsedStatus.data }
        : {}),
    };

    const [emails, total] = await Promise.all([
      prisma.email.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
          sender: {
            select: {
              email: true,
            },
          },
        },
      }),
      prisma.email.count({ where }),
    ]);

    return res.json({
      success: true,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      emails,
    });

  } catch (error) {
    console.error("Fetch emails error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch emails",
    });
  }
});

// ==========================================
// 4. GET CAMPAIGN DETAILS
// GET /api/campaigns/:id
// ==========================================

router.get("/:id", async (req, res) => {
  try {
    const userId = getUserId(req);

    const campaign = await prisma.campaign.findFirst({
      where: {
        id: req.params.id,
        userId,
      },
      include: {
        emails: {
          orderBy: {
            scheduledAt: "asc",
          },
          include: {
            events: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        },
      },
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    return res.json({
      success: true,
      campaign,
    });

  } catch (error) {
    console.error("Fetch campaign error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch campaign",
    });
  }
});

export default router;
