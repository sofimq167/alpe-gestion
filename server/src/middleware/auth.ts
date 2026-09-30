import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { canAccess, type Module, type Role } from '@alpe/shared';
import { env } from '../config/env';
import { queryOne } from '../database/pool';
import { HttpError } from '../utils/http';
import type { AuthUser } from '../types/express';

export const SESSION_COOKIE = 'alpe_session';

export function signSession(user: AuthUser): string {
  return jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: `${env.sessionHours}h` });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.isProduction,
    maxAge: env.sessionHours * 3600 * 1000,
    path: '/',
  };
}

/** Protege las rutas privadas: exige una sesión válida y un usuario activo. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new HttpError(401, 'Su sesión expiró. Inicie sesión nuevamente.', 'NO_AUTENTICADO');
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
    } catch {
      throw new HttpError(401, 'Su sesión expiró. Inicie sesión nuevamente.', 'NO_AUTENTICADO');
    }
    const user = await queryOne<AuthUser & { active: boolean }>(
      'SELECT id, name, email, role, active FROM users WHERE id = $1',
      [Number(payload.sub)],
    );
    if (!user || !user.active) throw new HttpError(401, 'Usuario no autorizado.', 'NO_AUTENTICADO');
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** Restringe una ruta a los roles con acceso al módulo. El administrador accede a todo. */
export function requireModule(module: Module) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !canAccess(req.user.role, module)) {
      return next(new HttpError(403, 'No tiene permisos para esta sección.', 'SIN_PERMISO'));
    }
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'No tiene permisos para esta acción.', 'SIN_PERMISO'));
    }
    next();
  };
}
