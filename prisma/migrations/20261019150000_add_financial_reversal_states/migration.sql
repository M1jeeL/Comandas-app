-- Commit new enum values before later migrations use them in data/index expressions.
ALTER TYPE "PaymentStatus" ADD VALUE 'REVERSED';
ALTER TYPE "CashHandoverStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "CashMovementType" ADD VALUE 'REFUND';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_REVERSED';
