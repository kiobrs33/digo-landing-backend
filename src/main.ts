import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { UPLOADS_DIR } from './media/media.service.js';
import { SESSION_COOKIE } from './auth/auth-user.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Detrás del proxy de Easypanel: la IP real del visitante (para el límite de peticiones).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(cookieParser());
  // Imágenes del modo local (sin Cloudinary). En producción la carpeta queda vacía.
  app.useStaticAssets(UPLOADS_DIR, {
    prefix: '/uploads/',
    maxAge: '30d',
    immutable: true,
    setHeaders: (res) =>
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  });
  app.setGlobalPrefix('api');
  // Landings (formularios públicos) y panel admin. `credentials` deja pasar la cookie de sesión
  // del panel; con SameSite=Strict solo viaja entre subdominios de digo.net.pe.
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Digo Landing API')
        .setDescription(
          'Contenido, consultas y Libro de Reclamaciones de DIGO HOGAR y DIGO EMPRESAS',
        )
        .setVersion('1.0')
        .addCookieAuth(SESSION_COOKIE)
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs/openapi.json',
    });
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  console.log(`API en http://localhost:${port}/api`);
}
await bootstrap();
