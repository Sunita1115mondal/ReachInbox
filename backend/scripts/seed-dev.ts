
import "dotenv/config";
import { prisma } from "../src/config/database";

async function seedDevelopmentData() {
  const senderEmail = process.env.SMTP_USER;

  if (!senderEmail) {
    throw new Error("SMTP_USER is missing from .env");
  }

  const user = await prisma.user.upsert({
    where: {
      googleId: "reachinbox-local-dev-user",
    },
    update: {},
    create: {
      googleId: "reachinbox-local-dev-user",
      email: senderEmail,
      name: "ReachInbox Developer",
    },
  });

  const sender = await prisma.sender.upsert({
    where: {
      userId_email: {
        userId: user.id,
        email: senderEmail,
      },
    },
    update: {},
    create: {
      userId: user.id,
      email: senderEmail,
      displayName: "ReachInbox Test Sender",
      hourlyLimit: 100,
      minDelaySeconds: 5,
    },
  });

  console.log("\n✅ Development data created successfully");
  console.log("User ID:", user.id);
  console.log("Sender ID:", sender.id);
  console.log("Sender email:", sender.email);
}

seedDevelopmentData()
  .catch((error) => {
    console.error("❌ Development seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
