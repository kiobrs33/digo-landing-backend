import { BadRequestException } from '@nestjs/common';
import type { RegistroTelecredito } from './deudas.js';

/**
 * Archivo de cobranza (carga de deudas) de Telecrédito, en el mismo formato que genera el macro
 * del BCP "Macro Generadora de Archivo de Cobranza - Validación Completa (CREP)": líneas de 250
 * caracteres separadas por CRLF, una cabecera `CC` y un detalle `DD` por deuda.
 */

/** Cuenta recaudadora 215-4713365-0-63 en el formato del archivo (3 + 1 + 7 dígitos). */
export const CUENTA_RECAUDADORA = '21504713365';
export const EMPRESA = 'DIGO TELECOM SAC';

/**
 * Reemplazo: borra todas las deudas cargadas y deja solo las del archivo (primer ciclo del mes).
 * Actualización: agrega las deudas del archivo a las que ya están (ciclos siguientes).
 */
export type TipoCarga = 'REEMPLAZO' | 'ACTUALIZACION';

const LARGO = 250;

/** Número (sin punto) con ceros a la izquierda; texto con espacios (regla del macro). */
const alinear = (valor: string, largo: number) =>
  /^\d+$/.test(valor) ? valor.padStart(largo, '0') : valor.padStart(largo, ' ');

const centimos = (monto: number, largo: number) =>
  String(Math.round(monto * 100)).padStart(largo, '0');

/** 'DD/MM/YYYY' → 'YYYYMMDD' */
const fechaArchivo = (ddmmyyyy: string) =>
  `${ddmmyyyy.slice(6, 10)}${ddmmyyyy.slice(3, 5)}${ddmmyyyy.slice(0, 2)}`;

/** Quita los ceros de relleno de un documento numérico (el archivo los vuelve a poner). */
const sinCeros = (documento: string) =>
  /^\d+$/.test(documento) ? documento.replace(/^0+(?=\d)/, '') : documento;

/**
 * Arma el TXT. `fecha` es la de generación ('YYYY-MM-DD', hoy en Lima). Valida lo mismo que el
 * macro: campos obligatorios, caracteres, largos, montos y que no se repita depositante +
 * vencimiento.
 */
export function txtCargaTelecredito(
  registros: RegistroTelecredito[],
  { tipo, fecha }: { tipo: TipoCarga; fecha: string },
): string {
  if (!registros.length)
    throw new BadRequestException('No hay deudas para cargar.');
  const errores: string[] = [];
  const claves = new Set<string>();

  const detalle = registros.map((registro, index) => {
    const n = index + 1;
    const codigo = sinCeros(registro.codigo_depositante.toUpperCase());
    const identidad = sinCeros(registro.nro_documento_identidad.toUpperCase());
    if (!/^[A-Z0-9]{1,14}$/.test(codigo))
      errores.push(`Registro ${n}: código de depositante inválido`);
    if (!/^[A-Z0-9]{0,16}$/.test(identidad))
      errores.push(`Registro ${n}: documento de identidad inválido`);
    if (!/^[A-Z0-9]{0,20}$/.test(registro.nro_documento_pago)) {
      errores.push(`Registro ${n}: documento de pago inválido`);
    }
    if (!/^[A-Z0-9*,\-./#()+& ]*$/.test(registro.nombre_depositante)) {
      errores.push(
        `Registro ${n}: el nombre tiene caracteres que el BCP no acepta`,
      );
    }
    if (registro.monto_pagar < 0 || registro.monto_pagar >= 1e13)
      errores.push(`Registro ${n}: monto inválido`);
    if (registro.monto_minimo < 0 || registro.monto_minimo >= 1e7) {
      errores.push(`Registro ${n}: monto mínimo inválido (máximo 9 dígitos)`);
    }
    const clave = `${codigo}|${registro.fecha_vencimiento}`;
    if (claves.has(clave))
      errores.push(`Registro ${n}: depositante y vencimiento repetidos`);
    claves.add(clave);

    return [
      'DD',
      CUENTA_RECAUDADORA,
      alinear(codigo, 14),
      registro.nombre_depositante.slice(0, 40).padEnd(40),
      registro.informacion_retorno.slice(0, 30).padEnd(30),
      fechaArchivo(registro.fecha_emision),
      fechaArchivo(registro.fecha_vencimiento),
      centimos(registro.monto_pagar, 15),
      centimos(registro.mora_cargo_fijo, 15),
      centimos(registro.monto_minimo, 9),
      // Tipo de registro: en un reemplazo "No Aplica" (espacio); en una actualización, "Agregar".
      tipo === 'REEMPLAZO' ? ' ' : 'A',
      alinear(registro.nro_documento_pago, 20),
      alinear(identidad, 16),
    ]
      .join('')
      .padEnd(LARGO);
  });

  if (errores.length) {
    throw new BadRequestException(errores.slice(0, 20));
  }

  const total = registros.reduce(
    (suma, registro) => suma + registro.monto_pagar,
    0,
  );
  const cabecera = [
    'CC',
    CUENTA_RECAUDADORA,
    'C',
    EMPRESA.padEnd(40),
    fecha.replace(/-/g, ''),
    String(registros.length).padStart(9, '0'),
    centimos(total, 15),
    tipo === 'REEMPLAZO' ? 'R' : 'A',
  ]
    .join('')
    .padEnd(LARGO);

  return `${[cabecera, ...detalle].join('\r\n')}\r\n`;
}
