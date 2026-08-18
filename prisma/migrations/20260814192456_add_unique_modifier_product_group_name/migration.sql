/*
  Warnings:

  - A unique constraint covering the columns `[productId,groupId,name]` on the table `Modifier` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Modifier_productId_groupId_name_key" ON "Modifier"("productId", "groupId", "name");
