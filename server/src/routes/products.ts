import { Router } from 'express';
import { z } from 'zod';
import { COMPONENT_ROLES, todayISO } from '@alpe/shared';
import { env } from '../config/env';
import { query, queryOne, withTransaction } from '../database/pool';
import { requireModule } from '../middleware/auth';
import { loadCostContext, productCalculation, productSummary } from '../services/costService';
import { moveProduct } from '../services/inventoryService';
import { changeProductPrice } from '../services/productService';
import { badRequest, h, idParam, notFound } from '../utils/http';
import { money, nonNegInt, optText, pct, posInt } from '../utils/validators';

export const productsRouter = Router();

const productSchema = z
  .object({
    code: optText,
    name: z.string().trim().min(1),
    volumeMl: posInt,
    unitsPerPack: posInt,
    packsPerPallet: posInt,
    weightKgPack: z.coerce.number().min(0).optional().nullable(),
    active: z.boolean().default(true),
    minMargin: pct,
    targetMargin: pct,
    useBlown: z.boolean().default(false),
    stdLaborPerUnit: money.default(0),
    stdEnergyPerUnit: money.default(0),
    minStockPacks: nonNegInt.default(0),
    notes: optText,
  })
  .refine((d) => d.minMargin <= d.targetMargin, { message: 'El margen mínimo no puede ser mayor que el margen objetivo.', path: ['minMargin'] });

const componentsSchema = z.array(
  z.object({
    supplyId: posInt,
    role: z.enum(COMPONENT_ROLES),
    quantity: z.coerce.number().positive('debe ser mayor que cero'),
    basis: z.enum(['unidad', 'paca', 'estiba']),
  }),
);

productsRouter.get(
  '/',
  h(async (_req, res) => {
    const ctx = await loadCostContext();
    res.json({
      admin: ctx.admin,
      products: [...ctx.products.values()].map((p) => productSummary(ctx, p.id)),
    });
  }),
);

productsRouter.get(
  '/:id',
  h(async (req, res) => {
    const id = idParam(req);
    const ctx = await loadCostContext();
    if (!ctx.products.has(id)) throw notFound('La presentación');
    const [components, blow, history] = await Promise.all([
      query(
        `SELECT pc.*, s.name AS supply_name, s.unit, s.current_cost, s.category FROM product_components pc
         JOIN supplies s ON s.id = pc.supply_id WHERE pc.product_id = $1 ORDER BY pc.id`,
        [id],
      ),
      queryOne('SELECT * FROM blow_configs WHERE product_id = $1', [id]),
      query(
        `SELECT h.*, u.name AS user_name FROM product_price_history h LEFT JOIN users u ON u.id = h.user_id
         WHERE product_id = $1 ORDER BY changed_at DESC LIMIT 50`,
        [id],
      ),
    ]);
    res.json({ ...productCalculation(ctx, id), components, blowRaw: blow, priceHistory: history });
  }),
);

productsRouter.post(
  '/',
  requireModule('precios'),
  h(async (req, res) => {
    const data = productSchema.parse(req.body);
    const extra = z
      .object({ listPricePack: money.default(0), components: componentsSchema.default([]), initialStock: nonNegInt.default(0) })
      .parse(req.body);
    const row = await withTransaction(async (db) => {
      const p = await queryOne(
        `INSERT INTO products (code, name, volume_ml, units_per_pack, packs_per_pallet, weight_kg_pack, active, min_margin, target_margin,
           use_blown, std_labor_per_unit, std_energy_per_unit, min_stock_packs, notes, list_price_pack)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          data.code,
          data.name,
          data.volumeMl,
          data.unitsPerPack,
          data.packsPerPallet,
          data.weightKgPack ?? null,
          data.active,
          data.minMargin,
          data.targetMargin,
          false,
          data.stdLaborPerUnit,
          data.stdEnergyPerUnit,
          data.minStockPacks,
          data.notes,
          extra.listPricePack,
        ],
        db,
      );
      for (const c of extra.components) {
        await query('INSERT INTO product_components (product_id, supply_id, role, quantity, basis) VALUES ($1,$2,$3,$4,$5)', [
          p!.id,
          c.supplyId,
          c.role,
          c.quantity,
          c.basis,
        ], db);
      }
      if (extra.listPricePack > 0) {
        await query('INSERT INTO product_price_history (product_id, old_price, new_price, user_id, reason) VALUES ($1,NULL,$2,$3,$4)', [
          p!.id,
          extra.listPricePack,
          req.user!.id,
          'Precio inicial',
        ], db);
      }
      if (extra.initialStock > 0) {
        await moveProduct(db, {
          productId: p!.id,
          date: todayISO(env.timezone),
          type: 'ajuste',
          packs: extra.initialStock,
          reference: 'Saldo inicial',
          userId: req.user!.id,
        });
      }
      return p;
    });
    res.status(201).json(row);
  }),
);

productsRouter.put(
  '/:id',
  requireModule('precios'),
  h(async (req, res) => {
    const id = idParam(req);
    const data = productSchema.parse(req.body);
    if (data.useBlown) {
      const blow = await queryOne('SELECT 1 FROM blow_configs WHERE product_id = $1', [id]);
      if (!blow) throw badRequest('Configure primero el escenario de soplado de esta presentación.');
    }
    const row = await queryOne(
      `UPDATE products SET code=$1, name=$2, volume_ml=$3, units_per_pack=$4, packs_per_pallet=$5, weight_kg_pack=$6, active=$7,
         min_margin=$8, target_margin=$9, use_blown=$10, std_labor_per_unit=$11, std_energy_per_unit=$12, min_stock_packs=$13, notes=$14
       WHERE id=$15 RETURNING *`,
      [
        data.code,
        data.name,
        data.volumeMl,
        data.unitsPerPack,
        data.packsPerPallet,
        data.weightKgPack ?? null,
        data.active,
        data.minMargin,
        data.targetMargin,
        data.useBlown,
        data.stdLaborPerUnit,
        data.stdEnergyPerUnit,
        data.minStockPacks,
        data.notes,
        id,
      ],
    );
    if (!row) throw notFound('La presentación');
    res.json(row);
  }),
);

/** Activa o desactiva el uso de envase soplado internamente. */
productsRouter.put(
  '/:id/use-blown',
  requireModule('precios'),
  h(async (req, res) => {
    const id = idParam(req);
    const { useBlown } = z.object({ useBlown: z.boolean() }).parse(req.body);
    if (useBlown && !(await queryOne('SELECT 1 FROM blow_configs WHERE product_id = $1', [id]))) {
      throw badRequest('Configure primero el escenario de soplado de esta presentación.');
    }
    await query('UPDATE products SET use_blown = $1 WHERE id = $2', [useBlown, id]);
    res.json({ ok: true });
  }),
);

productsRouter.put(
  '/:id/components',
  requireModule('precios'),
  h(async (req, res) => {
    const id = idParam(req);
    const components = componentsSchema.parse(req.body.components);
    const ids = components.map((c) => c.supplyId);
    if (new Set(ids).size !== ids.length) throw badRequest('Hay insumos repetidos en la estructura de costos.');
    await withTransaction(async (db) => {
      await query('DELETE FROM product_components WHERE product_id = $1', [id], db);
      for (const c of components) {
        await query('INSERT INTO product_components (product_id, supply_id, role, quantity, basis) VALUES ($1,$2,$3,$4,$5)', [
          id,
          c.supplyId,
          c.role,
          c.quantity,
          c.basis,
        ], db);
      }
    });
    res.json({ ok: true });
  }),
);

productsRouter.put(
  '/:id/blow',
  requireModule('precios'),
  h(async (req, res) => {
    const id = idParam(req);
    if (req.body === null || req.body?.remove) {
      await query('UPDATE products SET use_blown = FALSE WHERE id = $1', [id]);
      await query('DELETE FROM blow_configs WHERE product_id = $1', [id]);
      return res.json({ ok: true });
    }
    const data = z
      .object({
        preformSupplyId: posInt,
        energyPerUnit: money,
        laborPerUnit: money,
        wastePct: z.coerce.number().min(0).max(0.5, 'el desperdicio no puede superar 50%'),
        overheadPerUnit: money,
        notes: optText,
      })
      .parse(req.body);
    await query(
      `INSERT INTO blow_configs (product_id, preform_supply_id, energy_per_unit, labor_per_unit, waste_pct, overhead_per_unit, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (product_id) DO UPDATE SET preform_supply_id=$2, energy_per_unit=$3, labor_per_unit=$4, waste_pct=$5, overhead_per_unit=$6, notes=$7`,
      [id, data.preformSupplyId, data.energyPerUnit, data.laborPerUnit, data.wastePct, data.overheadPerUnit, data.notes],
    );
    res.json({ ok: true });
  }),
);

productsRouter.put(
  '/:id/price',
  requireModule('precios'),
  h(async (req, res) => {
    const id = idParam(req);
    const { price, reason } = z.object({ price: z.coerce.number().positive('debe ser mayor que cero'), reason: optText }).parse(req.body);
    const row = await withTransaction((db) => changeProductPrice(db, id, Math.round(price), reason, req.user!.id));
    res.json(row);
  }),
);

/** "Recalcular precios": aplica el precio sugerido (margen objetivo) a las presentaciones indicadas. */
productsRouter.post(
  '/apply-suggested',
  requireModule('precios'),
  h(async (req, res) => {
    const { productIds } = z.object({ productIds: z.array(z.number().int()).min(1, 'Seleccione al menos una presentación') }).parse(req.body);
    const changed = await withTransaction(async (db) => {
      const ctx = await loadCostContext(db);
      const out: { id: number; name: string; oldPrice: number; newPrice: number }[] = [];
      for (const id of productIds) {
        if (!ctx.products.has(id)) continue;
        const s = productSummary(ctx, id);
        if (s.suggestedPricePack !== s.listPricePack) {
          await changeProductPrice(db, id, s.suggestedPricePack, 'Precio recalculado según margen objetivo', req.user!.id);
          out.push({ id, name: s.name, oldPrice: s.listPricePack, newPrice: s.suggestedPricePack });
        }
      }
      return out;
    });
    res.json({ changed });
  }),
);

/** Simulador: costos y márgenes con valores hipotéticos (no guarda nada). */
productsRouter.post(
  '/simulate',
  h(async (req, res) => {
    const data = z
      .object({
        supplyCosts: z.record(z.string(), money).default({}),
        laborChangePct: z.coerce.number().min(-0.9).max(5).default(0),
        energyChangePct: z.coerce.number().min(-0.9).max(5).default(0),
        forceBlown: z.boolean().optional(),
      })
      .parse(req.body);
    const ctx = await loadCostContext();
    const overrides = new Map(Object.entries(data.supplyCosts).map(([k, v]) => [Number(k), v]));
    const rows = [...ctx.products.values()]
      .filter((p) => p.active)
      .map((p) => {
        const before = productSummary(ctx, p.id);
        const labor = (ctx.laborReal.get(p.id)?.perUnit ?? p.std_labor_per_unit) * (1 + data.laborChangePct);
        const energy = (ctx.energyReal.get(p.id)?.perUnit ?? p.std_energy_per_unit) * (1 + data.energyChangePct);
        const after = productSummary(ctx, p.id, {
          supplyOverrides: overrides,
          laborOverride: labor,
          energyOverride: energy,
          useBlown: data.forceBlown === undefined ? undefined : data.forceBlown && ctx.blow.has(p.id),
        });
        return {
          productId: p.id,
          name: p.name,
          listPricePack: p.list_price_pack,
          costPerPackBefore: before.costPerPack,
          costPerPackAfter: after.costPerPack,
          marginBefore: before.marginPct,
          marginAfter: after.marginPct,
          suggestedPricePack: after.suggestedPricePack,
          minMargin: p.min_margin,
          statusAfter: after.status,
        };
      });
    res.json({ rows });
  }),
);
