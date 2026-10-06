import { ApiHideProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Campo trampa de los formularios públicos: el formulario lo oculta, así que una persona lo
 * deja vacío y un bot suele llenarlo. Si llega con valor, se responde como si todo saliera
 * bien, pero no se guarda nada.
 */
export class HoneypotDto {
  @ApiHideProperty()
  @IsOptional()
  @IsString()
  website?: string;
}

export function isBot(dto: HoneypotDto): boolean {
  return Boolean(dto.website?.trim());
}
