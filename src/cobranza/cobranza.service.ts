import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { AuthUser } from '../auth/auth-user.js';
import { limaIsoDate } from '../common/business-days.js';
import { buildXlsx } from '../common/xlsx.js';
import {
  asignarPagos,
  type Asignacion,
  transaccionDe,
} from './conciliacion.js';
import {
  COLUMNAS_USUARIOS,
  deudasPorUsuarios,
  nombreMes,
  type RegistroTelecredito,
  TELECREDITO_HEADERS,
} from './deudas.js';
import { readMikrowispSheet } from './excel-input.js';
import {
  type ClienteMikrowisp,
  type ConsultaCliente,
  type FacturasCliente,
  MikrowispService,
} from './mikrowisp.service.js';
import { type TipoCarga, txtCargaTelecredito } from './telecredito-carga.js';
import { leerReporteTelecredito, type PagoTelecredito } from './telecredito.js';

/** Resultado de cada pago del BCP frente a Mikrowisp. */
export type EstadoPago = Asignacion['estado'] | 'NO_ENCONTRADO' | 'ERROR';

export type FilaConciliacion = PagoTelecredito & {
  cliente: ClienteMikrowisp | null;
  estado: EstadoPago;
  facturas: Asignacion['facturas'];
  detalle: string;
};

/** Consultas simultáneas a Mikrowisp. */
const CONCURRENCIA = 5;
/** Tiempo que el archivo generado queda disponible para descargar. */
const DESCARGA_TTL_MS = 30 * 60_000;

const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TXT = 'text/plain; charset=us-ascii';

type Descarga = {
  userId: string;
  nombre: string;
  tipo: string;
  archivo: Buffer;
  expira: number;
};

export type OpcionesDeudas = {
  diasVencimiento: number;
  /** Sin ciclo, solo se analiza el Excel (ciclos y montos) sin generar archivos. */
  ciclo?: number;
  incluirSinDeuda: boolean;
  tipoCarga: TipoCarga;
};

@Injectable()
export class CobranzaService {
  /** Archivos listos para descargar: se generan al procesar y se piden por su id. */
  private readonly descargas = new Map<string, Descarga>();

  constructor(private readonly mikrowisp: MikrowispService) {}

  // ─── Mikrowisp → Telecrédito ──────────────────────────────────────────────

  async deudasPorUsuarios(
    file: Buffer,
    opciones: OpcionesDeudas,
    user: AuthUser,
  ) {
    const filas = await readMikrowispSheet(file, COLUMNAS_USUARIOS);
    const hoy = limaIsoDate();
    const resultado = deudasPorUsuarios(filas, { hoy, ...opciones });
    const analisis = {
      mes: nombreMes(hoy),
      ciclos: resultado.ciclos,
      excluidosPorEstado: resultado.excluidosPorEstado,
    };
    if (opciones.ciclo === undefined) return { ...analisis, carga: null };

    const { registros } = resultado;
    if (registros.length === 0) {
      throw new BadRequestException(
        'Ese ciclo no tiene clientes con deuda para cargar al BCP.',
      );
    }
    const accion = opciones.tipoCarga === 'REEMPLAZO' ? 'reemplazo' : 'agregar';
    const base = `CREP_ciclo-${opciones.ciclo}_${accion}_${hoy}`;
    const txt = txtCargaTelecredito(registros, {
      tipo: opciones.tipoCarga,
      fecha: hoy,
    });
    return {
      ...analisis,
      carga: {
        ciclo: opciones.ciclo,
        tipoCarga: opciones.tipoCarga,
        total: registros.length,
        montoTotal: redondear(
          registros.reduce((suma, r) => suma + r.monto_pagar, 0),
        ),
        sinDeuda: resultado.sinDeuda,
        suspendidos: resultado.detalles.filter((d) => d.estado === 'SUSPENDIDO')
          .length,
        conVariosRecibos: resultado.detalles.filter((d) => d.recibos > 1)
          .length,
        // Cada registro del BCP con el estado y los recibos del cliente (solo para revisar).
        registros: registros.map((registro, index) => ({
          ...registro,
          ...resultado.detalles[index],
        })),
        omitidos: resultado.omitidos,
        descargas: {
          txt: this.guardarDescarga(
            user,
            `${base}.txt`,
            TXT,
            Buffer.from(txt, 'latin1'),
          ),
          excel: this.guardarDescarga(
            user,
            `${base}.xlsx`,
            XLSX,
            await excelTelecredito(
              'USUARIOS_PARSEADOS',
              registros,
              opciones.tipoCarga,
            ),
          ),
        },
      },
    };
  }

  // ─── Telecrédito → conciliación con Mikrowisp ─────────────────────────────

  async conciliarPagos(files: Express.Multer.File[], user: AuthUser) {
    if (!files.length)
      throw new BadRequestException('Sube al menos un archivo .txt.');
    this.mikrowisp.assertConfigured();

    // Latin-1: un byte, un carácter; las posiciones del ancho fijo no se corren.
    const reporte = leerReporteTelecredito(
      files.map((file) => ({
        nombre: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        contenido: file.buffer.toString('latin1'),
      })),
    );

    // 1. Cliente de cada documento (un cliente que pagó varias veces se consulta una vez).
    const documentos = [
      ...new Set(reporte.pagos.map((pago) => pago.documento)),
    ];
    const clientes = new Map<string, ConsultaCliente>();
    await enParalelo(documentos, CONCURRENCIA, async (documento) => {
      clientes.set(
        documento,
        documento
          ? await this.mikrowisp.buscarPorDocumento(documento)
          : { resultado: 'NO_ENCONTRADO' },
      );
    });

    // 2. Facturas de cada cliente encontrado y a qué facturas corresponde cada pago.
    const porCliente = new Map<number, PagoTelecredito[]>();
    for (const pago of reporte.pagos) {
      const consulta = clientes.get(pago.documento)!;
      if (consulta.resultado !== 'ENCONTRADO') continue;
      const lista = porCliente.get(consulta.cliente.id) ?? [];
      lista.push(pago);
      porCliente.set(consulta.cliente.id, lista);
    }
    const asignaciones = new Map<
      PagoTelecredito,
      Asignacion | { error: string }
    >();
    await enParalelo(
      [...porCliente.entries()],
      CONCURRENCIA,
      async ([idcliente, pagos]) => {
        const facturas: FacturasCliente =
          await this.mikrowisp.facturas(idcliente);
        if (!facturas.ok) {
          for (const pago of pagos)
            asignaciones.set(pago, { error: facturas.error });
          return;
        }
        // reporte.pagos ya viene en orden de fecha y hora.
        asignarPagos(pagos, facturas).forEach((asignacion, index) =>
          asignaciones.set(pagos[index], asignacion),
        );
      },
    );

    const filas: FilaConciliacion[] = reporte.pagos.map((pago) => {
      const consulta = clientes.get(pago.documento)!;
      if (consulta.resultado === 'NO_ENCONTRADO') {
        return {
          ...pago,
          cliente: null,
          estado: 'NO_ENCONTRADO',
          facturas: [],
          detalle: 'No existe en Mikrowisp un cliente con esa cédula.',
        };
      }
      if (consulta.resultado === 'ERROR') {
        return {
          ...pago,
          cliente: null,
          estado: 'ERROR',
          facturas: [],
          detalle: consulta.error,
        };
      }
      const asignacion = asignaciones.get(pago)!;
      if ('error' in asignacion) {
        return {
          ...pago,
          cliente: consulta.cliente,
          estado: 'ERROR',
          facturas: [],
          detalle: asignacion.error,
        };
      }
      return { ...pago, cliente: consulta.cliente, ...asignacion };
    });

    const listos = filas.filter((fila) => fila.estado === 'LISTO');
    const facturasAPagar = listos.reduce(
      (suma, fila) => suma + fila.facturas.length,
      0,
    );
    const hoy = limaIsoDate();
    const conteo = Object.fromEntries(
      (
        [
          'LISTO',
          'YA_REGISTRADO',
          'SIN_PENDIENTES',
          'REVISAR',
          'NO_ENCONTRADO',
          'ERROR',
        ] as const
      ).map((estado) => [
        estado,
        filas.filter((fila) => fila.estado === estado).length,
      ]),
    ) as Record<EstadoPago, number>;

    return {
      archivos: reporte.archivos,
      total: filas.length,
      montoTotal: redondear(
        filas.reduce((suma, fila) => suma + fila.montoPagado, 0),
      ),
      duplicados: reporte.duplicados,
      extornos: reporte.extornos.length,
      avisos: reporte.avisos,
      conteo,
      facturasAPagar,
      montoAPagar: redondear(
        listos.reduce((suma, fila) => suma + fila.montoPagado, 0),
      ),
      descargas: {
        conciliacion: this.guardarDescarga(
          user,
          `conciliacion-bcp_${hoy}.xlsx`,
          XLSX,
          await excelConciliacion(filas),
        ),
        mikrowisp: facturasAPagar
          ? this.guardarDescarga(
              user,
              `pagos-masivos-mikrowisp_${hoy}.xlsx`,
              XLSX,
              await excelPagosMikrowisp(listos),
            )
          : null,
      },
      filas,
    };
  }

  // ─── Descargas ────────────────────────────────────────────────────────────

  descarga(id: string, user: AuthUser) {
    this.limpiarDescargas();
    const descarga = this.descargas.get(id);
    if (!descarga || descarga.userId !== user.id) {
      throw new NotFoundException(
        'El archivo ya no está disponible. Vuelve a procesar el reporte.',
      );
    }
    return descarga;
  }

  private guardarDescarga(
    user: AuthUser,
    nombre: string,
    tipo: string,
    archivo: Buffer,
  ) {
    this.limpiarDescargas();
    const id = randomUUID();
    this.descargas.set(id, {
      userId: user.id,
      nombre,
      tipo,
      archivo,
      expira: Date.now() + DESCARGA_TTL_MS,
    });
    return id;
  }

  private limpiarDescargas() {
    const ahora = Date.now();
    for (const [id, descarga] of this.descargas) {
      if (descarga.expira < ahora) this.descargas.delete(id);
    }
  }
}

const redondear = (valor: number) => Math.round(valor * 100) / 100;

/** Ejecuta `tarea` para cada elemento con a lo sumo `limite` a la vez. */
async function enParalelo<T>(
  items: T[],
  limite: number,
  tarea: (item: T) => Promise<void>,
) {
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const item = items[siguiente++];
      await tarea(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limite, items.length) }, trabajador),
  );
}

/**
 * Excel de la carga de deudas con las columnas del macro del BCP (A–K, fechas como texto
 * DD/MM/YYYY) para pegar desde la fila 11. El "Tipo de Registro" va con el texto exacto de la
 * lista del macro: "No Aplica" en un reemplazo y "Agregar" en una actualización (con otro valor,
 * el macro rechaza la fila o arma mal el TXT).
 */
async function excelTelecredito(
  hoja: string,
  registros: RegistroTelecredito[],
  tipoCarga: TipoCarga,
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(hoja);
  sheet.addRow(TELECREDITO_HEADERS);
  const tipoRegistro = tipoCarga === 'REEMPLAZO' ? 'No Aplica' : 'Agregar';
  for (const registro of registros) {
    sheet.addRow(
      TELECREDITO_HEADERS.map((key) =>
        key === 'tipo_registro' ? tipoRegistro : registro[key],
      ),
    );
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Columnas de la plantilla "Registrar pagos masivos" de Mikrowisp (no cambiar el orden). */
const COLUMNAS_PAGOS_MIKROWISP = [
  'Dato a Buscar',
  'ID FACTURA (opcional)',
  'Comisión (opcional)',
  'Fecha y Hora pago (Opcional)',
  'ID transaccion (Opcional)',
];

/**
 * Excel para "Pagos masivos" de Mikrowisp (buscar por CEDULA): una fila por factura, con su ID
 * explícito (nunca "la última no pagada"), comisión 0, fecha y hora del pago y el número de
 * operación del BCP como ID de transacción (con -1, -2… si el pago cubre varias facturas).
 */
async function excelPagosMikrowisp(listos: FilaConciliacion[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Hoja1');
  sheet.columns = COLUMNAS_PAGOS_MIKROWISP.map((header) => ({
    header,
    width: 24,
    style: { numFmt: '@' },
  }));
  sheet.getRow(1).font = { bold: true };
  for (const fila of listos) {
    fila.facturas.forEach((factura, index) => {
      sheet.addRow([
        fila.cliente?.cedula || fila.documento,
        String(factura.id),
        '0',
        `${fila.fechaPago} ${fila.horaPago}`,
        transaccionDe(fila.operacion, index, fila.facturas.length),
      ]);
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const estadoTexto: Record<EstadoPago, string> = {
  LISTO: 'Listo para registrar',
  YA_REGISTRADO: 'Ya registrado',
  SIN_PENDIENTES: 'Sin facturas pendientes',
  REVISAR: 'Revisar',
  NO_ENCONTRADO: 'Cliente no encontrado',
  ERROR: 'Error de consulta',
};

const fechaExcel = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

/** Reporte de conciliación: cada pago del BCP con su cliente y qué pasa en Mikrowisp. */
function excelConciliacion(filas: FilaConciliacion[]) {
  return buildXlsx<FilaConciliacion>(
    'Datos',
    [
      {
        header: 'Fecha de Pago',
        width: 13,
        kind: 'day',
        value: (f) => fechaExcel(f.fechaPago),
      },
      { header: 'Hora de Pago', width: 10, value: (f) => f.horaPago },
      {
        header: 'Monto Pagado',
        width: 12,
        kind: 'number',
        value: (f) => f.montoPagado,
      },
      { header: 'Cedula (TXT)', width: 14, value: (f) => f.documento },
      { header: 'ID Cliente', width: 10, value: (f) => f.cliente?.id },
      { header: 'Nombres', width: 36, value: (f) => f.cliente?.nombre },
      { header: 'Zona', width: 20, value: (f) => f.cliente?.zona },
      { header: 'Estado Cliente', width: 13, value: (f) => f.cliente?.estado },
      { header: 'Resultado', width: 22, value: (f) => estadoTexto[f.estado] },
      {
        header: 'Facturas',
        width: 18,
        value: (f) => f.facturas.map((factura) => factura.id).join(', '),
      },
      { header: 'Detalle', width: 60, kind: 'text', value: (f) => f.detalle },
      { header: 'N° Operación', width: 15, value: (f) => f.operacion },
      {
        header: 'N° Operación Canal',
        width: 14,
        value: (f) => f.operacionCanal,
      },
      { header: 'Canal', width: 16, value: (f) => f.canal },
      {
        header: 'Código Factura (TXT)',
        width: 14,
        value: (f) => f.documentoPago,
      },
      { header: 'Reporte', width: 8, value: (f) => f.tipoReporte },
      { header: 'Archivo', width: 40, value: (f) => f.archivo },
      { header: 'Móvil', width: 13, value: (f) => f.cliente?.movil },
    ],
    filas,
  );
}
