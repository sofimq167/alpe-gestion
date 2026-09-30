// Preparación automática de la base de datos al arrancar (el plan gratuito de Render no tiene consola).
import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { ensureDefaultSettings } from '../services/settingsService';
import { runMigrations } from './migrate';
import { query, queryOne } from './pool';
import { seedDemoData } from './seed';

/** Crea el administrador inicial si no existe ningún usuario. */
export async function ensureAdmin(options: { email?: string; password?: string; name?: string } = {}) {
  const email = (options.email ?? env.adminEmail)?.trim().toLowerCase();
  const password = options.password ?? env.adminPassword;
  const name = options.name ?? env.adminName;
  const existing = await queryOne<{ n: number }>('SELECT COUNT(*)::int AS n FROM users');
  if ((existing?.n ?? 0) > 0) return null;
  if (!email || !password) {
    console.warn('[inicio] No hay usuarios. Defina ADMIN_EMAIL y ADMIN_PASSWORD para crear el administrador inicial.');
    return null;
  }
  if (password.length < 8) throw new Error('ADMIN_PASSWORD debe tener al menos 8 caracteres.');
  const row = await queryOne(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'admin') RETURNING id, email`,
    [name, email, await bcrypt.hash(password, 10)],
  );
  console.log(`[inicio] Administrador inicial creado: ${row.email}`);
  return row;
}

export async function isDatabaseEmpty(): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    'SELECT ((SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM supplies) + (SELECT COUNT(*) FROM clients))::int AS n',
  );
  return (row?.n ?? 0) === 0;
}

/** Prepara la base: migraciones, configuración por defecto y administrador inicial. */
export async function bootstrap() {
  await runMigrations();
  await ensureDefaultSettings();
  await ensureAdmin();
  await query('SELECT 1');
}

/**
 * Carga los datos de demostración si SEED_DEMO_DATA=true y la base está vacía.
 * Se ejecuta después de abrir el puerto para que Render no marque el despliegue como fallido
 * mientras se cargan los datos (puede tardar 1–3 minutos contra una base remota).
 */
export async function seedIfRequested() {
  if (!env.seedDemoData) return;
  if (!(await isDatabaseEmpty())) {
    console.log('[inicio] SEED_DEMO_DATA=true pero la base ya tiene datos: no se cargan datos de demostración.');
    return;
  }
  const admin = await queryOne<{ id: number }>(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
  console.log('[inicio] Cargando datos de demostración en segundo plano...');
  await seedDemoData(admin?.id ?? null);
  console.log('[inicio] Datos de demostración cargados.');
}
