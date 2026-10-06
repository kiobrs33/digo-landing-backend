import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Site } from '../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SignUploadDto {
  @ApiProperty({ enum: Site })
  @IsEnum(Site)
  site: Site;
}

/** Respuesta de Cloudinary tras la subida directa desde el panel, para registrarla. */
export class RegisterCloudinaryDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  publicId: string;

  @ApiProperty()
  @IsString()
  version: string;

  @ApiProperty({
    description: 'Firma que devuelve Cloudinary: prueba que la subida es real',
  })
  @IsString()
  signature: string;

  @ApiProperty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(20_000)
  width: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(20_000)
  height: number;

  @ApiProperty()
  @IsString()
  @Length(2, 10)
  format: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  alt?: string;
}

export class UpdateMediaDto {
  @ApiProperty({ description: 'Texto alternativo: qué se ve en la imagen' })
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  alt: string;
}
