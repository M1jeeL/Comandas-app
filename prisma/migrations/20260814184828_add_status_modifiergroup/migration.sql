-- CreateEnum
CREATE TYPE "ModifierGroupStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "ModifierGroup" ADD COLUMN     "status" "ModifierGroupStatus" NOT NULL DEFAULT 'ACTIVE';
