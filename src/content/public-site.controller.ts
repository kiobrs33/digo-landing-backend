import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ParseSitePipe, type Site } from '../common/site.js';
import { PrismaService } from '../prisma/prisma.service.js';

const image = {
  select: { url: true, width: true, height: true, alt: true },
} as const;

/**
 * Todo el contenido público de un sitio en una sola respuesta. Lo consume el build de la landing
 * (y, si se quiere, la propia landing en el navegador). Solo incluye lo activo.
 */
@ApiTags('Público · Contenido')
@Controller('public/sites')
export class PublicSiteController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':site')
  @ApiParam({ name: 'site', enum: ['hogar', 'empresas'] })
  @ApiOperation({
    summary:
      'Contenido activo del sitio: empresa, planes, carrusel, redes, fotos y zonas de cobertura',
  })
  async get(@Param('site', ParseSitePipe) site: Site) {
    const now = new Date();
    const [company, plans, carousel, social, aboutPhotos, coverageZones] =
      await Promise.all([
        this.prisma.companyProfile.findUnique({
          where: { site },
          omit: { site: true, logoId: true, updatedAt: true },
          include: { logo: image },
        }),
        this.prisma.plan.findMany({
          where: { site, active: true },
          orderBy: { position: 'asc' },
          omit: {
            site: true,
            active: true,
            position: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        // Los que aún no vencen. Los programados a futuro van con su fecha: la landing los
        // muestra recién cuando corresponde.
        this.prisma.carouselSlide.findMany({
          where: {
            site,
            active: true,
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
          orderBy: { position: 'asc' },
          omit: {
            site: true,
            imageId: true,
            active: true,
            position: true,
            createdAt: true,
            updatedAt: true,
          },
          include: { image },
        }),
        this.prisma.socialLink.findMany({
          where: { site, active: true },
          orderBy: { position: 'asc' },
          omit: {
            site: true,
            iconId: true,
            active: true,
            position: true,
            createdAt: true,
            updatedAt: true,
          },
          include: { icon: image },
        }),
        this.prisma.aboutPhoto.findMany({
          where: { site, active: true },
          orderBy: { position: 'asc' },
          omit: {
            site: true,
            imageId: true,
            active: true,
            position: true,
            createdAt: true,
            updatedAt: true,
          },
          include: { image },
        }),
        this.prisma.coverageZone.findMany({
          where: { site, active: true },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            name: true,
            detail: true,
            color: true,
            rings: true,
          },
        }),
      ]);
    if (!company) throw new NotFoundException('Sitio sin datos de empresa');

    return {
      site,
      generatedAt: now,
      company,
      plans: plans.map((plan) => ({
        ...plan,
        price: Number(plan.price),
        promoPrice: plan.promoPrice === null ? null : Number(plan.promoPrice),
      })),
      carousel,
      social,
      aboutPhotos,
      coverageZones,
    };
  }
}
