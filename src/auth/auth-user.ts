import type { Role, Site } from '../generated/prisma/enums.js';

/** Usuario autenticado que queda en `request.user`. */
export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Espacios del panel a los que tiene acceso. */
  sites: Site[];
};

export type JwtPayload = { sub: string };

export const SESSION_COOKIE = 'digo_session';
