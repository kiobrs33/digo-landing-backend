import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination.js';
import { CANALES, type Canal } from '../cuentas.js';

/** Estado del envío a cada destinatario. */
export const ESTADOS_ENVIO = [
  'PENDIENTE',
  'ENVIADO',
  'ERROR',
  'OMITIDO',
] as const;
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number];

export class PlantillaDto {
  @ApiProperty()
  @IsString()
  @Length(1, 512)
  plantilla: string;

  @ApiProperty({ example: 'es' })
  @IsString()
  @Length(2, 15)
  idioma: string;
}

/** Por dónde sale el mensaje; sin indicar, directo a Meta. */
class ConCanalDto extends PlantillaDto {
  @ApiPropertyOptional({ enum: CANALES, default: 'WHATSAPP' })
  @IsOptional()
  @IsIn(CANALES)
  canal?: Canal;
}

export class CrearCampanaDto extends ConCanalDto {
  @ApiProperty({
    description: 'Id que devolvió la carga del Excel de clientes',
  })
  @IsUUID()
  archivoId: string;
}

/** Campos del formulario multipart al subir el Excel de clientes. */
export class CargarDestinatariosDto extends PlantillaDto {}

export class PruebaDto extends ConCanalDto {
  @ApiProperty({ example: '975303771' })
  @IsString()
  @Length(9, 20)
  telefono: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  variables: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  encabezado?: string;
}

export class ListarCampanasQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Busca por plantilla, nombre del Excel o quién lo envió',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  buscar?: string;

  @ApiPropertyOptional({ description: 'Enviadas desde (AAAA-MM-DD)' })
  @IsOptional()
  @IsDateString()
  desde?: string;

  @ApiPropertyOptional({
    description: 'Enviadas hasta, inclusive (AAAA-MM-DD)',
  })
  @IsOptional()
  @IsDateString()
  hasta?: string;
}

export class ListarDestinatariosQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ESTADOS_ENVIO })
  @IsOptional()
  @IsIn(ESTADOS_ENVIO)
  status?: EstadoEnvio;
}
