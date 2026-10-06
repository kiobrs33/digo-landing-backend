import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginationArgs } from '../common/pagination.js';
import { buildXlsx, siteName, type XlsxColumn } from '../common/xlsx.js';
import { Prisma, type ContactInquiry } from '../generated/prisma/client.js';
import { InquiryStatus } from '../generated/prisma/enums.js';
import type { AuthUser } from '../auth/auth-user.js';
import { assertSiteAccess, siteScope } from '../auth/guards.js';
import { mailLayout, mailTable } from '../mail/layout.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  BulkUpdateInquiriesDto,
  CreateInquiryDto,
  InquirySort,
  ListInquiriesQueryDto,
  UpdateInquiryDto,
} from './dto/contact.dto.js';

const assignedTo = { select: { id: true, name: true } } as const;
/** Responsable y quién la atendió, en cada consulta que devuelve el panel. */
const people = { assignedTo, attendedBy: assignedTo } as const;

@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async create({
    website: _honeypot,
    acceptsPrivacy: _consent,
    ...dto
  }: CreateInquiryDto) {
    const inquiry = await this.prisma.contactInquiry.create({
      data: {
        ...dto,
        email: dto.email?.toLowerCase(),
        company: dto.site === 'EMPRESAS' ? dto.company : null,
        ruc: dto.site === 'EMPRESAS' ? dto.ruc : null,
      },
    });
    await this.mail.send(teamNoticeMail(inquiry, this.mail.teamAddress));
    return { id: inquiry.id, createdAt: inquiry.createdAt };
  }

  async list(query: ListInquiriesQueryDto, user: AuthUser) {
    const where = inquiryWhere(query, user);
    // Los conteos por estado ignoran el filtro de estado: alimentan las pestañas del listado.
    const { status: _status, ...withoutStatus } = where;
    const [items, total, byStatus] = await this.prisma.$transaction([
      this.prisma.contactInquiry.findMany({
        where,
        include: people,
        orderBy: inquiryOrder(query.sort),
        ...paginationArgs(query),
      }),
      this.prisma.contactInquiry.count({ where }),
      this.prisma.contactInquiry.groupBy({
        by: ['status'],
        where: withoutStatus,
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
    ]);
    const counts = Object.fromEntries(
      Object.values(InquiryStatus).map((status) => [
        status,
        byStatus.find((row) => row.status === status)?._count._all ?? 0,
      ]),
    ) as Record<InquiryStatus, number>;
    return { items, total, page: query.page, pageSize: query.pageSize, counts };
  }

  /**
   * Excel (.xlsx) de las consultas que coinciden con los filtros (máx. 5000): encabezado fijo,
   * filtros de Excel en cada columna y fechas reales (se pueden ordenar y filtrar como fecha).
   */
  async exportXlsx(query: ListInquiriesQueryDto, user: AuthUser) {
    const items = await this.prisma.contactInquiry.findMany({
      where: inquiryWhere(query, user),
      include: people,
      orderBy: inquiryOrder(query.sort),
      take: 5000,
    });

    return buildXlsx('Consultas', inquiryColumns, items);
  }

  /** Mismo cambio a varias consultas; cada una registra su atención como en `update`. */
  async bulkUpdate(dto: BulkUpdateInquiriesDto, user: AuthUser) {
    const { ids, ...change } = dto;
    const userId = user.id;
    const current = await this.prisma.contactInquiry.findMany({
      where: { id: { in: ids }, site: { in: user.sites } },
      select: { id: true, status: true },
    });
    await this.prisma.$transaction(
      current.map((inquiry) =>
        this.prisma.contactInquiry.update({
          where: { id: inquiry.id },
          data: {
            ...change,
            ...attendedChange(inquiry.status, change.status, userId),
          },
        }),
      ),
    );
    return { updated: current.length };
  }

  async summary(user: AuthUser) {
    const rows = await this.prisma.contactInquiry.groupBy({
      by: ['site', 'status'],
      where: { site: { in: user.sites } },
      _count: { _all: true },
    });
    return rows.map((row) => ({
      site: row.site,
      status: row.status,
      count: row._count._all,
    }));
  }

  /** La consulta existe y es de un espacio al que el usuario tiene acceso. */
  async assertAccess(id: string, user: AuthUser) {
    const inquiry = await this.prisma.contactInquiry.findUnique({
      where: { id },
      select: { site: true },
    });
    if (!inquiry) throw new NotFoundException('Consulta no encontrada');
    assertSiteAccess(user, inquiry.site);
  }

  async findOne(id: string) {
    const inquiry = await this.prisma.contactInquiry.findUnique({
      where: { id },
      include: people,
    });
    if (!inquiry) throw new NotFoundException('Consulta no encontrada');
    return inquiry;
  }

  async update(id: string, dto: UpdateInquiryDto, userId: string) {
    const current = await this.prisma.contactInquiry.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current) throw new NotFoundException('Consulta no encontrada');

    const attended = attendedChange(current.status, dto.status, userId);

    try {
      return await this.prisma.contactInquiry.update({
        where: { id },
        data: { ...dto, ...attended },
        include: people,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025')
          throw new NotFoundException('Consulta no encontrada');
        if (error.code === 'P2003')
          throw new BadRequestException('El responsable no existe');
      }
      throw error;
    }
  }
}

/** Al marcarla atendida queda constancia de cuándo y quién; si se reabre, se borra. */
function attendedChange(
  current: InquiryStatus,
  next: InquiryStatus | undefined,
  userId: string,
) {
  if (!next || next === current) return {};
  return next === InquiryStatus.ATENDIDA
    ? { attendedAt: new Date(), attendedById: userId }
    : { attendedAt: null, attendedById: null };
}

/** Las fechas del filtro son días de Lima (UTC−5, sin horario de verano). */
const limaDay = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00-05:00`);
const DAY_MS = 24 * 60 * 60 * 1000;

function inquiryWhere(
  query: ListInquiriesQueryDto,
  user: AuthUser,
): Prisma.ContactInquiryWhereInput {
  const userId = user.id;
  const search = query.search?.trim();
  return {
    site: siteScope(user, query.site),
    status: query.status,
    assignedToId:
      query.assignedTo === 'me'
        ? userId
        : query.assignedTo === 'none'
          ? null
          : query.assignedTo,
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
      ? (['name', 'phone', 'email', 'company', 'ruc', 'message'] as const).map(
          (field) => ({
            [field]: { contains: search, mode: 'insensitive' as const },
          }),
        )
      : undefined,
  };
}

function inquiryOrder(
  sort: InquirySort = 'status:asc',
): Prisma.ContactInquiryOrderByWithRelationInput[] {
  const [field, direction] = sort.split(':') as [string, 'asc' | 'desc'];
  if (field === 'status') return [{ status: 'asc' }, { createdAt: 'desc' }];
  if (field === 'attendedAt')
    return [
      { attendedAt: { sort: direction, nulls: 'last' } },
      { createdAt: 'desc' },
    ];
  return [{ [field]: direction }, { createdAt: 'desc' }];
}

const statusName = {
  NUEVA: 'Nueva',
  EN_PROCESO: 'En proceso',
  ATENDIDA: 'Atendida',
} as const;

type InquiryRow = ContactInquiry & {
  assignedTo: { name: string } | null;
  attendedBy: { name: string } | null;
};

/** Columnas del Excel de consultas. */
const inquiryColumns: XlsxColumn<InquiryRow>[] = [
  { header: 'Recibida', width: 18, kind: 'date', value: (q) => q.createdAt },
  { header: 'Sitio', width: 11, value: (q) => siteName[q.site] },
  { header: 'Estado', width: 12, value: (q) => statusName[q.status] },
  { header: 'Nombre', width: 24, value: (q) => q.name },
  { header: 'Empresa', width: 26, value: (q) => q.company },
  { header: 'RUC', width: 13, value: (q) => q.ruc },
  { header: 'Teléfono', width: 14, value: (q) => q.phone },
  { header: 'Correo', width: 28, value: (q) => q.email },
  { header: 'Mensaje', width: 60, kind: 'text', value: (q) => q.message },
  { header: 'Responsable', width: 20, value: (q) => q.assignedTo?.name },
  { header: 'Atendida', width: 18, kind: 'date', value: (q) => q.attendedAt },
  { header: 'Atendida por', width: 20, value: (q) => q.attendedBy?.name },
  { header: 'Notas internas', width: 40, kind: 'text', value: (q) => q.notes },
];

function teamNoticeMail(inquiry: ContactInquiry, teamAddress: string) {
  return {
    to: teamAddress,
    replyTo: inquiry.email ?? undefined,
    subject: `[${inquiry.site}] Nueva consulta de ${inquiry.company ?? inquiry.name}`,
    html: mailLayout({
      title: 'Nueva consulta desde la web',
      body: mailTable([
        ['Sitio', inquiry.site],
        ['Nombre', inquiry.name],
        ['Empresa', inquiry.company],
        ['RUC', inquiry.ruc],
        ['Teléfono', inquiry.phone],
        ['Correo', inquiry.email],
        ['Mensaje', inquiry.message],
      ]),
      footer: 'Atiéndela desde el panel administrativo y cambia su estado.',
    }),
  };
}
