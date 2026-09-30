import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../database/pool';
import { requireModule } from '../middleware/auth';
import { annulProduction, createProduction, suggestConsumption } from '../services/productionService';
import { h, idParam, notFound } from '../utils/http';
import { isoDate, money, nonNegInt, optText, posInt } from '../utils/validators';

export const productionRouter = Router();

productionRouter.get(
  '/',
  h(async (req, res) => {
    const f = z
      .object({ from: isoDate.optional(), to: isoDate.optional(), productId: z.coerce.number().optional(), maquila: z.enum(['si', 'no']).optional() })
      .parse(req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (f.from) where.push(`pr.run_date >= $${params.push(f.from)}`);
    if (f.to) where.push(`pr.run_date <= $${params.push(f.to)}`);
    if (f.productId) where.push(`pr.product_id = $${params.push(f.productId)}`);
    if (f.maquila === 'si') where.push('pr.is_maquila');
    if (f.maquila === 'no') where.push('NOT pr.is_maquila');
    res.json(
      await query(
        `SELECT pr.*, l.code AS lot_code, COALESCE(p.name, ms.name) AS item_name, c.name AS client_name,
           COALESCE(p.units_per_pack, ms.units_per_pack) AS units_per_pack, u.name AS created_by_name
         FROM production_runs pr JOIN lots l ON l.id = pr.lot_id
         LEFT JOIN products p ON p.id = pr.product_id
         LEFT JOIN maquila_services ms ON ms.id = pr.maquila_service_id
         LEFT JOIN clients c ON c.id = ms.client_id
         LEFT JOIN users u ON u.id = pr.created_by
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY pr.run_date DESC, pr.id DESC LIMIT 2000`,
        params,
      ),
    );
  }),
);

productionRouter.get(
  '/suggest',
  h(async (req, res) => {
    const q = z
      .object({
        productId: z.coerce.number().int().positive().optional(),
        maquilaServiceId: z.coerce.number().int().positive().optional(),
        packs: z.coerce.number().int().min(0),
        defectiveUnits: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    res.json(q.packs > 0 ? await suggestConsumption(q) : []);
  }),
);

productionRouter.get(
  '/:id',
  h(async (req, res) => {
    const id = idParam(req);
    const run = await queryOne(
      `SELECT pr.*, l.code AS lot_code, l.packs_remaining, COALESCE(p.name, ms.name) AS item_name,
         COALESCE(p.units_per_pack, ms.units_per_pack) AS units_per_pack, u.name AS created_by_name
       FROM production_runs pr JOIN lots l ON l.id = pr.lot_id LEFT JOIN products p ON p.id = pr.product_id
       LEFT JOIN maquila_services ms ON ms.id = pr.maquila_service_id LEFT JOIN users u ON u.id = pr.created_by WHERE pr.id = $1`,
      [id],
    );
    if (!run) throw notFound('La producción');
    const consumptions = await query(
      `SELECT pc.*, s.name AS supply_name, s.unit FROM production_consumptions pc JOIN supplies s ON s.id = pc.supply_id
       WHERE production_id = $1 ORDER BY pc.id`,
      [id],
    );
    res.json({ ...run, consumptions });
  }),
);

productionRouter.post(
  '/',
  requireModule('produccion'),
  h(async (req, res) => {
    const d = z
      .object({
        date: isoDate,
        shift: z.string().trim().min(1),
        productId: z.coerce.number().int().positive().optional().nullable(),
        maquilaServiceId: z.coerce.number().int().positive().optional().nullable(),
        packs: posInt,
        defectiveUnits: nonNegInt.default(0),
        workers: nonNegInt.default(0),
        hours: z.coerce.number().min(0).max(24).default(0),
        laborCost: money.default(0),
        energyKwh: money.default(0),
        energyCost: money.default(0),
        responsible: optText,
        notes: optText,
        lotCode: optText,
        consumptions: z.array(z.object({ supplyId: posInt, quantity: z.coerce.number().min(0, 'no puede ser negativo') })).optional(),
        confirmWarnings: z.boolean().default(false),
      })
      .parse(req.body);
    res.status(201).json(await createProduction(d, req.user!.id));
  }),
);

productionRouter.post(
  '/:id/annul',
  requireModule('produccion'),
  h(async (req, res) => {
    const { reason } = z.object({ reason: optText }).parse(req.body ?? {});
    res.json(await annulProduction(idParam(req), req.user!.id, reason));
  }),
);

// ---------------- Lotes y trazabilidad ----------------
export const lotsRouter = Router();

lotsRouter.get(
  '/',
  h(async (req, res) => {
    const { q } = z.object({ q: z.string().trim().optional() }).parse(req.query);
    const params: unknown[] = [];
    let where = '';
    if (q) where = `WHERE l.code ILIKE $${params.push(`%${q}%`)} OR p.name ILIKE $1 OR ms.name ILIKE $1 OR c.name ILIKE $1`;
    res.json(
      await query(
        `SELECT l.*, COALESCE(p.name, ms.name) AS item_name, c.name AS client_name,
           (SELECT status FROM production_runs pr WHERE pr.lot_id = l.id LIMIT 1) AS production_status
         FROM lots l LEFT JOIN products p ON p.id = l.product_id LEFT JOIN maquila_services ms ON ms.id = l.maquila_service_id
         LEFT JOIN clients c ON c.id = l.client_id ${where}
         ORDER BY l.production_date DESC, l.id DESC LIMIT 500`,
        params,
      ),
    );
  }),
);

/** Trazabilidad completa de un lote: producción, insumos, despachos y clientes. */
lotsRouter.get(
  '/:id',
  h(async (req, res) => {
    const id = idParam(req);
    const lot = await queryOne(
      `SELECT l.*, COALESCE(p.name, ms.name) AS item_name, c.name AS client_name
       FROM lots l LEFT JOIN products p ON p.id = l.product_id LEFT JOIN maquila_services ms ON ms.id = l.maquila_service_id
       LEFT JOIN clients c ON c.id = l.client_id WHERE l.id = $1`,
      [id],
    );
    if (!lot) throw notFound('El lote');
    const production = await query('SELECT * FROM production_runs WHERE lot_id = $1', [id]);
    const consumptions = production.length
      ? await query(
          `SELECT pc.*, s.name AS supply_name, s.unit FROM production_consumptions pc JOIN supplies s ON s.id = pc.supply_id
           WHERE production_id = ANY($1::int[]) ORDER BY pc.id`,
          [production.map((p) => p.id)],
        )
      : [];
    const dispatches = await query(
      `SELECT d.id, d.number, d.remission_number, d.dispatch_date, d.destination, d.vehicle, d.driver, d.status,
         c.id AS client_id, c.name AS client_name, c.phone AS client_phone, c.city AS client_city, dil.packs
       FROM dispatch_item_lots dil JOIN dispatch_items di ON di.id = dil.dispatch_item_id
       JOIN dispatches d ON d.id = di.dispatch_id JOIN clients c ON c.id = d.client_id
       WHERE dil.lot_id = $1 ORDER BY d.dispatch_date, d.id`,
      [id],
    );
    const clientMap = new Map<number, { id: number; name: string; phone: string; city: string; packs: number }>();
    for (const d of dispatches.filter((x) => x.status === 'confirmado')) {
      const c = clientMap.get(d.client_id) ?? { id: d.client_id, name: d.client_name, phone: d.client_phone, city: d.client_city, packs: 0 };
      c.packs += d.packs;
      clientMap.set(d.client_id, c);
    }
    res.json({ ...lot, production, consumptions, dispatches, clients: [...clientMap.values()] });
  }),
);
