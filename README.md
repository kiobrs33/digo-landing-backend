# digo-landing-backend

API de los sitios **DIGO HOGAR** y **DIGO EMPRESAS**: contenido (empresa,
planes, carrusel, redes, fotos), consultas de contacto y Libro de Reclamaciones.

NestJS 12 · PostgreSQL · Prisma 7 · Nodemailer.

## Desarrollo local

Requisitos: Node 24 y Docker.

```bash
cp .env.example .env      # y cambia JWT_SECRET
npm install
npm run db:up             # Postgres (puerto 5433) y Mailpit
npm run db:migrate        # aplica las migraciones
npm run db:seed           # primer administrador y datos de empresa
npm run start:dev
```

| Qué | Dónde |
|---|---|
| API | http://localhost:4110/api |
| Swagger (solo fuera de producción) | http://localhost:4110/api/docs |
| Correos enviados (Mailpit) | http://localhost:8025 |
| Base de datos (Prisma Studio) | `npm run db:studio` |

## Endpoints

- **Públicos** (los usan las landings; con límite de peticiones y campo trampa `website`):
  `POST /api/public/complaints`, `POST /api/public/contact`.
- **Contenido para las landings**: `GET /api/public/sites/{hogar|empresas}` (empresa, planes,
  carrusel, redes y fotos activas). Lo consume el build de cada landing.
- **Panel** (cookie de sesión `digo_session` o `Authorization: Bearer`):
  `/api/auth/*`, `/api/admin/complaints`, `/api/admin/inquiries`; solo ADMIN: `/api/admin/users`,
  `/api/admin/media`, `/api/admin/sites/{sitio}/{company|plans|carousel|social|about-photos|publish}`.

## Contenido e imágenes

- Sin credenciales de Cloudinary, las imágenes se guardan en `uploads/` y se sirven en
  `/uploads/...` (solo desarrollo). Con `CLOUDINARY_*` configurado, el panel sube directo a
  Cloudinary con una firma del backend, y el backend verifica la firma de la respuesta.
- Cada cambio de contenido marca el sitio con "cambios sin publicar". **Publicar** llama al Deploy
  Hook de Vercel del sitio (`VERCEL_DEPLOY_HOOK_*`); sin él, la publicación solo se registra.
- `npm run db:seed` carga el contenido actual de la landing de HOGAR (planes, carrusel, redes y
  fotos) si el sitio aún no tiene planes; las imágenes las copia desde `../digo-landing/public`.

## Libro de Reclamaciones

- Número correlativo por año (`000001-2026`), asignado en la misma transacción que la hoja.
- Plazo de respuesta: 15 días hábiles en hora de Lima, sin fines de semana ni feriados
  nacionales (`src/common/business-days.ts`; los feriados extraordinarios se agregan ahí).
- Al registrarla se envía la constancia al consumidor y un aviso a `MAIL_TEAM`.
- Una hoja se responde una sola vez; la respuesta se envía por correo y se puede reenviar.
- Las hojas no se eliminan.

## Producción (Easypanel)

- Servicio App con el `Dockerfile` de este repo. Al arrancar aplica las migraciones pendientes.
- Servicio Postgres en Easypanel, **con backups automáticos** (el libro se conserva 2 años).
- Variables: las de `.env.example`, con `NODE_ENV=production` y credenciales SMTP reales.
- Health check: `GET /api/health`.
