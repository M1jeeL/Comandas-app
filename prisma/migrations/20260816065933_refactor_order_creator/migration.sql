/*
  Warnings:

  - Added the required column `createdBy` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "createdBy" TEXT NOT NULL,
ALTER COLUMN "waiterId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Order_createdBy_status_idx" ON "Order"("createdBy", "status");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
