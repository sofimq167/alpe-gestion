// Producción por lote y turno: aumenta producto terminado, descuenta insumos y calcula el costo real.
import { addDays, formatNumber, productionMetrics, theoreticalConsumption } from '@alpe/shared';
import type { PoolClient } from 'pg';
import { query, queryOne, pool, withTransaction, type Db } from '../database/pool';
import { badRequest, conflict, notFound, WarningsError } from '../utils/http';
import { moveProduct, moveSupply } from './inventoryService';
import { getSetting } from './settingsService';

export interface ConsumptionLine {
  supplyId: number;
  name: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  inventoried: boolean;
  stock: number;
}

interface Target {
  kind: 'producto' | 'maquila';
  id: number;
  name: string;
  code: string;
  unitsPerPack: number;
  packsPerPallet: number;
  clientId: number | null;
}

async function loadTarget(db: Db, productId?: number | null, maquilaServiceId?: number | null): Promise<Target> {
  if (productId) {
    const p = await queryOne('SELECT * FROM products WHERE id = $1', [productId], db);
    if (!p) throw notFound('La presentación');
    return {
      kind: 'producto',
      id: p.id,
      name: p.name,
      code: p.code ?? `P${p.id}`,
      unitsPerPack: p.units_per_pack,
      packsPerPallet: p.packs_per_pallet,
      clientId: null,
    };
  }
  if (maquilaServiceId) {
    const s = await queryOne('SELECT * FROM maquila_services WHERE id = $1', [maquilaServiceId], db);
    if (!s) throw notFound('El servicio de maquila');
    return {
      kind: 'maquila',
      id: s.id,
      name: s.name,
      code: `MQ${s.id}`,
      unitsPerPack: s.units_per_pack,
      packsPerPallet: 100,
      clientId: s.client_id,
    };
  }
  throw badRequest('Seleccione una presentación o un servicio de maquila.');
}

/** Consumo teórico de insumos según la receta (o los materiales que aporta la empresa en maquila). */
export async function suggestConsumption(
  params: { productId?: number | null; maquilaServiceId?: number | null; packs: number; defectiveUnits: number },
  db: Db = pool,
): Promise<ConsumptionLine[]> {
  const target = await loadTarget(db, params.productId, params.maquilaServiceId);
  const packaging = { unitsPerPack: target.unitsPerPack, packsPerPallet: target.packsPerPallet };
  const goodUnits = params.packs * target.unitsPerPack;
  const lines: { supplyId: number; quantity: number }[] = [];

  if (target.kind === 'producto') {
    const product = await queryOne('SELECT use_blown FROM products WHERE id = $1', [target.id], db);
    const blow = await queryOne('SELECT * FROM blow_configs WHERE product_id = $1', [target.id], db);
    const components = await query('SELECT * FROM product_components WHERE product_id = $1 ORDER BY id', [target.id], db);
    for (const c of components) {
      if (c.role === 'envase' && product?.use_blown && blow) {
        lines.push({
          supplyId: blow.preform_supply_id,
          quantity: (goodUnits + params.defectiveUnits) / (1 - blow.waste_pct),
        });
        continue;
      }
      lines.push({
        supplyId: c.supply_id,
        quantity: theoreticalConsumption(c.quantity, c.basis, packaging, goodUnits, params.defectiveUnits),
      });
    }
  } else {
    const items = await query(
      'SELECT * FROM maquila_service_items WHERE service_id = $1 AND NOT client_provides ORDER BY id',
      [target.id],
      db,
    );
    for (const i of items) {
      lines.push({
        supplyId: i.supply_id,
        quantity: theoreticalConsumption(i.quantity, i.basis, packaging, goodUnits, params.defectiveUnits),
      });
    }
  }

  if (lines.length === 0) return [];
  const supplies = await query('SELECT * FROM supplies WHERE id = ANY($1::int[])', [lines.map((l) => l.supplyId)], db);
  const byId = new Map(supplies.map((s) => [s.id, s]));
  return lines.map((l) => {
    const s = byId.get(l.supplyId)!;
    const quantity = Math.round(l.quantity * 1000) / 1000;
    return {
      supplyId: s.id,
      name: s.name,
      unit: s.unit,
      quantity,
      unitCost: s.current_cost,
      totalCost: quantity * s.current_cost,
      inventoried: s.is_inventoried,
      stock: s.stock,
    };
  });
}

export interface ProductionInput {
  date: string;
  shift: string;
  productId?: number | null;
  maquilaServiceId?: number | null;
  packs: number;
  defectiveUnits: number;
  workers: number;
  hours: number;
  laborCost: number;
  energyKwh: number;
  energyCost: number;
  responsible?: string | null;
  notes?: string | null;
  lotCode?: string | null;
  consumptions?: { supplyId: number; quantity: number }[];
  confirmWarnings?: boolean;
}

async function nextLotCode(db: PoolClient, date: string, code: string): Promise<string> {
  const base = `L${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${code}`;
  const row = await queryOne<{ n: number }>('SELECT COUNT(*)::int AS n FROM lots WHERE code LIKE $1', [`${base}%`], db);
  const n = (row?.n ?? 0) + 1;
  return n === 1 ? base : `${base}-${n}`;
}

export async function createProduction(input: ProductionInput, userId: number | null) {
  if (input.packs <= 0) throw badRequest('Las pacas producidas deben ser mayores que cero.');
  return withTransaction(async (db) => {
    const target = await loadTarget(db, input.productId, input.maquilaServiceId);
    const goodUnits = input.packs * target.unitsPerPack;
    const suggested = await suggestConsumption(
      { productId: input.productId, maquilaServiceId: input.maquilaServiceId, packs: input.packs, defectiveUnits: input.defectiveUnits },
      db,
    );
    // Si el usuario ajustó cantidades, se respetan; si no, se usa el consumo teórico.
    let lines = suggested;
    if (input.consumptions && input.consumptions.length > 0) {
      const supplies = await query('SELECT * FROM supplies WHERE id = ANY($1::int[])', [input.consumptions.map((c) => c.supplyId)], db);
      const byId = new Map(supplies.map((s) => [s.id, s]));
      lines = input.consumptions
        .filter((c) => c.quantity > 0)
        .map((c) => {
          const s = byId.get(c.supplyId);
          if (!s) throw notFound('Un insumo del consumo');
          return {
            supplyId: s.id,
            name: s.name,
            unit: s.unit,
            quantity: c.quantity,
            unitCost: s.current_cost,
            totalCost: c.quantity * s.current_cost,
            inventoried: s.is_inventoried,
            stock: s.stock,
          };
        });
    }

    const shortages = lines.filter((l) => l.inventoried && l.quantity > l.stock);
    if (shortages.length > 0 && !input.confirmWarnings) {
      throw new WarningsError(
        shortages.map(
          (s) => `${s.name}: se consumen ${formatNumber(s.quantity, 2)} ${s.unit} y la existencia es ${formatNumber(s.stock, 2)}. El inventario quedará negativo.`,
        ),
      );
    }

    const materialsCost = lines.reduce((s, l) => s + l.totalCost, 0);
    const metrics = productionMetrics({
      goodUnits,
      defectiveUnits: input.defectiveUnits,
      unitsPerPack: target.unitsPerPack,
      materialsCost,
      laborCost: input.laborCost,
      energyCost: input.energyCost,
    });

    const lotCode = input.lotCode?.trim() || (await nextLotCode(db, input.date, target.code));
    const existing = await queryOne('SELECT id FROM lots WHERE code = $1', [lotCode], db);
    if (existing) throw conflict(`Ya existe el lote ${lotCode}. Use otro código o deje el campo vacío para generarlo automáticamente.`);
    const shelfLife = (await getSetting('production', db)).shelfLifeDays;
    const lot = await queryOne(
      `INSERT INTO lots (code, product_id, maquila_service_id, client_id, is_maquila, production_date, expiry_date, packs_produced, packs_remaining)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
      [
        lotCode,
        target.kind === 'producto' ? target.id : null,
        target.kind === 'maquila' ? target.id : null,
        target.clientId,
        target.kind === 'maquila',
        input.date,
        addDays(input.date, shelfLife),
        input.packs,
      ],
      db,
    );

    const run = await queryOne(
      `INSERT INTO production_runs (run_date, shift, product_id, maquila_service_id, is_maquila, lot_id, packs_produced, good_units, defective_units,
         workers, hours, labor_cost, energy_kwh, energy_cost, materials_cost, total_cost, cost_per_unit, cost_per_pack, yield_pct, waste_pct,
         responsible, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
      [
        input.date,
        input.shift,
        target.kind === 'producto' ? target.id : null,
        target.kind === 'maquila' ? target.id : null,
        target.kind === 'maquila',
        lot!.id,
        input.packs,
        goodUnits,
        input.defectiveUnits,
        input.workers,
        input.hours,
        input.laborCost,
        input.energyKwh,
        input.energyCost,
        materialsCost,
        metrics.totalCost,
        metrics.costPerUnit,
        metrics.costPerPack,
        metrics.yieldPct,
        metrics.wastePct,
        input.responsible ?? null,
        input.notes ?? null,
        userId,
      ],
      db,
    );

    for (const l of lines) {
      await query(
        `INSERT INTO production_consumptions (production_id, supply_id, quantity, unit_cost, total_cost, inventoried)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [run!.id, l.supplyId, l.quantity, l.unitCost, l.totalCost, l.inventoried],
        db,
      );
      if (l.inventoried && l.quantity > 0) {
        await moveSupply(db, {
          supplyId: l.supplyId,
          date: input.date,
          type: 'consumo',
          quantity: l.quantity,
          reference: `Producción lote ${lotCode}`,
          productionId: run!.id,
          userId,
          allowNegative: true,
        });
      }
    }

    if (target.kind === 'producto') {
      await moveProduct(db, {
        productId: target.id,
        date: input.date,
        type: 'produccion',
        packs: input.packs,
        lotId: lot!.id,
        productionId: run!.id,
        reference: `Lote ${lotCode}`,
        userId,
      });
    }
    return { ...run, lot_code: lotCode, metrics };
  });
}

/** Anula una producción que aún no se ha despachado: revierte inventario de producto e insumos. */
export async function annulProduction(id: number, userId: number | null, reason: string | null) {
  return withTransaction(async (db) => {
    const run = await queryOne('SELECT * FROM production_runs WHERE id = $1 FOR UPDATE', [id], db);
    if (!run) throw notFound('La producción');
    if (run.status === 'anulada') throw conflict('Esta producción ya fue anulada.');
    const lot = await queryOne('SELECT * FROM lots WHERE id = $1 FOR UPDATE', [run.lot_id], db);
    if (lot.packs_remaining < lot.packs_produced) {
      throw conflict('No se puede anular: parte de este lote ya fue despachado. Anule primero los despachos asociados.');
    }
    const today = run.run_date;
    const ref = `Anulación producción lote ${lot.code}`;
    if (run.product_id) {
      await moveProduct(db, {
        productId: run.product_id,
        date: today,
        type: 'ajuste',
        packs: -run.packs_produced,
        lotId: lot.id,
        productionId: run.id,
        reference: ref,
        notes: reason,
        userId,
        allowNegative: true,
      });
    }
    const consumptions = await query('SELECT * FROM production_consumptions WHERE production_id = $1 AND inventoried', [id], db);
    for (const c of consumptions) {
      if (c.quantity > 0) {
        await moveSupply(db, {
          supplyId: c.supply_id,
          date: today,
          type: 'ajuste',
          quantity: c.quantity,
          reference: ref,
          notes: reason,
          productionId: run.id,
          userId,
        });
      }
    }
    await query('UPDATE lots SET packs_remaining = 0 WHERE id = $1', [lot.id], db);
    await query(
      `UPDATE production_runs SET status = 'anulada', notes = COALESCE(notes || ' | ', '') || $2 WHERE id = $1`,
      [id, `Anulada: ${reason ?? 'sin motivo'}`],
      db,
    );
    return { ok: true };
  });
}
