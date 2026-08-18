-- AlterTable
ALTER TABLE "ModifierGroup" ADD COLUMN     "maxSelections" INTEGER,
ADD COLUMN     "minSelections" INTEGER NOT NULL DEFAULT 0;
