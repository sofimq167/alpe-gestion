import { Router } from 'express';
import { z } from 'zod';
import { SUPPLY_CATEGORIES, todayISO } from '@alpe/shared';
import { env } from '../config/env';
import { query, queryOne, withTransaction } from '../database/pool';
import { requireModule } from '../middleware/auth';
import { loadCostContext, productsUsingSupply, supplyCostImpact } from '../services/costService';
import { moveSupply } from '../services/inventoryService';
import { changeProductPrice } from '../services/productService';
import { conflict, h, idParam, notFound } from '../utils/http';
import { money, optText } from '../utils/validators';

export const suppliesRouter = Router();

const supplySchema = z.object({
  code: optText,
  name: z.string().trim().min(1),
  category: z.enum(SUPPLY_CATEGORIES),
  unit: z.string().trim().min(1),
  supplier: optText,
  isInventoried: z.boolean().default(true),
  minStock: money.default(0),
  active: z.boolean().default(true),
  notes: optText,
});

suppliesRouter.get(
  '/',
  h(async (_req, res) => {
    const ctx = await loadCostContext();
    const rows = await query('SELECT * FROM supplies ORDER BY active DESC, category, name');
    res.json(
      rows.map((s) => {
        const used = productsUsingSupply(ctx, s.id);
        return { ...s, used_by: used.length, used_by_names: used.map((id) => ctx.products.get(id)?.name) };
      }),
    );
  }),
);

suppliesRouter.get(
  '/:id',
  h(async (req, res) => {
    const id = idParam(req);
    const supply = await queryOne('SELECT * FROM supplies WHERE id = $1', [id]);
    if (!supply) throw notFound('El insumo');
    const [history, movements] = await Promise.all([
      query(
        `SELECT h.*, u.name AS user_name FROM supply_cost_history h LEFT JOIN users u ON u.id = h.user_id
         WHERE supply_id = $1 ORDER BY changed_at DESC LIMIT 100`,
        [id],
      ),
      query(
        `SELECT m.*, u.name AS user_name FROM supply_movements m LEFT JOIN users u ON u.id = m.user_id
         WHERE supply_id = $1 ORDER BY movement_date DESC, id DESC LIMIT 100`,
        [id],
      ),
    ]);
    const ctx = await loadCostContext();
    res.json({ ...supply, history, movements, impact: supplyCostImpact(ctx, id, supply.current_cost) });
  }),
);

suppliesRouter.post(
  '/',
  requireModule('precios'),
  h(async (req, res) => {
    const data = supplySchema
      .extend({ currentCost: money, initialStock: money.default(0) })
      .parse(req.body);
    const row = await withTransaction(async (db) => {
      const s = await queryOne(
        `INSERT INTO supplies (code, name, category, unit, current_cost, supplier, is_inventoried, min_stock, active, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [data.code, data.name, data.category, data.unit, data.currentCost, data.supplier, data.isInventoried, data.minStock, data.active, data.notes],
        db,
      );
      await query('INSERT INTO supply_cost_history (supply_id, old_cost, new_cost, user_id, note) VALUES ($1,NULL,$2,$3,$4)', [
        s!.id,
        data.currentCost,
        req.user!.id,
        'Costo inicial',
      ], db);
      if (data.isInventoried && data.initialStock > 0) {
        await moveSupply(db, {
          supplyId: s!.id,
          date: todayISO(env.timezone),
          type: 'entrada',
          quantity: data.initialStock,
          reference: 'Saldo inicial',
          userId: req.user!.id,
        });
      }
      return s;
    });
    res.status(201).json(row);
  }),
);

suppliesRouter.put(
  '/:id',
  requireModule('precios'),
  h(async (req, res) => {
    const id = idParam(req);
    const data = supplySchema.parse(req.body);
    const row = await queryOne(
      `UPDATE supplies SET code=$1, name=$2, category=$3, unit=$4, supplier=$5, is_inventoried=$6, min_stock=$7, active=$8, notes=$9
       WHERE id=$10 RETURNING *`,
      [data.code, data.name, data.category, data.unit, data.supplier, data.isInventoried, data.minStock, data.active, data.notes, id],
    );
    if (!row) throw notFound('El insumo');
    res.json(row);
  }),
);

suppliesRouter.delete(
  '/:id',
  requireModule('precios'),
  h(async (req, res) => {
    const id = idParam(req);
    const used = await queryOne(
      `SELECT (SELECT COUNT(*) FROM supply_movements WHERE supply_id = $1)
            + (SELECT COUNT(*) FROM product_components WHERE supply_id = $1)
            + (SELECT COUNT(*) FROM blow_configs WHERE preform_supply_id = $1)
            + (SELECT COUNT(*) FROM production_consumptions WHERE supply_id = $1)
            + (SELECT COUNT(*) FROM maquila_service_items WHERE supply_id = $1) AS n`,
      [id],
    );
    if (Number(used.n) > 0) {
      throw conflict('Este insumo tiene movimientos o se usa en presentaciones. No se puede eliminar: desactívelo en su lugar.');
    }
    await query('DELETE FROM supplies WHERE id = $1', [id]);
    res.json({ ok: true });
  }),
);

/** Vista previa: qué presentaciones se afectan y cómo cambian costos y márgenes. */
suppliesRouter.post(
  '/:id/cost-preview',
  h(async (req, res) => {
    const id = idParam(req);
    const { newCost } = z.object({ newCost: money }).parse(req.body);
    const ctx = await loadCostContext();
    const supply = ctx.supplies.get(id);
    if (!supply) throw notFound('El insumo');
    const impact = supplyCostImpact(ctx, id, newCost);
    res.json({
      supply: { id, name: supply.name, unit: supply.unit, currentCost: supply.current_cost, newCost },
      affectedCount: impact.length,
      impact,
      belowMinimum: impact.filter((i) => i.statusAfter === 'bajo_minimo' && i.affectsCurrentCost).length,
    });
  }),
);

/** Confirma el cambio de costo; opcionalmente aplica el precio sugerido a algunas presentaciones. */
suppliesRouter.post(
  '/:id/cost',
  requireModule('precios'),
  h(async (req, res) => {
    const id = idParam(req);
    const data = z
      .object({ newCost: money, note: optText, applySuggestedTo: z.array(z.number().int()).default([]) })
      .parse(req.body);
    const result = await withTransaction(async (db) => {
      const supply = await queryOne('SELECT * FROM supplies WHERE id = $1 FOR UPDATE', [id], db);
      if (!supply) throw notFound('El insumo');
      if (supply.current_cost === data.newCost) throw conflict('El costo nuevo es igual al actual.');
      await query('UPDATE supplies SET current_cost = $1, cost_updated_at = now() WHERE id = $2', [data.newCost, id], db);
      await query(
        'INSERT INTO supply_cost_history (supply_id, old_cost, new_cost, user_id, note) VALUES ($1,$2,$3,$4,$5)',
        [id, supply.current_cost, data.newCost, req.user!.id, data.note],
        db,
      );
      const ctx = await loadCostContext(db);
      const impact = supplyCostImpact(ctx, id, data.newCost);
      const updatedPrices: string[] = [];
      for (const productId of data.applySuggestedTo) {
        const row = impact.find((i) => i.productId === productId);
        if (!row) continue;
        await changeProductPrice(db, productId, row.suggestedPricePack, `Precio sugerido tras cambio de costo de ${supply.name}`, req.user!.id);
        updatedPrices.push(row.name);
      }
      return { impact, updatedPrices };
    });
    res.json(result);
  }),
);
