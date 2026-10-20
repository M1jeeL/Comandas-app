ALTER TABLE "OrderItem"
  ALTER COLUMN "quantity" TYPE DECIMAL(12, 3)
  USING "quantity"::DECIMAL(12, 3);

ALTER TABLE "PreparationTicketItem"
  ALTER COLUMN "quantity" TYPE DECIMAL(12, 3)
  USING "quantity"::DECIMAL(12, 3);
