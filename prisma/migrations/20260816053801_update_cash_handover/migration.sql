-- AlterTable
ALTER TABLE "CashHandover" ADD COLUMN     "rejectReason" TEXT,
ALTER COLUMN "receivedBy" DROP NOT NULL;
