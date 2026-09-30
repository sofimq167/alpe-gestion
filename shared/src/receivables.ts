// Cartera: saldos, pagos y estados de cuentas por cobrar.

import { diffDays, formatCOP } from './format';

export type ReceivableStatus = 'pagada' | 'vencida' | 'por_vencer' | 'al_dia' | 'anulada';

export const RECEIVABLE_STATUS_LABEL: Record<ReceivableStatus, string> = {
  pagada: 'Pagada',
  vencida: 'Vencida',
  por_vencer: 'Por vencer',
  al_dia: 'Al día',
  anulada: 'Anulada',
};

export class PaymentError extends Error {}

/** Saldo después de un pago. No se permite pagar más que el saldo ni valores ≤ 0. */
export function applyPayment(balance: number, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new PaymentError('El valor del pago debe ser mayor que cero.');
  if (amount > balance + 0.5) {
    throw new PaymentError(`El pago (${formatCOP(amount)}) supera el saldo pendiente (${formatCOP(balance)}).`);
  }
  const next = Math.round((balance - amount) * 100) / 100;
  return next < 0.5 ? 0 : next;
}

/** Saldo = valor original − Σ pagos. */
export function receivableBalance(originalAmount: number, payments: number[]): number {
  const paid = payments.reduce((s, p) => s + p, 0);
  return Math.max(Math.round((originalAmount - paid) * 100) / 100, 0);
}

/** Días vencidos (0 si aún no vence). */
export function daysOverdue(dueDate: string, today: string): number {
  return Math.max(diffDays(dueDate, today), 0);
}

/**
 * Estado de una cuenta por cobrar:
 * - Pagada: saldo 0.
 * - Vencida: hoy es posterior al vencimiento.
 * - Por vencer: vence dentro de los próximos `soonDays` días.
 * - Al día: vence más adelante.
 */
export function receivableStatus(
  balance: number,
  dueDate: string,
  today: string,
  soonDays = 7,
  annulled = false,
): ReceivableStatus {
  if (annulled) return 'anulada';
  if (balance <= 0.5) return 'pagada';
  const daysToDue = diffDays(today, dueDate);
  if (daysToDue < 0) return 'vencida';
  if (daysToDue <= soonDays) return 'por_vencer';
  return 'al_dia';
}
