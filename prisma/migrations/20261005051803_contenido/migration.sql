-- CreateEnum
CREATE TYPE "MediaProvider" AS ENUM ('CLOUDINARY', 'LOCAL');

-- CreateEnum
CREATE TYPE "AboutCategory" AS ENUM ('EQUIPO', 'PROYECTOS', 'OFICINAS', 'ACTIVIDADES');

-- AlterTable
ALTER TABLE "AboutPhoto" ADD COLUMN     "category" "AboutCategory" NOT NULL DEFAULT 'PROYECTOS';

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "provider" "MediaProvider" NOT NULL DEFAULT 'CLOUDINARY';

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "tvPackage" TEXT;

-- CreateTable
CREATE TABLE "SitePublication" (
    "site" "Site" NOT NULL,
    "contentUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "publishedById" UUID,

    CONSTRAINT "SitePublication_pkey" PRIMARY KEY ("site")
);

-- AddForeignKey
ALTER TABLE "SitePublication" ADD CONSTRAINT "SitePublication_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
