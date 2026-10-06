import type { RegistroTelecredito } from './deudas.js';
import { txtCargaTelecredito } from './telecredito-carga.js';

const registro = (
  overrides: Partial<RegistroTelecredito> = {},
): RegistroTelecredito => ({
  codigo_depositante: '03872061',
  nombre_depositante: 'JOSE AVILA',
  informacion_retorno: 'OCTUBRE',
  fecha_emision: '01/10/2026',
  fecha_vencimiento: '11/10/2026',
  monto_pagar: 49,
  mora_cargo_fijo: 0,
  monto_minimo: 49,
  tipo_registro: 'No Aplica',
  nro_documento_pago: 'B10260001',
  nro_documento_identidad: '03872061',
  ...overrides,
});

describe('txtCargaTelecredito', () => {
  it('arma cabecera y detalle con el formato del macro del BCP', () => {
    const txt = txtCargaTelecredito(
      [
        registro(),
        registro({
          codigo_depositante: '20605174923',
          nro_documento_identidad: '20605174923',
          nombre_depositante:
            'INTERCONEXION DE NEGOCIOS SOCIEDAD ANONIMA CERRADA',
          monto_pagar: 400,
          monto_minimo: 400,
          nro_documento_pago: 'B10260002',
        }),
      ],
      { tipo: 'REEMPLAZO', fecha: '2026-10-05' },
    );
    const [cabecera, primero, segundo, fin] = txt.split('\r\n');
    expect(fin).toBe('');
    expect([cabecera, primero, segundo].map((linea) => linea.length)).toEqual([
      250, 250, 250,
    ]);
    expect(cabecera.trimEnd()).toBe(
      'CC21504713365CDIGO TELECOM SAC                        20261005000000002000000000044900R',
    );
    expect(primero.trimEnd()).toBe(
      'DD2150471336500000003872061JOSE AVILA                              OCTUBRE                       2026100120261011000000000004900000000000000000000004900            B102600010000000003872061',
    );
    // Nombre recortado a 40 caracteres, como el macro.
    expect(segundo.slice(27, 67)).toBe(
      'INTERCONEXION DE NEGOCIOS SOCIEDAD ANONI',
    );
  });

  it('en una actualización marca la cabecera y cada registro como "Agregar"', () => {
    const [cabecera, primero] = txtCargaTelecredito([registro()], {
      tipo: 'ACTUALIZACION',
      fecha: '2026-10-05',
    }).split('\r\n');
    expect(cabecera[86]).toBe('A');
    expect(primero[152]).toBe('A');
  });

  it('rechaza depositante + vencimiento repetidos y nombres con caracteres no válidos', () => {
    expect(() =>
      txtCargaTelecredito([registro(), registro()], {
        tipo: 'REEMPLAZO',
        fecha: '2026-10-05',
      }),
    ).toThrow();
    expect(() =>
      txtCargaTelecredito([registro({ nombre_depositante: 'PEÑA' })], {
        tipo: 'REEMPLAZO',
        fecha: '2026-10-05',
      }),
    ).toThrow();
  });
});
