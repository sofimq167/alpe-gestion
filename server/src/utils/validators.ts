import { z } from 'zod';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'debe tener formato AAAA-MM-DD');
export const optText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
export const reqText = z.string().trim().min(1).max(300);
export const money = z.coerce.number().finite().min(0);
export const pct = z.coerce.number().finite().min(0).max(0.9499, 'no puede ser 95% o más');
export const posInt = z.coerce.number().int('debe ser un número entero').positive();
export const nonNegInt = z.coerce.number().int('debe ser un número entero').min(0);
export const optId = z.coerce.number().int().positive().optional().nullable();
