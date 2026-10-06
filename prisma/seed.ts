// Datos iniciales: primer administrador y datos de empresa de cada sitio (tomados de la
// landing actual). Es idempotente: se puede correr varias veces sin duplicar.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcryptjs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { imageSize } from '../src/common/image-size.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error('Define SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD');

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Administrador',
      role: 'ADMIN',
      passwordHash: await hash(password, 12),
    },
  });

  // Datos legales según SUNAT (los dos sitios son la misma empresa).
  const legal = { legalName: 'DIGO TELECOM S.A.C.', ruc: '20610702369' };
  const shared = {
    ...legal,
    address: 'Calle Ambrosio Vucetich 130, Parque Industrial, Arequipa',
    email: 'team@digo.net.pe',
    phone: '+5117012341',
    phoneDisplay: '(01) 701-2341',
    mobile: '+51925521741',
    mobileDisplay: '925 521 741',
    whatsapp: '5117012341',
    whatsappDisplay: '(01) 701-2341',
    advisorName: 'Yudi C.',
  };
  const profiles = [
    {
      site: 'HOGAR',
      name: 'Digo Telecom',
      shortName: 'Digo',
      tagline: '¡Siempre contigo!',
      website: 'digo.net.pe',
    },
    {
      site: 'EMPRESAS',
      name: 'Digo Empresas',
      shortName: 'Digo Empresas',
      tagline: 'Conectividad dedicada para tu empresa',
      website: 'digo.net.pe',
    },
  ] as const;
  for (const profile of profiles) {
    await prisma.companyProfile.upsert({
      where: { site: profile.site },
      // Lo legal se corrige siempre; el resto se respeta si ya se editó en el panel.
      update: legal,
      create: { ...shared, ...profile },
    });
  }

  await seedHogarContent();
  console.log(`Seed listo. Administrador: ${email}`);
}

/**
 * Contenido actual de la landing de HOGAR (planes del volante de septiembre de 2026, cartel del
 * hero, redes y fotos de Nosotros). Solo se carga si el sitio aún no tiene planes. Las imágenes
 * se copian desde el repo de la landing a uploads/ (modo local, sin Cloudinary).
 */
async function seedHogarContent() {
  if ((await prisma.plan.count({ where: { site: 'HOGAR' } })) > 0) return;

  await prisma.plan.createMany({
    data: [
      {
        site: 'HOGAR',
        position: 0,
        name: '500 Mbps',
        downloadMbps: 500,
        uploadMbps: 500,
        price: 59,
        features: ['Ideal si solo necesitas internet en casa'],
      },
      {
        site: 'HOGAR',
        position: 1,
        name: '800 Mbps',
        downloadMbps: 800,
        uploadMbps: 800,
        price: 69,
        tvPackage: 'TV Digital Full',
        features: [
          'Más de 130 canales HD',
          'Canales nacionales, noticias, deportes y entretenimiento',
        ],
      },
      {
        site: 'HOGAR',
        position: 2,
        name: '1000 Mbps',
        downloadMbps: 1000,
        uploadMbps: 1000,
        price: 89,
        promoPrice: 44.5,
        promoMonths: 3,
        highlighted: true,
        badge: 'Recomendado',
        tvPackage: 'TV Digital Premium',
        features: [
          'Más de 130 canales HD',
          'Cine y series premium, deportes internacionales y documentales',
        ],
      },
    ],
  });

  for (const site of ['HOGAR', 'EMPRESAS'] as const) {
    await prisma.socialLink.createMany({
      data: [
        {
          site,
          position: 0,
          network: 'FACEBOOK',
          label: 'Facebook',
          url: 'https://www.facebook.com/people/Digo-Telecom/61593841747060/',
        },
        {
          site,
          position: 1,
          network: 'TIKTOK',
          label: 'TikTok',
          url: 'https://www.tiktok.com/@digoarequipa',
        },
      ],
    });
  }

  const landingPublic = path.resolve(
    process.env.SEED_LANDING_PUBLIC ?? '../digo-landing/public',
  );
  if (!existsSync(landingPublic)) {
    console.warn(`Sin imágenes de ejemplo: no existe ${landingPublic}`);
    return;
  }

  const logo = await localImage(
    landingPublic,
    'brand/digo-logo-256.png',
    'Logo de Digo Telecom',
  );
  await prisma.companyProfile.updateMany({ data: { logoId: logo.id } });

  const slides = [
    {
      file: 'promociones/digo-yape-servicios.jpg',
      alt: 'Paga tu recibo Digo en Yape en 5 pasos: entra a Yape, busca DIGO, ingresa tu DNI o RUC, selecciona tu recibo y listo. No es necesario enviar comprobante.',
      title: 'Paga tu recibo en Yape',
      subtitle:
        'Busca “DIGO” en Yape Servicios. Se registra solo: no envíes comprobante.',
      ctaKind: 'LINK',
      ctaLabel: 'Ver cómo',
      ctaValue: '/medios-de-pago',
    },
    {
      file: 'promociones/digo-promo-1.jpg',
      alt: 'Nuevo plan de 1000 megas por S/ 44.50 con streaming incluido',
      title: '1000 Mbps a S/ 44.50/mes',
      subtitle:
        'Los 3 primeros meses, con TV Digital Premium. Luego S/ 89.00/mes.',
      ctaKind: 'WHATSAPP',
      ctaLabel: 'Lo quiero',
      ctaValue: '1000 Mbps (promoción S/ 44.50)',
    },
    {
      file: 'promociones/digo-promo-5.jpg',
      alt: 'Zonas de cobertura, parte 2: ahora estamos más cerca de ti. Contáctanos al (01) 701-2341',
      title: 'Ahora estamos más cerca de ti',
      subtitle:
        'Fibra activa en Socabaya y el Centro de Arequipa. Busca tu dirección.',
      ctaKind: 'LINK',
      ctaLabel: 'Ver cobertura',
      ctaValue: '/cobertura',
    },
  ] as const;
  for (const [position, { file, alt, ...slide }] of slides.entries()) {
    const image = await localImage(landingPublic, file, alt);
    await prisma.carouselSlide.create({
      data: { ...slide, site: 'HOGAR', position, imageId: image.id },
    });
  }

  const photos = [
    {
      file: 'nosotros/tendido-poste.webp',
      category: 'PROYECTOS',
      caption: 'Ampliamos la red de fibra óptica en las calles de Arequipa.',
      alt: 'Técnico de Digo sobre una escalera trabajando en la caja de fibra de un poste; abajo, otro técnico junto a la camioneta de Digo',
    },
    {
      file: 'nosotros/fusion-fibra.webp',
      category: 'PROYECTOS',
      caption:
        'Fusión de fibra óptica: así llevamos la conexión hasta más hogares.',
      alt: 'Dos técnicos con casco y chaleco naranja fusionan fibra óptica con una empalmadora',
    },
    {
      file: 'nosotros/stand-arequipa.webp',
      category: 'ACTIVIDADES',
      caption:
        'Nuestro stand en Arequipa: atención personalizada, cara a cara.',
      alt: 'Stand de Digo Telecom con banderas y banners, un asesor atiende a dos vecinos',
    },
  ] as const;
  for (const [position, { file, alt, ...photo }] of photos.entries()) {
    const image = await localImage(landingPublic, file, alt);
    await prisma.aboutPhoto.create({
      data: { ...photo, site: 'HOGAR', position, imageId: image.id },
    });
  }
}

/** Copia una imagen de la landing a uploads/ y la registra como MediaAsset local. */
async function localImage(root: string, file: string, alt: string) {
  const ext = path.extname(file).slice(1).replace('jpeg', 'jpg');
  const name = `seed-${path.basename(file)}`;
  const uploads = path.resolve('uploads');
  await mkdir(uploads, { recursive: true });
  await copyFile(path.join(root, file), path.join(uploads, name));
  const { width, height } = imageSize(
    await readFile(path.join(root, file)),
    ext,
  );
  const publicUrl = (process.env.PUBLIC_URL ?? 'http://localhost:4110').replace(
    /\/$/,
    '',
  );
  return prisma.mediaAsset.upsert({
    where: { publicId: `local/${name}` },
    update: {},
    create: {
      provider: 'LOCAL',
      publicId: `local/${name}`,
      url: `${publicUrl}/uploads/${name}`,
      width,
      height,
      format: ext,
      alt,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
