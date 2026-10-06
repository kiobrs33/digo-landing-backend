import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { type ContentAction, Site } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type ContentChangeInput = {
  entity: string;
  label: string;
  action: ContentAction;
  /** Tabla del elemento: permite deshacer este cambio por separado. */
  collection?: ChangeCollection;
  /** Elemento afectado; sin él, el cambio es de orden (o de los datos de la empresa). */
  entityId?: string;
};

/** Tablas de contenido que se pueden publicar y deshacer. */
export type ChangeCollection =
  | 'companyProfile'
  | 'plan'
  | 'carouselSlide'
  | 'socialLink'
  | 'aboutPhoto'
  | 'coverageZone';

const collections: ChangeCollection[] = [
  'companyProfile',
  'plan',
  'carouselSlide',
  'socialLink',
  'aboutPhoto',
  'coverageZone',
];

/**
 * Las landings se generan en el build de Vercel con el contenido de la API. "Publicar" dispara
 * ese build mediante un Deploy Hook; aquí se registra si hay cambios pendientes de publicar.
 */
@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Lo llaman los servicios de contenido después de cada cambio: marca y registra qué cambió. */
  async markChanged(site: Site, change: ContentChangeInput) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.sitePublication.upsert({
        where: { site },
        create: { site, contentUpdatedAt: now },
        update: { contentUpdatedAt: now },
      }),
      this.prisma.contentChange.create({ data: { site, ...change, at: now } }),
    ]);
  }

  async status(site: Site) {
    let row = await this.prisma.sitePublication.findUnique({
      where: { site },
      include: { publishedBy: { select: { id: true, name: true } } },
    });
    const pendingChanges = Boolean(
      row && (!row.publishedAt || row.contentUpdatedAt > row.publishedAt),
    );
    // Sitio publicado y sin cambios, pero sin foto (publicado antes de existir): se toma ahora,
    // así el próximo cambio ya se puede descartar.
    if (row?.publishedAt && !pendingChanges && !row.snapshot) {
      row = await this.prisma.sitePublication.update({
        where: { site },
        data: { snapshot: await this.captureContent(site) },
        include: { publishedBy: { select: { id: true, name: true } } },
      });
    }
    // Qué se va a publicar: cambios desde la última publicación (los más recientes primero).
    const raw = pendingChanges
      ? await this.prisma.contentChange.findMany({
          where: {
            site,
            at: row?.publishedAt ? { gt: row.publishedAt } : undefined,
          },
          orderBy: { at: 'desc' },
          take: 300,
        })
      : [];
    const snapshot = (row?.snapshot ?? null) as ContentSnapshot | null;
    const changes = await this.summarize(site, raw, snapshot);
    return {
      site,
      changes,
      contentUpdatedAt: row?.contentUpdatedAt ?? null,
      publishedAt: row?.publishedAt ?? null,
      publishedBy: row?.publishedBy ?? null,
      pendingChanges,
      /** Se puede volver a lo publicado (hay foto de la última publicación). */
      canDiscard: pendingChanges && Boolean(row?.snapshot),
      simulated: !this.hookUrl(site),
    };
  }

  /** Estado de los dos sitios (botón de publicar del encabezado del panel). */
  async statusAll(sites: Site[] = Object.values(Site)) {
    return Promise.all(sites.map((site) => this.status(site)));
  }

  /**
   * Descarta los cambios sin publicar: el contenido del sitio vuelve a la foto de la última
   * publicación (vuelven los eliminados, se quitan los nuevos y se restauran ediciones y orden).
   */
  async discard(site: Site) {
    const row = await this.prisma.sitePublication.findUnique({
      where: { site },
    });
    if (!row?.publishedAt || !row.snapshot) {
      throw new BadRequestException(
        'No hay una versión publicada guardada para volver. Estará disponible después de la próxima publicación.',
      );
    }
    const snapshot = row.snapshot as unknown as ContentSnapshot;
    const publishedAt = row.publishedAt;

    await this.prisma.$transaction(async (tx) => {
      if (snapshot.company) {
        const { site: _site, ...company } = snapshot.company;
        await tx.companyProfile.upsert({
          where: { site },
          create: { ...company, site },
          update: company,
        });
      }

      const keep = (items: { id?: string }[]) => ({
        notIn: items.map((item) => item.id ?? ''),
      });
      await tx.plan.deleteMany({ where: { site, id: keep(snapshot.plans) } });
      for (const { id, ...plan } of snapshot.plans) {
        await tx.plan.upsert({
          where: { id },
          create: { id, ...plan },
          update: plan,
        });
      }
      await tx.carouselSlide.deleteMany({
        where: { site, id: keep(snapshot.carousel) },
      });
      for (const { id, ...slide } of snapshot.carousel) {
        await tx.carouselSlide.upsert({
          where: { id },
          create: { id, ...slide },
          update: slide,
        });
      }
      await tx.socialLink.deleteMany({
        where: { site, id: keep(snapshot.social) },
      });
      for (const { id, ...link } of snapshot.social) {
        await tx.socialLink.upsert({
          where: { id },
          create: { id, ...link },
          update: link,
        });
      }
      await tx.aboutPhoto.deleteMany({
        where: { site, id: keep(snapshot.aboutPhotos) },
      });
      for (const { id, ...photo } of snapshot.aboutPhotos) {
        await tx.aboutPhoto.upsert({
          where: { id },
          create: { id, ...photo },
          update: photo,
        });
      }
      // Publicaciones anteriores a las zonas no las traen: en ese caso no se tocan.
      if (snapshot.coverageZones) {
        await tx.coverageZone.deleteMany({
          where: { site, id: keep(snapshot.coverageZones) },
        });
        for (const { id, ...zone } of snapshot.coverageZones) {
          await tx.coverageZone.upsert({
            where: { id },
            create: { id, ...zone },
            update: zone,
          });
        }
      }

      // Lo descartado ya no está pendiente ni aparece en la lista de cambios.
      await tx.contentChange.deleteMany({
        where: { site, at: { gt: publishedAt } },
      });
      await tx.sitePublication.update({
        where: { site },
        data: { contentUpdatedAt: publishedAt },
      });
    });
    return this.status(site);
  }

  /**
   * Deshace un solo cambio (`key` de la lista): ese elemento, el orden de esa lista o los datos de
   * la empresa vuelven a como están publicados. Lo demás sin publicar no se toca.
   */
  async undo(site: Site, key: string) {
    const row = await this.prisma.sitePublication.findUnique({
      where: { site },
    });
    if (!row?.publishedAt || !row.snapshot) {
      throw new BadRequestException(
        'No hay una versión publicada guardada para volver. Estará disponible después de la próxima publicación.',
      );
    }
    const [collection, part] = key.split(':') as [ChangeCollection, string];
    if (!collections.includes(collection) || !part) {
      throw new BadRequestException(
        'Este cambio es anterior al registro por elemento: usa "Descartar todo".',
      );
    }
    const snapshot = row.snapshot as unknown as ContentSnapshot;
    const publishedAt = row.publishedAt;
    const entityId = part === 'all' ? null : part;

    await this.prisma.$transaction(async (tx) => {
      if (collection === 'companyProfile') {
        if (snapshot.company) {
          const { site: _site, ...company } = snapshot.company;
          await tx.companyProfile.upsert({
            where: { site },
            create: { ...company, site },
            update: company,
          });
        }
      } else {
        const model = tx[collection] as unknown as CollectionDelegate;
        const published = snapshotList(snapshot, collection);
        const rank = new Map(published.map((item, index) => [item.id, index]));
        const byPublished = (
          a: { id: string; position: number },
          b: { id: string; position: number },
        ) =>
          (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
          a.position - b.position;

        if (entityId !== null) {
          const original = published.find((item) => item.id === entityId);
          if (original) {
            const { id, ...data } = original;
            await model.upsert({
              where: { id },
              create: { id, ...data },
              update: data,
            });
          } else {
            await model.deleteMany({ where: { site, id: entityId } });
          }
        }

        // Puestos sin repetir. Deshacer el orden (o un elemento cuando el orden no está pendiente)
        // deja el orden publicado; si el orden sigue pendiente, se respeta y el elemento restaurado
        // vuelve a su puesto publicado.
        const orderPending =
          entityId !== null &&
          (await tx.contentChange.count({
            where: {
              site,
              collection,
              entityId: null,
              at: { gt: publishedAt },
            },
          })) > 0;
        const items = await model.findMany({
          where: { site },
          orderBy: { position: 'asc' },
          select: { id: true, position: true },
        });
        let ordered: { id: string; position: number }[];
        if (!orderPending) {
          ordered = [...items].sort(byPublished);
        } else {
          ordered = items.filter((item) => item.id !== entityId);
          const restored = items.find((item) => item.id === entityId);
          if (restored)
            ordered.splice(
              Math.min(rank.get(restored.id) ?? ordered.length, ordered.length),
              0,
              restored,
            );
        }
        for (const [position, item] of ordered.entries()) {
          if (item.position !== position) {
            await model.update({ where: { id: item.id }, data: { position } });
          }
        }
      }

      await tx.contentChange.deleteMany({
        where: { site, collection, entityId, at: { gt: publishedAt } },
      });
      const remaining = await tx.contentChange.count({
        where: { site, at: { gt: publishedAt } },
      });
      if (remaining === 0) {
        await tx.sitePublication.update({
          where: { site },
          data: { contentUpdatedAt: publishedAt },
        });
      }
    });
    return this.status(site);
  }

  /**
   * Lista de cambios para el panel: uno por elemento (o por orden de una lista), con su efecto
   * neto frente a lo publicado. Algo creado y luego borrado no aparece: no cambia la web.
   */
  private async summarize(
    site: Site,
    raw: {
      id: string;
      entity: string;
      label: string;
      action: ContentAction;
      at: Date;
      collection: string | null;
      entityId: string | null;
    }[],
    snapshot: ContentSnapshot | null,
  ) {
    const groups = new Map<string, typeof raw>();
    for (const change of raw) {
      const key = change.collection
        ? `${change.collection}:${change.entityId ?? 'all'}`
        : // Registros anteriores al cambio por elemento: se agrupan por lo que muestran.
          `legacy:${change.entity}|${change.label}|${change.action === 'EDITADO' ? 'E' : change.action}`;
      groups.set(key, [...(groups.get(key) ?? []), change]);
    }
    const current = snapshot ? await this.currentIds(site) : null;

    return [...groups].flatMap(([key, [latest]]) => {
      let action = latest.action;
      const collection = latest.collection as ChangeCollection | null;
      if (
        current &&
        snapshot &&
        collection &&
        collection !== 'companyProfile' &&
        latest.entityId
      ) {
        const published = snapshotList(snapshot, collection).some(
          (item) => item.id === latest.entityId,
        );
        const exists = current[collection].has(latest.entityId);
        if (!published && !exists) return [];
        action = !published ? 'CREADO' : !exists ? 'ELIMINADO' : 'EDITADO';
      }
      return [
        {
          key,
          entity: latest.entity,
          label: latest.label,
          action,
          at: latest.at,
          /** Se puede deshacer solo este cambio. */
          undoable: Boolean(snapshot && collection),
        },
      ];
    });
  }

  /** Ids actuales de cada colección (para saber si un elemento sigue existiendo). */
  private async currentIds(site: Site) {
    const select = { where: { site }, select: { id: true } } as const;
    const [plan, carouselSlide, socialLink, aboutPhoto, coverageZone] =
      await Promise.all([
        this.prisma.plan.findMany(select),
        this.prisma.carouselSlide.findMany(select),
        this.prisma.socialLink.findMany(select),
        this.prisma.aboutPhoto.findMany(select),
        this.prisma.coverageZone.findMany(select),
      ]);
    const ids = (items: { id: string }[]) =>
      new Set(items.map((item) => item.id));
    return {
      plan: ids(plan),
      carouselSlide: ids(carouselSlide),
      socialLink: ids(socialLink),
      aboutPhoto: ids(aboutPhoto),
      coverageZone: ids(coverageZone),
    };
  }

  /** Contenido editable del sitio tal como está ahora, en JSON (fechas y decimales como texto). */
  private async captureContent(site: Site): Promise<Prisma.InputJsonValue> {
    const order = { position: 'asc' } as const;
    const [company, plans, carousel, social, aboutPhotos, coverageZones] =
      await Promise.all([
        this.prisma.companyProfile.findUnique({ where: { site } }),
        this.prisma.plan.findMany({ where: { site }, orderBy: order }),
        this.prisma.carouselSlide.findMany({ where: { site }, orderBy: order }),
        this.prisma.socialLink.findMany({ where: { site }, orderBy: order }),
        this.prisma.aboutPhoto.findMany({ where: { site }, orderBy: order }),
        this.prisma.coverageZone.findMany({ where: { site }, orderBy: order }),
      ]);
    return JSON.parse(
      JSON.stringify({
        company,
        plans,
        carousel,
        social,
        aboutPhotos,
        coverageZones,
      }),
    ) as Prisma.InputJsonValue;
  }

  async publish(site: Site, userId: string) {
    const hook = this.hookUrl(site);
    if (hook) {
      const response = await fetch(hook, { method: 'POST' }).catch(
        (error: unknown) => {
          this.logger.error(`Deploy Hook de ${site} sin respuesta`, error);
          return null;
        },
      );
      if (!response?.ok) {
        throw new ServiceUnavailableException(
          'Vercel no aceptó la publicación. Intenta de nuevo en unos minutos.',
        );
      }
    } else {
      this.logger.warn(
        `Publicación de ${site} simulada: falta VERCEL_DEPLOY_HOOK_${site}`,
      );
    }
    const now = new Date();
    await this.prisma.sitePublication.upsert({
      where: { site },
      create: {
        site,
        contentUpdatedAt: now,
        publishedAt: now,
        publishedById: userId,
      },
      update: { publishedAt: now, publishedById: userId },
    });
    // Foto de lo publicado: con ella se pueden descartar los próximos cambios.
    await this.prisma.sitePublication.update({
      where: { site },
      data: { snapshot: await this.captureContent(site) },
    });
    return this.status(site);
  }

  private hookUrl(site: Site): string {
    return site === 'HOGAR'
      ? this.config.get('VERCEL_DEPLOY_HOOK_HOGAR', { infer: true })
      : this.config.get('VERCEL_DEPLOY_HOOK_EMPRESAS', { infer: true });
  }
}

/** Foto del contenido guardada al publicar (ver `captureContent`). */
type ContentSnapshot = {
  company: Prisma.CompanyProfileUncheckedCreateInput | null;
  plans: (Prisma.PlanUncheckedCreateInput & { id: string })[];
  carousel: (Prisma.CarouselSlideUncheckedCreateInput & { id: string })[];
  social: (Prisma.SocialLinkUncheckedCreateInput & { id: string })[];
  aboutPhotos: (Prisma.AboutPhotoUncheckedCreateInput & { id: string })[];
  /** Falta en las publicaciones anteriores a las zonas de cobertura. */
  coverageZones?: (Prisma.CoverageZoneUncheckedCreateInput & { id: string })[];
};

type SnapshotItem = { id: string; position?: number } & Record<string, unknown>;

/** Elementos publicados de una colección, en su orden publicado. */
function snapshotList(
  snapshot: ContentSnapshot,
  collection: Exclude<ChangeCollection, 'companyProfile'>,
): SnapshotItem[] {
  const lists = {
    plan: snapshot.plans,
    carouselSlide: snapshot.carousel,
    socialLink: snapshot.social,
    aboutPhoto: snapshot.aboutPhotos,
    coverageZone: snapshot.coverageZones ?? [],
  };
  return lists[collection] as SnapshotItem[];
}

/** Las colecciones comparten forma (id, site, position): acceso común para deshacer. */
type CollectionDelegate = {
  findMany(args: object): Promise<{ id: string; position: number }[]>;
  update(args: object): Promise<unknown>;
  upsert(args: object): Promise<unknown>;
  deleteMany(args: object): Promise<unknown>;
};
