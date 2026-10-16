import ExcelJS from 'exceljs';

/** Columna de una exportación: `kind` decide el formato de la celda. */
export type XlsxColumn<Row> = {
  header: string;
  width: number;
  value: (row: Row) => string | number | Date | null | undefined;
  /** `date`: fecha y hora de Lima; `text`: texto largo con salto de línea. */
  kind?: 'date' | 'day' | 'text' | 'number';
};

/**
 * Excel guarda fechas sin zona horaria: se pasa la hora a la de Lima (UTC−5, sin horario de
 * verano) para que la celda muestre la misma hora que el panel.
 */
export const limaExcelDate = (date: Date) =>
  new Date(date.getTime() - 5 * 60 * 60 * 1000);

/**
 * Libro de una hoja con el estilo del panel: encabezado azul de la marca, filtros de Excel en
 * cada columna y fechas reales (se ordenan y filtran como fecha).
 */
export async function buildXlsx<Row>(
  sheetName: string,
  columns: XlsxColumn<Row>[],
  rows: Row[],
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Panel Digo';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((column, index) => ({
    header: column.header,
    key: String(index),
    width: column.width,
    style:
      column.kind === 'date'
        ? { numFmt: 'dd/mm/yyyy hh:mm' }
        : column.kind === 'day'
          ? { numFmt: 'dd/mm/yyyy' }
          : column.kind === 'text'
            ? { alignment: { wrapText: true, vertical: 'top' } }
            : undefined,
  }));
  for (const row of rows) {
    sheet.addRow(
      Object.fromEntries(
        columns.map((column, index) => {
          const value = column.value(row);
          return [
            String(index),
            value instanceof Date && column.kind === 'date'
              ? limaExcelDate(value)
              : (value ?? null),
          ];
        }),
      ),
    );
  }

  // Estilo solo en las celdas con encabezado: si se aplica a la fila, se extiende a toda ella.
  const header = sheet.getRow(1);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF041C7B' },
    };
    cell.alignment = { vertical: 'middle' };
  });
  header.height = 22;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export const siteName = { HOGAR: 'Hogar', EMPRESAS: 'Empresas' } as const;
