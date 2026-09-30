// Cartera: cuentas por cobrar generadas por despachos y sus pagos.
import { addDays, applyPayment, daysOverdue, receivableStatus, todayISO, type ReceivableStatus } from '@alpe/shared';
import type { PoolClient } from 'pg';
import { env } from '../config/env';
import { query, queryOne, pool, withTransaction, type Db } from '../database/pool';
import { conflict, notFound } from '../utils/http';
import { getSetting } from './settingsService';

export async function createReceivable(
  db: PoolClient,
  input: {
    clientId: number;
    dispatchId: number;
    orderId: number | null;
    documentNumber: string;
    issueDate: string;
    termDays: number;
    amount: number;
    paidNow: boolean;
    paymentMethod?: string;
    userId: number | null;
  },
) {
  const receivable = await queryOne(
    `INSERT INTO receivables (client_id, dispatch_id, order_id, document_number, issue_date, due_date, original_amount, balance)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
    [input.clientId, input.dispatchId, input.orderId, input.documentNumber, input.issueDate, addDays(input.issueDate, input.termDays), input.amount],
    db,
  );
  if (input.paidNow && input.amount > 0) {
    await insertPayment(db, receivable!.id, {
      date: input.issueDate,
      amount: input.amount,
      method: input.paymentMethod ?? 'efectivo',
      reference: 'Pago de contado al despachar',
      userId: input.userId,
    });
  }
  return receivable;
}

async function insertPayment(
  db: PoolClient,
  receivableId: number,
  p: { date: string; amount: number; method: string; reference?: string | null; notes?: string | null; userId: number | null },
) {
  const r = await queryOne('SELECT * FROM receivables WHERE id = $1 FOR UPDATE', [receivableId], db);
  if (!r) throw notFound('La cuenta por cobrar');
  if (r.annulled) throw conflict('La cuenta por cobrar está anulada.');
  const newBalance = applyPayment(r.balance, p.amount);
  await query('UPDATE receivables SET balance = $1 WHERE id = $2', [newBalance, receivableId], db);
  return queryOne(
    `INSERT INTO payments (receivable_id, payment_date, amount, method, reference, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [receivableId, p.date, p.amount, p.method, p.reference ?? null, p.notes ?? null, p.userId],
    db,
  );
}

export async function registerPayment(
  receivableId: number,
  p: { date: string; amount: number; method: string; reference?: string | null; notes?: string | null; userId: number | null },
) {
  return withTransaction(async (db) => {
    const payment = await insertPayment(db, receivableId, p);
    const r = await queryOne('SELECT * FROM receivables WHERE id = $1', [receivableId], db);
    return { payment, receivable: r };
  });
}

/** Agrega estado y días vencidos calculados a una fila de cartera. */
export function decorateReceivable<T extends { balance: number; due_date: string; annulled: boolean }>(
  r: T,
  today: string,
  soonDays: number,
): T & { status: ReceivableStatus; days_overdue: number } {
  const status = receivableStatus(r.balance, r.due_date, today, soonDays, r.annulled);
  return { ...r, status, days_overdue: status === 'vencida' ? daysOverdue(r.due_date, today) : 0 };
}

export async function listReceivables(filters: { clientId?: number; status?: string; from?: string; to?: string }, db: Db = pool) {
  const today = todayISO(env.timezone);
  const soonDays = (await getSetting('operations', db)).dueSoonDays;
  const params: unknown[] = [];
  const where: string[] = [];
  if (filters.clientId) {
    params.push(filters.clientId);
    where.push(`r.client_id = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    where.push(`r.issue_date >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    where.push(`r.issue_date <= $${params.length}`);
  }
  const rows = await query(
    `SELECT r.*, c.name AS client_name, c.document AS client_document, d.number AS dispatch_number, o.number AS order_number,
       (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.receivable_id = r.id)::numeric AS paid
     FROM receivables r
     JOIN clients c ON c.id = r.client_id
     LEFT JOIN dispatches d ON d.id = r.dispatch_id
     LEFT JOIN orders o ON o.id = r.order_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY r.due_date ASC, r.id DESC LIMIT 3000`,
    params,
    db,
  );
  const decorated = rows.map((r) => decorateReceivable(r, today, soonDays));
  if (filters.status === 'pendiente') return decorated.filter((r) => r.status !== 'pagada' && r.status !== 'anulada');
  if (filters.status) return decorated.filter((r) => r.status === filters.status);
  return decorated;
}
