DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProductWorkstation" pw
    JOIN "Product" p ON p."id" = pw."productId"
    JOIN "Workstation" w ON w."id" = pw."workstationId"
    WHERE p."locationId" <> w."locationId"
  ) THEN
    RAISE EXCEPTION 'Cannot enforce product station routing: cross-location product-workstation assignments exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProductWorkstation"
    GROUP BY "productId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one workstation per product: duplicate product-workstation assignments exist';
  END IF;
END $$;

CREATE TYPE "ItemCancellationStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "OrderItem"
  ADD COLUMN "cancellationStatus" "ItemCancellationStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "cancellationRequestedAt" TIMESTAMP(3),
  ADD COLUMN "cancellationRequestedBy" TEXT,
  ADD COLUMN "cancellationResolvedAt" TIMESTAMP(3),
  ADD COLUMN "cancellationResolvedBy" TEXT;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_cancellationRequestedBy_fkey"
    FOREIGN KEY ("cancellationRequestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderItem_cancellationResolvedBy_fkey"
    FOREIGN KEY ("cancellationResolvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ProductWorkstation_productId_key" ON "ProductWorkstation"("productId");
