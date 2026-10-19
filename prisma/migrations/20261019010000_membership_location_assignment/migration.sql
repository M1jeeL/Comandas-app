ALTER TABLE "Membership" ADD COLUMN "locationId" TEXT;

UPDATE "Membership" AS membership
SET "locationId" = (
  SELECT location."id"
  FROM "Location" AS location
  WHERE location."businessId" = membership."businessId"
  ORDER BY location."createdAt" ASC, location."id" ASC
  LIMIT 1
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Membership" WHERE "locationId" IS NULL) THEN
    RAISE EXCEPTION 'No se pudo asignar una sucursal a todas las membresías existentes';
  END IF;
END $$;

ALTER TABLE "Membership" ALTER COLUMN "locationId" SET NOT NULL;
ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Membership_locationId_status_idx" ON "Membership"("locationId", "status");
