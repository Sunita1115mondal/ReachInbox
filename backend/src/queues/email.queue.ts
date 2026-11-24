
import { Queue } from "bullmq";
import { redis } from "../config/redis";

export interface EmailJobData {
  emailId: string;
  campaignId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

export const emailQueue = new Queue<EmailJobData>("email-queue", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 7 * 24 * 60 * 60,
      count: 1000,
    },
    removeOnFail: false,
  },
});
