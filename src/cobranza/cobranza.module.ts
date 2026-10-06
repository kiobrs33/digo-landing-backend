import { Module } from '@nestjs/common';
import { CobranzaController } from './cobranza.controller.js';
import { CobranzaService } from './cobranza.service.js';
import { MensajesController } from './mensajes/mensajes.controller.js';
import { MensajesService } from './mensajes/mensajes.service.js';
import { WhatsappService } from './mensajes/whatsapp.service.js';
import { MikrowispService } from './mikrowisp.service.js';

/**
 * Herramientas temporales de cobranza de Digo Hogar: cargas de deudas y conciliación con
 * Telecrédito (BCP) y Mikrowisp, y mensajes masivos de WhatsApp. No usan la base de datos.
 * Para quitarlas: borrar esta carpeta y su línea en `app.module.ts`.
 */
@Module({
  controllers: [CobranzaController, MensajesController],
  providers: [
    CobranzaService,
    MikrowispService,
    MensajesService,
    WhatsappService,
  ],
})
export class CobranzaModule {}
