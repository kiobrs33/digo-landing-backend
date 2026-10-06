import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Auth } from '../auth/guards.js';
import { ReorderDto } from '../common/ordering.js';
import { ParseSitePipe, type Site } from '../common/site.js';
import { ContentService } from './content.service.js';
import { searchBoundaries } from './coverage-zones.js';
import {
  AboutPhotoDto,
  BoundarySearchDto,
  CarouselSlideDto,
  CompanyProfileDto,
  CoverageZoneDto,
  PlanDto,
  SocialLinkDto,
} from './dto/content.dto.js';

// Todas las rutas: /api/admin/sites/{hogar|empresas}/...  (solo ADMIN)

@ApiTags('Admin · Empresa')
@Auth('ADMIN')
@ApiParam({ name: 'site', enum: ['hogar', 'empresas'] })
@Controller('admin/sites/:site/company')
export class CompanyController {
  constructor(private readonly content: ContentService) {}

  @Get()
  get(@Param('site', ParseSitePipe) site: Site) {
    return this.content.getCompany(site);
  }

  @Put()
  update(
    @Param('site', ParseSitePipe) site: Site,
    @Body() body: CompanyProfileDto,
  ) {
    return this.content.updateCompany(site, body);
  }
}

@ApiTags('Admin · Planes')
@Auth('ADMIN')
@ApiParam({ name: 'site', enum: ['hogar', 'empresas'] })
@Controller('admin/sites/:site/plans')
export class PlansController {
  constructor(private readonly content: ContentService) {}

  @Get()
  list(@Param('site', ParseSitePipe) site: Site) {
    return this.content.listPlans(site);
  }

  @Post()
  create(@Param('site', ParseSitePipe) site: Site, @Body() body: PlanDto) {
    return this.content.createPlan(site, body);
  }

  @Put('order')
  @HttpCode(204)
  reorder(@Param('site', ParseSitePipe) site: Site, @Body() body: ReorderDto) {
    return this.content.reorder('plan', site, body.ids);
  }

  @Put(':id')
  update(
    @Param('site', ParseSitePipe) site: Site,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PlanDto,
  ) {
    return this.content.updatePlan(site, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('site', ParseSitePipe) site: Site,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.content.remove('plan', site, id);
  }
}

@ApiTags('Admin · Carrusel')
@Auth('ADMIN')
@ApiParam({ name: 'site', enum: ['hogar', 'empresas'] })
@Controller('admin/sites/:site/carousel')
export class CarouselController {
  constructor(private readonly content: ContentService) {}

  @Get()
  list(@Param('site', ParseSitePipe) site: Site) {
    return this.content.listSlides(site);
  }

  @Post()
  create(
    @Param('site', ParseSitePipe) site: Site,
    @Body() body: CarouselSlideDto,
  ) {
    return this.content.createSlide(site, body);
  }

  @Put('order')
  @HttpCode(204)
  reorder(@Param('site', ParseSitePipe) site: Site, @Body() body: ReorderDto) {
    return this.content.reorder('carouselSlide', site, body.ids);
  }

  @Put(':id')
  update(
    @Param('site', ParseSitePipe) site: Site,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CarouselSlideDto,
  ) {
    return this.content.updateSlide(site, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('site', ParseSitePipe) site: Site,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.content.remove('carouselSlide', site, id);
  }
}

@ApiTags('Admin · Redes sociales')
@Auth('ADMIN')
@ApiParam({ name: 'site', enum: ['hogar', 'empresas'] })
@Controller('admin/sites/:site/social')
export class SocialController {
  constructor(private readonly content: ContentService) {}

  @Get()
  list(@Param('site', ParseSitePipe) site: Site) {
    return this.content.listSocial(site);
  }

  @Post()
  create(
    @Param('site', ParseSitePipe) site: Site,
    @Body() body: SocialLinkDto,
  ) {
    return this.content.createSocial(site, body);
  }

  @Put('order')
  @HttpCode(204)
  reorder(@Param('site', ParseSitePipe) site: Site, @Body() body: ReorderDto) {
    return this.content.reorder('socialLink', site, body.ids);
  }

  @Put(':id')
  update(
    @Param('site', ParseSitePipe) site: Site,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SocialLinkDto,
  ) {
    return this.content.updateSocial(site, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('site', ParseSitePipe) site: Site,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.content.remove('socialLink', site, id);
  }
}

@ApiTags('Admin · Fotos de Nosotros')
@Auth('ADMIN')
@ApiParam({ name: 'site', enum: ['hogar', 'empresas'] })
@Controller('admin/sites/:site/about-photos')
export class AboutPhotosController {
  constructor(private readonly content: ContentService) {}

  @Get()
  list(@Param('site', ParseSitePipe) site: Site) {
    return this.content.listPhotos(site);
  }

  @Post()
  create(
    @Param('site', ParseSitePipe) site: Site,
    @Body() body: AboutPhotoDto,
  ) {
    return this.content.createPhoto(site, body);
  }

  @Put('order')
  @HttpCode(204)
  reorder(@Param('site', ParseSitePipe) site: Site, @Body() body: ReorderDto) {
    return this.content.reorder('aboutPhoto', site, body.ids);
  }

  @Put(':id')
  update(
    @Param('site', ParseSitePipe) site: Site,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AboutPhotoDto,
  ) {
    return this.content.updatePhoto(site, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('site', ParseSitePipe) site: Site,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.content.remove('aboutPhoto', site, id);
  }
}

@ApiTags('Admin · Zonas de cobertura')
@Auth('ADMIN')
@ApiParam({ name: 'site', enum: ['hogar', 'empresas'] })
@Controller('admin/sites/:site/coverage-zones')
export class CoverageZonesController {
  constructor(private readonly content: ContentService) {}

  @Get()
  list(@Param('site', ParseSitePipe) site: Site) {
    return this.content.listZones(site);
  }

  /** Distritos con contorno en OpenStreetMap, para crear una zona sin dibujarla a mano. */
  @Get('boundaries')
  @ApiOperation({
    summary: 'Busca el contorno de un distrito en OpenStreetMap',
  })
  boundaries(@Query() query: BoundarySearchDto) {
    return searchBoundaries(query.q);
  }

  @Post()
  create(
    @Param('site', ParseSitePipe) site: Site,
    @Body() body: CoverageZoneDto,
  ) {
    return this.content.createZone(site, body);
  }

  @Put('order')
  @HttpCode(204)
  reorder(@Param('site', ParseSitePipe) site: Site, @Body() body: ReorderDto) {
    return this.content.reorder('coverageZone', site, body.ids);
  }

  @Put(':id')
  update(
    @Param('site', ParseSitePipe) site: Site,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CoverageZoneDto,
  ) {
    return this.content.updateZone(site, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('site', ParseSitePipe) site: Site,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.content.remove('coverageZone', site, id);
  }
}
