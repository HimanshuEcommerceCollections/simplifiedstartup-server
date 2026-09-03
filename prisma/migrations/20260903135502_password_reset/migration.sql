-- AlterTable
ALTER TABLE "User" ADD COLUMN "resetExpiresAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "resetTokenHash" TEXT;
