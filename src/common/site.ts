import { BadRequestException, PipeTransform } from '@nestjs/common';
import { Site } from '../generated/prisma/enums.js';

export { Site };

/** Convierte el parámetro de ruta `hogar` / `empresas` al enum `Site`. */
export class ParseSitePipe implements PipeTransform<string, Site> {
  transform(value: string): Site {
    const site = value?.toUpperCase();
    if (site !== Site.HOGAR && site !== Site.EMPRESAS) {
      throw new BadRequestException('Sitio inválido: usa "hogar" o "empresas"');
    }
    return site;
  }
}

/** `?site=` opcional (`hogar`, `HOGAR`…) como `Site`; cualquier otro valor se ignora. */
export function parseSite(value?: string): Site | undefined {
  const site = value?.toUpperCase();
  return site === Site.HOGAR || site === Site.EMPRESAS ? site : undefined;
}
