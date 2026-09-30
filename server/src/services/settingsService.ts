// Configuración editable del negocio (tabla settings, un JSON por clave).
import { z } from 'zod';
import type { AdminExpenseConfig } from '@alpe/shared';
import { query, queryOne, type Db, pool } from '../database/pool';

export const settingsSchemas = {
  company: z.object({
    name: z.string().trim().min(1),
    nit: z.string().trim().default(''),
    address: z.string().trim().default(''),
    city: z.string().trim().default(''),
    phone: z.string().trim().default(''),
    email: z.string().trim().default(''),
  }),
  admin_expenses: z.object({
    enabled: z.boolean(),
    mode: z.enum(['pct_ventas', 'por_unidad', 'mensual']),
    pct: z.coerce.number().min(0).max(0.5),
    perUnit: z.coerce.number().min(0),
    monthlyAmount: z.coerce.number().min(0),
    fallbackMonthlyUnits: z.coerce.number().int().min(0),
  }),
  production: z.object({
    lookbackDays: z.coerce.number().int().min(1).max(365),
    shifts: z.array(z.string().trim().min(1)).min(1),
    shelfLifeDays: z.coerce.number().int().min(1).max(3650),
    laborHourCost: z.coerce.number().min(0),
    energyKwhCost: z.coerce.number().min(0),
  }),
  pricing: z.object({
    roundingStep: z.coerce.number().int().min(1),
    defaultMinMargin: z.coerce.number().min(0).max(0.9),
    defaultTargetMargin: z.coerce.number().min(0).max(0.9),
  }),
  operations: z.object({
    dueSoonDays: z.coerce.number().int().min(0).max(60),
    countDiffThresholdPct: z.coerce.number().min(0).max(1),
    monthlyPacksLookbackDays: z.coerce.number().int().min(7).max(365),
  }),
};

export type SettingsKey = keyof typeof settingsSchemas;
export type Settings = { [K in SettingsKey]: z.infer<(typeof settingsSchemas)[K]> };

export const DEFAULT_SETTINGS: Settings = {
  company: { name: 'ALPE', nit: '', address: '', city: '', phone: '', email: '' },
  admin_expenses: {
    enabled: false,
    mode: 'pct_ventas',
    pct: 0.05,
    perUnit: 15,
    monthlyAmount: 12_000_000,
    fallbackMonthlyUnits: 600_000,
  },
  production: {
    lookbackDays: 60,
    shifts: ['Mañana', 'Tarde', 'Noche'],
    shelfLifeDays: 365,
    laborHourCost: 8_500,
    energyKwhCost: 820,
  },
  pricing: { roundingStep: 100, defaultMinMargin: 0.15, defaultTargetMargin: 0.25 },
  operations: { dueSoonDays: 7, countDiffThresholdPct: 0.02, monthlyPacksLookbackDays: 30 },
};

export async function getSettings(db: Db = pool): Promise<Settings> {
  const rows = await query<{ key: string; value: unknown }>('SELECT key, value FROM settings', [], db);
  const result = structuredClone(DEFAULT_SETTINGS) as Settings;
  for (const row of rows) {
    if (row.key in result) {
      (result as Record<string, unknown>)[row.key] = { ...(result as any)[row.key], ...(row.value as object) };
    }
  }
  return result;
}

export async function getSetting<K extends SettingsKey>(key: K, db: Db = pool): Promise<Settings[K]> {
  const row = await queryOne<{ value: Settings[K] }>('SELECT value FROM settings WHERE key = $1', [key], db);
  return { ...DEFAULT_SETTINGS[key], ...(row?.value ?? {}) } as Settings[K];
}

export async function saveSetting<K extends SettingsKey>(key: K, value: unknown, userId: number | null, db: Db = pool) {
  const parsed = settingsSchemas[key].parse(value);
  await query(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(parsed), userId],
    db,
  );
  return parsed;
}

export async function ensureDefaultSettings(db: Db = pool) {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, JSON.stringify(value)], db);
  }
}

export type { AdminExpenseConfig };
