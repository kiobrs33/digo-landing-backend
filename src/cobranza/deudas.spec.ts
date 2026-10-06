import {
  deudasPorUsuarios,
  nombreMes,
  normalizarNombre,
  normalizarDocumento,
  parseMonto,
  separarEstado,
} from './deudas.js';

const usuario = (
  Nombre: string,
  Cedula: string,
  dia: string,
  deuda: string,
) => ({
  Nombre,
  Cedula,
  'Dia pago': dia,
  'Deuda actual': deuda,
});

describe('deudas: utilidades', () => {
  it('lee montos de Mikrowisp', () => {
    expect(parseMonto('1 S/. 69.90')).toBe(69.9);
    expect(parseMonto('2 S/. 1,234.50')).toBe(1234.5);
    expect(parseMonto('S/ 59.00')).toBe(59);
    expect(parseMonto('')).toBe(0);
    expect(parseMonto('texto')).toBe(0);
  });

  it('recupera el cero inicial del DNI que Excel guarda como número', () => {
    expect(normalizarDocumento('3872061')).toBe('03872061');
    expect(normalizarDocumento('73897311')).toBe('73897311');
    expect(normalizarDocumento('20123456789')).toBe('20123456789');
    expect(normalizarDocumento('001234567')).toBe('001234567');
  });

  it('solo toma como estado la última palabra conocida', () => {
    expect(separarEstado('JUAN PEREZ  ACTIVO')).toEqual({
      nombre: 'JUAN PEREZ',
      estado: 'ACTIVO',
    });
    expect(separarEstado('ANA BAJAÑA ROJAS SUSPENDIDO').estado).toBe(
      'SUSPENDIDO',
    );
    expect(separarEstado('ANA BAJAÑA ROJAS')).toEqual({
      nombre: 'ANA BAJAÑA ROJAS',
      estado: '',
    });
  });

  it('nombra el mes como el BCP', () => {
    expect(nombreMes('2026-10-05')).toBe('OCTUBRE');
    expect(nombreMes('2026-09-01')).toBe('SETIEMBRE');
  });
});

describe('deudasPorUsuarios', () => {
  const filas = [
    usuario('JOSÉ ÁVILA  ACTIVO', '3872061', '1', '1 S/. 49.00'),
    usuario('MARIA BAJAÑA  ACTIVO', '44338396', '1', '2 S/. 158.00'),
    usuario('PEDRO RUIZ  RETIRADO', '11111111', '1', '1 S/. 70.00'),
    usuario('LUIS GOMEZ  SUSPENDIDO', '22222222', '30', '1 S/. 69.00'),
    usuario('ANA SIN DEUDA  ACTIVO', '33333333', '1', ''),
    usuario('SIN ESTADO', '44444444', '1', '1 S/. 10.00'),
    usuario("O'BRIEN ÑANDÚ  ACTIVO", '44338396', '1', '1 S/. 20.00'),
  ];
  const base = { hoy: '2026-09-20', diasVencimiento: 10 };

  it('resume los ciclos (día de pago) con clientes y deuda', () => {
    const { ciclos, excluidosPorEstado } = deudasPorUsuarios(filas, base);
    expect(ciclos).toEqual([
      { dia: 1, clientes: 4, conDeuda: 3, monto: 227 },
      { dia: 30, clientes: 1, conDeuda: 1, monto: 69 },
    ]);
    expect(excluidosPorEstado).toEqual({ RETIRADO: 1 });
  });

  const ciclo1 = deudasPorUsuarios(filas, { ...base, ciclo: 1 });

  it('carga solo el ciclo elegido, con deuda, y avisa de la cédula repetida', () => {
    expect(ciclo1.registros.map((r) => r.nro_documento_identidad)).toEqual([
      '44338396',
      '03872061',
    ]);
    expect(ciclo1.sinDeuda).toBe(1);
    expect(
      ciclo1.omitidos.map((o) => [o.fila, o.motivo.split(' (')[0]]),
    ).toEqual([
      [8, 'Sin estado al final del nombre'],
      [9, 'Cédula repetida'],
    ]);
  });

  it('numera el documento de pago en el orden final del archivo', () => {
    expect(ciclo1.registros.map((r) => r.nro_documento_pago)).toEqual([
      'B09260001',
      'B09260002',
    ]);
  });

  it('arma el registro del BCP', () => {
    expect(ciclo1.registros[1]).toEqual({
      codigo_depositante: '03872061',
      nombre_depositante: 'JOSE AVILA',
      informacion_retorno: 'SETIEMBRE',
      fecha_emision: '01/09/2026',
      fecha_vencimiento: '11/09/2026',
      monto_pagar: 49,
      mora_cargo_fijo: 0,
      monto_minimo: 49,
      tipo_registro: 'No Aplica',
      nro_documento_pago: 'B09260002',
      nro_documento_identidad: '03872061',
    });
  });

  it('incluye a los que no deben si se pide', () => {
    const conTodos = deudasPorUsuarios(filas, {
      ...base,
      ciclo: 1,
      incluirSinDeuda: true,
    });
    expect(conTodos.registros.at(-1)?.monto_pagar).toBe(0);
  });

  it('el día 30 en un mes de 31 días o el 31 en uno de 30 queda dentro del mes', () => {
    const [registro] = deudasPorUsuarios(
      [usuario('LUIS GOMEZ  SUSPENDIDO', '22222222', '31', '1 S/. 69.00')],
      { ...base, ciclo: 31 },
    ).registros;
    expect(registro.fecha_emision).toBe('30/09/2026');
    expect(registro.fecha_vencimiento).toBe('10/10/2026');
  });

  it('deja el nombre solo con caracteres que acepta el BCP', () => {
    expect(normalizarNombre("O'Brien Ñandú  (hijo) & cía_2")).toBe(
      'O BRIEN NANDU (HIJO) & CIA 2',
    );
  });
});

describe('detalles de la carga', () => {
  it('trae estado y recibos de cada cliente en el mismo orden', () => {
    const { registros, detalles } = deudasPorUsuarios(
      [
        usuario('ANA  ACTIVO', '11111111', '1', '1 S/. 49.00'),
        usuario('LUIS  SUSPENDIDO', '22222222', '1', '4 S/. 356.00'),
      ],
      { hoy: '2026-10-05', diasVencimiento: 10, ciclo: 1 },
    );
    expect(registros.map((r) => r.nro_documento_identidad)).toEqual([
      '22222222',
      '11111111',
    ]);
    expect(detalles).toEqual([
      { estado: 'SUSPENDIDO', recibos: 4 },
      { estado: 'ACTIVO', recibos: 1 },
    ]);
  });
});
