import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { clavesChatwoot, type Cuenta } from './cuentas.js';
import {
  parametrosChatwoot,
  type ParametrosMensaje,
  type Plantilla,
  textoPlantilla,
} from './plantillas.js';

const TIMEOUT_MS = 20_000;
/** Las plantillas que Chatwoot ya sincronizó con Meta: se guardan unos minutos. */
const PLANTILLAS_TTL_MS = 5 * 60_000;

export type ResultadoChatwoot =
  | { ok: true; conversacionId: number; mensajeId: number | null }
  | { ok: false; error: string; reintentable: boolean };

/** Lo que pasó con el mensaje después de que Chatwoot lo pasó (o no) a WhatsApp. */
export type EstadoChatwoot =
  | { estado: 'ENVIADO'; wamid: string }
  | { estado: 'ERROR'; error: string }
  /** Chatwoot aún no lo envía a WhatsApp (su cola va atrasada). */
  | { estado: 'EN_COLA' };

class ErrorChatwoot extends Error {
  constructor(
    readonly motivo: string,
    readonly reintentable: boolean,
  ) {
    super(motivo);
  }
}

type Registro = Record<string, unknown>;

const espera = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Envía plantillas de WhatsApp por la bandeja de Chatwoot (API de aplicación, con el token de un
 * agente). Chatwoot las manda con el mismo número de Meta y cada envío queda como conversación,
 * así los agentes ven la respuesta del cliente. El token va solo en la cabecera
 * `api_access_token`: no se registra en los logs.
 */
@Injectable()
export class ChatwootService {
  private readonly logger = new Logger(ChatwootService.name);
  private readonly plantillas = new Map<
    Cuenta,
    { claves: Set<string>; expira: number }
  >();

  constructor(private readonly config: ConfigService<Env, true>) {}

  configurado(cuenta: Cuenta) {
    return Object.values(clavesChatwoot[cuenta]).every((key) =>
      this.config.get(key),
    );
  }

  assertConfigured(cuenta: Cuenta) {
    const faltan = Object.values(clavesChatwoot[cuenta]).filter(
      (key) => !this.config.get(key),
    );
    if (faltan.length) {
      throw new ServiceUnavailableException(
        `Falta configurar Chatwoot en el servidor: ${faltan.join(', ')}.`,
      );
    }
  }

  private valor(cuenta: Cuenta, clave: keyof (typeof clavesChatwoot)['digo']) {
    return String(this.config.get(clavesChatwoot[cuenta][clave]) ?? '');
  }

  private bandeja(cuenta: Cuenta) {
    return Number(this.valor(cuenta, 'bandeja'));
  }

  /** Enlace a la conversación en el panel de Chatwoot (para el reporte del envío). */
  enlaceConversacion(cuenta: Cuenta, conversacionId: number) {
    return `${this.valor(cuenta, 'url')}/app/accounts/${this.valor(cuenta, 'cuenta')}/conversations/${conversacionId}`;
  }

  /**
   * Chatwoot solo pone las variables si ya tiene la plantilla sincronizada desde Meta; si no, la
   * envía sin ellas y Meta la rechaza. Se revisa antes de enviar.
   */
  async assertPlantilla(cuenta: Cuenta, plantilla: Plantilla) {
    const clave = `${plantilla.nombre}|${plantilla.idioma.toLowerCase()}`;
    let guardadas = this.plantillas.get(cuenta);
    if (
      !guardadas ||
      guardadas.expira < Date.now() ||
      !guardadas.claves.has(clave)
    ) {
      const bandeja = await this.pedir(
        cuenta,
        'GET',
        `/inboxes/${this.bandeja(cuenta)}`,
      ).catch((error: unknown) => {
        throw new BadGatewayException(
          `No se pudo leer la bandeja de Chatwoot: ${error instanceof ErrorChatwoot ? error.motivo : String(error)}`,
        );
      });
      const lista = Array.isArray(bandeja.message_templates)
        ? (bandeja.message_templates as Registro[])
        : [];
      guardadas = {
        claves: new Set(
          lista
            .filter((item) => String(item.status).toLowerCase() === 'approved')
            .map(
              (item) =>
                `${String(item.name)}|${String(item.language).toLowerCase()}`,
            ),
        ),
        expira: Date.now() + PLANTILLAS_TTL_MS,
      };
      this.plantillas.set(cuenta, guardadas);
    }
    if (!guardadas.claves.has(clave)) {
      throw new BadRequestException(
        `Chatwoot todavía no tiene la plantilla "${plantilla.nombre}" (${plantilla.idioma}). En Chatwoot, sincroniza las plantillas de la bandeja de WhatsApp y vuelve a intentarlo.`,
      );
    }
  }

  /**
   * Envía la plantilla al cliente: busca (o crea) el contacto en la bandeja y escribe en su
   * conversación abierta, o abre una nueva. Chatwoot la pasa a WhatsApp en segundo plano: usar
   * `estado` para saber si Meta la aceptó.
   */
  async enviar(
    cuenta: Cuenta,
    plantilla: Plantilla,
    telefono: string,
    nombre: string,
    parametros: ParametrosMensaje,
    intentos = 3,
  ): Promise<ResultadoChatwoot> {
    let ultimo: ResultadoChatwoot = {
      ok: false,
      error: 'Sin respuesta de Chatwoot',
      reintentable: true,
    };
    for (let intento = 1; intento <= intentos; intento++) {
      try {
        return await this.enviarUnaVez(
          cuenta,
          plantilla,
          telefono,
          nombre,
          parametros,
        );
      } catch (error) {
        ultimo =
          error instanceof ErrorChatwoot
            ? {
                ok: false,
                error: error.motivo,
                reintentable: error.reintentable,
              }
            : { ok: false, error: String(error), reintentable: false };
        if (!ultimo.reintentable) return ultimo;
        if (intento < intentos) await espera(1000 * 2 ** (intento - 1));
      }
    }
    return ultimo;
  }

  private async enviarUnaVez(
    cuenta: Cuenta,
    plantilla: Plantilla,
    telefono: string,
    nombre: string,
    parametros: ParametrosMensaje,
  ): Promise<ResultadoChatwoot> {
    const bandeja = this.bandeja(cuenta);
    const contacto = await this.contacto(cuenta, telefono, nombre);
    const mensaje = {
      content: textoPlantilla(plantilla, parametros),
      template_params: {
        name: plantilla.nombre,
        category: plantilla.categoria,
        language: plantilla.idioma,
        processed_params: parametrosChatwoot(plantilla, parametros),
      },
    };

    const abierta = await this.conversacionAbierta(cuenta, contacto.id);
    if (abierta) {
      const creado = await this.pedir(
        cuenta,
        'POST',
        `/conversations/${abierta}/messages`,
        { ...mensaje, message_type: 'outgoing' },
      );
      return {
        ok: true,
        conversacionId: abierta,
        mensajeId: typeof creado.id === 'number' ? creado.id : null,
      };
    }

    const sourceId =
      contacto.sourceId ??
      texto(
        (
          await this.pedir(
            cuenta,
            'POST',
            `/contacts/${contacto.id}/contact_inboxes`,
            {
              inbox_id: bandeja,
            },
          )
        ).source_id,
      );
    if (!sourceId) {
      throw new ErrorChatwoot(
        'Chatwoot no pudo añadir el contacto a la bandeja de WhatsApp.',
        false,
      );
    }
    const conversacion = await this.pedir(cuenta, 'POST', '/conversations', {
      source_id: sourceId,
      inbox_id: bandeja,
      contact_id: contacto.id,
      message: mensaje,
    });
    if (typeof conversacion.id !== 'number') {
      throw new ErrorChatwoot(
        'Chatwoot respondió algo inesperado al crear la conversación.',
        false,
      );
    }
    return { ok: true, conversacionId: conversacion.id, mensajeId: null };
  }

  /**
   * Si WhatsApp aceptó el mensaje (Chatwoot guarda su `wamid`) o lo rechazó (estado `failed` con
   * el error de Meta). Sin `mensajeId` (conversación nueva) se toma el último mensaje saliente.
   */
  async estado(
    cuenta: Cuenta,
    conversacionId: number,
    mensajeId: number | null,
  ): Promise<EstadoChatwoot> {
    const respuesta = await this.pedir(
      cuenta,
      'GET',
      `/conversations/${conversacionId}/messages`,
    );
    const mensajes = Array.isArray(respuesta.payload)
      ? (respuesta.payload as Registro[])
      : [];
    const mensaje = mensajeId
      ? mensajes.find((item) => item.id === mensajeId)
      : mensajes.filter((item) => item.message_type === 1).at(-1);
    if (!mensaje) return { estado: 'EN_COLA' };
    if (mensaje.status === 'failed') {
      const atributos = asRegistro(mensaje.content_attributes);
      return {
        estado: 'ERROR',
        error: `WhatsApp no lo envió: ${texto(atributos.external_error) || 'sin detalle de Chatwoot'}`,
      };
    }
    return typeof mensaje.source_id === 'string' && mensaje.source_id
      ? { estado: 'ENVIADO', wamid: mensaje.source_id }
      : { estado: 'EN_COLA' };
  }

  /** Contacto con ese celular (la búsqueda de Chatwoot es parcial: se exige el número exacto). */
  private async contacto(cuenta: Cuenta, telefono: string, nombre: string) {
    const bandeja = this.bandeja(cuenta);
    const busqueda = await this.pedir(
      cuenta,
      'GET',
      `/contacts/search?q=${encodeURIComponent(telefono)}`,
    );
    const encontrados = Array.isArray(busqueda.payload)
      ? (busqueda.payload as Registro[])
      : [];
    const existente = encontrados.find(
      (item) =>
        typeof item.id === 'number' &&
        texto(item.phone_number).replace(/\D/g, '') === telefono,
    );
    if (existente) {
      return {
        id: existente.id as number,
        sourceId: sourceIdEn(existente, bandeja),
      };
    }

    const creado = await this.pedir(cuenta, 'POST', '/contacts', {
      inbox_id: bandeja,
      name: nombre || `+${telefono}`,
      phone_number: `+${telefono}`,
    });
    // Según la versión: `{ payload: { contact, contact_inbox } }` o el contacto directo.
    const payload = asRegistro(creado.payload);
    const contacto = payload.contact ? asRegistro(payload.contact) : payload;
    const id = typeof contacto.id === 'number' ? contacto.id : creado.id;
    if (typeof id !== 'number') {
      throw new ErrorChatwoot(
        'Chatwoot respondió algo inesperado al crear el contacto.',
        false,
      );
    }
    const contactInbox = asRegistro(payload.contact_inbox);
    return {
      id,
      sourceId:
        typeof contactInbox.source_id === 'string'
          ? contactInbox.source_id
          : sourceIdEn(contacto, bandeja),
    };
  }

  /** La conversación sin resolver más reciente del contacto en esta bandeja, si tiene. */
  private async conversacionAbierta(cuenta: Cuenta, contactoId: number) {
    const bandeja = this.bandeja(cuenta);
    const respuesta = await this.pedir(
      cuenta,
      'GET',
      `/contacts/${contactoId}/conversations`,
    );
    const conversaciones = Array.isArray(respuesta.payload)
      ? (respuesta.payload as Registro[])
      : [];
    const abierta = conversaciones
      .filter(
        (item) =>
          item.inbox_id === bandeja &&
          item.status !== 'resolved' &&
          typeof item.id === 'number',
      )
      .sort(
        (a, b) =>
          Number(b.last_activity_at ?? 0) - Number(a.last_activity_at ?? 0),
      )[0];
    return abierta ? (abierta.id as number) : null;
  }

  private async pedir(
    cuenta: Cuenta,
    method: 'GET' | 'POST',
    ruta: string,
    body?: Record<string, unknown>,
  ): Promise<Registro> {
    let response: Response;
    try {
      response = await fetch(
        `${this.valor(cuenta, 'url')}/api/v1/accounts/${this.valor(cuenta, 'cuenta')}${ruta}`,
        {
          method,
          headers: {
            api_access_token: this.valor(cuenta, 'token'),
            accept: 'application/json',
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          // Una redirección se llevaría la cabecera con el token a otro sitio.
          redirect: 'error',
        },
      );
    } catch (error) {
      // Un POST que se cortó por tiempo puede haber llegado: no se reintenta para no duplicar.
      const timeout = error instanceof Error && error.name === 'TimeoutError';
      this.logger.warn(
        `Chatwoot ${method} ${ruta.split('?')[0]}: ${String(error)}`,
      );
      throw new ErrorChatwoot(
        timeout
          ? 'Chatwoot no respondió a tiempo (revisar si llegó)'
          : 'Sin conexión con Chatwoot',
        !timeout || method === 'GET',
      );
    }
    const data = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const detalle = asRegistro(data);
      const texto = [detalle.message, detalle.error]
        .flat()
        .filter((item) => typeof item === 'string' && item)
        .join(': ');
      throw new ErrorChatwoot(
        `${describirEstado(response.status)}${texto ? ` (${texto})` : ''}`,
        response.status === 429 || response.status >= 500,
      );
    }
    return asRegistro(data);
  }
}

function describirEstado(status: number) {
  switch (status) {
    case 401:
      return 'Chatwoot rechazó el token de acceso';
    case 403:
      return 'El token de Chatwoot no tiene permiso en esa bandeja';
    case 404:
      return 'Chatwoot no encontró la cuenta, la bandeja o el contacto';
    case 422:
      return 'Chatwoot rechazó el mensaje';
    case 429:
      return 'Chatwoot está limitando los envíos';
  }
  return `Chatwoot respondió ${status}`;
}

/** Valor de texto (o número) de la respuesta; '' si es otra cosa. */
function texto(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

function asRegistro(value: unknown): Registro {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Registro)
    : {};
}

function sourceIdEn(contacto: Registro, bandeja: number): string | null {
  const bandejas = Array.isArray(contacto.contact_inboxes)
    ? (contacto.contact_inboxes as Registro[])
    : [];
  const entrada = bandejas.find(
    (item) => asRegistro(item.inbox).id === bandeja,
  );
  return entrada && typeof entrada.source_id === 'string'
    ? entrada.source_id
    : null;
}
