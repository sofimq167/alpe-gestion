import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../database/pool';
import { requireModule } from '../middleware/auth';
import { cancelOrder, createOrder } from '../services/orderService';
import { h, idParam, notFound } from '../utils/http';
import { isoDate, optText, posInt } from '../utils/validators';

export const ordersRouter = Router();

ordersRouter.get(
  '/',
  h(async (req, res) => {
    const f = z
      .object({ from: isoDate.optional(), to: isoDate.optional(), clientId: z.coerce.number().optional(), status: z.string().optional() })
      .parse(req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (f.from) where.push(`o.order_date >= $${params.push(f.from)}`);
    if (f.to) where.push(`o.order_date <= $${params.push(f.to)}`);
    if (f.clientId) where.push(`o.client_id = $${params.push(f.clientId)}`);
    if (f.status === 'pendiente') where.push(`o.status IN ('confirmado','parcial')`);
    else if (f.status) where.push(`o.status = $${params.push(f.status)}`);
    res.json(
      await query(
        `SELECT o.*, c.name AS client_name, cp.name AS profile_name, u.name AS created_by_name,
           (SELECT SUM(packs)::int FROM order_items WHERE order_id = o.id) AS packs,
           (SELECT SUM(packs - packs_dispatched)::int FROM order_items WHERE order_id = o.id) AS pending_packs,
           (SELECT string_agg(p.name || ' × ' || oi.packs, ', ') FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS summary
         FROM orders o JOIN clients c ON c.id = o.client_id JOIN client_profiles cp ON cp.id = c.profile_id
         LEFT JOIN users u ON u.id = o.created_by
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY o.order_date DESC, o.id DESC LIMIT 2000`,
        params,
      ),
    );
  }),
);

ordersRouter.get(
  '/:id',
  h(async (req, res) => {
    const id = idParam(req);
    const order = await queryOne(
      `SELECT o.*, c.name AS client_name, c.document AS client_document, c.address, c.city, cp.name AS profile_name, u.name AS created_by_name
       FROM orders o JOIN clients c ON c.id = o.client_id JOIN client_profiles cp ON cp.id = c.profile_id
       LEFT JOIN users u ON u.id = o.created_by WHERE o.id = $1`,
      [id],
    );
    if (!order) throw notFound('El pedido');
    const [items, dispatches] = await Promise.all([
      query(
        `SELECT oi.*, p.name AS product_name, p.stock_packs FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1 ORDER BY oi.id`,
        [id],
      ),
      query(
        'SELECT id, number, remission_number, dispatch_date, total, packs_total, status FROM dispatches WHERE order_id = $1 ORDER BY id',
        [id],
      ),
    ]);
    res.json({ ...order, items, dispatches });
  }),
);

ordersRouter.post(
  '/',
  requireModule('pedidos'),
  h(async (req, res) => {
    const d = z
      .object({
        clientId: posInt,
        orderDate: isoDate,
        deliveryDate: isoDate.optional().nullable().or(z.literal('')).transform((v) => v || null),
        notes: optText,
        items: z.array(z.object({ productId: posInt, packs: posInt })).min(1, 'Agregue al menos un producto'),
        confirmWarnings: z.boolean().default(false),
      })
      .parse(req.body);
    res.status(201).json(await createOrder(d, req.user!.id));
  }),
);

ordersRouter.post(
  '/:id/cancel',
  requireModule('pedidos'),
  h(async (req, res) => {
    const { reason } = z.object({ reason: optText }).parse(req.body ?? {});
    res.json(await cancelOrder(idParam(req), reason));
  }),
);
