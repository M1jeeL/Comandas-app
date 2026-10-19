DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CashMovement"
    WHERE "type" = 'SALE' AND "reference" IS NOT NULL
    GROUP BY "type", "reference"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one direct cash sale per payment: duplicate SALE references exist';
  END IF;
END $$;

DROP INDEX "CashMovement_generated_financial_reference_key";

CREATE UNIQUE INDEX "CashMovement_generated_financial_reference_key"
  ON "CashMovement"("type", "reference")
  WHERE "type" IN ('SALE', 'HANDOVER', 'REFUND') AND "reference" IS NOT NULL;
