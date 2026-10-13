import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { Env } from '../../config/env.js';

/**
 * Cuentas de WhatsApp Cloud API (Meta) desde las que se envían mensajes masivos. Cada una tiene
 * su propio número, sus plantillas y su historial de campañas.
 */
export const CUENTAS = ['digo', 'speednet'] as const;
export type Cuenta = (typeof CUENTAS)[number];

type ClavesCuenta = {
  telefono: keyof Env;
  negocio: keyof Env;
  token: keyof Env;
};

export const clavesCuenta: Record<Cuenta, ClavesCuenta> = {
  digo: {
    telefono: 'WHATSAPP_PHONE_NUMBER_ID',
    negocio: 'WHATSAPP_BUSINESS_ID',
    token: 'WHATSAPP_TOKEN',
  },
  speednet: {
    telefono: 'SPEEDNET_WHATSAPP_PHONE_NUMBER_ID',
    negocio: 'SPEEDNET_WHATSAPP_BUSINESS_ID',
    token: 'SPEEDNET_WHATSAPP_TOKEN',
  },
};

/** `:cuenta` de la URL: solo las cuentas conocidas. */
export class ParseCuentaPipe implements PipeTransform<string, Cuenta> {
  transform(value: string): Cuenta {
    if (!(CUENTAS as readonly string[]).includes(value)) {
      throw new BadRequestException(`Cuenta de WhatsApp desconocida: ${value}`);
    }
    return value as Cuenta;
  }
}
