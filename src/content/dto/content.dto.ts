import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  AboutCategory,
  SlideCtaKind,
  SocialNetwork,
} from '../../generated/prisma/enums.js';
import { MAX_RINGS, ZONE_COLORS } from '../coverage-zones.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** Cadena vacía → null (campo opcional que se borra). */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

// ─── Empresa ───

export class CompanyProfileDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) name: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 40) shortName: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) tagline: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 120) legalName: string;

  @ApiProperty({ example: '20610702369' })
  @Transform(trim)
  @Matches(/^(10|15|17|20)\d{9}$/, { message: 'RUC inválido' })
  ruc: string;

  @ApiProperty() @Transform(trim) @IsString() @Length(5, 200) address: string;
  @ApiProperty()
  @Transform(trim)
  @IsEmail({}, { message: 'Correo inválido' })
  email: string;

  @ApiProperty({
    example: '+5117012341',
    description: 'Formato internacional, para enlaces tel:',
  })
  @Transform(trim)
  @Matches(/^\+51\d{8,9}$/, {
    message: 'Teléfono: usa formato +51 seguido del número',
  })
  phone: string;

  @ApiProperty({ example: '(01) 701-2341' })
  @Transform(trim)
  @IsString()
  @Length(6, 30)
  phoneDisplay: string;

  @ApiPropertyOptional({ example: '+51925521741', nullable: true })
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(/^\+51\d{9}$/, {
    message: 'Celular: usa formato +51 seguido de 9 dígitos',
  })
  mobile?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  mobileDisplay?: string | null;

  @ApiProperty({
    example: '5117012341',
    description: 'Número de WhatsApp sin "+" (para wa.me)',
  })
  @Transform(trim)
  @Matches(/^51\d{8,9}$/, {
    message: 'WhatsApp: código 51 seguido del número, sin + ni espacios',
  })
  whatsapp: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(6, 30)
  whatsappDisplay: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  advisorName?: string | null;

  @ApiProperty({ example: 'digo.net.pe' })
  @Transform(trim)
  @Matches(/^[a-z0-9.-]+\.[a-z]{2,}$/i, {
    message: 'Dominio inválido (sin https://)',
  })
  website: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  logoId?: string | null;
}

// ─── Planes ───

export class PlanDto {
  @ApiProperty({ example: '1000 Mbps' })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name: string;
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  downloadMbps: number;
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  uploadMbps: number;

  @ApiProperty({ example: 89 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  price: number;

  @ApiPropertyOptional({ example: 44.5, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  promoPrice?: number | null;

  @ApiPropertyOptional({ example: 3, nullable: true })
  @ValidateIf(
    (dto: PlanDto) => dto.promoPrice !== null && dto.promoPrice !== undefined,
  )
  @Type(() => Number)
  @IsInt({ message: 'Indica por cuántos meses rige la promoción' })
  @Min(1)
  @Max(36)
  promoMonths?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  badge?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  tvPackage?: string | null;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(12)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((item) => String(item).trim()).filter(Boolean)
      : value,
  )
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  features: string[];

  @ApiProperty() @IsBoolean() highlighted: boolean;
  @ApiProperty() @IsBoolean() active: boolean;
}

// ─── Carrusel ───

export class CarouselSlideDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) title: string;

  @ApiPropertyOptional({ nullable: true, description: 'Texto bajo el título' })
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string | null;

  @ApiProperty() @IsUUID() imageId: string;
  @ApiProperty({ enum: SlideCtaKind })
  @IsEnum(SlideCtaKind)
  ctaKind: SlideCtaKind;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((dto: CarouselSlideDto) => dto.ctaKind !== 'NONE')
  @Transform(trim)
  @IsString()
  @Length(2, 30)
  ctaLabel?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'LINK: ruta interna (/cobertura) o URL https. WHATSAPP: plan o motivo de la consulta.',
  })
  @ValidateIf((dto: CarouselSlideDto) => dto.ctaKind !== 'NONE')
  @Transform(trim)
  @IsString()
  @Length(1, 300)
  ctaValue?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  startsAt?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  endsAt?: string | null;
  @ApiProperty() @IsBoolean() active: boolean;
}

// ─── Redes sociales ───

export class SocialLinkDto {
  @ApiProperty({ enum: SocialNetwork })
  @IsEnum(SocialNetwork)
  network: SocialNetwork;
  @ApiProperty({ example: 'Facebook' })
  @Transform(trim)
  @IsString()
  @Length(2, 40)
  label: string;

  @ApiProperty({ example: 'https://www.facebook.com/digotelecom' })
  @Transform(trim)
  @Matches(/^https:\/\/[^\s]+$/, {
    message: 'El enlace debe empezar con https://',
  })
  @MaxLength(300)
  url: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Ícono propio; null usa el de la red',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  iconId?: string | null;

  @ApiProperty() @IsBoolean() active: boolean;
}

// ─── Fotos de Nosotros ───

export class AboutPhotoDto {
  @ApiProperty() @IsUUID() imageId: string;
  @ApiProperty({ enum: AboutCategory })
  @IsEnum(AboutCategory)
  category: AboutCategory;
  @ApiPropertyOptional({ nullable: true })
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  caption?: string | null;
  @ApiProperty() @IsBoolean() active: boolean;
}

// ─── Zonas de cobertura ───

export class CoverageZoneDto {
  @ApiProperty({ example: 'Cerro Colorado' })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Nota corta al elegir la zona, p. ej. "Distrito completo"',
  })
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  detail?: string | null;

  @ApiProperty({ enum: ZONE_COLORS })
  @IsIn(ZONE_COLORS, { message: 'Elige un color de la paleta' })
  color: string;

  @ApiProperty({
    description: 'Contorno: lista de anillos, cada uno con puntos [lat, lng]',
    example: [
      [
        [-16.46, -71.53],
        [-16.47, -71.52],
        [-16.48, -71.54],
      ],
    ],
  })
  @IsArray()
  @ArrayMaxSize(MAX_RINGS)
  rings: unknown[];

  @ApiPropertyOptional({ nullable: true, example: 'relation/1887817' })
  @Transform(emptyToNull)
  @IsOptional()
  @Matches(/^(relation|way)\/\d{1,15}$/, {
    message: 'Referencia de OpenStreetMap inválida',
  })
  osmRef?: string | null;

  @ApiProperty() @IsBoolean() active: boolean;
}

export class BoundarySearchDto {
  @ApiProperty({ example: 'Cerro Colorado, Arequipa' })
  @Transform(trim)
  @IsString()
  @Length(3, 100)
  q: string;
}
