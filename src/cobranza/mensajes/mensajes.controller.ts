import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../auth/auth-user.js';
import { assertSiteAccess, Auth, CurrentUser } from '../../auth/guards.js';
import {
  CargarDestinatariosDto,
  CrearCampanaDto,
  ListarCampanasQueryDto,
  ListarDestinatariosQueryDto,
  PruebaDto,
} from './dto/mensajes.dto.js';
import { MensajesService } from './mensajes.service.js';
import { WhatsappService } from './whatsapp.service.js';

/** Mensajes masivos de WhatsApp de Digo Hogar (plantillas de Meta). Solo ADMIN. */
@ApiTags('Admin · Mensajes masivos')
@Auth('ADMIN')
@Controller('admin/mensajes')
export class MensajesController {
  constructor(
    private readonly mensajes: MensajesService,
    private readonly whatsapp: WhatsappService,
  ) {}

  @Get('plantillas')
  @ApiOperation({ summary: 'Plantillas aprobadas en Meta' })
  plantillas(
    @CurrentUser() user: AuthUser,
    @Query('refrescar') refrescar?: string,
  ) {
    assertSiteAccess(user, 'HOGAR');
    return this.mensajes.plantillas(refrescar === 'true');
  }

  @Get('plantillas/excel')
  @ApiOperation({
    summary: 'Excel para llenar los destinatarios de una plantilla',
  })
  async excelPlantilla(
    @Query('nombre') nombre: string,
    @Query('idioma') idioma: string,
    @CurrentUser() user: AuthUser,
  ) {
    assertSiteAccess(user, 'HOGAR');
    if (!nombre || !idioma) {
      throw new BadRequestException('Indica la plantilla (nombre e idioma).');
    }
    const { archivo, nombre: archivoNombre } =
      await this.mensajes.excelPlantilla(nombre, idioma);
    return new StreamableFile(archivo, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${archivoNombre}"`,
    });
  }

  @Post('destinatarios')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Sube la plantilla Excel de una plantilla de WhatsApp llena con los clientes',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  destinatarios(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: CargarDestinatariosDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertSiteAccess(user, 'HOGAR');
    if (!file || !/\.xlsx$/i.test(file.originalname)) {
      throw new BadRequestException(
        'Sube la plantilla Excel (.xlsx) llena con tus clientes.',
      );
    }
    const nombre = Buffer.from(file.originalname, 'latin1').toString('utf8');
    return this.mensajes.cargarDestinatarios(
      file.buffer,
      nombre,
      body.plantilla,
      body.idioma,
      user,
    );
  }

  @Post('prueba')
  @ApiOperation({ summary: 'Envía la plantilla a un solo número' })
  prueba(@Body() body: PruebaDto, @CurrentUser() user: AuthUser) {
    assertSiteAccess(user, 'HOGAR');
    this.whatsapp.assertConfigured();
    return this.mensajes.prueba(body);
  }

  @Post('campanas')
  @ApiOperation({
    summary: 'Crea la campaña y empieza a enviar en segundo plano',
  })
  crear(@Body() body: CrearCampanaDto, @CurrentUser() user: AuthUser) {
    assertSiteAccess(user, 'HOGAR');
    this.whatsapp.assertConfigured();
    return this.mensajes.crearCampana(body, user);
  }

  @Get('campanas')
  listar(
    @Query() query: ListarCampanasQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertSiteAccess(user, 'HOGAR');
    return this.mensajes.listar(query);
  }

  @Get('campanas/:id')
  @ApiOperation({ summary: 'Avance de la campaña' })
  campana(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    assertSiteAccess(user, 'HOGAR');
    return this.mensajes.resumen(id);
  }

  @Get('campanas/:id/destinatarios')
  destinatariosCampana(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListarDestinatariosQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertSiteAccess(user, 'HOGAR');
    return this.mensajes.destinatarios(id, query);
  }

  @Post('campanas/:id/cancelar')
  cancelar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    assertSiteAccess(user, 'HOGAR');
    return this.mensajes.cancelar(id);
  }

  @Post('campanas/:id/reintentar')
  @ApiOperation({ summary: 'Vuelve a enviar los mensajes que fallaron' })
  reintentar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    assertSiteAccess(user, 'HOGAR');
    this.whatsapp.assertConfigured();
    return this.mensajes.reintentarErrores(id);
  }

  @Get('campanas/:id/excel')
  @ApiOperation({ summary: 'Resultado de cada envío (.xlsx)' })
  async excel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    assertSiteAccess(user, 'HOGAR');
    const { archivo, nombre } = await this.mensajes.excel(id);
    return new StreamableFile(archivo, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${nombre}"`,
    });
  }
}
