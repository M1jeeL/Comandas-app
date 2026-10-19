CREATE TYPE "TableOperationalStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'OUT_OF_SERVICE');

ALTER TABLE "RestaurantTable"
  ADD COLUMN "operationalStatus" "TableOperationalStatus" NOT NULL DEFAULT 'AVAILABLE';
