import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { AuthUser } from '../../auth/auth-user.js';
import { buildXlsx } from '../../common/xlsx.js';
import { readSheet } from '../excel-input.js';
import type {
  CrearCampanaDto,
  EstadoEnvio,
  ListarCampanasQueryDto,
  ListarDestinatariosQueryDto,
  PruebaDto,
} from './dto/mensajes.dto.js';
import {
  COLUMNAS_ENCABEZADO,
  columnaEncabezado,
  columnaVariable,
  excelPlantilla,
} from './plantilla-excel.js';
import { ChatwootService } from './chatwoot.service.js';
import {
  mensajePlantilla,
  normalizarTelefono,
  type ParametrosMensaje,
  type Plantilla,
} from './plantillas.js';
import type { Canal, Cuenta } from './cuentas.js';
import { WhatsappService } from './whatsapp.service.js';

const COLUMNA_TELEFONO = 'Teléfono';
/** Mensajes simultáneos por lote y pausa entre lotes (muy por debajo del límite de Meta). */
const LOTE = 20;
const PAUSA_MS = 1000;
/** Por Chatwoot: veces que se revisa al final si Chatwoot ya pasó los mensajes a WhatsApp. */
const REVISIONES_FINALES = 5;
const ESPERA_REVISION_MS = 3000;
/** Tiempo que el Excel subido queda disponible para crear la campaña. */
const ARCHIVO_TTL_MS = 60 * 60_000;
/** Tiempo que una campaña terminada sigue visible (para revisar y descargar el resultado). */
const CAMPANA_TTL_MS = 24 * 60 * 60_000;

/** Un cliente del Excel con los valores de su mensaje y, si lo hay, por qué no se le puede enviar. */
type FilaCliente = {
  fila: number;
  /** Celular en formato internacional; vacío si el del Excel no es válido. */
  telefono: string;
  /** Lo que se escribió en el Excel (para mostrarlo si no es válido). */
  telefonoExcel: string;
  nombre: string;
  parametros: ParametrosMensaje;
  problema: string | null;
};

type ArchivoDestinatarios = {
  cuenta: Cuenta;
  userId: string;
  nombre: string;
  /** Plantilla para la que se subió: sus columnas son las de ese Excel. */
  plantilla: Plantilla;
  clientes: FilaCliente[];
  expira: number;
};

type Destinatario = {
  fila: number;
  telefono: string;
  nombre: string;
  parametros: ParametrosMensaje;
  estado: EstadoEnvio;
  /** Error de Meta o motivo de omisión. */
  detalle: string | null;
  messageId: string | null;
  enviado: Date | null;
  /** Por Chatwoot: la conversación y el mensaje que se escribió en ella. */
  conversacion: number | null;
  mensajeChatwoot: number | null;
  /** Por Chatwoot: falta saber si WhatsApp lo aceptó (Chatwoot lo envía en segundo plano). */
  porConfirmar: boolean;
};

type Campana = {
  id: string;
  cuenta: Cuenta;
  canal: Canal;
  plantilla: Plantilla;
  archivo: string;
  estado: 'EN_CURSO' | 'COMPLETADA' | 'CANCELADA';
  creadaPor: string;
  creada: Date;
  terminada: Date | null;
  destinatarios: Destinatario[];
};

const espera = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Envíos masivos de WhatsApp. Herramienta temporal: las campañas viven en la memoria del
 * servidor (no en la base de datos de las landings). Siguen aunque se cierre el panel, pero un
 * reinicio del servidor detiene las que estén en curso y borra el historial.
 */
@Injectable()
export class MensajesService implements OnApplicationShutdown {
  private readonly logger = new Logger(MensajesService.name);
  private readonly archivos = new Map<string, ArchivoDestinatarios>();
  private readonly campanas = new Map<string, Campana>();
  private apagando = false;

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly chatwoot: ChatwootService,
  ) {}

  onApplicationShutdown() {
    this.apagando = true;
  }

  plantillas(cuenta: Cuenta, refrescar: boolean) {
    return this.whatsapp.listarPlantillas(cuenta, refrescar);
  }

  /** Excel vacío con las columnas que pide la plantilla, para llenar los destinatarios. */
  async excelPlantilla(cuenta: Cuenta, nombre: string, idioma: string) {
    const plantilla = await this.whatsapp.plantilla(cuenta, nombre, idioma);
    return {
      archivo: await excelPlantilla(plantilla),
      nombre: `destinatarios_${plantilla.nombre}.xlsx`,
    };
  }

  // ─── Destinatarios ────────────────────────────────────────────────────────

  /**
   * Lee el Excel de clientes. Debe ser la plantilla generada para esta plantilla de WhatsApp:
   * "Teléfono", "Nombre" y una columna por variable (y por el encabezado si lo pide). Cada fila
   * es un cliente con sus propios valores.
   */
  async cargarDestinatarios(
    cuenta: Cuenta,
    file: Buffer,
    nombre: string,
    plantillaNombre: string,
    idioma: string,
    user: AuthUser,
  ) {
    const plantilla = await this.whatsapp.plantilla(
      cuenta,
      plantillaNombre,
      idioma,
    );
    const columnaHeader = plantilla.encabezadoConVariable
      ? columnaEncabezado(plantilla)
      : null;
    const requeridas = [
      COLUMNA_TELEFONO,
      ...(columnaHeader ? [columnaHeader] : []),
      ...plantilla.variables.map(columnaVariable),
    ];
    const noEsLaPlantilla = (faltan: string[]) =>
      new BadRequestException(
        `Este Excel no es la plantilla de "${plantilla.nombre}"${
          faltan.length
            ? `: le faltan las columnas ${faltan.map((c) => `"${c}"`).join(', ')}`
            : ''
        }. Descárgala en el punto 1, llénala con tus clientes y súbela.`,
      );

    let hoja: Awaited<ReturnType<typeof readSheet>>;
    try {
      hoja = await readSheet(file, [COLUMNA_TELEFONO]);
    } catch {
      throw noEsLaPlantilla([]);
    }
    const faltan = requeridas.filter(
      (columna) => !hoja.columnas.includes(columna),
    );
    if (faltan.length) throw noEsLaPlantilla(faltan);
    // Variables o encabezado que esta plantilla no tiene: el Excel es de otra plantilla.
    const deOtra = hoja.columnas.filter(
      (columna) =>
        (/^Variable \{\{\w+\}\}$/.test(columna) ||
          COLUMNAS_ENCABEZADO.includes(columna)) &&
        !requeridas.includes(columna),
    );
    if (deOtra.length) {
      throw new BadRequestException(
        `Este Excel es de otra plantilla (tiene ${deOtra.map((c) => `"${c}"`).join(', ')}, que "${plantilla.nombre}" no usa). Descarga la plantilla de "${plantilla.nombre}" en el punto 1.`,
      );
    }
    if (!hoja.filas.length) {
      throw new BadRequestException(
        'El Excel no tiene clientes: llena una fila por cliente desde la fila 2.',
      );
    }

    const clientes = hoja.filas.map((fila, index): FilaCliente => {
      const telefonoExcel = (fila[COLUMNA_TELEFONO] ?? '').trim();
      const telefono = normalizarTelefono(telefonoExcel);
      const parametros: ParametrosMensaje = {
        encabezado: columnaHeader
          ? (fila[columnaHeader] ?? '').trim()
          : undefined,
        cuerpo: plantilla.variables.map((variable) =>
          (fila[columnaVariable(variable)] ?? '').trim(),
        ),
      };
      const vacia = plantilla.variables.find((_, i) => !parametros.cuerpo[i]);
      const problema = !telefonoExcel
        ? 'Sin celular'
        : !telefono
          ? 'Celular inválido'
          : columnaHeader && !parametros.encabezado
            ? `"${columnaHeader}" vacío`
            : vacia !== undefined
              ? `"${columnaVariable(vacia)}" vacía`
              : null;
      return {
        fila: hoja.numeros[index],
        telefono,
        telefonoExcel,
        nombre: (fila['Nombre'] ?? '').trim(),
        parametros,
        problema,
      };
    });

    this.limpiar();
    const archivoId = randomUUID();
    this.archivos.set(archivoId, {
      cuenta,
      userId: user.id,
      nombre,
      plantilla,
      clientes,
      expira: Date.now() + ARCHIVO_TTL_MS,
    });
    const listos = clientes.filter((cliente) => !cliente.problema).length;
    return {
      archivoId,
      nombre,
      total: clientes.length,
      listos,
      conProblema: clientes.length - listos,
      clientes: clientes.map((cliente) => ({
        fila: cliente.fila,
        telefono: cliente.telefono || cliente.telefonoExcel,
        nombre: cliente.nombre,
        encabezado: cliente.parametros.encabezado ?? null,
        variables: cliente.parametros.cuerpo,
        problema: cliente.problema,
      })),
    };
  }

  private archivo(cuenta: Cuenta, id: string, user: AuthUser) {
    this.limpiar();
    const archivo = this.archivos.get(id);
    if (!archivo || archivo.userId !== user.id || archivo.cuenta !== cuenta) {
      throw new NotFoundException(
        'El Excel ya no está disponible. Vuelve a subirlo.',
      );
    }
    return archivo;
  }

  /** Borra los Excel vencidos y las campañas terminadas hace más de un día. */
  private limpiar() {
    const ahora = Date.now();
    for (const [id, archivo] of this.archivos) {
      if (archivo.expira < ahora) this.archivos.delete(id);
    }
    for (const [id, campana] of this.campanas) {
      if (
        campana.terminada &&
        campana.terminada.getTime() + CAMPANA_TTL_MS < ahora
      ) {
        this.campanas.delete(id);
      }
    }
  }

  // ─── Envíos ───────────────────────────────────────────────────────────────

  /** Un mensaje de prueba a un número, con valores fijos. */
  async prueba(cuenta: Cuenta, dto: PruebaDto) {
    const plantilla = await this.whatsapp.plantilla(
      cuenta,
      dto.plantilla,
      dto.idioma,
    );
    const telefono = normalizarTelefono(dto.telefono);
    if (!telefono)
      throw new BadRequestException('Ingresa un celular válido (9 dígitos).');
    const parametros = { encabezado: dto.encabezado, cuerpo: dto.variables };
    const faltante = validarParametros(plantilla, parametros);
    if (faltante) throw new BadRequestException(faltante);
    if (dto.canal === 'CHATWOOT') {
      return this.pruebaChatwoot(cuenta, plantilla, telefono, parametros);
    }
    const resultado = await this.whatsapp.enviar(
      cuenta,
      mensajePlantilla(plantilla, telefono, parametros),
      1,
    );
    if (!resultado.ok) throw new BadRequestException(resultado.error);
    return { telefono, messageId: resultado.messageId };
  }

  /** La prueba por Chatwoot espera a que Chatwoot la pase a WhatsApp para avisar si falló. */
  private async pruebaChatwoot(
    cuenta: Cuenta,
    plantilla: Plantilla,
    telefono: string,
    parametros: ParametrosMensaje,
  ) {
    await this.chatwoot.assertPlantilla(cuenta, plantilla);
    const resultado = await this.chatwoot.enviar(
      cuenta,
      plantilla,
      telefono,
      'Prueba de envío masivo',
      parametros,
      1,
    );
    if (!resultado.ok) throw new BadRequestException(resultado.error);
    for (let intento = 0; intento < 4; intento++) {
      await espera(2000);
      const estado = await this.chatwoot
        .estado(cuenta, resultado.conversacionId, resultado.mensajeId)
        .catch(() => null);
      if (estado?.estado === 'ERROR')
        throw new BadRequestException(estado.error);
      if (estado?.estado === 'ENVIADO') break;
    }
    return {
      telefono,
      conversacion: this.chatwoot.enlaceConversacion(
        cuenta,
        resultado.conversacionId,
      ),
    };
  }

  async crearCampana(cuenta: Cuenta, dto: CrearCampanaDto, user: AuthUser) {
    const archivo = this.archivo(cuenta, dto.archivoId, user);
    const { plantilla } = archivo;
    if (plantilla.nombre !== dto.plantilla || plantilla.idioma !== dto.idioma) {
      throw new BadRequestException(
        `El Excel se subió para la plantilla "${plantilla.nombre}". Vuelve a subirlo para esta plantilla.`,
      );
    }
    const canal = dto.canal ?? 'WHATSAPP';
    if (canal === 'CHATWOOT') {
      await this.chatwoot.assertPlantilla(cuenta, plantilla);
    }
    const destinatarios = archivo.clientes.map((cliente): Destinatario => ({
      fila: cliente.fila,
      telefono: cliente.telefono,
      nombre: cliente.nombre,
      parametros: cliente.parametros,
      estado: cliente.problema ? 'OMITIDO' : 'PENDIENTE',
      detalle: cliente.problema,
      messageId: null,
      enviado: null,
      conversacion: null,
      mensajeChatwoot: null,
      porConfirmar: false,
    }));
    if (!destinatarios.some((d) => d.estado === 'PENDIENTE')) {
      throw new BadRequestException(
        'Ningún cliente tiene celular válido y todos sus datos.',
      );
    }

    const campana: Campana = {
      id: randomUUID(),
      cuenta,
      canal,
      plantilla,
      archivo: archivo.nombre,
      estado: 'EN_CURSO',
      creadaPor: user.name,
      creada: new Date(),
      terminada: null,
      destinatarios,
    };
    this.campanas.set(campana.id, campana);
    this.archivos.delete(dto.archivoId);
    this.iniciar(campana);
    return resumen(campana);
  }

  private iniciar(campana: Campana) {
    this.procesar(campana).catch((error: unknown) => {
      this.logger.error(`Campaña ${campana.id}: ${String(error)}`);
      campana.estado = 'CANCELADA';
      campana.terminada = new Date();
    });
  }

  private async procesar(campana: Campana) {
    while (!this.apagando && campana.estado === 'EN_CURSO') {
      const lote = campana.destinatarios
        .filter((d) => d.estado === 'PENDIENTE')
        .slice(0, LOTE);
      if (!lote.length) {
        if (campana.canal === 'CHATWOOT') await this.confirmarFinal(campana);
        campana.estado = 'COMPLETADA';
        campana.terminada = new Date();
        return;
      }
      await Promise.all(
        lote.map((destinatario) => this.enviarA(campana, destinatario)),
      );
      await espera(PAUSA_MS);
      if (campana.canal === 'CHATWOOT') {
        await this.confirmar(campana, ESPERA_REVISION_MS);
      }
    }
  }

  private async enviarA(campana: Campana, destinatario: Destinatario) {
    if (campana.canal === 'CHATWOOT') {
      const resultado = await this.chatwoot.enviar(
        campana.cuenta,
        campana.plantilla,
        destinatario.telefono,
        destinatario.nombre,
        destinatario.parametros,
      );
      if (resultado.ok) {
        destinatario.estado = 'ENVIADO';
        destinatario.conversacion = resultado.conversacionId;
        destinatario.mensajeChatwoot = resultado.mensajeId;
        destinatario.porConfirmar = true;
        destinatario.enviado = new Date();
        destinatario.detalle = null;
      } else {
        destinatario.estado = 'ERROR';
        destinatario.detalle = resultado.error;
      }
      return;
    }
    const resultado = await this.whatsapp.enviar(
      campana.cuenta,
      mensajePlantilla(
        campana.plantilla,
        destinatario.telefono,
        destinatario.parametros,
      ),
    );
    if (resultado.ok) {
      destinatario.estado = 'ENVIADO';
      destinatario.messageId = resultado.messageId;
      destinatario.enviado = new Date();
      destinatario.detalle = null;
    } else {
      destinatario.estado = 'ERROR';
      destinatario.detalle = resultado.error;
    }
  }

  /**
   * Chatwoot pasa los mensajes a WhatsApp en segundo plano: se revisa cada uno enviado hace al
   * menos `antiguedadMs` y se marca como error si Meta lo rechazó.
   */
  private async confirmar(campana: Campana, antiguedadMs: number) {
    const ahora = Date.now();
    const porRevisar = campana.destinatarios.filter(
      (d) =>
        d.porConfirmar &&
        d.conversacion !== null &&
        d.enviado &&
        ahora - d.enviado.getTime() >= antiguedadMs,
    );
    for (let inicio = 0; inicio < porRevisar.length; inicio += LOTE) {
      await Promise.all(
        porRevisar.slice(inicio, inicio + LOTE).map(async (destinatario) => {
          const estado = await this.chatwoot
            .estado(
              campana.cuenta,
              destinatario.conversacion!,
              destinatario.mensajeChatwoot,
            )
            .catch(() => null);
          if (estado?.estado === 'ENVIADO') {
            destinatario.porConfirmar = false;
            destinatario.messageId = estado.wamid;
          } else if (estado?.estado === 'ERROR') {
            destinatario.porConfirmar = false;
            destinatario.estado = 'ERROR';
            destinatario.detalle = estado.error;
          }
        }),
      );
    }
  }

  /** Al terminar, unas revisiones más para los que Chatwoot aún no había enviado. */
  private async confirmarFinal(campana: Campana) {
    for (let vez = 0; vez < REVISIONES_FINALES; vez++) {
      if (!campana.destinatarios.some((d) => d.porConfirmar)) return;
      await espera(ESPERA_REVISION_MS);
      await this.confirmar(campana, 0);
    }
    for (const destinatario of campana.destinatarios) {
      if (destinatario.porConfirmar) {
        destinatario.porConfirmar = false;
        destinatario.detalle =
          'Chatwoot aún no confirmaba el envío a WhatsApp: revisa la conversación.';
      }
    }
  }

  cancelar(cuenta: Cuenta, id: string) {
    const campana = this.campana(cuenta, id);
    if (campana.estado === 'EN_CURSO') {
      campana.estado = 'CANCELADA';
      campana.terminada = new Date();
    }
    return resumen(campana);
  }

  /** Vuelve a poner en cola los que fallaron (p. ej. después de corregir el token). */
  reintentarErrores(cuenta: Cuenta, id: string) {
    const campana = this.campana(cuenta, id);
    if (campana.estado === 'EN_CURSO') {
      throw new BadRequestException('La campaña todavía está enviando.');
    }
    let pendientes = 0;
    for (const destinatario of campana.destinatarios) {
      if (destinatario.estado === 'ERROR') {
        destinatario.estado = 'PENDIENTE';
        destinatario.detalle = null;
        pendientes++;
      }
    }
    if (!pendientes) throw new BadRequestException('No hay envíos con error.');
    campana.estado = 'EN_CURSO';
    campana.terminada = null;
    this.iniciar(campana);
    return resumen(campana);
  }

  // ─── Consultas ────────────────────────────────────────────────────────────

  listar(cuenta: Cuenta, { page, pageSize }: ListarCampanasQueryDto) {
    this.limpiar();
    const todas = [...this.campanas.values()]
      .filter((campana) => campana.cuenta === cuenta)
      .sort((a, b) => b.creada.getTime() - a.creada.getTime());
    return {
      items: todas.slice((page - 1) * pageSize, page * pageSize).map(resumen),
      total: todas.length,
      page,
      pageSize,
    };
  }

  resumen(cuenta: Cuenta, id: string) {
    return resumen(this.campana(cuenta, id));
  }

  destinatarios(
    cuenta: Cuenta,
    id: string,
    { status, page, pageSize }: ListarDestinatariosQueryDto,
  ) {
    const filtrados = this.campana(cuenta, id).destinatarios.filter(
      (d) => !status || d.estado === status,
    );
    return {
      items: filtrados
        .slice((page - 1) * pageSize, page * pageSize)
        .map(({ fila, telefono, nombre, estado, detalle, enviado }) => ({
          fila,
          telefono,
          nombre,
          estado,
          detalle,
          enviado,
        })),
      total: filtrados.length,
      page,
      pageSize,
    };
  }

  async excel(cuenta: Cuenta, id: string) {
    const campana = this.campana(cuenta, id);
    const estado: Record<EstadoEnvio, string> = {
      PENDIENTE: 'Pendiente',
      ENVIADO: 'Enviado',
      ERROR: 'Error',
      OMITIDO: 'Omitido',
    };
    const archivo = await buildXlsx<Destinatario>(
      'Envíos',
      [
        {
          header: 'Fila del Excel',
          width: 10,
          kind: 'number',
          value: (d) => d.fila,
        },
        { header: 'Nombre', width: 36, value: (d) => d.nombre },
        { header: 'Teléfono', width: 14, value: (d) => d.telefono },
        { header: 'Resultado', width: 12, value: (d) => estado[d.estado] },
        { header: 'Detalle', width: 50, kind: 'text', value: (d) => d.detalle },
        { header: 'Enviado', width: 18, kind: 'date', value: (d) => d.enviado },
        ...(campana.canal === 'CHATWOOT'
          ? [
              {
                header: 'Conversación en Chatwoot',
                width: 60,
                value: (d: Destinatario) =>
                  d.conversacion === null
                    ? null
                    : this.chatwoot.enlaceConversacion(
                        campana.cuenta,
                        d.conversacion,
                      ),
              },
            ]
          : []),
      ],
      campana.destinatarios,
    );
    return {
      archivo,
      nombre: `envios_${campana.cuenta}${campana.canal === 'CHATWOOT' ? '_chatwoot' : ''}_${campana.plantilla.nombre}_${campana.creada.toISOString().slice(0, 10)}.xlsx`,
    };
  }

  private campana(cuenta: Cuenta, id: string) {
    this.limpiar();
    const campana = this.campanas.get(id);
    if (!campana || campana.cuenta !== cuenta) {
      throw new NotFoundException(
        'Campaña no encontrada (el historial se borra al reiniciar el servidor).',
      );
    }
    return campana;
  }
}

/** Meta rechaza variables vacías: se avisa antes de enviar. */
function validarParametros(
  plantilla: Plantilla,
  { encabezado, cuerpo }: ParametrosMensaje,
) {
  if (plantilla.encabezadoConVariable && !encabezado?.trim())
    return 'Encabezado vacío';
  const vacia = plantilla.variables.findIndex(
    (_, index) => !cuerpo[index]?.trim(),
  );
  return vacia >= 0 ? `Variable {{${plantilla.variables[vacia]}}} vacía` : '';
}

function resumen(campana: Campana) {
  const contar = (estado: EstadoEnvio) =>
    campana.destinatarios.filter((d) => d.estado === estado).length;
  return {
    id: campana.id,
    canal: campana.canal,
    plantilla: campana.plantilla.nombre,
    idioma: campana.plantilla.idioma,
    archivo: campana.archivo,
    estado: campana.estado,
    creada: campana.creada,
    terminada: campana.terminada,
    creadaPor: campana.creadaPor,
    total: campana.destinatarios.length,
    pendientes: contar('PENDIENTE'),
    enviados: contar('ENVIADO'),
    errores: contar('ERROR'),
    omitidos: contar('OMITIDO'),
  };
}
