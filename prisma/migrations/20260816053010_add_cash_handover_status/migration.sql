-- CreateEnum
CREATE TYPE "CashHandoverStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "CashHandover" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "status" "CashHandoverStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "CashHandover_status_idx" ON "CashHandover"("status");
