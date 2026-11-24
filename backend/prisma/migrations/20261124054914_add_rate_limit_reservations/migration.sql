-- CreateTable
CREATE TABLE "HourlyUsageReservation" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "hourlyUsageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HourlyUsageReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HourlyUsageReservation_emailId_key" ON "HourlyUsageReservation"("emailId");

-- CreateIndex
CREATE INDEX "HourlyUsageReservation_hourlyUsageId_idx" ON "HourlyUsageReservation"("hourlyUsageId");

-- AddForeignKey
ALTER TABLE "HourlyUsageReservation" ADD CONSTRAINT "HourlyUsageReservation_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyUsageReservation" ADD CONSTRAINT "HourlyUsageReservation_hourlyUsageId_fkey" FOREIGN KEY ("hourlyUsageId") REFERENCES "HourlyUsage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
