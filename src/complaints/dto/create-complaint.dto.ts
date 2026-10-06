import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { HoneypotDto } from '../../common/honeypot.js';
import {
  ComplaintKind,
  ContractedItem,
  DocumentType,
  Site,
} from '../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Hoja de reclamación enviada desde una landing. */
export class CreateComplaintDto extends HoneypotDto {
  @ApiProperty({ enum: Site })
  @IsEnum(Site)
  site: Site;

  @ApiProperty({ enum: ComplaintKind })
  @IsEnum(ComplaintKind)
  kind: ComplaintKind;

  // ─── Consumidor ───
  @ApiProperty({ enum: DocumentType })
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @ApiProperty({ example: '45678912' })
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9]{6,12}$/, { message: 'Número de documento inválido' })
  documentNumber: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 160)
  fullName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(5, 250)
  address: string;

  @ApiProperty()
  @Transform(trim)
  @IsEmail({}, { message: 'Correo electrónico inválido' })
  email: string;

  @ApiProperty({ example: '925521741' })
  @Transform(trim)
  @Matches(/^\+?[0-9\s-]{6,20}$/, { message: 'Teléfono inválido' })
  phone: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isMinor?: boolean;

  @ApiPropertyOptional({
    description: 'Obligatorio si el consumidor es menor de edad',
  })
  @ValidateIf((dto: CreateComplaintDto) => dto.isMinor === true)
  @Transform(trim)
  @IsString()
  @Length(3, 160)
  guardianName?: string;

  @ApiPropertyOptional({
    description: 'Obligatorio si el consumidor es menor de edad',
  })
  @ValidateIf((dto: CreateComplaintDto) => dto.isMinor === true)
  @Transform(trim)
  @Matches(/^[A-Za-z0-9]{6,12}$/, {
    message: 'Documento del apoderado inválido',
  })
  guardianDocument?: string;

  // ─── Bien contratado ───
  @ApiProperty({ enum: ContractedItem })
  @IsEnum(ContractedItem)
  itemType: ContractedItem;

  @ApiPropertyOptional({ example: 59 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  amount?: number;

  @ApiProperty({ example: 'Plan hogar 500 Mbps' })
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  itemDescription: string;

  // ─── Reclamo ───
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(10, 3000)
  detail: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(5, 2000)
  request: string;

  @ApiProperty({
    description:
      'Declaración de veracidad y aceptación del tratamiento de datos',
  })
  @Equals(true, {
    message: 'Debes aceptar la declaración para registrar la hoja',
  })
  acceptsTerms: boolean;
}
