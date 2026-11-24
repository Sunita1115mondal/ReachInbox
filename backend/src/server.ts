
import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";

import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

import { connectRedis, redis } from "./config/redis";
import { emailQueue } from "./queues/email.queue";
import { connectDatabase, prisma } from "./config/database";
import { createEmailWorker } from "./workers/email.worker";

import authRoutes from "./modules/auth/auth.routes";
import campaignRoutes from "./modules/campaigns/campaign.routes";
import slackRoutes from "./modules/slack/slack.routes";
const app = express();
const PORT = Number(process.env.PORT) || 5000;

let activeWorker: ReturnType<typeof createEmailWorker> | undefined;
let server: ReturnType<typeof app.listen> | undefined;
let shuttingDown = false;

// Bull Board dashboard configuration
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

// Middleware
app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json());

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/campaigns", campaignRoutes);

// Bull Board
app.use("/admin/queues", serverAdapter.getRouter());
app.use("/api/slack", slackRoutes);
// Root endpoint
app.get("/", (_req, res) => {
  res.json({
    message: "Welcome to ReachInbox API",
    status: "running",
  });
});

// Health check
app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redisStatus = await redis.ping();

    res.status(200).json({
      success: true,
      message: "ReachInbox API is healthy",
      database: "connected",
      redis: redisStatus === "PONG" ? "connected" : "disconnected",
      worker: activeWorker ? "running" : "not_started",
      queue: await emailQueue.getJobCounts(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check failed:", error);

    res.status(503).json({
      success: false,
      message: "A service connection failed",
    });
  }
});

// Start server
async function startServer(): Promise<void> {
  try {
    await connectDatabase();
    await connectRedis();

    activeWorker = createEmailWorker();

    server = app.listen(PORT, () => {
      console.log(`🚀 ReachInbox API running at http://localhost:${PORT}`);
      console.log(`💚 Health check: http://localhost:${PORT}/api/health`);
      console.log(`📊 Bull Board: http://localhost:${PORT}/admin/queues`);
      console.log(`🔐 Google Auth: http://localhost:${PORT}/api/auth/google`);
    });
  } catch (error) {
    console.error("❌ Failed to start ReachInbox:", error);
    process.exitCode = 1;
    await shutdown();
  }
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("\n🛑 Shutting down ReachInbox...");

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      console.log("✅ HTTP server closed");
    }

    if (activeWorker) {
      await activeWorker.close();
      console.log("✅ Email worker closed");
    }

    await emailQueue.close();
    console.log("✅ Email queue closed");

    await redis.quit();
    console.log("✅ Redis connection closed");

    await prisma.$disconnect();
    console.log("✅ PostgreSQL connection closed");
  } catch (error) {
    console.error("❌ Shutdown error:", error);
    process.exitCode = 1;
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

void startServer();
