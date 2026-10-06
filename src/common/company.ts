import type { PrismaService } from '../prisma/prisma.service.js';
import type { Site } from '../generated/prisma/enums.js';

export type ProviderInfo = {
  name: string;
  legalName: string;
  ruc: string;
  address: string;
  email: string;
  phoneDisplay: string;
};

/** Datos del proveedor para constancias y correos; si el sitio aún no los tiene, usa los de marca. */
export async function getProviderInfo(
  prisma: PrismaService,
  site: Site,
): Promise<ProviderInfo> {
  const profile = await prisma.companyProfile.findUnique({ where: { site } });
  return (
    profile ?? {
      name: 'Digo Telecom',
      legalName: 'DIGO TELECOM S.A.C.',
      ruc: '20610702369',
      address: '',
      email: '',
      phoneDisplay: '',
    }
  );
}
