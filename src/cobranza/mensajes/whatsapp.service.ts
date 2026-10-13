import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { clavesCuenta, type Cuenta } from './cuentas.js';
import {
  type Plantilla,
  type PlantillaMeta,
  resumirPlantilla,
} from './plantillas.js';

const GRAPH_URL = 'https://graph.facebook.com/v25.0';
const TIMEOUT_MS = 20_000;
/** Las plantillas cambian poco: se guardan unos minutos para no consultar a Meta en cada vista. */
const PLANTILLAS_TTL_MS = 5 * 60_000;

export type ResultadoEnvio =
  | { ok: true; messageId: string }
  | { ok: false; error: string; reintentable: boolean };

type ErrorMeta = {
  error?: {
    message?: string;
    code?: number;
    error_data?: { details?: string };
  };
};

const espera = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly plantillas = new Map<
    Cuenta,
    { lista: Plantilla[]; expira: number }
  >();

  constructor(private readonly config: ConfigService<Env, true>) {}

  private valor(cuenta: Cuenta, clave: 'telefono' | 'negocio' | 'token') {
    return String(this.config.get(clavesCuenta[cuenta][clave]) ?? '');
  }

  assertConfigured(cuenta: Cuenta) {
    const faltan = Object.values(clavesCuenta[cuenta]).filter(
      (key) => !this.config.get(key),
    );
    if (faltan.length) {
      throw new ServiceUnavailableException(
        `Falta configurar en el servidor: ${faltan.join(', ')}.`,
      );
    }
  }

  private headers(cuenta: Cuenta) {
    return {
      Authorization: `Bearer ${this.valor(cuenta, 'token')}`,
      'Content-Type': 'application/json',
    };
  }

  /** Plantillas aprobadas de la cuenta, todas las páginas. */
  async listarPlantillas(
    cuenta: Cuenta,
    refrescar = false,
  ): Promise<Plantilla[]> {
    this.assertConfigured(cuenta);
    const guardadas = this.plantillas.get(cuenta);
    if (!refrescar && guardadas && guardadas.expira > Date.now()) {
      return guardadas.lista;
    }
    const waba = this.valor(cuenta, 'negocio');
    let url: string | undefined =
      `${GRAPH_URL}/${waba}/message_templates?limit=100&fields=id,name,language,status,category,parameter_format,components`;
    const todas: PlantillaMeta[] = [];
    while (url) {
      const response = await fetch(url, {
        headers: this.headers(cuenta),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => null);
      const data = (await response?.json().catch(() => null)) as
        | ({ data?: PlantillaMeta[]; paging?: { next?: string } } & ErrorMeta)
        | null;
      if (!response?.ok || !data?.data) {
        throw new BadGatewayException(
          `No se pudieron leer las plantillas de WhatsApp: ${mensajeError(data) ?? 'sin respuesta de Meta'}`,
        );
      }
      todas.push(...data.data);
      url = data.paging?.next;
    }
    const lista = todas
      .filter((plantilla) => plantilla.status === 'APPROVED')
      .map(resumirPlantilla)
      .sort(
        (a, b) =>
          a.nombre.localeCompare(b.nombre) || a.idioma.localeCompare(b.idioma),
      );
    this.plantillas.set(cuenta, {
      lista,
      expira: Date.now() + PLANTILLAS_TTL_MS,
    });
    return lista;
  }

  async plantilla(cuenta: Cuenta, nombre: string, idioma: string) {
    const plantilla = (await this.listarPlantillas(cuenta)).find(
      (item) => item.nombre === nombre && item.idioma === idioma,
    );
    if (!plantilla) {
      throw new NotFoundException(
        `La plantilla ${nombre} (${idioma}) no existe o no está aprobada.`,
      );
    }
    return plantilla;
  }

  /**
   * Envía un mensaje. Reintenta solo lo que no llegó a Meta o lo que Meta pide reintentar (límite
   * de velocidad, error del servidor): un error de datos (4xx) no se reintenta para no duplicar.
   */
  async enviar(
    cuenta: Cuenta,
    cuerpo: unknown,
    intentos = 3,
  ): Promise<ResultadoEnvio> {
    const url = `${GRAPH_URL}/${this.valor(cuenta, 'telefono')}/messages`;
    let ultimo: ResultadoEnvio = {
      ok: false,
      error: 'Sin respuesta',
      reintentable: true,
    };
    for (let intento = 1; intento <= intentos; intento++) {
      ultimo = await this.enviarUnaVez(cuenta, url, cuerpo);
      if (ultimo.ok || !ultimo.reintentable) return ultimo;
      if (intento < intentos) await espera(1000 * 2 ** (intento - 1));
    }
    return ultimo;
  }

  private async enviarUnaVez(
    cuenta: Cuenta,
    url: string,
    cuerpo: unknown,
  ): Promise<ResultadoEnvio> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.headers(cuenta),
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Un timeout puede haber llegado a Meta: no se reintenta para no enviar dos veces.
      const timeout = error instanceof Error && error.name === 'TimeoutError';
      this.logger.warn(`Envío a WhatsApp fallido: ${String(error)}`);
      return {
        ok: false,
        error: timeout
          ? 'Meta no respondió a tiempo (revisar si llegó)'
          : 'Sin conexión con Meta',
        reintentable: !timeout,
      };
    }
    const data = (await response.json().catch(() => null)) as
      ({ messages?: { id: string }[] } & ErrorMeta) | null;
    const messageId = data?.messages?.[0]?.id;
    if (response.ok && messageId) return { ok: true, messageId };
    const code = data?.error?.code;
    return {
      ok: false,
      error: mensajeError(data) ?? `Meta respondió ${response.status}`,
      // 429 / 5xx, o los códigos de límite de velocidad de la Cloud API.
      reintentable:
        response.status === 429 ||
        response.status >= 500 ||
        code === 4 ||
        code === 80007 ||
        code === 130429,
    };
  }
}

function mensajeError(data: ErrorMeta | null): string | undefined {
  const error = data?.error;
  if (!error) return undefined;
  const detalle = error.error_data?.details;
  const base = error.message ?? 'Error de Meta';
  return `${detalle && detalle !== base ? `${base}: ${detalle}` : base}${error.code ? ` (${error.code})` : ''}`;
}
