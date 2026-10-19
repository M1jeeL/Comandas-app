ALTER TABLE "Payment"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "reversedAt" TIMESTAMP(3),
  ADD COLUMN "reversedBy" TEXT,
  ADD COLUMN "reversalReason" TEXT;

ALTER TABLE "CashMovement"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Payment_idempotencyKey_key"
  ON "Payment"("idempotencyKey");

CREATE UNIQUE INDEX "CashMovement_idempotencyKey_key"
  ON "CashMovement"("idempotencyKey");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_reversedBy_fkey"
  FOREIGN KEY ("reversedBy") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level guarantees for operations that were previously read-then-write.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CashSession"
    WHERE "status" = 'OPEN'
    GROUP BY "locationId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one open cash session: duplicate OPEN sessions exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "CashSession_one_open_per_location_key"
  ON "CashSession"("locationId") WHERE "status" = 'OPEN';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "BillOrder"
    GROUP BY "orderId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one bill per order: duplicate bill links exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "BillOrder_orderId_key" ON "BillOrder"("orderId");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CashMovement"
    WHERE "type" = 'HANDOVER' AND "reference" IS NOT NULL
    GROUP BY "type", "reference"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one handover movement: duplicate references exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "CashMovement_generated_financial_reference_key"
  ON "CashMovement"("type", "reference")
  WHERE "type" IN ('HANDOVER', 'REFUND') AND "reference" IS NOT NULL;

CREATE INDEX "Payment_status_reversedAt_idx"
  ON "Payment"("status", "reversedAt");
