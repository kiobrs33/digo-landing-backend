import { BadRequestException } from '@nestjs/common';
import type { SheetRow } from './excel-input.js';

/**
 * Registro de la carga de deudas de Telecrédito (BCP). Los nombres y el orden de las claves son
 * los encabezados del Excel que se sube al BCP: no cambiarlos.
 */
export type RegistroTelecredito = {
  codigo_depositante: string;
  nombre_depositante: string;
  informacion_retorno: string;
  fecha_emision: string;
  fecha_vencimiento: string;
  monto_pagar: number;
  mora_cargo_fijo: number;
  monto_minimo: number;
  tipo_registro: string;
  nro_documento_pago: string;
  nro_documento_identidad: string;
};

export const TELECREDITO_HEADERS: (keyof RegistroTelecredito)[] = [
  'codigo_depositante',
  'nombre_depositante',
  'informacion_retorno',
  'fecha_emision',
  'fecha_vencimiento',
  'monto_pagar',
  'mora_cargo_fijo',
  'monto_minimo',
  'tipo_registro',
  'nro_documento_pago',
  'nro_documento_identidad',
];

/** Clientes de un ciclo (día de pago) en el Excel de Mikrowisp. */
export type CicloDeudas = {
  dia: number;
  clientes: number;
  conDeuda: number;
  monto: number;
};

/** Datos del cliente que no van al BCP pero ayudan a revisar la carga (mismo orden que `registros`). */
export type DetalleDeuda = {
  estado: string;
  /** Recibos pendientes según Mikrowisp ("2 S/. 158.00" → 2). */
  recibos: number;
};

/** Resultado del parser: los registros y lo que no entró. */
export type ResultadoDeudas = {
  registros: RegistroTelecredito[];
  detalles: DetalleDeuda[];
  /** Filas con un problema que hay que corregir en Mikrowisp. */
  omitidos: { fila: number; nombre: string; motivo: string }[];
  /** Ciclos del Excel (solo clientes ACTIVO y SUSPENDIDO). */
  ciclos: CicloDeudas[];
  /** Clientes que no entran por su estado (RETIRADO, BAJA…), por estado. */
  excluidosPorEstado: Record<string, number>;
  /** Clientes del ciclo elegido que no deben nada (no se cargan salvo que se pida). */
  sinDeuda: number;
};

// ─── Utilidades ────────────────────────────────────────────────────────────

/** Fecha 'YYYY-MM-DD' (como la da `limaIsoDate`) → 'DD/MM/YYYY'. */
export const formatoBcp = (iso: string) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';

export function sumarDias(iso: string, dias: number): string {
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dias);
  return date.toISOString().slice(0, 10);
}

/** Nombre del mes en mayúsculas, como lo usa el BCP en "información de retorno" (OCTUBRE). */
export function nombreMes(iso: string): string {
  const date = new Date(`${iso.slice(0, 7)}-15T12:00:00Z`);
  return new Intl.DateTimeFormat('es-PE', { month: 'long', timeZone: 'UTC' })
    .format(date)
    .toUpperCase();
}

/**
 * Nombre como lo acepta el BCP: mayúsculas sin tildes (Ñ → N) y solo letras, números, espacios
 * y `*,-./#()+&` (validación del macro de Telecrédito). Lo demás pasa a espacio.
 */
export const normalizarNombre = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9*,\-./#()+& ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Monto de Mikrowisp: "S/. 89.00", "1 S/. 1,234.50" (la cantidad de facturas va delante).
 * Toma el número que sigue al símbolo de soles; sin símbolo, el texto entero.
 */
export function parseMonto(texto: string): number {
  const value = texto.trim();
  if (!value) return 0;
  const match = /S\/\.?\s*([\d.,]+)/i.exec(value);
  const number = Number((match ? match[1] : value).replace(/,/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

/** Cantidad de recibos que Mikrowisp antepone al monto ("2 S/. 158.00" → 2; sin deuda → 0). */
export function contarRecibos(texto: string): number {
  const match = /^\s*(\d+)\s*S\//i.exec(texto);
  return match ? Number(match[1]) : 0;
}

/**
 * Documento de identidad. Excel guarda el DNI como número y pierde el cero inicial
 * (03872061 → 3872061): todo número de menos de 8 dígitos se completa a 8.
 */
export function normalizarDocumento(texto: string): string {
  const value = texto.trim();
  return /^\d{1,7}$/.test(value) ? value.padStart(8, '0') : value;
}

// ─── Deudas por cliente (reporte "Lista de Usuarios") ────────────────────────

const ESTADOS_INCLUIDOS = ['ACTIVO', 'SUSPENDIDO'];
const ESTADOS_MIKROWISP = [...ESTADOS_INCLUIDOS, 'RETIRADO', 'BAJA'];

export const COLUMNAS_USUARIOS = [
  'Nombre',
  'Cedula',
  'Dia pago',
  'Deuda actual',
];

export type OpcionesUsuarios = {
  /** Hoy en Lima, 'YYYY-MM-DD': la emisión cae en este mes. */
  hoy: string;
  diasVencimiento: number;
  /** Día de pago del ciclo a cargar; sin él, todos los ciclos. */
  ciclo?: number;
  /** Cargar también a los que no deben (monto 0). */
  incluirSinDeuda?: boolean;
};

/**
 * Mikrowisp pega el estado al final del nombre: "JUAN PEREZ  ACTIVO". Solo cuenta como estado
 * la última palabra, así "INACTIVO" o un apellido como "BAJAÑA" no se confunden.
 */
export function separarEstado(nombre: string) {
  const match = /^(.*?)\s+(\S+)\s*$/.exec(nombre.trim());
  const estado = match?.[2].toUpperCase() ?? '';
  if (!match || !ESTADOS_MIKROWISP.includes(estado)) {
    return { nombre: nombre.trim(), estado: '' };
  }
  return { nombre: match[1], estado };
}

/** Día de pago dentro del mes de `hoy`; el 31 en un mes de 30 días queda en el último día. */
function emisionDelMes(hoy: string, diaPago: number): string {
  const [year, month] = hoy.split('-').map(Number);
  const ultimo = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dia = Math.min(diaPago, ultimo);
  return `${hoy.slice(0, 7)}-${String(dia).padStart(2, '0')}`;
}

/**
 * Carga de deudas por cliente desde la "Lista de Usuarios" completa de Mikrowisp: solo ACTIVO y
 * SUSPENDIDO, del ciclo elegido y (salvo que se pida) con deuda. Ordenada de mayor a menor deuda;
 * el número de documento de pago es B + MM + YY + correlativo de 4 dígitos en ese orden (el BCP
 * lo devuelve en el reporte de cobros).
 */
export function deudasPorUsuarios(
  filas: SheetRow[],
  { hoy, diasVencimiento, ciclo, incluirSinDeuda = false }: OpcionesUsuarios,
): ResultadoDeudas {
  const mes = nombreMes(hoy);
  const omitidos: ResultadoDeudas['omitidos'] = [];
  const excluidosPorEstado: Record<string, number> = {};
  const ciclos = new Map<number, CicloDeudas>();
  let sinDeuda = 0;
  const validos: (Omit<RegistroTelecredito, 'nro_documento_pago'> & {
    emisionIso: string;
    fila: number;
    detalle: DetalleDeuda;
  })[] = [];

  filas.forEach((fila, index) => {
    const numeroFila = index + 3;
    const { nombre, estado } = separarEstado(fila['Nombre'] ?? '');
    const omitir = (motivo: string) =>
      omitidos.push({
        fila: numeroFila,
        nombre: normalizarNombre(nombre),
        motivo,
      });
    if (!estado) return omitir('Sin estado al final del nombre');
    if (!ESTADOS_INCLUIDOS.includes(estado)) {
      excluidosPorEstado[estado] = (excluidosPorEstado[estado] ?? 0) + 1;
      return;
    }
    const documento = normalizarDocumento(fila['Cedula'] ?? '');
    const diaPago = Number(fila['Dia pago']);
    if (!Number.isInteger(diaPago) || diaPago < 1 || diaPago > 31) {
      return omitir('Día de pago inválido');
    }
    const monto = parseMonto(fila['Deuda actual'] ?? '');
    const resumen = ciclos.get(diaPago) ?? {
      dia: diaPago,
      clientes: 0,
      conDeuda: 0,
      monto: 0,
    };
    resumen.clientes++;
    if (monto > 0) {
      resumen.conDeuda++;
      resumen.monto = Math.round((resumen.monto + monto) * 100) / 100;
    }
    ciclos.set(diaPago, resumen);

    if (ciclo !== undefined && diaPago !== ciclo) return;
    if (monto === 0 && !incluirSinDeuda) {
      sinDeuda++;
      return;
    }
    if (!/^[A-Z0-9]{1,14}$/i.test(documento)) {
      return omitir(
        documento ? 'Cédula con caracteres no válidos' : 'Sin cédula',
      );
    }
    const emisionIso = emisionDelMes(hoy, diaPago);
    validos.push({
      emisionIso,
      fila: numeroFila,
      detalle: { estado, recibos: contarRecibos(fila['Deuda actual'] ?? '') },
      codigo_depositante: documento,
      nombre_depositante: normalizarNombre(nombre),
      informacion_retorno: mes,
      fecha_emision: formatoBcp(emisionIso),
      fecha_vencimiento: formatoBcp(sumarDias(emisionIso, diasVencimiento)),
      monto_pagar: monto,
      mora_cargo_fijo: 0,
      monto_minimo: monto,
      tipo_registro: 'No Aplica',
      nro_documento_identidad: documento,
    });
  });

  // El BCP no acepta dos deudas con el mismo depositante y vencimiento (p. ej. dos cuentas de
  // Mikrowisp con la misma cédula): se carga la primera y se avisa de la otra.
  const vistos = new Map<string, number>();
  const unicos = validos.filter((registro) => {
    const clave = `${registro.codigo_depositante}|${registro.fecha_vencimiento}`;
    const primera = vistos.get(clave);
    if (primera !== undefined) {
      omitidos.push({
        fila: registro.fila,
        nombre: registro.nombre_depositante,
        motivo: `Cédula repetida (también en la fila ${primera}): el BCP admite una sola deuda por cédula y vencimiento`,
      });
      return false;
    }
    vistos.set(clave, registro.fila);
    return true;
  });

  if (unicos.length > 9999) {
    throw new BadRequestException(
      'Hay más de 9999 clientes: el correlativo del documento de pago solo tiene 4 dígitos.',
    );
  }

  // Ordenar es estable: a igual deuda se respeta el orden del Excel.
  unicos.sort((a, b) => {
    if (a.monto_pagar === 0 && b.monto_pagar > 0) return 1;
    if (a.monto_pagar > 0 && b.monto_pagar === 0) return -1;
    return b.monto_pagar - a.monto_pagar;
  });

  const registros = unicos.map(
    ({ emisionIso, fila: _fila, detalle: _detalle, ...registro }, index) => ({
      ...registro,
      nro_documento_pago: `B${emisionIso.slice(5, 7)}${emisionIso.slice(2, 4)}${String(index + 1).padStart(4, '0')}`,
    }),
  );

  return {
    registros: registros.map((registro) => ordenarClaves(registro)),
    detalles: unicos.map((registro) => registro.detalle),
    omitidos: omitidos.sort((a, b) => a.fila - b.fila),
    ciclos: [...ciclos.values()].sort((a, b) => a.dia - b.dia),
    excluidosPorEstado,
    sinDeuda,
  };
}

/** Las claves en el orden de las columnas del BCP. */
function ordenarClaves(registro: RegistroTelecredito): RegistroTelecredito {
  return Object.fromEntries(
    TELECREDITO_HEADERS.map((key) => [key, registro[key]]),
  ) as RegistroTelecredito;
}
