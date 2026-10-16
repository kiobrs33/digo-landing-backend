import {
  mensajePlantilla,
  normalizarTelefono,
  parametrosChatwoot,
  type PlantillaMeta,
  resumirPlantilla,
  textoPlantilla,
  variablesDe,
} from './plantillas.js';

const meta = (overrides: Partial<PlantillaMeta> = {}): PlantillaMeta => ({
  id: '1',
  name: 'recordatorio_pago',
  language: 'es',
  status: 'APPROVED',
  category: 'UTILITY',
  parameter_format: 'POSITIONAL',
  components: [
    { type: 'HEADER', format: 'DOCUMENT' },
    {
      type: 'BODY',
      text: 'Hola {{1}}, tu recibo de {{2}} vence el {{3}}. Gracias {{1}}.',
    },
    { type: 'FOOTER', text: 'Digo Telecom' },
  ],
  ...overrides,
});

describe('plantillas', () => {
  it('cuenta cada variable una vez', () => {
    expect(variablesDe('Hola {{1}}, {{2}} y {{1}}')).toEqual(['1', '2']);
    expect(variablesDe('Hola {{ nombre }}')).toEqual(['nombre']);
  });

  it('resume la plantilla para el panel', () => {
    expect(resumirPlantilla(meta())).toMatchObject({
      nombre: 'recordatorio_pago',
      encabezado: 'DOCUMENT',
      encabezadoConVariable: true,
      variables: ['1', '2', '3'],
      pie: 'Digo Telecom',
      nombradas: false,
    });
    const textoFijo = resumirPlantilla(
      meta({
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'Aviso' },
          { type: 'BODY', text: 'Hola' },
        ],
      }),
    );
    expect(textoFijo.encabezadoConVariable).toBe(false);
    expect(textoFijo.variables).toEqual([]);
  });

  it('arma el mensaje con documento y variables del cuerpo', () => {
    const plantilla = resumirPlantilla(meta());
    const mensaje = mensajePlantilla(
      plantilla,
      '51975303771',
      {
        encabezado: 'https://x.pe/recibo.pdf',
        cuerpo: ['ANA', 'S/ 59.00', '11/10/2026'],
      },
      new Date('2026-10-05T15:00:00Z'),
    );
    expect(mensaje).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '51975303771',
      type: 'template',
      template: {
        name: 'recordatorio_pago',
        language: { code: 'es' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'document',
                document: {
                  link: 'https://x.pe/recibo.pdf',
                  filename: 'doc-octubre.pdf',
                },
              },
            ],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'ANA' },
              { type: 'text', text: 'S/ 59.00' },
              { type: 'text', text: '11/10/2026' },
            ],
          },
        ],
      },
    });
  });

  it('nombra los parámetros en plantillas NAMED', () => {
    const plantilla = resumirPlantilla(
      meta({
        parameter_format: 'NAMED',
        components: [{ type: 'BODY', text: 'Hola {{nombre}}' }],
      }),
    );
    const { template } = mensajePlantilla(plantilla, '51975303771', {
      cuerpo: ['ANA'],
    });
    expect(template.components).toEqual([
      {
        type: 'body',
        parameters: [{ type: 'text', text: 'ANA', parameter_name: 'nombre' }],
      },
    ]);
  });

  it('normaliza celulares peruanos', () => {
    expect(normalizarTelefono('975303771')).toBe('51975303771');
    expect(normalizarTelefono('975 303 771')).toBe('51975303771');
    expect(normalizarTelefono('+51 975303771')).toBe('51975303771');
    expect(normalizarTelefono('51975303771')).toBe('51975303771');
    expect(normalizarTelefono('0975303771')).toBe('51975303771');
    expect(normalizarTelefono('975303771 / 906340930')).toBe('51975303771');
    expect(normalizarTelefono('054-123456')).toBe('');
    expect(normalizarTelefono('')).toBe('');
    expect(normalizarTelefono('12345')).toBe('');
  });

  it('arma los parámetros de Chatwoot con el PDF y las variables', () => {
    const plantilla = resumirPlantilla(meta());
    const params = parametrosChatwoot(
      plantilla,
      {
        encabezado: 'https://x.pe/recibo.pdf',
        cuerpo: ['ANA', 'octubre', '15/10'],
      },
      new Date('2026-10-15T12:00:00Z'),
    );
    expect(params).toEqual({
      header: {
        media_url: 'https://x.pe/recibo.pdf',
        media_type: 'document',
        media_name: 'doc-octubre.pdf',
      },
      body: { '1': 'ANA', '2': 'octubre', '3': '15/10' },
    });
  });

  it('escribe en Chatwoot el texto con los valores del cliente', () => {
    const plantilla = resumirPlantilla(meta());
    expect(
      textoPlantilla(plantilla, { cuerpo: ['ANA', 'octubre', '15/10'] }),
    ).toBe(
      'Hola ANA, tu recibo de octubre vence el 15/10. Gracias ANA.\n\nDigo Telecom',
    );
  });
});
