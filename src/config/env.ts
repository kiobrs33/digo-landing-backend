/** Variables de entorno validadas al arrancar: si falta una obligatoria, el servidor no inicia. */
export type Env = {
  PORT: number;
  NODE_ENV: string;
  CORS_ORIGINS: string[];
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER: string;
  SMTP_PASS: string;
  MAIL_FROM: string;
  MAIL_TEAM: string;
  /** URL pública de esta API (para las imágenes locales de desarrollo). */
  PUBLIC_URL: string;
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
  CLOUDINARY_FOLDER: string;
  VERCEL_DEPLOY_HOOK_HOGAR: string;
  VERCEL_DEPLOY_HOOK_EMPRESAS: string;
  /** API de Mikrowisp (consulta de clientes en la conciliación de pagos). */
  MIKROWISP_URL: string;
  MIKROWISP_TOKEN: string;
  /** WhatsApp Cloud API (Meta) de Digo: envíos masivos. */
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_BUSINESS_ID: string;
  WHATSAPP_TOKEN: string;
};

const required = [
  'DATABASE_URL',
  'JWT_SECRET',
  'SMTP_HOST',
  'MAIL_FROM',
] as const;

export function validateEnv(raw: Record<string, unknown>): Env {
  const missing = required.filter((key) => !raw[key]);
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }
  const str = (key: string, fallback = '') => {
    const value = raw[key];
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : fallback;
  };

  if (str('NODE_ENV') === 'production' && str('JWT_SECRET').length < 32) {
    throw new Error(
      'JWT_SECRET debe tener al menos 32 caracteres en producción',
    );
  }

  return {
    PORT: Number(str('PORT', '3000')),
    NODE_ENV: str('NODE_ENV', 'development'),
    CORS_ORIGINS: str('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    DATABASE_URL: str('DATABASE_URL'),
    JWT_SECRET: str('JWT_SECRET'),
    JWT_EXPIRES_IN: str('JWT_EXPIRES_IN', '8h'),
    SMTP_HOST: str('SMTP_HOST'),
    SMTP_PORT: Number(str('SMTP_PORT', '587')),
    SMTP_SECURE: str('SMTP_SECURE') === 'true',
    SMTP_USER: str('SMTP_USER'),
    SMTP_PASS: str('SMTP_PASS'),
    MAIL_FROM: str('MAIL_FROM'),
    MAIL_TEAM: str('MAIL_TEAM'),
    PUBLIC_URL: str(
      'PUBLIC_URL',
      `http://localhost:${str('PORT', '3000')}`,
    ).replace(/\/$/, ''),
    CLOUDINARY_CLOUD_NAME: str('CLOUDINARY_CLOUD_NAME'),
    CLOUDINARY_API_KEY: str('CLOUDINARY_API_KEY'),
    CLOUDINARY_API_SECRET: str('CLOUDINARY_API_SECRET'),
    CLOUDINARY_FOLDER: str('CLOUDINARY_FOLDER', 'digo'),
    VERCEL_DEPLOY_HOOK_HOGAR: str('VERCEL_DEPLOY_HOOK_HOGAR'),
    VERCEL_DEPLOY_HOOK_EMPRESAS: str('VERCEL_DEPLOY_HOOK_EMPRESAS'),
    MIKROWISP_URL: str('MIKROWISP_URL', 'https://app.digo.net.pe').replace(
      /\/$/,
      '',
    ),
    MIKROWISP_TOKEN: str('MIKROWISP_TOKEN'),
    WHATSAPP_PHONE_NUMBER_ID: str('WHATSAPP_PHONE_NUMBER_ID'),
    WHATSAPP_BUSINESS_ID: str('WHATSAPP_BUSINESS_ID'),
    WHATSAPP_TOKEN: str('WHATSAPP_TOKEN'),
  };
}
