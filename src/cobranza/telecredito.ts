import { BadRequestException } from '@nestjs/common';

/**
 * Reportes de cobros de Telecrédito (BCP): texto de ancho fijo, una cabecera `CC` y una línea
 * `DD` por pago. Posiciones 0-based [inicio, fin), tomadas del macro del BCP ("Visualizar
 * Archivo de Resultado").
 *
 * - CREP: pagos del día calendario, se actualiza cada hora. Líneas de 250 caracteres con el
 *   número de documento de pago (B1026…).
 * - CDPG: corte de 8:45 p.m. a 8:45 p.m., disponible desde las 10:30 p.m. Líneas de 208
 *   caracteres, sin documento de pago (el canal Ventanilla no lo lee).
 * Un mismo pago aparece en los dos y en CREP descargados varias veces: se identifica por fecha +
 * sucursal + agencia + número de operación.
 */
const DD = {
  codigoDepositante: [13, 27],
  informacionRetorno: [27, 57],
  fechaPago: [57, 65],
  fechaVencimiento: [65, 73],
  montoPagado: [73, 88],
  mora: [88, 103],
  montoTotal: [103, 118],
  /** Sucursal (3) + agencia (3) + número de operación (6). */
  operacion: [118, 130],
  medio: [130, 138],
  terminal: [152, 156],
  /** CREP: medio de atención (YP, BM, PZ…). */
  medioAtencion: [156, 168],
  hora: [168, 174],
  flagExtorno: [196, 197],
  documentoPago: [197, 217],
  operacionCanal: [225, 233],
} as const;

const CC = {
  fecha: [14, 22],
  cantidad: [22, 31],
  total: [31, 46],
} as const;

/** Hasta la hora de atención: lo mínimo que traen los dos formatos. */
const LARGO_MINIMO = DD.hora[1];
const LARGO_CREP = DD.documentoPago[1];

export type TipoReporte = 'CREP' | 'CDPG';

const CANALES: Record<string, string> = {
  YP: 'Yape',
  AX: 'Yape',
  BM: 'Banca móvil',
  PZ: 'Agente BCP',
  TN: 'Otro banco',
  OB: 'Otro banco',
  IB: 'Banca por internet',
  TB: 'Banca por internet',
};

export type PagoTelecredito = {
  archivo: string;
  tipoReporte: TipoReporte;
  linea: number;
  /** DNI (8 dígitos), CE o RUC, sin el relleno del BCP. */
  documento: string;
  informacionRetorno: string;
  /** 'YYYY-MM-DD' */
  fechaPago: string;
  /** 'HH:MM:SS' */
  horaPago: string;
  montoPagado: number;
  mora: number;
  montoTotal: number;
  /** Sucursal + agencia + número de operación (12 dígitos): identifica el pago. */
  operacion: string;
  /** Número de la operación en el canal (Yape, banca móvil); solo en CREP. */
  operacionCanal: string;
  canal: string;
  /** Documento de pago de la deuda cargada (B + MM + YY + correlativo); solo en CREP. */
  documentoPago: string;
};

export type ArchivoTelecredito = {
  nombre: string;
  tipo: TipoReporte;
  /** Rango de fechas de pago del archivo. */
  desde: string;
  hasta: string;
  pagos: number;
  total: number;
};

export type ReporteTelecredito = {
  pagos: PagoTelecredito[];
  archivos: ArchivoTelecredito[];
  /** Pagos que ya venían en otro archivo (CREP y CDPG del mismo día, descargas repetidas). */
  duplicados: number;
  /** Pagos revertidos por el BCP: no se registran. */
  extornos: PagoTelecredito[];
  avisos: string[];
};

const campo = (linea: string, [inicio, fin]: readonly [number, number]) =>
  linea.slice(inicio, fin).trim();

const monto = (texto: string) => Number(texto || '0') / 100;

const fecha = (yyyymmdd: string) =>
  /^\d{8}$/.test(yyyymmdd)
    ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
    : '';

const hora = (hhmmss: string) =>
  /^\d{6}$/.test(hhmmss)
    ? `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}`
    : '';

/**
 * El BCP rellena el código con ceros a la izquierda hasta 14 dígitos. Se quitan y, si queda un
 * número de hasta 8 dígitos, es un DNI: se completa a 8 (03872061).
 */
export function documentoDesdeCodigo(codigo: string): string {
  const sinCeros = codigo.trim().replace(/^0+/, '');
  if (!sinCeros) return '';
  return /^\d{1,8}$/.test(sinCeros) ? sinCeros.padStart(8, '0') : sinCeros;
}

function canalDe(linea: string, tipo: TipoReporte) {
  // CREP: medio de atención de 2 letras (a veces precedido de "TERM"); CDPG: terminal de 4
  // caracteres cuyas 2 primeras letras indican el canal.
  const codigo =
    tipo === 'CREP'
      ? campo(linea, DD.medioAtencion) || campo(linea, DD.terminal)
      : campo(linea, DD.terminal).slice(0, 2);
  return CANALES[codigo] ?? codigo;
}

export function leerReporteTelecredito(
  archivos: { nombre: string; contenido: string }[],
): ReporteTelecredito {
  const porOperacion = new Map<string, PagoTelecredito>();
  const resumen: ArchivoTelecredito[] = [];
  const extornos: PagoTelecredito[] = [];
  const avisos: string[] = [];
  let duplicados = 0;

  for (const { nombre, contenido } of archivos) {
    const lineas = contenido.split(/\r?\n/);
    const detalle = lineas.filter((linea) => linea.startsWith('DD'));
    const cabeceraLinea = lineas.find((linea) => linea.startsWith('CC'));
    if (!detalle.length && !cabeceraLinea) {
      throw new BadRequestException(
        `${nombre} no es un reporte de cobros de Telecrédito (.txt).`,
      );
    }
    const tipo: TipoReporte = detalle.some(
      (linea) => linea.length >= LARGO_CREP,
    )
      ? 'CREP'
      : 'CDPG';
    const fechas: string[] = [];
    let total = 0;

    lineas.forEach((linea, index) => {
      if (!linea.startsWith('DD')) return;
      if (linea.length < LARGO_MINIMO) {
        throw new BadRequestException(
          `${nombre}, línea ${index + 1}: la línea está incompleta. ¿Es el reporte de cobros de Telecrédito?`,
        );
      }
      const pago: PagoTelecredito = {
        archivo: nombre,
        tipoReporte: tipo,
        linea: index + 1,
        documento: documentoDesdeCodigo(campo(linea, DD.codigoDepositante)),
        informacionRetorno: campo(linea, DD.informacionRetorno),
        fechaPago: fecha(campo(linea, DD.fechaPago)),
        horaPago: hora(campo(linea, DD.hora)),
        montoPagado: monto(campo(linea, DD.montoPagado)),
        mora: monto(campo(linea, DD.mora)),
        montoTotal: monto(campo(linea, DD.montoTotal)),
        operacion: campo(linea, DD.operacion),
        operacionCanal: tipo === 'CREP' ? campo(linea, DD.operacionCanal) : '',
        canal: canalDe(linea, tipo),
        documentoPago: tipo === 'CREP' ? campo(linea, DD.documentoPago) : '',
      };
      fechas.push(pago.fechaPago);
      total += pago.montoPagado;

      if (tipo === 'CREP' && campo(linea, DD.flagExtorno)) {
        extornos.push(pago);
        return;
      }
      const clave = `${pago.fechaPago}|${pago.operacion}`;
      const anterior = porOperacion.get(clave);
      if (anterior) {
        duplicados++;
        // El CREP trae más datos (documento de pago, operación del canal): se prefiere.
        if (anterior.tipoReporte === 'CDPG' && tipo === 'CREP')
          porOperacion.set(clave, pago);
        return;
      }
      porOperacion.set(clave, pago);
    });

    fechas.sort();
    resumen.push({
      nombre,
      tipo,
      desde: fechas[0] ?? '',
      hasta: fechas.at(-1) ?? '',
      pagos: detalle.length,
      total: Math.round(total * 100) / 100,
    });

    if (cabeceraLinea) {
      const cantidad = Number(campo(cabeceraLinea, CC.cantidad));
      const totalCabecera = monto(campo(cabeceraLinea, CC.total));
      if (cantidad !== detalle.length) {
        avisos.push(
          `${nombre}: la cabecera indica ${cantidad} pagos y el archivo trae ${detalle.length}.`,
        );
      }
      if (Math.abs(totalCabecera - total) > 0.005) {
        avisos.push(
          `${nombre}: la cabecera suma S/ ${totalCabecera.toFixed(2)} y los pagos S/ ${total.toFixed(2)}.`,
        );
      }
    }
  }

  if (extornos.length) {
    avisos.push(
      `${extornos.length} pago${extornos.length === 1 ? '' : 's'} extornado${extornos.length === 1 ? '' : 's'} (revertido${extornos.length === 1 ? '' : 's'} por el BCP): no se registra${extornos.length === 1 ? '' : 'n'}.`,
    );
  }

  const pagos = [...porOperacion.values()].sort(
    (a, b) =>
      a.fechaPago.localeCompare(b.fechaPago) ||
      a.horaPago.localeCompare(b.horaPago),
  );
  return { pagos, archivos: resumen, duplicados, extornos, avisos };
}
