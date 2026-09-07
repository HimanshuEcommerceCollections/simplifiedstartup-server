/*
  Warnings:

  - You are about to drop the column `cvPath` on the `JobApplication` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "JobApplication" DROP COLUMN "cvPath",
ADD COLUMN     "cvUrl" TEXT;
