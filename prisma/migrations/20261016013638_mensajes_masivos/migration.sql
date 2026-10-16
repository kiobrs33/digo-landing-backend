-- CreateEnum
CREATE TYPE "CanalMensaje" AS ENUM ('WHATSAPP', 'CHATWOOT');

-- CreateEnum
CREATE TYPE "EstadoCampana" AS ENUM ('EN_CURSO', 'COMPLETADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "EstadoEnvio" AS ENUM ('PENDIENTE', 'ENVIADO', 'ERROR', 'OMITIDO');

-- CreateTable
CREATE TABLE "MensajeCampana" (
    "id" UUID NOT NULL,
    "cuenta" TEXT NOT NULL,
    "canal" "CanalMensaje" NOT NULL,
    "plantillaNombre" TEXT NOT NULL,
    "idioma" TEXT NOT NULL,
    "plantilla" JSONB NOT NULL,
    "archivo" TEXT NOT NULL,
    "estado" "EstadoCampana" NOT NULL DEFAULT 'EN_CURSO',
    "creadaPorId" UUID,
    "creadaPorNombre" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminadaAt" TIMESTAMP(3),

    CONSTRAINT "MensajeCampana_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MensajeEnvio" (
    "id" UUID NOT NULL,
    "campanaId" UUID NOT NULL,
    "fila" INTEGER NOT NULL,
    "telefono" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "parametros" JSONB NOT NULL,
    "estado" "EstadoEnvio" NOT NULL DEFAULT 'PENDIENTE',
    "detalle" TEXT,
    "messageId" TEXT,
    "conversacionId" INTEGER,
    "mensajeChatwootId" INTEGER,
    "porConfirmar" BOOLEAN NOT NULL DEFAULT false,
    "intentadoAt" TIMESTAMP(3),
    "enviadoAt" TIMESTAMP(3),

    CONSTRAINT "MensajeEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MensajeCampana_cuenta_createdAt_idx" ON "MensajeCampana"("cuenta", "createdAt");

-- CreateIndex
CREATE INDEX "MensajeEnvio_campanaId_estado_idx" ON "MensajeEnvio"("campanaId", "estado");

-- CreateIndex
CREATE INDEX "MensajeEnvio_campanaId_fila_idx" ON "MensajeEnvio"("campanaId", "fila");

-- AddForeignKey
ALTER TABLE "MensajeCampana" ADD CONSTRAINT "MensajeCampana_creadaPorId_fkey" FOREIGN KEY ("creadaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MensajeEnvio" ADD CONSTRAINT "MensajeEnvio_campanaId_fkey" FOREIGN KEY ("campanaId") REFERENCES "MensajeCampana"("id") ON DELETE CASCADE ON UPDATE CASCADE;
