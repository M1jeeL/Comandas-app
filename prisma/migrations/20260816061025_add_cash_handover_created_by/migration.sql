/*
  Warnings:

  - Added the required column `createdBy` to the `CashHandover` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CashHandover" ADD COLUMN     "createdBy" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "CashHandover_createdBy_createdAt_idx" ON "CashHandover"("createdBy", "createdAt");

-- AddForeignKey
ALTER TABLE "CashHandover" ADD CONSTRAINT "CashHandover_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
