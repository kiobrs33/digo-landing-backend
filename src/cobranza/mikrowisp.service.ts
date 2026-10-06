import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/** Datos del cliente de Mikrowisp que se usan en la conciliación. */
export type ClienteMikrowisp = {
  id: number;
  nombre: string;
  cedula: string;
  estado: string;
  zona: string;
  movil: string;
  fechaSuspendido: string;
  servicios: string[];
  /** Suma del costo mensual de sus servicios. */
  pagoMensual: number;
  facturasNoPagadas: number;
  totalFacturas: number;
};

export type ConsultaCliente =
  | { resultado: 'ENCONTRADO'; cliente: ClienteMikrowisp }
  | { resultado: 'NO_ENCONTRADO' }
  | { resultado: 'ERROR'; error: string };

type ClienteApi = {
  id: number;
  nombre?: string;
  cedula?: string;
  estado?: string;
  ubicacion?: string;
  movil?: string;
  fecha_suspendido?: string;
  servicios?: { perfil?: string; costo?: string | number }[];
  facturacion?: { facturas_nopagadas?: number; total_facturas?: string };
};

/** Factura de Mikrowisp (lo que usa la conciliación). */
export type FacturaMikrowisp = {
  id: number;
  vencimiento: string;
  total: number;
  /** 'YYYY-MM-DD'; vacío si no está pagada. */
  fechaPago: string;
  formaPago: string;
  /** IDs de transacción con que se registraron sus pagos. */
  transacciones: string[];
};

export type FacturasCliente =
  | { ok: true; pendientes: FacturaMikrowisp[]; pagadas: FacturaMikrowisp[] }
  | { ok: false; error: string };

type FacturaApi = {
  id: number;
  vencimiento: string;
  total: string;
  fechapago?: string;
  formapago?: string;
  operaciones?: { transaccion?: string }[];
};

const TIMEOUT_MS = 15_000;
/** Pagadas recientes que se revisan para saber si un pago ya se registró. */
const PAGADAS_A_REVISAR = 12;

@Injectable()
export class MikrowispService {
  private readonly logger = new Logger(MikrowispService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Lanza 503 si falta el token: sin él no se puede conciliar. */
  assertConfigured() {
    if (!this.config.get('MIKROWISP_TOKEN', { infer: true })) {
      throw new ServiceUnavailableException(
        'Falta configurar MIKROWISP_TOKEN en el servidor.',
      );
    }
  }

  /**
   * Busca al cliente por documento. Mikrowisp guarda algunos DNI con el cero inicial y otros sin
   * él: si no aparece, se prueban las otras formas.
   */
  async buscarPorDocumento(documento: string): Promise<ConsultaCliente> {
    const variantes = [
      ...new Set([documento, documento.replace(/^0+/, ''), `0${documento}`]),
    ].filter(Boolean);
    let error: string | undefined;
    for (const cedula of variantes) {
      const consulta = await this.consultar(cedula);
      if (consulta.resultado === 'ENCONTRADO') return consulta;
      if (consulta.resultado === 'ERROR') error = consulta.error;
    }
    return error
      ? { resultado: 'ERROR', error }
      : { resultado: 'NO_ENCONTRADO' };
  }

  /**
   * Facturas pendientes (todas, de la más antigua a la más nueva) y las últimas pagadas del
   * cliente. `GetInvoices` con estado 1 = no pagadas, 0 = pagadas (no documentado; verificado).
   */
  async facturas(idcliente: number): Promise<FacturasCliente> {
    const [pendientes, pagadas] = await Promise.all([
      this.listarFacturas({ idcliente, estado: 1, limit: 100 }),
      this.listarFacturas({ idcliente, estado: 0, limit: PAGADAS_A_REVISAR }),
    ]);
    if (!pendientes.ok) return pendientes;
    if (!pagadas.ok) return pagadas;
    return {
      ok: true,
      pendientes: pendientes.facturas.sort(
        (a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.id - b.id,
      ),
      pagadas: pagadas.facturas,
    };
  }

  private async listarFacturas(
    filtro: Record<string, number>,
  ): Promise<
    { ok: true; facturas: FacturaMikrowisp[] } | { ok: false; error: string }
  > {
    const respuesta = await this.post<{ facturas?: FacturaApi[] }>(
      'GetInvoices',
      filtro,
    );
    if (!respuesta.ok) return respuesta;
    // Sin facturas, Mikrowisp responde estado "error" con "No existe ninguna factura".
    const facturas = (respuesta.data.facturas ?? []).map(
      (factura): FacturaMikrowisp => ({
        id: factura.id,
        vencimiento: factura.vencimiento,
        total: Number(factura.total),
        fechaPago:
          factura.fechapago && factura.fechapago !== '0000-00-00'
            ? factura.fechapago
            : '',
        formaPago: factura.formapago ?? '',
        transacciones: (factura.operaciones ?? [])
          .map((operacion) => operacion.transaccion ?? '')
          .filter(Boolean),
      }),
    );
    return { ok: true, facturas };
  }

  /** POST a la API v1 con el token. `ok: false` solo si falla la conexión o el servidor. */
  private async post<T>(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<
    | { ok: true; data: T & { estado?: string; mensaje?: string } }
    | { ok: false; error: string }
  > {
    const url = `${this.config.get('MIKROWISP_URL', { infer: true })}/api/v1/${endpoint}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: this.config.get('MIKROWISP_TOKEN', { infer: true }),
          ...body,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = (await response.json().catch(() => null)) as
        (T & { estado?: string }) | null;
      if (!response.ok || !data) {
        return { ok: false, error: `Mikrowisp respondió ${response.status}` };
      }
      return { ok: true, data };
    } catch (error) {
      this.logger.warn(`Mikrowisp ${endpoint} falló: ${String(error)}`);
      return { ok: false, error: 'Sin respuesta de Mikrowisp' };
    }
  }

  private async consultar(cedula: string): Promise<ConsultaCliente> {
    const url = `${this.config.get('MIKROWISP_URL', { infer: true })}/api/v1/GetClientsDetails`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: this.config.get('MIKROWISP_TOKEN', { infer: true }),
          cedula,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = (await response.json().catch(() => null)) as {
        estado?: string;
        mensaje?: string;
        datos?: ClienteApi[];
      } | null;
      if (data?.estado === 'exito' && data.datos?.length) {
        return {
          resultado: 'ENCONTRADO',
          cliente: mapearCliente(data.datos[0]),
        };
      }
      if (!response.ok) {
        // Mikrowisp responde 200 con estado "error" cuando no existe el cliente; un código de
        // error HTTP es una falla del servicio.
        return {
          resultado: 'ERROR',
          error: `Mikrowisp respondió ${response.status}`,
        };
      }
      return { resultado: 'NO_ENCONTRADO' };
    } catch (error) {
      this.logger.warn(
        `Consulta a Mikrowisp fallida (${cedula}): ${String(error)}`,
      );
      return { resultado: 'ERROR', error: 'Sin respuesta de Mikrowisp' };
    }
  }
}

function mapearCliente(cliente: ClienteApi): ClienteMikrowisp {
  const servicios = cliente.servicios ?? [];
  return {
    id: cliente.id,
    nombre: cliente.nombre ?? '',
    cedula: cliente.cedula ?? '',
    estado: cliente.estado ?? '',
    zona: cliente.ubicacion ?? '',
    movil: cliente.movil ?? '',
    fechaSuspendido: cliente.fecha_suspendido ?? '',
    servicios: servicios
      .map((servicio) => servicio.perfil ?? '')
      .filter(Boolean),
    pagoMensual:
      Math.round(
        servicios.reduce(
          (total, servicio) => total + Number(servicio.costo ?? 0),
          0,
        ) * 100,
      ) / 100,
    facturasNoPagadas: cliente.facturacion?.facturas_nopagadas ?? 0,
    totalFacturas: Number(cliente.facturacion?.total_facturas ?? 0),
  };
}
