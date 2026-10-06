import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import {
  ComplaintKind,
  ComplaintStatus,
  Site,
} from '../../generated/prisma/enums.js';

/** Orden del listado. `priority`: sin responder primero, y entre ellas la que vence antes. */
export const complaintSorts = [
  'priority',
  'createdAt:desc',
  'createdAt:asc',
  'code:desc',
  'code:asc',
  'name:asc',
  'name:desc',
  'respondedAt:desc',
] as const;
export type ComplaintSort = (typeof complaintSorts)[number];

export class ListComplaintsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Site })
  @IsOptional()
  @IsEnum(Site)
  site?: Site;

  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;

  @ApiPropertyOptional({ description: 'Solo las que aún no tienen respuesta' })
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === true || value === 'true',
  )
  @IsBoolean()
  open?: boolean;

  @ApiPropertyOptional({ enum: ComplaintKind })
  @IsOptional()
  @IsEnum(ComplaintKind)
  kind?: ComplaintKind;

  @ApiPropertyOptional({
    enum: ['vencido', 'pronto'],
    description: 'Sin responder y vencidas, o que vencen en 3 días hábiles',
  })
  @IsOptional()
  @IsIn(['vencido', 'pronto'])
  plazo?: 'vencido' | 'pronto';

  @ApiPropertyOptional({
    description:
      '"me" = asignadas a mí, "none" = sin asignar, o el id de un usuario',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== 'me' && value !== 'none')
  @IsUUID()
  assigned?: string;

  @ApiPropertyOptional({
    description: 'Busca por número, documento, nombre, correo o teléfono',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Registradas desde (AAAA-MM-DD)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Registradas hasta, inclusive (AAAA-MM-DD)',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: complaintSorts, default: 'priority' })
  @IsOptional()
  @IsIn(complaintSorts)
  sort?: ComplaintSort;
}

/** Cambio en lote: responsable y, en hojas sin responder, pasar a pendiente o en proceso. */
export class BulkUpdateComplaintsDto {
  @ApiProperty({ type: [String], description: 'Hojas a cambiar (máx. 100)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];

  @ApiPropertyOptional({
    enum: ['PENDIENTE', 'EN_PROCESO'],
    description: 'Responder no se hace en lote: es el acto legal de cada hoja',
  })
  @IsOptional()
  @IsIn(['PENDIENTE', 'EN_PROCESO'])
  status?: 'PENDIENTE' | 'EN_PROCESO';

  @ApiPropertyOptional({
    description: 'Responsable; null para quitarlo',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsUUID()
  assignedToId?: string | null;
}

export class UpdateComplaintStatusDto {
  @ApiProperty({
    enum: [ComplaintStatus.PENDIENTE, ComplaintStatus.EN_PROCESO],
  })
  @IsIn([ComplaintStatus.PENDIENTE, ComplaintStatus.EN_PROCESO], {
    message: 'Para marcar como respondido usa el endpoint de respuesta',
  })
  status: ComplaintStatus;
}

export class RespondComplaintDto {
  @ApiProperty({
    description: 'Respuesta que recibirá el consumidor por correo',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(10, 5000)
  response: string;
}

export class UpdateComplaintManagementDto {
  @ApiPropertyOptional({
    description: 'Responsable; null para quitarlo',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assignedToId?: string | null;

  @ApiPropertyOptional({
    description: 'Notas internas (el consumidor no las ve)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  internalNotes?: string;
}
