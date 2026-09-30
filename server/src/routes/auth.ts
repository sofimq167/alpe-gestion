import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query, queryOne } from '../database/pool';
import { requireAuth, SESSION_COOKIE, sessionCookieOptions, signSession } from '../middleware/auth';
import { h, HttpError } from '../utils/http';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Espere 15 minutos e intente de nuevo.' },
});

authRouter.post(
  '/login',
  loginLimiter,
  h(async (req, res) => {
    const { email, password } = z
      .object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) })
      .parse(req.body);
    const user = await queryOne('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const valid = user && user.active && (await bcrypt.compare(password, user.password_hash));
    if (!valid) throw new HttpError(401, 'Correo o contraseña incorrectos.', 'CREDENCIALES');
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    const authUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.cookie(SESSION_COOKIE, signSession(authUser), sessionCookieOptions());
    res.json({ user: authUser });
  }),
);

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Devuelve el usuario de la sesión o null (sin error) para que el frontend sepa si mostrar el inicio de sesión.
authRouter.get('/me', (req, res, next) => {
  if (!req.cookies?.[SESSION_COOKIE]) return res.json({ user: null });
  requireAuth(req, res, (err?: unknown) => {
    if (err) return res.json({ user: null });
    res.json({ user: req.user });
  }).catch(next);
});

authRouter.post(
  '/change-password',
  requireAuth,
  h(async (req, res) => {
    const { currentPassword, newPassword } = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8, 'La nueva contraseña debe tener al menos 8 caracteres') })
      .parse(req.body);
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.user!.id]);
    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      throw new HttpError(400, 'La contraseña actual no es correcta.');
    }
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(newPassword, 10), user.id]);
    res.json({ ok: true });
  }),
);
