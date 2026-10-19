/*
  Warnings:

  - The values [CASH_HANDOVER] on the enum `AuditAction` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[userId,businessId]` on the table `Membership` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AuditAction_new" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'LOGIN', 'LOGOUT', 'ORDER_CREATED', 'ORDER_SENT', 'ORDER_CANCELLED', 'ORDER_READY', 'ORDER_DELIVERED', 'ORDER_CLOSED', 'ORDER_ITEM_ADDED', 'ORDER_ITEM_UPDATED', 'ORDER_ITEM_CANCELLED', 'PREPARATION_TICKET_CREATED', 'PREPARATION_TICKET_STARTED', 'PREPARATION_TICKET_READY', 'PREPARATION_TICKET_CANCELLED', 'BILL_CREATED', 'BILL_UPDATED', 'BILL_CANCELLED', 'PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'PAYMENT_CANCELLED', 'PAYMENT_REFUNDED', 'CASH_SESSION_OPENED', 'CASH_SESSION_CLOSED', 'CASH_HANDOVER_CREATED', 'CASH_HANDOVER_ACCEPTED', 'CASH_HANDOVER_REJECTED', 'CASH_HANDOVER_CANCELLED', 'CASH_MOVEMENT_CREATED', 'CASH_MOVEMENT_REVERSED', 'CASH_ADJUSTMENT', 'TABLE_CREATED', 'TABLE_UPDATED', 'TABLE_DEACTIVATED', 'TABLE_SESSION_OPENED', 'TABLE_SESSION_UPDATED', 'TABLE_SESSION_CLOSED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DEACTIVATED', 'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DEACTIVATED', 'MODIFIER_GROUP_CREATED', 'MODIFIER_GROUP_UPDATED', 'MODIFIER_GROUP_DEACTIVATED', 'MODIFIER_CREATED', 'MODIFIER_UPDATED', 'MODIFIER_DEACTIVATED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'MEMBERSHIP_CREATED', 'MEMBERSHIP_UPDATED', 'MEMBERSHIP_DEACTIVATED', 'MEMBERSHIP_ROLE_CHANGED', 'DISCOUNT_CREATED', 'DISCOUNT_UPDATED', 'DISCOUNT_DEACTIVATED', 'DISCOUNT_APPLIED', 'DISCOUNT_REMOVED', 'BUSINESS_CREATED', 'BUSINESS_UPDATED', 'LOCATION_CREATED', 'LOCATION_UPDATED', 'LOCATION_DEACTIVATED', 'CONFIGURATION_UPDATED');
ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditAction_new" USING ("action"::text::"AuditAction_new");
ALTER TYPE "AuditAction" RENAME TO "AuditAction_old";
ALTER TYPE "AuditAction_new" RENAME TO "AuditAction";
DROP TYPE "public"."AuditAction_old";
COMMIT;

-- DropIndex
DROP INDEX "Membership_userId_businessId_role_key";

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_idx" ON "RefreshSession"("userId");

-- CreateIndex
CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");

-- CreateIndex
CREATE INDEX "RefreshSession_expiresAt_idx" ON "RefreshSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_businessId_key" ON "Membership"("userId", "businessId");

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
