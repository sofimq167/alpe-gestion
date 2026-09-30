import { Router } from 'express';
import { z } from 'zod';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, todayISO } from '@alpe/shared';
import { env } from '../config/env';
import { query, queryOne } from '../database/pool';
import { requireModule } from '../middleware/auth';
import { decorateReceivable, listReceivables, registerPayment } from '../services/receivableService';
import { getDashboard, getFinance } from '../services/reportService';
import { getSetting } from '../services/settingsService';
import { h, idParam, notFound } from '../utils/http';
import { isoDate, optText } from '../utils/validators';

// ---------------- Cartera ----------------
export const receivablesRouter = Router();

receivablesRouter.get(
  '/',
  h(async (req, res) => {
    const f = z
      .object({ clientId: z.coerce.number().optional(), status: z.string().optional(), from: isoDate.optional(), to: isoDate.optional() })
      .parse(req.query);
    res.json(await listReceivables(f));
  }),
);

receivablesRouter.get(
  '/:id',
  h(async (req, res) => {
    const id = idParam(req);
    const r = await queryOne(
      `SELECT r.*, c.name AS client_name, c.phone AS client_phone, d.number AS dispatch_number, o.number AS order_number
       FROM receivables r JOIN clients c ON c.id = r.client_id LEFT JOIN dispatches d ON d.id = r.dispatch_id
       LEFT JOIN orders o ON o.id = r.order_id WHERE r.id = $1`,
      [id],
    );
    if (!r) throw notFound('La cuenta por cobrar');
    const payments = await query(
      `SELECT p.*, u.name AS created_by_name FROM payments p LEFT JOIN users u ON u.id = p.created_by
       WHERE receivable_id = $1 ORDER BY payment_date, id`,
      [id],
    );
    const soon = (await getSetting('operations')).dueSoonDays;
    res.json({ ...decorateReceivable(r, todayISO(env.timezone), soon), payments });
  }),
);

receivablesRouter.post(
  '/:id/payments',
  requireModule('cartera'),
  h(async (req, res) => {
    const d = z
      .object({
        date: isoDate,
        amount: z.coerce.number().positive('debe ser mayor que cero'),
        method: z.enum(PAYMENT_METHODS),
        reference: optText,
        notes: optText,
      })
      .parse(req.body);
    res.status(201).json(await registerPayment(idParam(req), { ...d, userId: req.user!.id }));
  }),
);

export const paymentsRouter = Router();
paymentsRouter.get(
  '/',
  h(async (req, res) => {
    const f = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (f.from) where.push(`p.payment_date >= $${params.push(f.from)}`);
    if (f.to) where.push(`p.payment_date <= $${params.push(f.to)}`);
    res.json(
      await query(
        `SELECT p.*, r.document_number, c.name AS client_name FROM payments p JOIN receivables r ON r.id = p.receivable_id
         JOIN clients c ON c.id = r.client_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY p.payment_date DESC, p.id DESC LIMIT 2000`,
        params,
      ),
    );
  }),
);

// ---------------- Dashboard y finanzas ----------------
export const reportsRouter = Router();

reportsRouter.get(
  '/dashboard',
  h(async (_req, res) => {
    res.json(await getDashboard());
  }),
);

reportsRouter.get(
  '/finance',
  requireModule('finanzas'),
  h(async (req, res) => {
    const today = todayISO(env.timezone);
    const f = z.object({ from: isoDate.default(`${today.slice(0, 7)}-01`), to: isoDate.default(today) }).parse(req.query);
    res.json(await getFinance(f.from, f.to));
  }),
);

// ---------------- Gastos administrativos ----------------
export const expensesRouter = Router();

const expenseSchema = z.object({
  date: isoDate,
  category: z.enum(EXPENSE_CATEGORIES),
  description: optText,
  amount: z.coerce.number().positive('debe ser mayor que cero'),
});

expensesRouter.get(
  '/',
  h(async (req, res) => {
    const f = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (f.from) where.push(`e.expense_date >= $${params.push(f.from)}`);
    if (f.to) where.push(`e.expense_date <= $${params.push(f.to)}`);
    res.json(
      await query(
        `SELECT e.*, u.name AS created_by_name FROM admin_expenses e LEFT JOIN users u ON u.id = e.created_by
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.expense_date DESC, e.id DESC LIMIT 2000`,
        params,
      ),
    );
  }),
);

expensesRouter.post(
  '/',
  requireModule('finanzas'),
  h(async (req, res) => {
    const d = expenseSchema.parse(req.body);
    res.status(201).json(
      await queryOne(
        'INSERT INTO admin_expenses (expense_date, category, description, amount, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [d.date, d.category, d.description, d.amount, req.user!.id],
      ),
    );
  }),
);

expensesRouter.put(
  '/:id',
  requireModule('finanzas'),
  h(async (req, res) => {
    const d = expenseSchema.parse(req.body);
    const row = await queryOne(
      'UPDATE admin_expenses SET expense_date=$1, category=$2, description=$3, amount=$4 WHERE id=$5 RETURNING *',
      [d.date, d.category, d.description, d.amount, idParam(req)],
    );
    if (!row) throw notFound('El gasto');
    res.json(row);
  }),
);

expensesRouter.delete(
  '/:id',
  requireModule('finanzas'),
  h(async (req, res) => {
    await query('DELETE FROM admin_expenses WHERE id = $1', [idParam(req)]);
    res.json({ ok: true });
  }),
);
