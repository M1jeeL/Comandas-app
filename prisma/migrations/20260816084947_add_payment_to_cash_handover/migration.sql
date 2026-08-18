/*
  Warnings:

  - A unique constraint covering the columns `[paymentId]` on the table `CashHandover` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "CashHandover" ADD COLUMN     "paymentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CashHandover_paymentId_key" ON "CashHandover"("paymentId");

-- CreateIndex
CREATE INDEX "CashHandover_paymentId_idx" ON "CashHandover"("paymentId");

-- AddForeignKey
ALTER TABLE "CashHandover" ADD CONSTRAINT "CashHandover_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
