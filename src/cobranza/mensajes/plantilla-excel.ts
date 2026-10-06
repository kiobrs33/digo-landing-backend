import ExcelJS from 'exceljs';
import type { Plantilla } from './plantillas.js';

/** Columna del Excel de destinatarios para la variable `{{n}}` del cuerpo. */
export const columnaVariable = (variable: string) => `Variable {{${variable}}}`;

const COLUMNA_ENCABEZADO: Record<
  NonNullable<Plantilla['encabezado']>,
  string
> = {
  TEXT: 'Texto del encabezado',
  IMAGE: 'Enlace de la imagen',
  DOCUMENT: 'Enlace del PDF',
  VIDEO: 'Enlace del video',
};

const EJEMPLO_ENLACE: Record<NonNullable<Plantilla['encabezado']>, string> = {
  TEXT: '',
  IMAGE: 'https://…/qr-pago.jpg',
  DOCUMENT: 'https://…/recibo.pdf',
  VIDEO: 'https://…/video.mp4',
};

/** Nombres posibles de la columna del encabezado (según su formato). */
export const COLUMNAS_ENCABEZADO = Object.values(COLUMNA_ENCABEZADO);

export const columnaEncabezado = (plantilla: Plantilla) =>
  plantilla.encabezado ? COLUMNA_ENCABEZADO[plantilla.encabezado] : '';

const AZUL = 'FF041C7B';

/**
 * Excel para llenar los destinatarios de una plantilla: hoja "Destinatarios" con una columna por
 * dato que pide la plantilla (vacía, para no enviar ejemplos por error) y hoja "Instrucciones"
 * con el texto del mensaje y un ejemplo de cada columna.
 */
export async function excelPlantilla(plantilla: Plantilla) {
  const columnas: {
    nombre: string;
    descripcion: string;
    ejemplo: string;
    ancho: number;
  }[] = [
    {
      nombre: 'Teléfono',
      descripcion: 'Celular de 9 dígitos (se le agrega el 51 al enviar).',
      ejemplo: '987654321',
      ancho: 14,
    },
    {
      nombre: 'Nombre',
      descripcion:
        'Nombre del cliente. Solo para identificarlo en el reporte de envíos.',
      ejemplo: 'JUAN PEREZ',
      ancho: 30,
    },
  ];
  if (plantilla.encabezadoConVariable) {
    columnas.push({
      nombre: columnaEncabezado(plantilla),
      descripcion:
        plantilla.encabezado === 'TEXT'
          ? `Texto del encabezado: "${plantilla.textoEncabezado}".`
          : 'Enlace público (https://…) del archivo que se adjunta al mensaje.',
      ejemplo: EJEMPLO_ENLACE[plantilla.encabezado!],
      ancho: 40,
    });
  }
  plantilla.variables.forEach((variable, index) => {
    columnas.push({
      nombre: columnaVariable(variable),
      descripcion: `Reemplaza {{${variable}}} en el mensaje.`,
      ejemplo: plantilla.ejemplos[index] ?? '',
      ancho: 22,
    });
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Panel Digo';

  const hoja = workbook.addWorksheet('Destinatarios', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  hoja.columns = columnas.map((columna) => ({
    header: columna.nombre,
    key: columna.nombre,
    width: columna.ancho,
    // Texto: Excel no convierte el celular en número ni los montos o fechas a otro formato.
    style: { numFmt: '@' },
  }));
  estiloEncabezado(hoja.getRow(1));

  const ayuda = workbook.addWorksheet('Instrucciones');
  ayuda.columns = [{ width: 26 }, { width: 60 }, { width: 30 }];
  ayuda.addRow([`Plantilla: ${plantilla.nombre} (${plantilla.idioma})`]).font =
    {
      bold: true,
      size: 13,
    };
  ayuda.addRow([]);
  ayuda.addRow(['Mensaje']).font = { bold: true };
  for (const linea of [
    plantilla.textoEncabezado,
    plantilla.cuerpo,
    plantilla.pie,
  ].filter(Boolean)) {
    const fila = ayuda.addRow([linea]);
    ayuda.mergeCells(fila.number, 1, fila.number, 3);
    fila.alignment = { wrapText: true, vertical: 'top' };
    fila.height = Math.min(
      200,
      15 * Math.ceil(linea.length / 90 + linea.split('\n').length),
    );
  }
  ayuda.addRow([]);
  estiloEncabezado(ayuda.addRow(['Columna', 'Qué poner', 'Ejemplo']));
  for (const columna of columnas) {
    ayuda.addRow([
      columna.nombre,
      columna.descripcion,
      columna.ejemplo,
    ]).alignment = {
      wrapText: true,
      vertical: 'top',
    };
  }
  ayuda.addRow([]);
  for (const nota of [
    'Llena la hoja "Destinatarios": una fila por cliente, desde la fila 2.',
    'No cambies ni borres los encabezados de la fila 1.',
    'Las filas sin celular válido o con una variable vacía no se envían (quedan como omitidas).',
  ]) {
    ayuda.addRow([`• ${nota}`]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function estiloEncabezado(fila: ExcelJS.Row) {
  fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  fila.eachCell((celda) => {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
  });
  fila.height = 22;
  fila.alignment = { vertical: 'middle' };
}
