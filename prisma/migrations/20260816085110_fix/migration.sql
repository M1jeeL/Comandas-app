/*
  Warnings:

  - Made the column `paymentId` on table `CashHandover` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "CashHandover" ALTER COLUMN "paymentId" SET NOT NULL;
