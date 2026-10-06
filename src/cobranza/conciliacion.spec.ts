import { asignarPagos, transaccionDe } from './conciliacion.js';
import type { FacturaMikrowisp } from './mikrowisp.service.js';

const factura = (
  id: number,
  vencimiento: string,
  total: number,
  extra: Partial<FacturaMikrowisp> = {},
): FacturaMikrowisp => ({
  id,
  vencimiento,
  total,
  fechaPago: '',
  formaPago: '',
  transacciones: [],
  ...extra,
});

describe('asignarPagos', () => {
  it('un recibo: paga la factura pendiente', () => {
    const [a] = asignarPagos([{ operacion: '111023000001', montoPagado: 99 }], {
      pendientes: [factura(20248, '2026-10-01', 99)],
      pagadas: [],
    });
    expect(a).toMatchObject({ estado: 'LISTO', facturas: [{ id: 20248 }] });
  });

  it('varios recibos: el pago cubre las facturas más antiguas que suman lo pagado', () => {
    const [a] = asignarPagos(
      [{ operacion: '111023000001', montoPagado: 158 }],
      {
        pendientes: [
          factura(1, '2026-08-01', 79),
          factura(2, '2026-09-01', 79),
          factura(3, '2026-10-01', 79),
        ],
        pagadas: [],
      },
    );
    expect(a.estado).toBe('LISTO');
    expect(a.facturas.map((f) => f.id)).toEqual([1, 2]);
  });

  it('dos pagos del mismo cliente toman facturas distintas', () => {
    const resultado = asignarPagos(
      [
        { operacion: '111023000001', montoPagado: 79 },
        { operacion: '111023000002', montoPagado: 79 },
      ],
      {
        pendientes: [
          factura(1, '2026-09-01', 79),
          factura(2, '2026-10-01', 79),
        ],
        pagadas: [],
      },
    );
    expect(resultado.map((r) => r.facturas.map((f) => f.id))).toEqual([
      [1],
      [2],
    ]);
  });

  it('no adivina: si el monto no cuadra queda para revisar', () => {
    const [a] = asignarPagos(
      [{ operacion: '111023000001', montoPagado: 100 }],
      {
        pendientes: [
          factura(1, '2026-09-01', 79),
          factura(2, '2026-10-01', 79),
        ],
        pagadas: [],
      },
    );
    expect(a.estado).toBe('REVISAR');
    expect(a.facturas).toEqual([]);
  });

  it('detecta un pago que ya se subió por su número de operación', () => {
    const [a] = asignarPagos(
      [{ operacion: '111023000001', montoPagado: 158 }],
      {
        pendientes: [],
        pagadas: [
          factura(1, '2026-09-01', 79, { transacciones: ['111023000001-1'] }),
        ],
      },
    );
    expect(a).toMatchObject({ estado: 'YA_REGISTRADO', facturas: [{ id: 1 }] });
  });

  it('sin facturas pendientes: probablemente registrado a mano', () => {
    const [a] = asignarPagos([{ operacion: '111023000001', montoPagado: 49 }], {
      pendientes: [],
      pagadas: [
        factura(9, '2026-10-01', 49, {
          fechaPago: '2026-10-02',
          formaPago: 'Transferencia Bancaria',
        }),
      ],
    });
    expect(a.estado).toBe('SIN_PENDIENTES');
    expect(a.detalle).toContain('Transferencia Bancaria');
  });

  it('numera la transacción cuando un pago cubre varias facturas', () => {
    expect(transaccionDe('111023000001', 0, 1)).toBe('111023000001');
    expect(transaccionDe('111023000001', 1, 2)).toBe('111023000001-2');
  });
});
