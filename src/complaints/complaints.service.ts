import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addBusinessDays,
  businessDaysUntil,
  fromIso,
  limaIsoDate,
  toIso,
} from '../common/business-days.js';
import { getProviderInfo } from '../common/company.js';
import { paginationArgs } from '../common/pagination.js';
import { buildXlsx, siteName, type XlsxColumn } from '../common/xlsx.js';
import { Prisma, type Complaint } from '../generated/prisma/client.js';
import { ComplaintStatus, type Site } from '../generated/prisma/enums.js';
import type { AuthUser } from '../auth/auth-user.js';
import { assertSiteAccess, siteScope } from '../auth/guards.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  receiptMail,
  responseMail,
  teamNoticeMail,
} from './complaint-mails.js';
import type { CreateComplaintDto } from './dto/create-complaint.dto.js';
import type {
  BulkUpdateComplaintsDto,
  ComplaintSort,
  ListComplaintsQueryDto,
  UpdateComplaintManagementDto,
  UpdateComplaintStatusDto,
} from './dto/admin-complaint.dto.js';

const person = { select: { id: true, name: true } } as const;

/** Plazo legal de respuesta, en días hábiles. */
export const RESPONSE_BUSINESS_DAYS = 15;

const DOCUMENT_PATTERNS = {
  DNI: /^\d{8}$/,
  RUC: /^(10|15|17|20)\d{9}$/,
  CE: /^[A-Za-z0-9]{8,12}$/,
  PASAPORTE: /^[A-Za-z0-9]{6,12}$/,
} as const;

export function formatComplaintCode(sequence: number, year: number): string {
  return `${String(sequence).padStart(6, '0')}-${year}`;
}

@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async create(dto: CreateComplaintDto) {
    if (!DOCUMENT_PATTERNS[dto.documentType].test(dto.documentNumber)) {
      throw new BadRequestException([
        'Número de documento inválido para el tipo elegido',
      ]);
    }

    const today = limaIsoDate();
    const year = Number(today.slice(0, 4));

    // El correlativo y la hoja se crean juntos: si algo falla, el número no se consume.
    const complaint = await this.prisma.$transaction(async (tx) => {
      const { last: sequence } = await tx.complaintSequence.upsert({
        where: { year },
        create: { year, last: 1 },
        update: { last: { increment: 1 } },
      });
      return tx.complaint.create({
        data: {
          code: formatComplaintCode(sequence, year),
          year,
          sequence,
          site: dto.site,
          kind: dto.kind,
          documentType: dto.documentType,
          documentNumber: dto.documentNumber.toUpperCase(),
          fullName: dto.fullName,
          address: dto.address,
          email: dto.email.toLowerCase(),
          phone: dto.phone,
          isMinor: dto.isMinor ?? false,
          guardianName: dto.isMinor ? dto.guardianName : null,
          guardianDocument: dto.isMinor ? dto.guardianDocument : null,
          itemType: dto.itemType,
          amount: dto.amount,
          itemDescription: dto.itemDescription,
          detail: dto.detail,
          request: dto.request,
          dueDate: fromIso(addBusinessDays(today, RESPONSE_BUSINESS_DAYS)),
        },
      });
    });

    const provider = await getProviderInfo(this.prisma, complaint.site);
    const [receiptSent] = await Promise.all([
      this.mail.send(receiptMail(complaint, provider)),
      this.mail.send(
        teamNoticeMail(complaint, provider, this.mail.teamAddress),
      ),
    ]);
    if (receiptSent) {
      await this.prisma.complaint.update({
        where: { id: complaint.id },
        data: { receiptSentAt: new Date() },
      });
    }

    return {
      code: complaint.code,
      kind: complaint.kind,
      createdAt: complaint.createdAt,
      dueDate: toIso(complaint.dueDate),
      receiptSent,
    };
  }

  async list(query: ListComplaintsQueryDto, user: AuthUser) {
    const where = complaintWhere(query, user);
    // Los conteos por estado ignoran el filtro de estado: alimentan el selector de estado.
    const { status: _status, ...withoutStatus } = where;
    const [items, total, byStatus] = await this.prisma.$transaction([
      this.prisma.complaint.findMany({
        where,
        orderBy: complaintOrder(query.sort),
        include: { assignedTo: person },
        ...paginationArgs(query),
      }),
      this.prisma.complaint.count({ where }),
      this.prisma.complaint.groupBy({
        by: ['status'],
        where: withoutStatus,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
    ]);
    const counts = Object.fromEntries(
      Object.values(ComplaintStatus).map((status) => [
        status,
        byStatus.find((row) => row.status === status)?._count._all ?? 0,
      ]),
    ) as Record<ComplaintStatus, number>;
    return {
      items: items.map(withDeadline),
      total,
      page: query.page,
      pageSize: query.pageSize,
      counts,
    };
  }

  /** Excel (.xlsx) de las hojas que coinciden con los filtros (máx. 5000). */
  async exportXlsx(query: ListComplaintsQueryDto, user: AuthUser) {
    const items = await this.prisma.complaint.findMany({
      where: complaintWhere(query, user),
      orderBy: complaintOrder(query.sort),
      include: { assignedTo: person, respondedBy: person },
      take: 5000,
    });
    return buildXlsx(
      'Libro de Reclamaciones',
      complaintColumns,
      items.map(withDeadline),
    );
  }

  /**
   * Mismo cambio a varias hojas. El estado solo cambia en las que no están respondidas; el
   * responsable, en todas.
   */
  async bulkUpdate(
    { ids, status, assignedToId }: BulkUpdateComplaintsDto,
    user: AuthUser,
  ) {
    const mine = { id: { in: ids }, site: { in: user.sites } };
    const [byStatus, byAssignee] = await this.prisma.$transaction([
      this.prisma.complaint.updateMany({
        where: status
          ? { ...mine, status: { not: 'RESPONDIDO' } }
          : { id: { in: [] } },
        data: { status },
      }),
      this.prisma.complaint.updateMany({
        where: assignedToId !== undefined ? mine : { id: { in: [] } },
        data: { assignedToId },
      }),
    ]);
    return { updated: Math.max(byStatus.count, byAssignee.count) };
  }

  async summary(user: AuthUser, site?: Site) {
    const today = fromIso(limaIsoDate());
    const soon = fromIso(addBusinessDays(limaIsoDate(), 3));
    const open = {
      status: { not: 'RESPONDIDO' as const },
      site: siteScope(user, site),
    };
    const [pending, overdue, dueSoon] = await this.prisma.$transaction([
      this.prisma.complaint.count({ where: open }),
      this.prisma.complaint.count({
        where: { ...open, dueDate: { lt: today } },
      }),
      this.prisma.complaint.count({
        where: { ...open, dueDate: { gte: today, lte: soon } },
      }),
    ]);
    return { pending, overdue, dueSoon };
  }

  /** La hoja existe y es de un espacio al que el usuario tiene acceso. */
  async assertAccess(id: string, user: AuthUser) {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id },
      select: { site: true },
    });
    if (!complaint) throw new NotFoundException('Hoja no encontrada');
    assertSiteAccess(user, complaint.site);
  }

  async findOne(id: string) {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id },
      include: {
        respondedBy: { select: { id: true, name: true, email: true } },
        assignedTo: person,
      },
    });
    if (!complaint)
      throw new NotFoundException('Hoja de reclamación no encontrada');
    // Nombre del remitente del correo de respuesta, para la vista previa del panel.
    const provider = await getProviderInfo(this.prisma, complaint.site);
    return { ...withDeadline(complaint), providerName: provider.name };
  }

  /** Responsable y notas internas: se pueden cambiar incluso después de responder. */
  async updateManagement(id: string, dto: UpdateComplaintManagementDto) {
    await this.findOne(id);
    try {
      await this.prisma.complaint.update({ where: { id }, data: dto });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException('El responsable no existe');
      }
      throw error;
    }
    return this.findOne(id);
  }

  /** Siguiente hoja sin responder (la que vence antes), sin contar `afterId`. */
  async next(user: AuthUser, afterId?: string, site?: Site) {
    const next = await this.prisma.complaint.findFirst({
      where: {
        status: { not: 'RESPONDIDO' },
        site: siteScope(user, site),
        id: afterId ? { not: afterId } : undefined,
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, code: true },
    });
    return next ?? null;
  }

  async updateStatus(id: string, { status }: UpdateComplaintStatusDto) {
    const complaint = await this.findOne(id);
    if (complaint.status === 'RESPONDIDO') {
      throw new BadRequestException('La hoja ya fue respondida');
    }
    await this.prisma.complaint.update({ where: { id }, data: { status } });
    return this.findOne(id);
  }

  /** Registra la respuesta y la envía al consumidor. Una hoja se responde una sola vez. */
  async respond(id: string, response: string, userId: string) {
    await this.findOne(id);
    // Condición en el mismo UPDATE: dos respuestas simultáneas no pueden pisarse.
    const { count } = await this.prisma.complaint.updateMany({
      where: { id, status: { not: 'RESPONDIDO' } },
      data: {
        response,
        status: 'RESPONDIDO',
        respondedAt: new Date(),
        respondedById: userId,
      },
    });
    if (count === 0) throw new BadRequestException('La hoja ya fue respondida');
    const complaint = await this.prisma.complaint.findUniqueOrThrow({
      where: { id },
    });
    const provider = await getProviderInfo(this.prisma, complaint.site);
    const sent = await this.mail.send(responseMail(complaint, provider));
    if (sent) {
      await this.prisma.complaint.update({
        where: { id },
        data: { responseSentAt: new Date() },
      });
    }
    // La hoja completa (responsable, quién respondió) para que el panel no pierda datos.
    return { ...(await this.findOne(id)), responseSent: sent };
  }

  /** Reintenta el envío de la respuesta (p. ej. si el SMTP falló). */
  async resendResponse(id: string) {
    const complaint = await this.findOne(id);
    if (complaint.status !== 'RESPONDIDO' || !complaint.response) {
      throw new BadRequestException('La hoja aún no tiene respuesta');
    }
    const provider = await getProviderInfo(this.prisma, complaint.site);
    const sent = await this.mail.send(responseMail(complaint, provider));
    if (sent) {
      await this.prisma.complaint.update({
        where: { id },
        data: { responseSentAt: new Date() },
      });
    }
    return { responseSent: sent };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Las fechas del filtro son días de Lima (UTC−5, sin horario de verano). */
const limaDay = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00-05:00`);

function complaintWhere(
  query: ListComplaintsQueryDto,
  user: AuthUser,
): Prisma.ComplaintWhereInput {
  const userId = user.id;
  const search = query.search?.trim();
  const today = fromIso(limaIsoDate());
  const soon = fromIso(addBusinessDays(limaIsoDate(), 3));
  return {
    site: siteScope(user, query.site),
    status:
      query.status ??
      (query.open || query.plazo ? { not: 'RESPONDIDO' } : undefined),
    kind: query.kind,
    dueDate:
      query.plazo === 'vencido'
        ? { lt: today }
        : query.plazo === 'pronto'
          ? { gte: today, lte: soon }
          : undefined,
    assignedToId:
      query.assigned === 'me'
        ? userId
        : query.assigned === 'none'
          ? null
          : query.assigned,
    createdAt:
      query.from || query.to
        ? {
            gte: query.from ? limaDay(query.from) : undefined,
            lt: query.to
              ? new Date(limaDay(query.to).getTime() + DAY_MS)
              : undefined,
          }
        : undefined,
    OR: search
      ? [
          { code: { contains: search } },
          { documentNumber: { contains: search, mode: 'insensitive' } },
          { fullName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ]
      : undefined,
  };
}

function complaintOrder(
  sort: ComplaintSort = 'priority',
): Prisma.ComplaintOrderByWithRelationInput[] {
  if (sort === 'priority') {
    // Las sin responder primero y, entre ellas, la que vence antes.
    return [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }];
  }
  const [field, direction] = sort.split(':') as [string, 'asc' | 'desc'];
  if (field === 'name') return [{ fullName: direction }];
  if (field === 'respondedAt') {
    return [
      { respondedAt: { sort: direction, nulls: 'last' } },
      { createdAt: 'desc' },
    ];
  }
  return [{ [field]: direction }];
}

const statusName = {
  PENDIENTE: 'Pendiente',
  EN_PROCESO: 'En proceso',
  RESPONDIDO: 'Respondido',
} as const;

type ComplaintRow = ReturnType<
  typeof withDeadline<
    Complaint & {
      assignedTo: { name: string } | null;
      respondedBy: { name: string } | null;
    }
  >
>;

/** Columnas del Excel del Libro de Reclamaciones. */
const complaintColumns: XlsxColumn<ComplaintRow>[] = [
  { header: 'N° hoja', width: 14, value: (c) => c.code },
  { header: 'Registrada', width: 18, kind: 'date', value: (c) => c.createdAt },
  { header: 'Sitio', width: 11, value: (c) => siteName[c.site] },
  {
    header: 'Tipo',
    width: 10,
    value: (c) => (c.kind === 'QUEJA' ? 'Queja' : 'Reclamo'),
  },
  { header: 'Estado', width: 12, value: (c) => statusName[c.status] },
  {
    header: 'Vence',
    width: 12,
    kind: 'day',
    value: (c) => new Date(`${c.dueDate}T00:00:00Z`),
  },
  {
    header: 'Días hábiles restantes',
    width: 12,
    kind: 'number',
    value: (c) => c.businessDaysLeft,
  },
  { header: 'Consumidor', width: 26, value: (c) => c.fullName },
  {
    header: 'Documento',
    width: 18,
    value: (c) => `${c.documentType} ${c.documentNumber}`,
  },
  { header: 'Correo', width: 28, value: (c) => c.email },
  { header: 'Teléfono', width: 14, value: (c) => c.phone },
  { header: 'Bien contratado', width: 26, value: (c) => c.itemDescription },
  {
    header: 'Monto (S/)',
    width: 11,
    kind: 'number',
    value: (c) => (c.amount ? Number(c.amount) : null),
  },
  { header: 'Detalle', width: 50, kind: 'text', value: (c) => c.detail },
  { header: 'Pedido', width: 40, kind: 'text', value: (c) => c.request },
  { header: 'Responsable', width: 20, value: (c) => c.assignedTo?.name },
  {
    header: 'Respondida',
    width: 18,
    kind: 'date',
    value: (c) => c.respondedAt,
  },
  { header: 'Respondida por', width: 20, value: (c) => c.respondedBy?.name },
  {
    header: 'Notas internas',
    width: 40,
    kind: 'text',
    value: (c) => c.internalNotes,
  },
];

/** Agrega los días hábiles restantes (negativo = vencido) para el semáforo del panel. */
function withDeadline<T extends Complaint>(complaint: T) {
  return {
    ...complaint,
    dueDate: toIso(complaint.dueDate),
    businessDaysLeft:
      complaint.status === 'RESPONDIDO'
        ? null
        : businessDaysUntil(toIso(complaint.dueDate)),
  };
}
