import { Router } from 'express';
import { z } from 'zod';
import { countDifference, todayISO } from '@alpe/shared';
import { env } from '../config/env';
import { query, withTransaction } from '../database/pool';
import { requireModule } from '../middleware/auth';
import { loadCostContext, productSummary } from '../services/costService';
import { moveProduct, moveSupply, registerPhysicalCount } from '../services/inventoryService';
import { getSetting } from '../services/settingsService';
import { badRequest, h } from '../utils/http';
import { isoDate, optText, posInt } from '../utils/validators';

export const inventoryRouter = Router();

/** Producto terminado: existencia teórica, último conteo físico y diferencia. */
inventoryRouter.get(
  '/products',
  h(async (_req, res) => {
    const ctx = await loadCostContext();
    const threshold = ctx.settings.operations.countDiffThresholdPct;
    const lastCounts = await query(
      `SELECT DISTINCT ON (product_id) * FROM physical_counts WHERE item_type = 'producto' ORDER BY product_id, count_date DESC, id DESC`,
    );
    res.json(
      [...ctx.products.values()].map((p) => {
        const s = productSummary(ctx, p.id);
        const last = lastCounts.find((c) => c.product_id === p.id);
        return {
          id: p.id,
          name: p.name,
          active: p.active,
          unitsPerPack: p.units_per_pack,
          stockPacks: p.stock_packs,
          stockUnits: p.stock_packs * p.units_per_pack,
          minStockPacks: p.min_stock_packs,
          costPerPack: s.costPerPack,
          value: Math.max(p.stock_packs, 0) * s.costPerPack,
          low: p.stock_packs <= p.min_stock_packs,
          lastCount: last
            ? { ...last, ...countDifference(last.system_qty, last.physical_qty, last.unit_value, threshold) }
            : null,
        };
      }),
    );
  }),
);

inventoryRouter.get(
  '/supplies',
  h(async (_req, res) => {
    const rows = await query(
      `SELECT s.*, (s.stock * s.current_cost)::numeric AS value,
         (SELECT SUM(-quantity) FROM supply_movements m WHERE m.supply_id = s.id AND m.type = 'consumo' AND m.movement_date >= CURRENT_DATE - 30)::numeric AS consumed_30d
       FROM supplies s WHERE s.is_inventoried ORDER BY s.active DESC, s.category, s.name`,
    );
    res.json(
      rows.map((r) => {
        const daily = (r.consumed_30d ?? 0) / 30;
        return { ...r, daily_use: daily, days_left: daily > 0 ? Math.max(r.stock, 0) / daily : null, low: r.stock <= r.min_stock };
      }),
    );
  }),
);

inventoryRouter.get(
  '/movements',
  h(async (req, res) => {
    const f = z
      .object({ kind: z.enum(['producto', 'insumo']).default('producto'), from: isoDate.optional(), to: isoDate.optional(), itemId: z.coerce.number().optional() })
      .parse(req.query);
    const params: unknown[] = [];
    const where: string[] = [];
    const dateCol = 'm.movement_date';
    if (f.from) where.push(`${dateCol} >= $${params.push(f.from)}`);
    if (f.to) where.push(`${dateCol} <= $${params.push(f.to)}`);
    if (f.kind === 'producto') {
      if (f.itemId) where.push(`m.product_id = $${params.push(f.itemId)}`);
      res.json(
        await query(
          `SELECT m.*, p.name AS item_name, 'pacas' AS unit, l.code AS lot_code, u.name AS user_name
           FROM product_movements m JOIN products p ON p.id = m.product_id LEFT JOIN lots l ON l.id = m.lot_id
           LEFT JOIN users u ON u.id = m.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
           ORDER BY m.movement_date DESC, m.id DESC LIMIT 3000`,
          params,
        ),
      );
    } else {
      if (f.itemId) where.push(`m.supply_id = $${params.push(f.itemId)}`);
      res.json(
        await query(
          `SELECT m.*, s.name AS item_name, s.unit, u.name AS user_name
           FROM supply_movements m JOIN supplies s ON s.id = m.supply_id LEFT JOIN users u ON u.id = m.user_id
           ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
           ORDER BY m.movement_date DESC, m.id DESC LIMIT 3000`,
          params,
        ),
      );
    }
  }),
);

/** Registrar movimiento manual de insumo: entrada (compra), ajuste o pérdida. */
inventoryRouter.post(
  '/supplies/movements',
  requireModule('inventario'),
  h(async (req, res) => {
    const d = z
      .object({
        supplyId: posInt,
        date: isoDate,
        type: z.enum(['entrada', 'ajuste', 'perdida', 'consumo']),
        quantity: z.coerce.number().finite(),
        reference: optText,
        notes: optText,
      })
      .parse(req.body);
    if (d.type !== 'ajuste' && d.quantity <= 0) throw badRequest('La cantidad debe ser mayor que cero.');
    const row = await withTransaction((db) => moveSupply(db, { ...d, userId: req.user!.id }));
    res.status(201).json(row);
  }),
);

/** Registrar movimiento manual de producto terminado: ajuste o pérdida. */
inventoryRouter.post(
  '/products/movements',
  requireModule('inventario'),
  h(async (req, res) => {
    const d = z
      .object({
        productId: posInt,
        date: isoDate,
        type: z.enum(['ajuste', 'perdida']),
        packs: z.coerce.number().int('debe ser un número entero de pacas'),
        reference: optText,
        notes: optText,
      })
      .parse(req.body);
    if (d.type === 'perdida' && d.packs <= 0) throw badRequest('La cantidad debe ser mayor que cero.');
    const row = await withTransaction((db) => moveProduct(db, { ...d, userId: req.user!.id }));
    res.status(201).json(row);
  }),
);

inventoryRouter.get(
  '/counts',
  h(async (_req, res) => {
    res.json(
      await query(
        `SELECT pc.*, COALESCE(p.name, s.name) AS item_name, COALESCE(s.unit, 'pacas') AS unit, u.name AS user_name
         FROM physical_counts pc LEFT JOIN products p ON p.id = pc.product_id LEFT JOIN supplies s ON s.id = pc.supply_id
         LEFT JOIN users u ON u.id = pc.user_id ORDER BY pc.count_date DESC, pc.id DESC LIMIT 1000`,
      ),
    );
  }),
);

/** Conteo físico (uno o varios ítems). Ajusta la existencia al valor contado. */
inventoryRouter.post(
  '/counts',
  requireModule('inventario'),
  h(async (req, res) => {
    const d = z
      .object({
        date: isoDate.default(todayISO(env.timezone)),
        itemType: z.enum(['producto', 'insumo']),
        notes: optText,
        items: z.array(z.object({ itemId: posInt, physicalQty: z.coerce.number().min(0, 'no puede ser negativo') })).min(1),
      })
      .parse(req.body);
    const ctx = await loadCostContext();
    const threshold = (await getSetting('operations')).countDiffThresholdPct;
    const results = await withTransaction(async (db) => {
      const out = [];
      for (const item of d.items) {
        if (d.itemType === 'producto' && !Number.isInteger(item.physicalQty)) throw badRequest('El conteo de pacas debe ser un número entero.');
        const unitValue =
          d.itemType === 'producto' ? productSummary(ctx, item.itemId).costPerPack : (ctx.supplies.get(item.itemId)?.current_cost ?? 0);
        out.push(
          await registerPhysicalCount(db, {
            itemType: d.itemType,
            itemId: item.itemId,
            date: d.date,
            physicalQty: item.physicalQty,
            unitValue,
            thresholdPct: threshold,
            notes: d.notes,
            userId: req.user!.id,
          }),
        );
      }
      return out;
    });
    res.status(201).json(results);
  }),
);
