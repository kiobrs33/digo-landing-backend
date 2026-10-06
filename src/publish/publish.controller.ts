import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { ApiOperation, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Auth, CurrentUser } from '../auth/guards.js';
import { ParseSitePipe, type Site } from '../common/site.js';
import { PublishService } from './publish.service.js';

class UndoChangeDto {
  @ApiProperty({
    description: 'Cambio de la lista, p. ej. plan:<id> o carouselSlide:all',
  })
  @IsString()
  @MaxLength(80)
  key!: string;
}

@ApiTags('Admin · Publicación')
@Auth('ADMIN')
@ApiParam({ name: 'site', enum: ['hogar', 'empresas'] })
@Controller('admin/sites/:site/publish')
export class PublishController {
  constructor(private readonly publish: PublishService) {}

  @Get()
  @ApiOperation({
    summary: 'Si hay cambios sin publicar y cuándo se publicó por última vez',
  })
  status(@Param('site', ParseSitePipe) site: Site) {
    return this.publish.status(site);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Regenera la landing del sitio con el contenido actual',
  })
  run(@Param('site', ParseSitePipe) site: Site, @CurrentUser() user: AuthUser) {
    return this.publish.publish(site, user.id);
  }

  @Post('discard')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Descarta los cambios sin publicar: vuelve a lo último publicado',
  })
  discard(@Param('site', ParseSitePipe) site: Site) {
    return this.publish.discard(site);
  }

  @Post('undo')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Deshace un solo cambio sin publicar (vuelve a lo publicado)',
  })
  undo(@Param('site', ParseSitePipe) site: Site, @Body() body: UndoChangeDto) {
    return this.publish.undo(site, body.key);
  }
}

@ApiTags('Admin · Publicación')
@Auth('ADMIN')
@Controller('admin/publish')
export class PublishSummaryController {
  constructor(private readonly publish: PublishService) {}

  @Get()
  @ApiOperation({ summary: 'Estado de publicación de los dos sitios' })
  all(@CurrentUser() user: AuthUser) {
    return this.publish.statusAll(user.sites);
  }
}
