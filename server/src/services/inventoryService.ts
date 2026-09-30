// Movimientos de inventario centralizados. Producción, despachos, conteos y ajustes pasan por aquí.
import {
  applyMovement,
  countDifference,
  type ProductMovementType,
  type SupplyMovementType,
} from '@alpe/shared';
import type { PoolClient } from 'pg';
import { queryOne, query } from '../database/pool';
import { notFound } from '../utils/http';

export interface SupplyMoveInput {
  supplyId: number;
  date: string;
  type: SupplyMovementType;
  quantity: number;
  reference?: string | null;
  notes?: string | null;
  productionId?: number | null;
  userId: number | null;
  allowNegative?: boolean;
  unitCost?: number | null;
}

/** Registra un movimiento de insumo y actualiza su existencia (dentro de una transacción). */
export async function moveSupply(db: PoolClient, input: SupplyMoveInput) {
  const supply = await queryOne<{ id: number; name: string; stock: number; current_cost: number }>(
    'SELECT id, name, stock, current_cost FROM supplies WHERE id = $1 FOR UPDATE',
    [input.supplyId],
    db,
  );
  if (!supply) throw notFound('El insumo');
  let result;
  try {
    result = applyMovement(supply.stock, input.type, input.quantity, { allowNegative: input.allowNegative });
  } catch (e) {
    if (e instanceof Error) e.message = `${supply.name}: ${e.message}`;
    throw e;
  }
  await query('UPDATE supplies SET stock = $1 WHERE id = $2', [result.stockAfter, supply.id], db);
  const row = await queryOne(
    `INSERT INTO supply_movements (supply_id, movement_date, type, quantity, stock_after, unit_cost, reference, notes, production_id, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      supply.id,
      input.date,
      input.type,
      result.delta,
      result.stockAfter,
      input.unitCost ?? supply.current_cost,
      input.reference ?? null,
      input.notes ?? null,
      input.productionId ?? null,
      input.userId,
    ],
    db,
  );
  return row;
}

export interface ProductMoveInput {
  productId: number;
  date: string;
  type: ProductMovementType;
  packs: number;
  lotId?: number | null;
  productionId?: number | null;
  dispatchId?: number | null;
  reference?: string | null;
  notes?: string | null;
  userId: number | null;
  allowNegative?: boolean;
}

/** Registra un movimiento de producto terminado (pacas) y actualiza la existencia. */
export async function moveProduct(db: PoolClient, input: ProductMoveInput) {
  const product = await queryOne<{ id: number; name: string; stock_packs: number }>(
    'SELECT id, name, stock_packs FROM products WHERE id = $1 FOR UPDATE',
    [input.productId],
    db,
  );
  if (!product) throw notFound('La presentación');
  let result;
  try {
    result = applyMovement(product.stock_packs, input.type, input.packs, { allowNegative: input.allowNegative });
  } catch (e) {
    if (e instanceof Error) e.message = `${product.name}: ${e.message}`;
    throw e;
  }
  await query('UPDATE products SET stock_packs = $1 WHERE id = $2', [result.stockAfter, product.id], db);
  return queryOne(
    `INSERT INTO product_movements (product_id, movement_date, type, packs, stock_after, lot_id, production_id, dispatch_id, reference, notes, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      product.id,
      input.date,
      input.type,
      result.delta,
      result.stockAfter,
      input.lotId ?? null,
      input.productionId ?? null,
      input.dispatchId ?? null,
      input.reference ?? null,
      input.notes ?? null,
      input.userId,
    ],
    db,
  );
}

/** Conteo físico: guarda el registro y ajusta la existencia a lo contado. */
export async function registerPhysicalCount(
  db: PoolClient,
  input: {
    itemType: 'producto' | 'insumo';
    itemId: number;
    date: string;
    physicalQty: number;
    unitValue: number;
    thresholdPct: number;
    notes?: string | null;
    userId: number | null;
  },
) {
  const current =
    input.itemType === 'producto'
      ? await queryOne<{ qty: number }>('SELECT stock_packs AS qty FROM products WHERE id = $1 FOR UPDATE', [input.itemId], db)
      : await queryOne<{ qty: number }>('SELECT stock AS qty FROM supplies WHERE id = $1 FOR UPDATE', [input.itemId], db);
  if (!current) throw notFound(input.itemType === 'producto' ? 'La presentación' : 'El insumo');
  const diff = countDifference(current.qty, input.physicalQty, input.unitValue, input.thresholdPct);
  const count = await queryOne(
    `INSERT INTO physical_counts (count_date, item_type, product_id, supply_id, system_qty, physical_qty, difference, unit_value, difference_value, notes, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      input.date,
      input.itemType,
      input.itemType === 'producto' ? input.itemId : null,
      input.itemType === 'insumo' ? input.itemId : null,
      diff.systemQty,
      diff.physicalQty,
      diff.difference,
      input.unitValue,
      diff.differenceValue,
      input.notes ?? null,
      input.userId,
    ],
    db,
  );
  if (diff.difference !== 0) {
    const common = { date: input.date, reference: `Conteo físico #${count!.id}`, notes: input.notes, userId: input.userId };
    if (input.itemType === 'producto') {
      await moveProduct(db, { ...common, productId: input.itemId, type: 'conteo', packs: input.physicalQty });
    } else {
      await moveSupply(db, { ...common, supplyId: input.itemId, type: 'conteo', quantity: input.physicalQty });
    }
  }
  return { ...count, relevant: diff.relevant, differencePct: diff.differencePct };
}
