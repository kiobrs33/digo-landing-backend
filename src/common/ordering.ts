import { BadRequestException } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsUUID } from 'class-validator';

export class ReorderDto {
  @ApiProperty({
    type: [String],
    description: 'Todos los ids del sitio, en el orden nuevo',
  })
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids: string[];
}

/** Valida que `ids` sea exactamente el conjunto actual (sin faltantes ni ajenos). */
export function assertSameIds(current: { id: string }[], ids: string[]) {
  const known = new Set(current.map((item) => item.id));
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
    throw new BadRequestException(
      'La lista no coincide con los elementos actuales. Recarga la página e intenta de nuevo.',
    );
  }
}
