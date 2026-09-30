import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '@alpe/shared';
import { query, queryOne } from '../database/pool';
import { requireModule, requireRole } from '../middleware/auth';
import { getSettings, saveSetting, settingsSchemas, type SettingsKey } from '../services/settingsService';
import { badRequest, conflict, h, idParam } from '../utils/http';

export const settingsRouter = Router();

settingsRouter.get(
  '/',
  h(async (_req, res) => {
    res.json(await getSettings());
  }),
);

settingsRouter.put(
  '/:key',
  requireModule('configuracion'),
  h(async (req, res) => {
    const key = req.params.key as SettingsKey;
    if (!(key in settingsSchemas)) throw badRequest('Configuración desconocida.');
    res.json(await saveSetting(key, req.body, req.user!.id));
  }),
);

// ---------------- Usuarios ----------------
export const usersRouter = Router();
usersRouter.use(requireRole('admin'));

const userSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES),
  active: z.boolean().default(true),
  password: z.string().min(8, 'debe tener al menos 8 caracteres').optional().or(z.literal('')),
});

usersRouter.get(
  '/',
  h(async (_req, res) => {
    res.json(await query('SELECT id, name, email, role, active, last_login_at, created_at FROM users ORDER BY name'));
  }),
);

usersRouter.post(
  '/',
  h(async (req, res) => {
    const data = userSchema.parse(req.body);
    if (!data.password) throw badRequest('La contraseña es obligatoria (mínimo 8 caracteres).');
    const row = await queryOne(
      'INSERT INTO users (name, email, role, active, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role, active',
      [data.name, data.email, data.role, data.active, await bcrypt.hash(data.password, 10)],
    );
    res.status(201).json(row);
  }),
);

usersRouter.put(
  '/:id',
  h(async (req, res) => {
    const id = idParam(req);
    const data = userSchema.parse(req.body);
    if (id === req.user!.id && (!data.active || data.role !== 'admin')) {
      throw conflict('No puede desactivar ni quitarse el rol de administrador a sí mismo.');
    }
    const row = await queryOne(
      'UPDATE users SET name=$1, email=$2, role=$3, active=$4 WHERE id=$5 RETURNING id, name, email, role, active',
      [data.name, data.email, data.role, data.active, id],
    );
    if (data.password) {
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(data.password, 10), id]);
    }
    res.json(row);
  }),
);
