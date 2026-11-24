
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";

export interface RateLimitReservation {
  hourStart: Date;
  isRescheduled: boolean;
}

function getUtcHourStart(date: Date): Date {
  const hour = new Date(date);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}

/**
 * Reserves one hourly sending slot for an email.
 *
 * - Each email can reserve only once.
 * - Concurrent workers cannot exceed the sender's hourly limit.
 * - If the current hour is full, the next available hour is reserved.
 */
export async function reserveHourlySlot(
  senderId: string,
  emailId: string,
  hourlyLimit: number
): Promise<RateLimitReservation> {
  if (!Number.isInteger(hourlyLimit) || hourlyLimit < 1) {
    throw new Error("Sender hourly limit must be a positive integer");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Reuse an existing reservation on BullMQ retries.
      const existing = await tx.hourlyUsageReservation.findUnique({
        where: { emailId },
        include: { hourlyUsage: true },
      });

      if (existing) {
        return {
          hourStart: existing.hourlyUsage.hourStart,
          isRescheduled:
            existing.hourlyUsage.hourStart.getTime() >
            getUtcHourStart(new Date()).getTime(),
        };
      }

      const currentHour = getUtcHourStart(new Date());

      // Search the current hour and the next 7 days.
      for (let offset = 0; offset <= 168; offset++) {
        const candidateHour = new Date(
          currentHour.getTime() + offset * 60 * 60 * 1000
        );

        // Atomically increment only if the hourly limit is not reached.
        const rows = await tx.$queryRaw<
          Array<{ id: string; count: number }>
        >`
          INSERT INTO "HourlyUsage"
            ("id", "senderId", "hourStart", "count", "createdAt", "updatedAt")
VALUES
  (
    ${randomUUID()},
    ${senderId},
    CAST(${candidateHour.toISOString().slice(0, -1)} AS TIMESTAMP),
    1,
    NOW(),
    NOW()
  )
          ON CONFLICT ("senderId", "hourStart")
          DO UPDATE SET
            "count" = "HourlyUsage"."count" + 1,
            "updatedAt" = NOW()
          WHERE "HourlyUsage"."count" < ${hourlyLimit}
          RETURNING "id", "count"
        `;

        // No returned row means this hour is already full.
        if (rows.length === 0) {
          continue;
        }

        // Reservation creation is in the same transaction.
        await tx.hourlyUsageReservation.create({
          data: {
            emailId,
            hourlyUsageId: rows[0].id,
          },
        });

        return {
          hourStart: candidateHour,
          isRescheduled: offset > 0,
        };
      }

      throw new Error(
        "No hourly sending capacity available in the next 7 days"
      );
    });
  } catch (error) {
    // If two workers race to reserve the same email, the unique emailId
    // constraint rolls back the losing transaction. Reuse the winner's slot.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.hourlyUsageReservation.findUnique({
        where: { emailId },
        include: { hourlyUsage: true },
      });

      if (existing) {
        const currentHour = getUtcHourStart(new Date());

        return {
          hourStart: existing.hourlyUsage.hourStart,
          isRescheduled:
            existing.hourlyUsage.hourStart.getTime() >
            currentHour.getTime(),
        };
      }
    }

    throw error;
  }
}
