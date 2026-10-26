-- CreateEnum
CREATE TYPE "MonitorStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('UP', 'DOWN');

-- CreateTable
CREATE TABLE "Monitor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "intervalSeconds" INTEGER NOT NULL DEFAULT 300,
    "status" "MonitorStatus" NOT NULL DEFAULT 'ACTIVE',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckResult" (
    "id" TEXT NOT NULL,
    "status" "CheckStatus" NOT NULL,
    "statusCode" INTEGER,
    "responseTimeMs" INTEGER,
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monitorId" TEXT NOT NULL,

    CONSTRAINT "CheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Monitor_userId_idx" ON "Monitor"("userId");

-- CreateIndex
CREATE INDEX "Monitor_status_idx" ON "Monitor"("status");

-- CreateIndex
CREATE INDEX "CheckResult_monitorId_checkedAt_idx" ON "CheckResult"("monitorId", "checkedAt");

-- AddForeignKey
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckResult" ADD CONSTRAINT "CheckResult_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
