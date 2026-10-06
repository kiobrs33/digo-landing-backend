import { documentoDesdeCodigo, leerReporteTelecredito } from './telecredito.js';

type Pago = {
  codigo: string;
  centimos: number;
  operacion: string;
  hora?: string;
  canal?: string;
  documentoPago?: string;
  extorno?: string;
};

/** Línea CREP (250) con el layout del reporte de cobros del BCP. */
function crep({
  codigo,
  centimos,
  operacion,
  hora = '143351',
  canal = 'YP',
  documentoPago = 'B10260001',
  extorno = ' ',
}: Pago) {
  const monto = String(centimos).padStart(15, '0');
  return [
    'DD',
    '21504713365',
    codigo.padStart(14, '0'),
    'OCTUBRE'.padEnd(30),
    '20261001',
    '20261011',
    monto,
    '0'.repeat(15),
    monto,
    operacion,
    'EFECTIVO',
    codigo.padStart(14, '0'),
    '    ',
    canal.padEnd(12),
    hora,
    ' '.repeat(12),
    '0'.repeat(10),
    extorno,
    documentoPago.padStart(20),
    '05661443',
    '00289909',
  ]
    .join('')
    .padEnd(250);
}

/** La misma operación en el formato CDPG (208, sin documento de pago). */
function cdpg({ codigo, centimos, operacion, hora = '143351' }: Pago) {
  const monto = String(centimos).padStart(15, '0');
  return [
    'DD',
    '21504713365',
    codigo.padStart(14, '0'),
    'OCTUBRE'.padEnd(30),
    '20261001',
    '20261011',
    monto,
    '0'.repeat(15),
    monto,
    operacion,
    'EFECTIVO',
    codigo.padStart(14, '0'),
    'AXOE',
    '  ',
    `0005${operacion.slice(6)}`,
    hora,
    ' '.repeat(12),
    '0'.repeat(10),
    '    00289909',
  ].join('');
}

const cabecera = (cantidad: number, centimos: number) =>
  `CC21504713365C20261001${String(cantidad).padStart(9, '0')}${String(centimos).padStart(15, '0')}8761T0M702003003CP0000`.padEnd(
    250,
  );

describe('telecredito', () => {
  it('quita el relleno del código y recupera el DNI', () => {
    expect(documentoDesdeCodigo('00000003872061')).toBe('03872061');
    expect(documentoDesdeCodigo('00020123456789')).toBe('20123456789');
    expect(documentoDesdeCodigo('00000000000000')).toBe('');
  });

  it('lee un CREP: operación, hora, canal y documento de pago', () => {
    const contenido = [
      cabecera(1, 6900),
      crep({
        codigo: '3872061',
        centimos: 6900,
        operacion: '111023676534',
        hora: '143549',
        canal: 'BM',
      }),
      '',
    ].join('\r\n');
    const reporte = leerReporteTelecredito([{ nombre: 'crep.txt', contenido }]);
    expect(reporte.avisos).toEqual([]);
    expect(reporte.archivos[0]).toMatchObject({
      tipo: 'CREP',
      desde: '2026-10-01',
      pagos: 1,
      total: 69,
    });
    expect(reporte.pagos[0]).toMatchObject({
      documento: '03872061',
      fechaPago: '2026-10-01',
      horaPago: '14:35:49',
      montoPagado: 69,
      operacion: '111023676534',
      operacionCanal: '00289909',
      canal: 'Banca móvil',
      documentoPago: 'B10260001',
      tipoReporte: 'CREP',
    });
  });

  it('cuenta una vez el mismo pago en CREP, CDPG y descargas repetidas, y prefiere el CREP', () => {
    const pago = {
      codigo: '29307479',
      centimos: 9900,
      operacion: '111023661443',
    };
    const otro = {
      codigo: '29307479',
      centimos: 9900,
      operacion: '111017073470',
      hora: '150000',
    };
    const reporte = leerReporteTelecredito([
      { nombre: 'cdpg.txt', contenido: [cdpg(pago), cdpg(otro)].join('\n') },
      { nombre: 'crep.txt', contenido: crep(pago) },
      { nombre: 'crep (1).txt', contenido: crep(pago) },
    ]);
    expect(reporte.pagos).toHaveLength(2);
    expect(reporte.duplicados).toBe(2);
    expect(reporte.pagos[0]).toMatchObject({
      tipoReporte: 'CREP',
      documentoPago: 'B10260001',
      canal: 'Yape',
    });
    expect(reporte.pagos[1]).toMatchObject({
      tipoReporte: 'CDPG',
      documentoPago: '',
      canal: 'Yape',
    });
    expect(reporte.archivos.map((a) => a.tipo)).toEqual([
      'CDPG',
      'CREP',
      'CREP',
    ]);
  });

  it('separa los pagos extornados', () => {
    const reporte = leerReporteTelecredito([
      {
        nombre: 'crep.txt',
        contenido: crep({
          codigo: '29307479',
          centimos: 9900,
          operacion: '111023661443',
          extorno: 'E',
        }),
      },
    ]);
    expect(reporte.pagos).toEqual([]);
    expect(reporte.extornos).toHaveLength(1);
    expect(reporte.avisos[0]).toContain('extornado');
  });

  it('avisa si la cabecera no cuadra con los pagos', () => {
    const contenido = [
      cabecera(3, 50000),
      crep({ codigo: '29307479', centimos: 9900, operacion: '111023661443' }),
    ].join('\n');
    expect(
      leerReporteTelecredito([{ nombre: 'x.txt', contenido }]).avisos,
    ).toHaveLength(2);
  });

  it('rechaza un archivo que no es el reporte del BCP', () => {
    expect(() =>
      leerReporteTelecredito([{ nombre: 'x.txt', contenido: 'hola' }]),
    ).toThrow();
    expect(() =>
      leerReporteTelecredito([{ nombre: 'x.txt', contenido: 'DD123' }]),
    ).toThrow();
  });
});
