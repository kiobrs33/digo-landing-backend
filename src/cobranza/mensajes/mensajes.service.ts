import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { AuthUser } from '../../auth/auth-user.js';
import { paginationArgs } from '../../common/pagination.js';
import { buildXlsx } from '../../common/xlsx.js';
import type {
  MensajeCampana,
  MensajeEnvio,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
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
const DAY_MS = 24 * 60 * 60_000;

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

/** Lo que se necesita de la campaña para enviar (se lee una vez de la base). */
type Contexto = {
  id: string;
  cuenta: Cuenta;
  canal: Canal;
  plantilla: Plantilla;
};

/** Plantilla, parámetros y demás objetos simples a una columna JSON. */
const json = (valor: unknown) => valor as Prisma.InputJsonValue;

/** Las fechas del filtro son días de Lima (UTC−5, sin horario de verano). */
const diaLima = (dia: string) => new Date(`${dia.slice(0, 10)}T00:00:00-05:00`);

const espera = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Envíos masivos de WhatsApp. Las campañas y el resultado de cada cliente se guardan en la base:
 * siguen aunque se cierre el panel y, si el servidor se reinicia, las que estaban en curso se
 * retoman con los pendientes (sin repetir los ya enviados). El Excel subido, en cambio, vive en
 * memoria hasta que se crea la campaña.
 */
@Injectable()
export class MensajesService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MensajesService.name);
  private readonly archivos = new Map<string, ArchivoDestinatarios>();
  /** Campañas que este proceso está enviando (para no lanzar la misma dos veces). */
  private readonly activas = new Set<string>();
  private apagando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly chatwoot: ChatwootService,
  ) {}

  /** Retoma las campañas que quedaron en curso al apagarse o caerse el servidor. */
  async onApplicationBootstrap() {
    try {
      const enCurso = await this.prisma.mensajeCampana.findMany({
        where: { estado: 'EN_CURSO' },
        select: { id: true },
      });
      for (const { id } of enCurso) {
        // Los que se estaban enviando en ese momento pudieron llegar: no se reenvían solos.
        await this.prisma.mensajeEnvio.updateMany({
          where: {
            campanaId: id,
            estado: 'PENDIENTE',
            intentadoAt: { not: null },
          },
          data: {
            estado: 'ERROR',
            detalle:
              'El servidor se reinició mientras se enviaba: revisa si llegó antes de reintentar.',
          },
        });
        this.logger.log(`Retomando la campaña ${id}`);
        this.iniciar(id);
      }
    } catch (error) {
      this.logger.error(
        `No se pudieron retomar las campañas: ${String(error)}`,
      );
    }
  }

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

  /** Borra los Excel subidos que vencieron sin crear la campaña. */
  private limpiar() {
    const ahora = Date.now();
    for (const [id, archivo] of this.archivos) {
      if (archivo.expira < ahora) this.archivos.delete(id);
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
    if (archivo.clientes.every((cliente) => cliente.problema)) {
      throw new BadRequestException(
        'Ningún cliente tiene celular válido y todos sus datos.',
      );
    }

    const campana = await this.prisma.mensajeCampana.create({
      data: {
        cuenta,
        canal,
        plantillaNombre: plantilla.nombre,
        idioma: plantilla.idioma,
        plantilla: json(plantilla),
        archivo: archivo.nombre,
        creadaPorId: user.id,
        creadaPorNombre: user.name,
        envios: {
          createMany: {
            data: archivo.clientes.map((cliente) => ({
              fila: cliente.fila,
              telefono: cliente.telefono,
              nombre: cliente.nombre,
              parametros: json(cliente.parametros),
              estado: cliente.problema ? 'OMITIDO' : 'PENDIENTE',
              detalle: cliente.problema,
            })),
          },
        },
      },
    });
    this.archivos.delete(dto.archivoId);
    this.iniciar(campana.id);
    return this.resumen(cuenta, campana.id);
  }

  private iniciar(id: string) {
    if (this.activas.has(id)) return;
    this.activas.add(id);
    this.procesar(id)
      .catch(async (error: unknown) => {
        this.logger.error(`Campaña ${id}: ${String(error)}`);
        await this.prisma.mensajeCampana
          .updateMany({
            where: { id, estado: 'EN_CURSO' },
            data: { estado: 'CANCELADA', terminadaAt: new Date() },
          })
          .catch(() => undefined);
      })
      .finally(() => this.activas.delete(id));
  }

  /** Envía por lotes los pendientes, en orden de fila, hasta terminar o hasta que la detengan. */
  private async procesar(id: string) {
    const campana = await this.prisma.mensajeCampana.findUniqueOrThrow({
      where: { id },
    });
    const contexto: Contexto = {
      id,
      cuenta: campana.cuenta as Cuenta,
      canal: campana.canal,
      plantilla: campana.plantilla as unknown as Plantilla,
    };
    while (!this.apagando) {
      const { estado } = await this.prisma.mensajeCampana.findUniqueOrThrow({
        where: { id },
        select: { estado: true },
      });
      const lote =
        estado === 'EN_CURSO'
          ? await this.prisma.mensajeEnvio.findMany({
              where: { campanaId: id, estado: 'PENDIENTE' },
              orderBy: { fila: 'asc' },
              take: LOTE,
            })
          : [];
      if (!lote.length) {
        if (contexto.canal === 'CHATWOOT') await this.confirmarFinal(contexto);
        await this.prisma.mensajeCampana.updateMany({
          where: { id, estado: 'EN_CURSO' },
          data: { estado: 'COMPLETADA', terminadaAt: new Date() },
        });
        return;
      }
      await this.prisma.mensajeEnvio.updateMany({
        where: { id: { in: lote.map((envio) => envio.id) } },
        data: { intentadoAt: new Date() },
      });
      await Promise.all(lote.map((envio) => this.enviarA(contexto, envio)));
      await espera(PAUSA_MS);
      if (contexto.canal === 'CHATWOOT') {
        await this.confirmar(contexto, ESPERA_REVISION_MS);
      }
    }
  }

  private async enviarA(contexto: Contexto, envio: MensajeEnvio) {
    const parametros = envio.parametros as unknown as ParametrosMensaje;
    if (contexto.canal === 'CHATWOOT') {
      const resultado = await this.chatwoot.enviar(
        contexto.cuenta,
        contexto.plantilla,
        envio.telefono,
        envio.nombre,
        parametros,
      );
      await this.prisma.mensajeEnvio.update({
        where: { id: envio.id },
        data: resultado.ok
          ? {
              estado: 'ENVIADO',
              conversacionId: resultado.conversacionId,
              mensajeChatwootId: resultado.mensajeId,
              porConfirmar: true,
              enviadoAt: new Date(),
              detalle: null,
            }
          : { estado: 'ERROR', detalle: resultado.error },
      });
      return;
    }
    const resultado = await this.whatsapp.enviar(
      contexto.cuenta,
      mensajePlantilla(contexto.plantilla, envio.telefono, parametros),
    );
    await this.prisma.mensajeEnvio.update({
      where: { id: envio.id },
      data: resultado.ok
        ? {
            estado: 'ENVIADO',
            messageId: resultado.messageId,
            enviadoAt: new Date(),
            detalle: null,
          }
        : { estado: 'ERROR', detalle: resultado.error },
    });
  }

  /**
   * Chatwoot pasa los mensajes a WhatsApp en segundo plano: se revisa cada uno enviado hace al
   * menos `antiguedadMs` y se marca como error si Meta lo rechazó.
   */
  private async confirmar(contexto: Contexto, antiguedadMs: number) {
    const porRevisar = await this.prisma.mensajeEnvio.findMany({
      where: {
        campanaId: contexto.id,
        porConfirmar: true,
        conversacionId: { not: null },
        enviadoAt: { lte: new Date(Date.now() - antiguedadMs) },
      },
    });
    for (let inicio = 0; inicio < porRevisar.length; inicio += LOTE) {
      await Promise.all(
        porRevisar.slice(inicio, inicio + LOTE).map(async (envio) => {
          const estado = await this.chatwoot
            .estado(
              contexto.cuenta,
              envio.conversacionId!,
              envio.mensajeChatwootId,
            )
            .catch(() => null);
          if (estado?.estado === 'ENVIADO') {
            await this.prisma.mensajeEnvio.update({
              where: { id: envio.id },
              data: { porConfirmar: false, messageId: estado.wamid },
            });
          } else if (estado?.estado === 'ERROR') {
            await this.prisma.mensajeEnvio.update({
              where: { id: envio.id },
              data: {
                porConfirmar: false,
                estado: 'ERROR',
                detalle: estado.error,
              },
            });
          }
        }),
      );
    }
  }

  /** Al terminar, unas revisiones más para los que Chatwoot aún no había enviado. */
  private async confirmarFinal(contexto: Contexto) {
    const quedan = () =>
      this.prisma.mensajeEnvio.count({
        where: { campanaId: contexto.id, porConfirmar: true },
      });
    for (let vez = 0; vez < REVISIONES_FINALES; vez++) {
      if (!(await quedan())) return;
      await espera(ESPERA_REVISION_MS);
      await this.confirmar(contexto, 0);
    }
    await this.prisma.mensajeEnvio.updateMany({
      where: { campanaId: contexto.id, porConfirmar: true },
      data: {
        porConfirmar: false,
        detalle:
          'Chatwoot aún no confirmaba el envío a WhatsApp: revisa la conversación.',
      },
    });
  }

  async cancelar(cuenta: Cuenta, id: string) {
    await this.campana(cuenta, id);
    await this.prisma.mensajeCampana.updateMany({
      where: { id, estado: 'EN_CURSO' },
      data: { estado: 'CANCELADA', terminadaAt: new Date() },
    });
    return this.resumen(cuenta, id);
  }

  /** Vuelve a poner en cola los que fallaron (p. ej. después de corregir el token). */
  async reintentarErrores(cuenta: Cuenta, id: string) {
    const campana = await this.campana(cuenta, id);
    if (campana.estado === 'EN_CURSO' || this.activas.has(id)) {
      throw new BadRequestException('La campaña todavía está enviando.');
    }
    const { count } = await this.prisma.mensajeEnvio.updateMany({
      where: { campanaId: id, estado: 'ERROR' },
      data: {
        estado: 'PENDIENTE',
        detalle: null,
        intentadoAt: null,
        porConfirmar: false,
      },
    });
    if (!count) throw new BadRequestException('No hay envíos con error.');
    await this.prisma.mensajeCampana.update({
      where: { id },
      data: { estado: 'EN_CURSO', terminadaAt: null },
    });
    this.iniciar(id);
    return this.resumen(cuenta, id);
  }

  // ─── Consultas ────────────────────────────────────────────────────────────

  async listar(cuenta: Cuenta, query: ListarCampanasQueryDto) {
    const buscar = query.buscar?.trim();
    const where: Prisma.MensajeCampanaWhereInput = {
      cuenta,
      createdAt:
        query.desde || query.hasta
          ? {
              gte: query.desde ? diaLima(query.desde) : undefined,
              lt: query.hasta
                ? new Date(diaLima(query.hasta).getTime() + DAY_MS)
                : undefined,
            }
          : undefined,
      OR: buscar
        ? [
            { plantillaNombre: { contains: buscar, mode: 'insensitive' } },
            { archivo: { contains: buscar, mode: 'insensitive' } },
            { creadaPorNombre: { contains: buscar, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [campanas, total] = await Promise.all([
      this.prisma.mensajeCampana.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginationArgs(query),
      }),
      this.prisma.mensajeCampana.count({ where }),
    ]);
    const conteos = await this.conteos(campanas.map((campana) => campana.id));
    return {
      items: campanas.map((campana) => resumen(campana, conteos)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async resumen(cuenta: Cuenta, id: string) {
    const campana = await this.campana(cuenta, id);
    return resumen(campana, await this.conteos([id]));
  }

  /** Clientes por estado de cada campaña. */
  private async conteos(ids: string[]) {
    const filas = ids.length
      ? await this.prisma.mensajeEnvio.groupBy({
          by: ['campanaId', 'estado'],
          where: { campanaId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const conteos = new Map<string, Record<EstadoEnvio, number>>();
    for (const fila of filas) {
      const actual = conteos.get(fila.campanaId) ?? {
        PENDIENTE: 0,
        ENVIADO: 0,
        ERROR: 0,
        OMITIDO: 0,
      };
      actual[fila.estado] = fila._count._all;
      conteos.set(fila.campanaId, actual);
    }
    return conteos;
  }

  async destinatarios(
    cuenta: Cuenta,
    id: string,
    { status, page, pageSize }: ListarDestinatariosQueryDto,
  ) {
    await this.campana(cuenta, id);
    const where = { campanaId: id, estado: status };
    const [envios, total] = await Promise.all([
      this.prisma.mensajeEnvio.findMany({
        where,
        orderBy: { fila: 'asc' },
        ...paginationArgs({ page, pageSize }),
      }),
      this.prisma.mensajeEnvio.count({ where }),
    ]);
    return {
      items: envios.map(
        ({ fila, telefono, nombre, estado, detalle, enviadoAt }) => ({
          fila,
          telefono,
          nombre,
          estado,
          detalle,
          enviado: enviadoAt,
        }),
      ),
      total,
      page,
      pageSize,
    };
  }

  async excel(cuenta: Cuenta, id: string) {
    const campana = await this.campana(cuenta, id);
    const envios = await this.prisma.mensajeEnvio.findMany({
      where: { campanaId: id },
      orderBy: { fila: 'asc' },
    });
    const estado: Record<EstadoEnvio, string> = {
      PENDIENTE: 'Pendiente',
      ENVIADO: 'Enviado',
      ERROR: 'Error',
      OMITIDO: 'Omitido',
    };
    const archivo = await buildXlsx<MensajeEnvio>(
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
        {
          header: 'Enviado',
          width: 18,
          kind: 'date',
          value: (d) => d.enviadoAt,
        },
        ...(campana.canal === 'CHATWOOT'
          ? [
              {
                header: 'Conversación en Chatwoot',
                width: 60,
                value: (d: MensajeEnvio) =>
                  d.conversacionId === null
                    ? null
                    : this.chatwoot.enlaceConversacion(
                        cuenta,
                        d.conversacionId,
                      ),
              },
            ]
          : []),
      ],
      envios,
    );
    return {
      archivo,
      nombre: `envios_${cuenta}${campana.canal === 'CHATWOOT' ? '_chatwoot' : ''}_${campana.plantillaNombre}_${campana.createdAt.toISOString().slice(0, 10)}.xlsx`,
    };
  }

  private async campana(cuenta: Cuenta, id: string) {
    const campana = await this.prisma.mensajeCampana.findFirst({
      where: { id, cuenta },
    });
    if (!campana) throw new NotFoundException('Campaña no encontrada.');
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

function resumen(
  campana: MensajeCampana,
  conteos: Map<string, Record<EstadoEnvio, number>>,
) {
  const cuenta = conteos.get(campana.id) ?? {
    PENDIENTE: 0,
    ENVIADO: 0,
    ERROR: 0,
    OMITIDO: 0,
  };
  return {
    id: campana.id,
    canal: campana.canal,
    plantilla: campana.plantillaNombre,
    idioma: campana.idioma,
    archivo: campana.archivo,
    estado: campana.estado,
    creada: campana.createdAt,
    terminada: campana.terminadaAt,
    creadaPor: campana.creadaPorNombre,
    total: cuenta.PENDIENTE + cuenta.ENVIADO + cuenta.ERROR + cuenta.OMITIDO,
    pendientes: cuenta.PENDIENTE,
    enviados: cuenta.ENVIADO,
    errores: cuenta.ERROR,
    omitidos: cuenta.OMITIDO,
  };
}
