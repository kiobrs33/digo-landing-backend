/** Plantilla de WhatsApp tal como la devuelve Meta (`/message_templates`). */
export type PlantillaMeta = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  parameter_format?: 'POSITIONAL' | 'NAMED';
  components: {
    type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
    format?: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO' | 'LOCATION';
    text?: string;
    /** Valores de ejemplo que se registraron al crear la plantilla en Meta. */
    example?: {
      body_text?: string[][];
      body_text_named_params?: { param_name: string; example: string }[];
      header_text?: string[];
    };
  }[];
};

/** Lo que el panel necesita para armar el envío. */
export type Plantilla = {
  id: string;
  nombre: string;
  idioma: string;
  categoria: string;
  /** Formato del encabezado; `null` si no tiene. */
  encabezado: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO' | null;
  /** El encabezado pide un valor: el enlace del archivo o la variable del texto. */
  encabezadoConVariable: boolean;
  textoEncabezado: string;
  cuerpo: string;
  pie: string;
  /** Variables del cuerpo en orden: '1', '2'… o nombres si la plantilla es NAMED. */
  variables: string[];
  /** Ejemplo de cada variable del cuerpo (mismo orden), si la plantilla lo tiene. */
  ejemplos: string[];
  nombradas: boolean;
};

const VARIABLE = /\{\{\s*([\w]+)\s*\}\}/g;

/** Variables distintas en el orden en que aparecen ({{1}} repetido cuenta una vez). */
export function variablesDe(texto: string): string[] {
  return [...new Set([...texto.matchAll(VARIABLE)].map((match) => match[1]))];
}

export function resumirPlantilla(plantilla: PlantillaMeta): Plantilla {
  const parte = (type: PlantillaMeta['components'][number]['type']) =>
    plantilla.components.find((component) => component.type === type);
  const header = parte('HEADER');
  const encabezado =
    header?.format && header.format !== 'LOCATION' ? header.format : null;
  const body = parte('BODY');
  const cuerpo = body?.text ?? '';
  const variables = variablesDe(cuerpo);
  const nombradas = plantilla.parameter_format === 'NAMED';
  const ejemplos = variables.map((variable, index) =>
    nombradas
      ? (body?.example?.body_text_named_params?.find(
          (param) => param.param_name === variable,
        )?.example ?? '')
      : (body?.example?.body_text?.[0]?.[index] ?? ''),
  );
  return {
    id: plantilla.id,
    nombre: plantilla.name,
    idioma: plantilla.language,
    categoria: plantilla.category,
    encabezado,
    encabezadoConVariable:
      encabezado !== null &&
      (encabezado !== 'TEXT' || variablesDe(header?.text ?? '').length > 0),
    textoEncabezado: header?.text ?? '',
    cuerpo,
    pie: parte('FOOTER')?.text ?? '',
    variables,
    ejemplos,
    nombradas,
  };
}

/** Valores de un destinatario: el del encabezado (si lo pide) y los del cuerpo, en orden. */
export type ParametrosMensaje = { encabezado?: string; cuerpo: string[] };

/** Nombre del PDF que ve el cliente en WhatsApp: "doc-octubre.pdf" (como el sistema anterior). */
export function nombreDocumento(fecha = new Date()) {
  const mes = new Intl.DateTimeFormat('es-PE', {
    month: 'long',
    timeZone: 'America/Lima',
  })
    .format(fecha)
    .toLowerCase();
  return `doc-${mes}.pdf`;
}

/** Cuerpo de `POST /{phone-id}/messages` para una plantilla. */
export function mensajePlantilla(
  plantilla: Plantilla,
  telefono: string,
  { encabezado, cuerpo }: ParametrosMensaje,
  fecha = new Date(),
) {
  const components: Record<string, unknown>[] = [];
  if (plantilla.encabezadoConVariable && encabezado) {
    const tipo = plantilla.encabezado!.toLowerCase();
    components.push({
      type: 'header',
      parameters: [
        plantilla.encabezado === 'TEXT'
          ? { type: 'text', text: encabezado }
          : {
              type: tipo,
              [tipo]: {
                link: encabezado,
                ...(plantilla.encabezado === 'DOCUMENT'
                  ? { filename: nombreDocumento(fecha) }
                  : {}),
              },
            },
      ],
    });
  }
  if (plantilla.variables.length) {
    components.push({
      type: 'body',
      parameters: plantilla.variables.map((variable, index) => ({
        type: 'text',
        text: cuerpo[index] ?? '',
        ...(plantilla.nombradas ? { parameter_name: variable } : {}),
      })),
    });
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefono,
    type: 'template',
    template: {
      name: plantilla.nombre,
      language: { code: plantilla.idioma },
      ...(components.length ? { components } : {}),
    },
  };
}

/**
 * Celular peruano en formato internacional (51 + 9 dígitos que empiezan en 9). Acepta
 * "975 303 771", "+51 975303771", "0975303771" o una celda con dos números (toma el primero).
 * Devuelve '' si no hay un celular válido.
 */
export function normalizarTelefono(texto: string): string {
  const match = /(?:^|\D)(?:\+?51[\s-]?|0)?(9(?:[\s-]?\d){8})(?!\d)/.exec(
    texto,
  );
  return match ? `51${match[1].replace(/\D/g, '')}` : '';
}
