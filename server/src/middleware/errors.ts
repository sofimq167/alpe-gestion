import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { InventoryError, PaymentError, PricingError } from '@alpe/shared';
import { HttpError, zodMessage } from '../utils/http';

/** Traduce cualquier error a una respuesta JSON comprensible para el usuario. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: zodMessage(err), code: 'DATOS_INVALIDOS' });
  }
  if (err instanceof InventoryError || err instanceof PaymentError || err instanceof PricingError) {
    return res.status(400).json({ error: err.message, code: 'REGLA_NEGOCIO' });
  }
  const pgErr = err as { code?: string; constraint?: string; detail?: string };
  if (pgErr?.code === '23505') {
    return res.status(409).json({ error: 'Ya existe un registro con ese valor (código, nombre o número duplicado).', code: 'DUPLICADO' });
  }
  if (pgErr?.code === '23503') {
    return res.status(409).json({
      error: 'No se puede eliminar o modificar porque tiene registros relacionados (movimientos, pedidos o despachos). Puede desactivarlo en su lugar.',
      code: 'RELACIONADO',
    });
  }
  if (pgErr?.code === '23514') {
    return res.status(400).json({ error: 'Algún valor está fuera del rango permitido.', code: 'DATOS_INVALIDOS' });
  }
  if ((err as { type?: string })?.type === 'entity.too.large' || (err as { code?: string })?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo o la información enviada es demasiado grande (máximo 2 MB).' });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: 'Ocurrió un error inesperado. Intente nuevamente.' });
}
