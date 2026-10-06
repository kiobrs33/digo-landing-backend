import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '../auth/guards.js';
import { ParseSitePipe, type Site } from '../common/site.js';
import {
  RegisterCloudinaryDto,
  SignUploadDto,
  UpdateMediaDto,
} from './dto/media.dto.js';
import { MAX_UPLOAD_BYTES, MediaService } from './media.service.js';

@ApiTags('Admin · Imágenes')
@Auth('ADMIN')
@Controller('admin/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get('config')
  @ApiOperation({ summary: 'Modo de subida: Cloudinary o local (desarrollo)' })
  config() {
    return this.media.uploadConfig();
  }

  @Post('sign')
  @ApiOperation({ summary: 'Firma una subida directa a Cloudinary' })
  sign(@Body() body: SignUploadDto) {
    return this.media.sign(body.site);
  }

  @Post()
  @ApiOperation({ summary: 'Registra una imagen ya subida a Cloudinary' })
  register(@Body() body: RegisterCloudinaryDto) {
    return this.media.registerCloudinary(body);
  }

  @Post('local/:site')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Solo desarrollo: sube la imagen al backend' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  uploadLocal(
    @Param('site', ParseSitePipe) site: Site,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('alt') alt?: string,
  ) {
    return this.media.uploadLocal(file, site, alt);
  }

  @Patch(':id')
  updateAlt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMediaDto,
  ) {
    return this.media.updateAlt(id, body.alt);
  }
}
