import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError } from 'zod';

/** Error con mensaje comprensible para el usuario y código HTTP. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'DATOS_INVALIDOS', details);
export const notFound = (what = 'El registro') => new HttpError(404, `${what} no existe.`, 'NO_ENCONTRADO');
export const conflict = (msg: string) => new HttpError(409, msg, 'CONFLICTO');

/**
 * Advertencias que el usuario debe confirmar antes de guardar
 * (margen bajo, pedido mínimo, sobrecupo de crédito, existencia insuficiente...).
 */
export class WarningsError extends HttpError {
  constructor(public warnings: string[]) {
    super(409, 'Revise las advertencias antes de continuar.', 'REQUIERE_CONFIRMACION', { warnings });
  }
}

/** Permite usar funciones async en rutas de Express y enviar los errores al manejador central. */
export function h(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function idParam(req: Request, name = 'id'): number {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Identificador no válido.');
  return id;
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  email: 'Correo',
  password: 'Contraseña',
  packs: 'Pacas',
  quantity: 'Cantidad',
  price: 'Precio',
  pricePack: 'Precio por paca',
  amount: 'Valor',
  date: 'Fecha',
  orderDate: 'Fecha del pedido',
  startDate: 'Fecha de inicio',
  endDate: 'Fecha de vencimiento',
  clientId: 'Cliente',
  productId: 'Presentación',
  supplyId: 'Insumo',
  profileId: 'Perfil',
  minMargin: 'Margen mínimo',
  targetMargin: 'Margen objetivo',
  unitsPerPack: 'Botellas por paca',
  packsPerPallet: 'Pacas por estiba',
  volumeMl: 'Volumen',
  newCost: 'Costo nuevo',
  currentCost: 'Costo',
  discountPct: 'Descuento',
  baseDiscountPct: 'Descuento base',
  minQty: 'Cantidad mínima',
  maxQty: 'Cantidad máxima',
  shift: 'Turno',
  items: 'Productos',
  physicalQty: 'Cantidad física',
  paymentTermDays: 'Plazo',
  category: 'Categoría',
  unit: 'Unidad',
};

export function zodMessage(err: ZodError): string {
  const issue = err.issues[0];
  // Mensajes personalizados (empiezan en mayúscula) se muestran tal cual
  if (/^[A-ZÁÉÍÓÚ]/.test(issue.message)) return issue.message;
  const key = [...issue.path].reverse().find((p) => typeof p === 'string') as string | undefined;
  const label = key ? (FIELD_LABELS[key] ?? key) : '';
  const line = issue.path.find((p) => typeof p === 'number');
  const where = typeof line === 'number' ? ` (línea ${line + 1})` : '';
  return label ? `${label}${where} ${issue.message}.` : issue.message;
}

// Mensajes de validación en español
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'es obligatorio' };
      return { message: 'tiene un formato no válido' };
    case 'too_small':
      if (issue.type === 'string') return { message: 'es obligatorio' };
      return { message: `debe ser mayor${issue.inclusive ? ' o igual' : ''} a ${issue.minimum}` };
    case 'too_big':
      return { message: `debe ser menor${issue.inclusive ? ' o igual' : ''} a ${issue.maximum}` };
    case 'invalid_string':
      if (issue.validation === 'email') return { message: 'no es un correo válido' };
      return { message: 'tiene un formato no válido' };
    case 'invalid_enum_value':
      return { message: 'no es una opción válida' };
    default:
      return { message: ctx.defaultError };
  }
});
