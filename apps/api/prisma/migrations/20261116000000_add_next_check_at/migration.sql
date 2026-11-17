-- Migration: add_next_check_at
-- Adds nextCheckAt to Monitor for efficient due-monitor queries.
-- Backfill strategy:
--   - Rows with lastCheckedAt: nextCheckAt = lastCheckedAt + intervalSeconds
--   - Rows without lastCheckedAt (never checked): nextCheckAt = migration time
--     so they are picked up on the next scheduler tick.

ALTER TABLE "Monitor" ADD COLUMN "nextCheckAt" TIMESTAMP(3);

-- Backfill rows that have been checked before: schedule their next check
-- relative to when they were last checked.
UPDATE "Monitor"
SET "nextCheckAt" = "lastCheckedAt" + ("intervalSeconds" * INTERVAL '1 second')
WHERE "lastCheckedAt" IS NOT NULL;

-- Backfill rows that have never been checked: treat them as immediately due
-- so the scheduler picks them up on the next tick.
UPDATE "Monitor"
SET "nextCheckAt" = NOW()
WHERE "lastCheckedAt" IS NULL;

-- Every monitor must have a scheduled next check.
ALTER TABLE "Monitor" ALTER COLUMN "nextCheckAt" SET NOT NULL;

-- Drop the old single-column status index now superseded by the composite one.
DROP INDEX IF EXISTS "Monitor_status_idx";

-- New composite index covering the scheduler query:
-- WHERE status = 'ACTIVE' AND nextCheckAt <= now
CREATE INDEX "Monitor_status_nextCheckAt_idx" ON "Monitor"("status", "nextCheckAt");
