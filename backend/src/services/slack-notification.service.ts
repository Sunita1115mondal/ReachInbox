
import { prisma } from "../config/database";
import { redis } from "../config/redis";
import { decryptToken } from "./slack-encryption.service";

export async function notifyHourlyLimitReached(
  senderId: string,
  nextAvailableAt: Date
): Promise<void> {
  try {
    const channel = process.env.SLACK_ALERT_CHANNEL_ID;

    if (!channel) {
      console.error("SLACK_ALERT_CHANNEL_ID is missing");
      return;
    }

    const sender = await prisma.sender.findUnique({
      where: { id: senderId },
      include: {
        user: {
          include: { slackConnection: true },
        },
      },
    });

    const connection = sender?.user.slackConnection;

    if (!connection) {
      console.log("No Slack workspace connected for this sender.");
      return;
    }

    // Avoid sending repeated alerts for the same sender and hour.
    const hourKey = nextAvailableAt.toISOString().slice(0, 13);
    const alertKey = `slack:limit-alert:${senderId}:${hourKey}`;

    const shouldNotify = await redis.set(
      alertKey,
      "1",
      "EX",
      3600,
      "NX"
    );

    if (!shouldNotify) return;

    const token = decryptToken(connection.accessTokenEncrypted);

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text:
          `⚠️ *ReachInbox hourly sending limit reached*\n` +
          `Sender: ${sender.email}\n` +
          `Sending will resume at: ${nextAvailableAt.toISOString()}`,
      }),
    });

    const result = await response.json() as {
      ok: boolean;
      error?: string;
    };

    if (!result.ok) {
      console.error("Slack notification failed:", result.error);
      await redis.del(alertKey);
    } else {
      console.log("✅ Slack hourly-limit notification sent");
    }
  } catch (error) {
    console.error("Slack notification error:", error);
  }
}
