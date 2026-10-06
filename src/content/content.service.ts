import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { assertSameIds } from '../common/ordering.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Site } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PublishService } from '../publish/publish.service.js';
import { normalizeRings } from './coverage-zones.js';
import type {
  AboutPhotoDto,
  CarouselSlideDto,
  CompanyProfileDto,
  CoverageZoneDto,
  PlanDto,
  SocialLinkDto,
} from './dto/content.dto.js';

const image = {
  select: {
    id: true,
    url: true,
    width: true,
    height: true,
    alt: true,
    provider: true,
  },
} as const;

/** Colecciones ordenables de cada sitio. */
type Collection =
  'plan' | 'carouselSlide' | 'socialLink' | 'aboutPhoto' | 'coverageZone';

const entityLabel: Record<Collection, string> = {
  plan: 'Plan',
  carouselSlide: 'Carrusel',
  socialLink: 'Red social',
  aboutPhoto: 'Foto de Nosotros',
  coverageZone: 'Zona de cobertura',
};

/**
 * Contenido editable de los sitios. Cada cambio marca el sitio con "cambios sin publicar"
 * (la landing se regenera al publicar).
 */
@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publish: PublishService,
  ) {}

  // ─── Empresa ───

  async getCompany(site: Site) {
    const profile = await this.prisma.companyProfile.findUnique({
      where: { site },
      include: { logo: image },
    });
    if (!profile)
      throw new NotFoundException('El sitio aún no tiene datos de empresa');
    return profile;
  }

  async updateCompany(site: Site, dto: CompanyProfileDto) {
    const profile = await this.write(() =>
      this.prisma.companyProfile.upsert({
        where: { site },
        create: { site, ...dto },
        update: dto,
        include: { logo: image },
      }),
    );
    await this.publish.markChanged(site, {
      entity: 'Empresa',
      label: 'Datos de la empresa',
      action: 'EDITADO',
      collection: 'companyProfile',
    });
    return profile;
  }

  // ─── Planes ───

  listPlans(site: Site) {
    return this.prisma.plan.findMany({
      where: { site },
      orderBy: { position: 'asc' },
    });
  }

  async createPlan(site: Site, dto: PlanDto) {
    const plan = await this.prisma.plan.create({
      data: {
        ...normalizePlan(dto),
        site,
        position: await this.nextPosition('plan', site),
      },
    });
    await this.publish.markChanged(site, {
      entity: 'Plan',
      label: plan.name,
      action: 'CREADO',
      collection: 'plan',
      entityId: plan.id,
    });
    return plan;
  }

  async updatePlan(site: Site, id: string, dto: PlanDto) {
    await this.assertBelongs('plan', site, id);
    const plan = await this.prisma.plan.update({
      where: { id },
      data: normalizePlan(dto),
    });
    await this.publish.markChanged(site, {
      entity: 'Plan',
      label: plan.name,
      action: 'EDITADO',
      collection: 'plan',
      entityId: plan.id,
    });
    return plan;
  }

  // ─── Carrusel ───

  listSlides(site: Site) {
    return this.prisma.carouselSlide.findMany({
      where: { site },
      orderBy: { position: 'asc' },
      include: { image },
    });
  }

  async createSlide(site: Site, dto: CarouselSlideDto) {
    const data = normalizeSlide(dto);
    const slide = await this.write(async () =>
      this.prisma.carouselSlide.create({
        data: {
          ...data,
          site,
          position: await this.nextPosition('carouselSlide', site),
        },
        include: { image },
      }),
    );
    await this.publish.markChanged(site, {
      entity: 'Carrusel',
      label: slide.title,
      action: 'CREADO',
      collection: 'carouselSlide',
      entityId: slide.id,
    });
    return slide;
  }

  async updateSlide(site: Site, id: string, dto: CarouselSlideDto) {
    await this.assertBelongs('carouselSlide', site, id);
    const slide = await this.write(() =>
      this.prisma.carouselSlide.update({
        where: { id },
        data: normalizeSlide(dto),
        include: { image },
      }),
    );
    await this.publish.markChanged(site, {
      entity: 'Carrusel',
      label: slide.title,
      action: 'EDITADO',
      collection: 'carouselSlide',
      entityId: slide.id,
    });
    return slide;
  }

  // ─── Redes sociales ───

  listSocial(site: Site) {
    return this.prisma.socialLink.findMany({
      where: { site },
      orderBy: { position: 'asc' },
      include: { icon: image },
    });
  }

  async createSocial(site: Site, dto: SocialLinkDto) {
    const link = await this.write(async () =>
      this.prisma.socialLink.create({
        data: {
          ...dto,
          site,
          position: await this.nextPosition('socialLink', site),
        },
        include: { icon: image },
      }),
    );
    await this.publish.markChanged(site, {
      entity: 'Red social',
      label: link.label,
      action: 'CREADO',
      collection: 'socialLink',
      entityId: link.id,
    });
    return link;
  }

  async updateSocial(site: Site, id: string, dto: SocialLinkDto) {
    await this.assertBelongs('socialLink', site, id);
    const link = await this.write(() =>
      this.prisma.socialLink.update({
        where: { id },
        data: dto,
        include: { icon: image },
      }),
    );
    await this.publish.markChanged(site, {
      entity: 'Red social',
      label: link.label,
      action: 'EDITADO',
      collection: 'socialLink',
      entityId: link.id,
    });
    return link;
  }

  // ─── Fotos de Nosotros ───

  listPhotos(site: Site) {
    return this.prisma.aboutPhoto.findMany({
      where: { site },
      orderBy: { position: 'asc' },
      include: { image },
    });
  }

  async createPhoto(site: Site, dto: AboutPhotoDto) {
    const photo = await this.write(async () =>
      this.prisma.aboutPhoto.create({
        data: {
          ...dto,
          site,
          position: await this.nextPosition('aboutPhoto', site),
        },
        include: { image },
      }),
    );
    await this.publish.markChanged(site, {
      entity: 'Foto de Nosotros',
      label: photo.caption || 'Foto sin texto',
      action: 'CREADO',
      collection: 'aboutPhoto',
      entityId: photo.id,
    });
    return photo;
  }

  async updatePhoto(site: Site, id: string, dto: AboutPhotoDto) {
    await this.assertBelongs('aboutPhoto', site, id);
    const photo = await this.write(() =>
      this.prisma.aboutPhoto.update({
        where: { id },
        data: dto,
        include: { image },
      }),
    );
    await this.publish.markChanged(site, {
      entity: 'Foto de Nosotros',
      label: photo.caption || 'Foto sin texto',
      action: 'EDITADO',
      collection: 'aboutPhoto',
      entityId: photo.id,
    });
    return photo;
  }

  // ─── Zonas de cobertura ───

  listZones(site: Site) {
    return this.prisma.coverageZone.findMany({
      where: { site },
      orderBy: { position: 'asc' },
    });
  }

  async createZone(site: Site, dto: CoverageZoneDto) {
    const zone = await this.prisma.coverageZone.create({
      data: {
        ...dto,
        rings: normalizeRings(dto.rings),
        site,
        position: await this.nextPosition('coverageZone', site),
      },
    });
    await this.publish.markChanged(site, {
      entity: 'Zona de cobertura',
      label: zone.name,
      action: 'CREADO',
      collection: 'coverageZone',
      entityId: zone.id,
    });
    return zone;
  }

  async updateZone(site: Site, id: string, dto: CoverageZoneDto) {
    await this.assertBelongs('coverageZone', site, id);
    const zone = await this.prisma.coverageZone.update({
      where: { id },
      data: { ...dto, rings: normalizeRings(dto.rings) },
    });
    await this.publish.markChanged(site, {
      entity: 'Zona de cobertura',
      label: zone.name,
      action: 'EDITADO',
      collection: 'coverageZone',
      entityId: zone.id,
    });
    return zone;
  }

  // ─── Comunes a las colecciones ───

  async remove(collection: Collection, site: Site, id: string) {
    await this.assertBelongs(collection, site, id);
    const label = await this.labelOf(collection, id);
    await this.delegate(collection).delete({ where: { id } });
    await this.publish.markChanged(site, {
      entity: entityLabel[collection],
      label,
      action: 'ELIMINADO',
      collection,
      entityId: id,
    });
  }

  /** Guarda el orden nuevo: `ids` debe traer todos los elementos del sitio. */
  async reorder(collection: Collection, site: Site, ids: string[]) {
    const current = await this.delegate(collection).findMany({
      where: { site },
      select: { id: true },
    });
    assertSameIds(current, ids);
    await this.prisma.$transaction(
      ids.map((id, position) =>
        this.delegate(collection).update({ where: { id }, data: { position } }),
      ),
    );
    await this.publish.markChanged(site, {
      entity: entityLabel[collection],
      label: 'Orden de la lista',
      action: 'REORDENADO',
      collection,
    });
  }

  /**
   * Las tablas de colección tienen la misma forma (id, site, position); este acceso común evita
   * repetir borrar/reordenar por cada una.
   */
  private delegate(collection: Collection) {
    return this.prisma[collection] as unknown as {
      findMany(args: object): Promise<{ id: string }[]>;
      findFirst(args: object): Promise<{ id: string } | null>;
      aggregate(args: object): Promise<{ _max: { position: number | null } }>;
      update(args: object): Prisma.PrismaPromise<unknown>;
      delete(args: object): Promise<unknown>;
    };
  }

  /** Nombre legible de un elemento, para la bitácora de cambios. */
  private async labelOf(collection: Collection, id: string): Promise<string> {
    switch (collection) {
      case 'plan':
        return (
          (await this.prisma.plan.findUnique({ where: { id } }))?.name ?? 'Plan'
        );
      case 'carouselSlide':
        return (
          (await this.prisma.carouselSlide.findUnique({ where: { id } }))
            ?.title ?? 'Pieza'
        );
      case 'socialLink':
        return (
          (await this.prisma.socialLink.findUnique({ where: { id } }))?.label ??
          'Red social'
        );
      case 'aboutPhoto':
        return (
          (await this.prisma.aboutPhoto.findUnique({ where: { id } }))
            ?.caption || 'Foto sin texto'
        );
      case 'coverageZone':
        return (
          (await this.prisma.coverageZone.findUnique({ where: { id } }))
            ?.name ?? 'Zona'
        );
    }
  }

  private async nextPosition(collection: Collection, site: Site) {
    const { _max } = await this.delegate(collection).aggregate({
      where: { site },
      _max: { position: true },
    });
    return (_max.position ?? -1) + 1;
  }

  /** Un elemento solo se edita desde el sitio al que pertenece. */
  private async assertBelongs(collection: Collection, site: Site, id: string) {
    const found = await this.delegate(collection).findFirst({
      where: { id, site },
      select: { id: true },
    });
    if (!found)
      throw new NotFoundException('Elemento no encontrado en este sitio');
  }

  /** Traduce errores de clave foránea (imagen inexistente) a un 400 legible. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'La imagen seleccionada no existe. Súbela de nuevo.',
        );
      }
      throw error;
    }
  }
}

function normalizePlan(dto: PlanDto) {
  const hasPromo = dto.promoPrice !== null && dto.promoPrice !== undefined;
  if (hasPromo && dto.promoPrice! >= dto.price) {
    throw new BadRequestException([
      'El precio de promoción debe ser menor que el precio regular',
    ]);
  }
  return {
    ...dto,
    promoPrice: hasPromo ? dto.promoPrice : null,
    promoMonths: hasPromo ? dto.promoMonths : null,
  };
}

function normalizeSlide(dto: CarouselSlideDto) {
  if (
    dto.ctaKind === 'LINK' &&
    !/^(\/[\w\-/#?=&.]*|https:\/\/\S+)$/.test(dto.ctaValue ?? '')
  ) {
    throw new BadRequestException([
      'El enlace debe ser una ruta del sitio (p. ej. /cobertura) o una URL que empiece con https://',
    ]);
  }
  const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
  const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new BadRequestException([
      'La fecha de fin debe ser posterior a la de inicio',
    ]);
  }
  const hasCta = dto.ctaKind !== 'NONE';
  return {
    ...dto,
    ctaLabel: hasCta ? dto.ctaLabel : null,
    ctaValue: hasCta ? dto.ctaValue : null,
    startsAt,
    endsAt,
  };
}
