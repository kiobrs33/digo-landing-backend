import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';

/** Fila de un reporte de Mikrowisp: valor de cada columna como texto, por nombre de encabezado. */
export type SheetRow = Record<string, string>;

/** Texto de una celda tal como se ve en Excel (números sin formato, fechas DD/MM/YYYY). */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    const day = String(value.getUTCDate()).padStart(2, '0');
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${value.getUTCFullYear()}`;
  }
  if ('richText' in value) {
    return value.richText
      .map((part) => part.text)
      .join('')
      .trim();
  }
  if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
  if ('text' in value) return String(value.text).trim();
  return '';
}

/**
 * Lee la primera hoja de un reporte exportado de Mikrowisp. Fila 1: título ("Lista de
 * Usuarios"); fila 2: encabezados; luego los datos. En vez de depender de esa posición, se busca
 * la fila de encabezados entre las primeras filas por las columnas que el parser necesita.
 */
export async function readMikrowispSheet(
  file: Buffer,
  requiredHeaders: string[],
): Promise<SheetRow[]> {
  return (await readSheet(file, requiredHeaders)).filas;
}

/**
 * Igual que `readMikrowispSheet`, con las columnas en orden y el número de fila de Excel de cada
 * registro (para señalar en qué fila está un error).
 */
export async function readSheet(
  file: Buffer,
  requiredHeaders: string[],
): Promise<{ columnas: string[]; filas: SheetRow[]; numeros: number[] }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException(
      'No se pudo leer el archivo. Sube un Excel (.xlsx).',
    );
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('El Excel no tiene hojas.');

  let headerRow = 0;
  let headers: string[] = [];
  for (let index = 1; index <= Math.min(5, sheet.rowCount); index++) {
    const values = rowTexts(sheet.getRow(index));
    if (requiredHeaders.every((header) => values.includes(header))) {
      headerRow = index;
      headers = values;
      break;
    }
  }
  if (!headerRow) {
    throw new BadRequestException(
      `El Excel no tiene las columnas esperadas: ${requiredHeaders.join(', ')}.`,
    );
  }

  const rows: SheetRow[] = [];
  const numeros: number[] = [];
  sheet.eachRow((row, index) => {
    if (index <= headerRow) return;
    const values = rowTexts(row);
    if (values.every((value) => !value)) return;
    const record: SheetRow = {};
    headers.forEach((header, column) => {
      if (header) record[header] = values[column] ?? '';
    });
    rows.push(record);
    numeros.push(index);
  });
  return { columnas: headers.filter(Boolean), filas: rows, numeros };
}

/** Textos de la fila, con la columna A en la posición 0. */
function rowTexts(row: ExcelJS.Row): string[] {
  const values: string[] = [];
  row.eachCell({ includeEmpty: true }, (cell, column) => {
    values[column - 1] = cellText(cell.value);
  });
  return Array.from(values, (value) => value ?? '');
}
