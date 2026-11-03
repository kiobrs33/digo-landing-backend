import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Campos del formulario multipart (llegan como texto). */
export class DeudasUsuariosDto {
  @ApiPropertyOptional({
    description: 'Días entre la emisión y el vencimiento en el BCP',
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  diasVencimiento?: number;

  @ApiPropertyOptional({
    description:
      'Día de pago del ciclo a cargar. Sin él, solo se analizan los ciclos del Excel.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  ciclo?: number;

  @ApiPropertyOptional({
    description: 'Cargar también a los clientes sin deuda',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  incluirSinDeuda?: boolean;

  @ApiPropertyOptional({
    enum: ['REEMPLAZO', 'ACTUALIZACION'],
    description:
      'Reemplazo: borra lo cargado (primer ciclo del mes). Actualización: agrega.',
    default: 'REEMPLAZO',
  })
  @IsOptional()
  @IsIn(['REEMPLAZO', 'ACTUALIZACION'])
  tipoCarga?: 'REEMPLAZO' | 'ACTUALIZACION';

  @ApiPropertyOptional({
    description: 'Mes de las deudas (YYYY-MM). Sin él, el mes actual en Lima.',
    example: '2026-11',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'El mes debe tener el formato YYYY-MM.',
  })
  mes?: string;
}
