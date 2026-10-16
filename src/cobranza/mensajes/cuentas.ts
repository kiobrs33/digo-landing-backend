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

type ClavesChatwoot = {
  url: keyof Env;
  cuenta: keyof Env;
  bandeja: keyof Env;
  token: keyof Env;
};

/** Chatwoot de cada cuenta: la bandeja de WhatsApp conectada al mismo número de Meta. */
export const clavesChatwoot: Record<Cuenta, ClavesChatwoot> = {
  digo: {
    url: 'CHATWOOT_URL',
    cuenta: 'CHATWOOT_ACCOUNT_ID',
    bandeja: 'CHATWOOT_INBOX_ID',
    token: 'CHATWOOT_TOKEN',
  },
  speednet: {
    url: 'SPEEDNET_CHATWOOT_URL',
    cuenta: 'SPEEDNET_CHATWOOT_ACCOUNT_ID',
    bandeja: 'SPEEDNET_CHATWOOT_INBOX_ID',
    token: 'SPEEDNET_CHATWOOT_TOKEN',
  },
};

/** Por dónde sale el mensaje: directo a Meta o por la bandeja de Chatwoot. */
export const CANALES = ['WHATSAPP', 'CHATWOOT'] as const;
export type Canal = (typeof CANALES)[number];

/** `:cuenta` de la URL: solo las cuentas conocidas. */
export class ParseCuentaPipe implements PipeTransform<string, Cuenta> {
  transform(value: string): Cuenta {
    if (!(CUENTAS as readonly string[]).includes(value)) {
      throw new BadRequestException(`Cuenta de WhatsApp desconocida: ${value}`);
    }
    return value as Cuenta;
  }
}
