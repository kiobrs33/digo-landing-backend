-- CreateTable
CREATE TABLE "CoverageZone" (
    "id" UUID NOT NULL,
    "site" "Site" NOT NULL,
    "name" TEXT NOT NULL,
    "detail" TEXT,
    "color" TEXT NOT NULL,
    "rings" JSONB NOT NULL,
    "osmRef" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverageZone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoverageZone_site_position_idx" ON "CoverageZone"("site", "position");
