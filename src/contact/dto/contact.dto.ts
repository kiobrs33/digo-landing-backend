import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { HoneypotDto } from '../../common/honeypot.js';
import { PaginationQueryDto } from '../../common/pagination.js';
import { InquiryStatus, Site } from '../../generated/prisma/enums.js';

/** Orden del listado: `campo:dirección`. */
export const inquirySorts = [
  'status:asc',
  'createdAt:desc',
  'createdAt:asc',
  'name:asc',
  'name:desc',
  'attendedAt:desc',
] as const;
export type InquirySort = (typeof inquirySorts)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class CreateInquiryDto extends HoneypotDto {
  @ApiProperty({ enum: Site })
  @IsEnum(Site)
  site: Site;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({ example: '925521741' })
  @Transform(trim)
  @Matches(/^\+?[0-9\s-]{6,20}$/, { message: 'Teléfono inválido' })
  phone: string;

  @ApiPropertyOptional()
  @Transform(trim)
  @IsOptional()
  @IsEmail({}, { message: 'Correo electrónico inválido' })
  email?: string;

  @ApiPropertyOptional({
    description: 'Razón social (obligatoria en EMPRESAS)',
  })
  @Transform(trim)
  @ValidateIf((dto: CreateInquiryDto) => dto.site === Site.EMPRESAS)
  @IsString()
  @Length(2, 160)
  company?: string;

  @ApiPropertyOptional({ description: 'RUC (obligatorio en EMPRESAS)' })
  @Transform(trim)
  @ValidateIf((dto: CreateInquiryDto) => dto.site === Site.EMPRESAS)
  @Matches(/^(10|15|17|20)\d{9}$/, { message: 'RUC inválido' })
  ruc?: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(5, 2000)
  message: string;

  @ApiProperty({
    description: 'Aceptación del tratamiento de datos personales (Ley 29733)',
  })
  @Equals(true, { message: 'Debes aceptar el tratamiento de tus datos' })
  acceptsPrivacy: boolean;
}

export class ListInquiriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Site })
  @IsOptional()
  @IsEnum(Site)
  site?: Site;

  @ApiPropertyOptional({ enum: InquiryStatus })
  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;

  @ApiPropertyOptional({
    description: 'Busca por nombre, teléfono, correo, empresa, RUC o mensaje',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description:
      '`me` (asignadas a mí), `none` (sin asignar) o el id de un usuario',
  })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== 'me' && value !== 'none')
  @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional({
    description: 'Recibidas desde esta fecha (AAAA-MM-DD)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Recibidas hasta esta fecha, inclusive (AAAA-MM-DD)',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: inquirySorts, default: 'status:asc' })
  @IsOptional()
  @IsIn(inquirySorts)
  sort?: InquirySort;
}

export class BulkUpdateInquiriesDto {
  @ApiProperty({
    type: [String],
    description: 'Consultas a cambiar (máx. 100)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];

  @ApiPropertyOptional({ enum: InquiryStatus })
  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;

  @ApiPropertyOptional({
    description: 'Responsable; null para quitarlo',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID()
  assignedToId?: string | null;
}

export class UpdateInquiryDto {
  @ApiPropertyOptional({ enum: InquiryStatus })
  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;

  @ApiPropertyOptional({ description: 'Notas internas' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Usuario responsable; null para quitarlo',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID()
  assignedToId?: string | null;
}
