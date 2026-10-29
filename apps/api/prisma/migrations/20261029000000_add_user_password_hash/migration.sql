-- Migration: add_user_password_hash
-- Adds a required passwordHash column to User.
-- Existing rows (dev seed data) receive a placeholder value so the
-- NOT NULL constraint can be applied; those accounts cannot be used
-- for login until a real password is set.

ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- Backfill any pre-existing rows with an invalid sentinel value so the
-- constraint below can be enforced. These rows were created before
-- authentication existed and must be re-created via /auth/register.
UPDATE "User" SET "passwordHash" = 'MIGRATION_PLACEHOLDER_RESET_REQUIRED' WHERE "passwordHash" IS NULL;

ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;
