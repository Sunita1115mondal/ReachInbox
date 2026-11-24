-- CreateTable
CREATE TABLE "HourlyUsage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "hourStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HourlyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HourlyUsage_hourStart_idx" ON "HourlyUsage"("hourStart");

-- CreateIndex
CREATE UNIQUE INDEX "HourlyUsage_senderId_hourStart_key" ON "HourlyUsage"("senderId", "hourStart");

-- AddForeignKey
ALTER TABLE "HourlyUsage" ADD CONSTRAINT "HourlyUsage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Sender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
