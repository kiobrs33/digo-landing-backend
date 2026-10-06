import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { assertSiteAccess, Auth, CurrentUser } from '../auth/guards.js';
import { CobranzaService } from './cobranza.service.js';
import { DeudasUsuariosDto } from './dto/cobranza.dto.js';

const MAX_BYTES = 10 * 1024 * 1024;

function excelSubido(file: Express.Multer.File | undefined) {
  if (!file)
    throw new BadRequestException('Sube el Excel exportado de Mikrowisp.');
  if (!/\.xlsx$/i.test(file.originalname)) {
    throw new BadRequestException('El archivo debe ser un Excel .xlsx.');
  }
  return file.buffer;
}

/** Herramientas de cobranza de Digo Hogar (Mikrowisp y Telecrédito del BCP). Solo ADMIN. */
@ApiTags('Admin · Cobranza')
@Auth('ADMIN')
@Controller('admin/cobranza')
export class CobranzaController {
  constructor(private readonly cobranza: CobranzaService) {}

  @Post('deudas/usuarios')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Carga de deudas por cliente para Telecrédito (desde "Lista de Usuarios")',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }),
  )
  deudasUsuarios(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: DeudasUsuariosDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertSiteAccess(user, 'HOGAR');
    return this.cobranza.deudasPorUsuarios(
      excelSubido(file),
      {
        diasVencimiento: body.diasVencimiento ?? 10,
        ciclo: body.ciclo,
        incluirSinDeuda: body.incluirSinDeuda ?? false,
        tipoCarga: body.tipoCarga ?? 'REEMPLAZO',
      },
      user,
    );
  }

  @Post('pagos-bcp')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Concilia el reporte de cobros de Telecrédito (.txt) con los clientes de Mikrowisp',
  })
  @UseInterceptors(
    FilesInterceptor('files', 20, { limits: { fileSize: MAX_BYTES } }),
  )
  pagosBcp(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    assertSiteAccess(user, 'HOGAR');
    for (const file of files ?? []) {
      if (!/\.txt$/i.test(file.originalname)) {
        throw new BadRequestException(
          'Los reportes del BCP deben ser archivos .txt.',
        );
      }
    }
    return this.cobranza.conciliarPagos(files ?? [], user);
  }

  @Get('descargas/:id')
  @ApiOperation({
    summary: 'Descarga el Excel generado al procesar un archivo',
  })
  descargar(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const { nombre, archivo, tipo } = this.cobranza.descarga(id, user);
    return new StreamableFile(archivo, {
      type: tipo,
      disposition: `attachment; filename="${nombre}"`,
    });
  }
}
