import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination.js';

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

export class CrearCampanaDto extends PlantillaDto {
  @ApiProperty({
    description: 'Id que devolvió la carga del Excel de clientes',
  })
  @IsUUID()
  archivoId: string;
}

/** Campos del formulario multipart al subir el Excel de clientes. */
export class CargarDestinatariosDto extends PlantillaDto {}

export class PruebaDto extends PlantillaDto {
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

export class ListarCampanasQueryDto extends PaginationQueryDto {}

export class ListarDestinatariosQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ESTADOS_ENVIO })
  @IsOptional()
  @IsIn(ESTADOS_ENVIO)
  status?: EstadoEnvio;
}
