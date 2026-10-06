import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCookieAuth } from '@nestjs/swagger';
import type { Role, Site } from '../generated/prisma/enums.js';
import { type AuthUser, SESSION_COOKIE } from './auth-user.js';

const ROLES_KEY = 'roles';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    return Boolean(user && roles.includes(user.role));
  }
}

const siteName: Record<Site, string> = {
  HOGAR: 'DIGO HOGAR',
  EMPRESAS: 'DIGO EMPRESAS',
};

/** Rechaza si el usuario no tiene acceso al espacio del panel (Hogar o Empresas). */
export function assertSiteAccess(user: AuthUser, site: Site) {
  if (!user.sites.includes(site)) {
    throw new ForbiddenException(`No tienes acceso a ${siteName[site]}`);
  }
}

/**
 * Espacios que puede ver el usuario: el pedido (si tiene acceso) o todos los suyos. Sirve de
 * filtro `site` en listados, resúmenes y exportaciones.
 */
export function siteScope(user: AuthUser, requested?: Site) {
  if (requested) {
    assertSiteAccess(user, requested);
    return { in: [requested] };
  }
  return { in: user.sites };
}

/**
 * Rutas con `:site` (contenido, publicación) o `?site=`: el usuario debe tener acceso a ese
 * espacio. El parámetro de ruta llega como `hogar` / `empresas`.
 */
@Injectable()
export class SiteAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      params?: Record<string, string>;
      query?: Record<string, unknown>;
    }>();
    const raw = request.params?.site ?? request.query?.site;
    if (!request.user || typeof raw !== 'string' || !raw) return true;
    const site = raw.toUpperCase();
    if (site === 'HOGAR' || site === 'EMPRESAS')
      assertSiteAccess(request.user, site);
    return true;
  }
}

/** Exige sesión iniciada y, si se indican, alguno de los roles. */
export function Auth(...roles: Role[]) {
  return applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    UseGuards(JwtAuthGuard, RolesGuard, SiteAccessGuard),
    ApiCookieAuth(SESSION_COOKIE),
    ApiBearerAuth(),
  );
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
