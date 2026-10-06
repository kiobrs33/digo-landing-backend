import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Env } from '../config/env.js';
import type { Site } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { imageSize } from '../common/image-size.js';
import type { RegisterCloudinaryDto } from './dto/media.dto.js';

export const UPLOADS_DIR = path.resolve('uploads');
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Formatos aceptados. SVG no: puede llevar scripts. */
const IMAGE_TYPES: Record<
  string,
  { ext: string; magic: (b: Buffer) => boolean }
> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': {
    ext: 'png',
    magic: (b) => b.subarray(1, 4).toString() === 'PNG',
  },
  'image/webp': {
    ext: 'webp',
    magic: (b) =>
      b.subarray(0, 4).toString() === 'RIFF' &&
      b.subarray(8, 12).toString() === 'WEBP',
  },
};

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get cloudinary() {
    const cloudName = this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
    const apiKey = this.config.get('CLOUDINARY_API_KEY', { infer: true });
    const apiSecret = this.config.get('CLOUDINARY_API_SECRET', { infer: true });
    return cloudName && apiKey && apiSecret
      ? {
          cloudName,
          apiKey,
          apiSecret,
          folder: this.config.get('CLOUDINARY_FOLDER', { infer: true }),
        }
      : null;
  }

  /** Cómo debe subir el panel: directo a Cloudinary o al backend (modo local). */
  uploadConfig() {
    const cloud = this.cloudinary;
    return cloud
      ? {
          mode: 'cloudinary' as const,
          cloudName: cloud.cloudName,
          maxBytes: MAX_UPLOAD_BYTES,
        }
      : { mode: 'local' as const, maxBytes: MAX_UPLOAD_BYTES };
  }

  /** Firma una subida directa a Cloudinary (el secreto nunca sale del servidor). */
  sign(site: Site) {
    const cloud = this.requireCloudinary();
    const params = {
      folder: `${cloud.folder}/${site.toLowerCase()}`,
      timestamp: Math.round(Date.now() / 1000),
    };
    return {
      ...params,
      apiKey: cloud.apiKey,
      cloudName: cloud.cloudName,
      signature: this.signParams(params, cloud.apiSecret),
    };
  }

  /** Registra una imagen ya subida a Cloudinary, verificando la firma de su respuesta. */
  async registerCloudinary(dto: RegisterCloudinaryDto) {
    const cloud = this.requireCloudinary();
    const expected = this.signParams(
      { public_id: dto.publicId, version: dto.version },
      cloud.apiSecret,
    );
    if (
      expected !== dto.signature ||
      !dto.publicId.startsWith(`${cloud.folder}/`)
    ) {
      throw new BadRequestException(
        'La imagen no proviene de una subida válida',
      );
    }
    return this.prisma.mediaAsset.create({
      data: {
        provider: 'CLOUDINARY',
        publicId: dto.publicId,
        url: dto.url,
        width: dto.width,
        height: dto.height,
        format: dto.format,
        alt: dto.alt ?? '',
      },
    });
  }

  /** Modo local (sin Cloudinary): guarda el archivo en uploads/. Solo para desarrollo. */
  async uploadLocal(
    file: Express.Multer.File | undefined,
    site: Site,
    alt = '',
  ) {
    if (this.cloudinary) {
      throw new BadRequestException(
        'Con Cloudinary configurado, sube la imagen directo a Cloudinary',
      );
    }
    if (!file) throw new BadRequestException('Falta el archivo');
    const type = IMAGE_TYPES[file.mimetype];
    if (!type || !type.magic(file.buffer)) {
      throw new BadRequestException('Formato no admitido: usa JPG, PNG o WebP');
    }
    const { width, height } = imageSize(file.buffer, type.ext);
    const name = `${site.toLowerCase()}-${randomUUID()}.${type.ext}`;
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(path.join(UPLOADS_DIR, name), file.buffer);
    return this.prisma.mediaAsset.create({
      data: {
        provider: 'LOCAL',
        publicId: `local/${name}`,
        url: `${this.config.get('PUBLIC_URL', { infer: true })}/uploads/${name}`,
        width,
        height,
        format: type.ext,
        alt: alt.trim().slice(0, 300),
      },
    });
  }

  async updateAlt(id: string, alt: string) {
    try {
      return await this.prisma.mediaAsset.update({
        where: { id },
        data: { alt },
      });
    } catch {
      throw new NotFoundException('Imagen no encontrada');
    }
  }

  private requireCloudinary() {
    const cloud = this.cloudinary;
    if (!cloud) throw new BadRequestException('Cloudinary no está configurado');
    return cloud;
  }

  /** Firma de Cloudinary: parámetros ordenados `k=v&k=v` + secreto, en SHA-1. */
  private signParams(params: Record<string, string | number>, secret: string) {
    const payload = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    return createHash('sha1')
      .update(payload + secret)
      .digest('hex');
  }
}
