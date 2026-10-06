-- CreateEnum
CREATE TYPE "ContentAction" AS ENUM ('CREADO', 'EDITADO', 'ELIMINADO', 'REORDENADO');

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "assignedToId" UUID,
ADD COLUMN     "internalNotes" TEXT;

-- CreateTable
CREATE TABLE "ContentChange" (
    "id" UUID NOT NULL,
    "site" "Site" NOT NULL,
    "entity" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "action" "ContentAction" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentChange_site_at_idx" ON "ContentChange"("site", "at");

-- CreateIndex
CREATE INDEX "Complaint_assignedToId_status_idx" ON "Complaint"("assignedToId", "status");

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
