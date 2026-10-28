-- CreateEnum
CREATE TYPE "MonitorHealthStatus" AS ENUM ('UNKNOWN', 'UP', 'DOWN');

-- AlterTable
ALTER TABLE "Monitor" ADD COLUMN     "healthStatus" "MonitorHealthStatus" NOT NULL DEFAULT 'UNKNOWN';
