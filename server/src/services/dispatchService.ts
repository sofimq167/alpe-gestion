// Despachos: descuentan inventario, asignan lotes, actualizan el pedido y generan la cuenta por cobrar.
import { allocateLots, computeOrderTotals, formatNumber } from '@alpe/shared';
import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../database/pool';
import { badRequest, conflict, notFound, WarningsError } from '../utils/http';
import { loadCostContext, productCost } from './costService';
import { moveProduct } from './inventoryService';
import { loadMaquilaService } from './maquilaService';
import { refreshOrderStatus } from './orderService';
import { loadClientPricing, quoteOrder } from './pricingService';
import { createReceivable } from './receivableService';

interface CommonDispatchInput {
  date: string;
  destination?: string | null;
  vehicle?: string | null;
  driver?: string | null;
  remissionNumber?: string | null;
  notes?: string | null;
  paymentMode: 'credito' | 'contado';
  paymentMethod?: string;
  confirmWarnings?: boolean;
}

export interface SaleDispatchInput extends CommonDispatchInput {
  orderId?: number | null;
  clientId?: number | null;
  items: { productId: number; packs: number; lotId?: number | null }[];
}

export interface MaquilaDispatchInput extends CommonDispatchInput {
  maquilaServiceId: number;
  packs: number;
  lotId?: number | null;
}

interface PreparedLine {
  productId: number;
  orderItemId: number | null;
  description: string;
  packs: number;
  units: number;
  pricePack: number;
  lineTotal: number;
  grossTotal: number;
  discountAmount: number;
  unitCostPack: number;
  costTotal: number;
  lotId?: number | null;
}

async function remissionNumber(db: PoolClient, provided?: string | null): Promise<string> {
  if (provided && provided.trim()) {
    const dup = await queryOne(`SELECT id FROM dispatches WHERE remission_number = $1 AND status = 'confirmado'`, [provided.trim()], db);
    if (dup) throw conflict(`Ya existe un despacho con la remisión ${provided.trim()}.`);
    return provided.trim();
  }
  const row = await queryOne<{ n: number }>(`SELECT nextval('remission_number_seq')::int AS n`, [], db);
  return `REM-${row!.n}`;
}

async function insertDispatch(
  db: PoolClient,
  base: CommonDispatchInput & {
    kind: 'venta' | 'maquila';
    orderId: number | null;
    clientId: number;
    maquilaServiceId: number | null;
    remission: string;
    totals: { productsTotal: number; freightCharge: number; freightCost: number; total: number; costTotal: number; packs: number };
    warnings: string[];
  },
  userId: number | null,
) {
  return queryOne(
    `INSERT INTO dispatches (kind, dispatch_date, order_id, client_id, maquila_service_id, remission_number, destination, vehicle, driver,
       notes, payment_mode, products_total, freight_charge, freight_cost, total, cost_total, packs_total, warnings_accepted, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [
      base.kind,
      base.date,
      base.orderId,
      base.clientId,
      base.maquilaServiceId,
      base.remission,
      base.destination ?? null,
      base.vehicle ?? null,
      base.driver ?? null,
      base.notes ?? null,
      base.paymentMode,
      base.totals.productsTotal,
      base.totals.freightCharge,
      base.totals.freightCost,
      base.totals.total,
      base.totals.costTotal,
      base.totals.packs,
      base.warnings.length ? base.warnings.join(' | ') : null,
      userId,
    ],
    db,
  );
}

async function insertItemWithLots(
  db: PoolClient,
  dispatchId: number,
  line: PreparedLine,
  lots: { lotId: number; code: string; packsRemaining: number }[],
) {
  const item = await queryOne(
    `INSERT INTO dispatch_items (dispatch_id, product_id, order_item_id, description, packs, units, price_pack, line_total, unit_cost_pack, cost_total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      dispatchId,
      line.productId || null,
      line.orderItemId,
      line.description,
      line.packs,
      line.units,
      line.pricePack,
      line.lineTotal,
      line.unitCostPack,
      line.costTotal,
    ],
    db,
  );
  const { allocations } = allocateLots(lots, line.packs, line.lotId);
  for (const a of allocations) {
    await query('INSERT INTO dispatch_item_lots (dispatch_item_id, lot_id, packs) VALUES ($1,$2,$3)', [item!.id, a.lotId, a.packs], db);
    await query('UPDATE lots SET packs_remaining = packs_remaining - $2 WHERE id = $1', [a.lotId, a.packs], db);
  }
  return { item, allocations };
}

async function availableLots(db: PoolClient, column: 'product_id' | 'maquila_service_id', id: number) {
  const rows = await query(
    `SELECT id, code, packs_remaining FROM lots WHERE ${column} = $1 AND packs_remaining > 0
     ORDER BY production_date, id FOR UPDATE`,
    [id],
    db,
  );
  return rows.map((r) => ({ lotId: r.id, code: r.code, packsRemaining: r.packs_remaining }));
}

/** Despacho de venta: desde un pedido o directo. */
export async function createSaleDispatch(input: SaleDispatchInput, userId: number | null) {
  if (!input.items.length || input.items.every((i) => i.packs <= 0)) throw badRequest('Indique al menos un producto con cantidad.');
  return withTransaction(async (db) => {
    const ctx = await loadCostContext(db);
    const warnings: string[] = [];
    let clientId: number;
    let orderId: number | null = null;
    let lines: PreparedLine[];
    let freightIncluded: boolean;
    let freightRate: number;
    let termDays: number;

    const items = input.items.filter((i) => i.packs > 0);

    if (input.orderId) {
      const order = await queryOne('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [input.orderId], db);
      if (!order) throw notFound('El pedido');
      if (order.status === 'cancelado') throw conflict('El pedido está cancelado.');
      if (order.status === 'despachado') throw conflict('El pedido ya fue despachado completamente.');
      clientId = order.client_id;
      orderId = order.id;
      freightIncluded = order.freight_included;
      freightRate = order.freight_rate_pack;
      termDays = order.payment_term_days;
      const orderItems = await query(
        `SELECT oi.*, p.name AS product_name FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1 FOR UPDATE OF oi`,
        [order.id],
        db,
      );
      lines = items.map((i) => {
        const oi = orderItems.find((x) => x.product_id === i.productId);
        if (!oi) throw badRequest('Uno de los productos no pertenece al pedido.');
        const pending = oi.packs - oi.packs_dispatched;
        if (i.packs > pending) {
          throw badRequest(`${oi.product_name}: quedan ${pending} pacas pendientes por despachar en el pedido.`);
        }
        const cost = productCost(ctx, i.productId);
        const unitCostPack = Math.round(cost.costPerPack * 100) / 100;
        return {
          productId: i.productId,
          orderItemId: oi.id,
          description: oi.product_name,
          packs: i.packs,
          units: i.packs * oi.units_per_pack,
          pricePack: oi.net_price_pack,
          lineTotal: oi.net_price_pack * i.packs,
          grossTotal: oi.list_price_pack * i.packs,
          discountAmount: (oi.list_price_pack - oi.net_price_pack) * i.packs,
          unitCostPack,
          costTotal: unitCostPack * i.packs,
          lotId: i.lotId,
        };
      });
    } else {
      if (!input.clientId) throw badRequest('Seleccione el cliente o un pedido.');
      const cp = await loadClientPricing(input.clientId, db);
      if (cp.client.status !== 'activo') throw badRequest(`El cliente está ${cp.client.status}.`);
      clientId = cp.client.id;
      freightIncluded = cp.client.freight_included;
      freightRate = cp.client.freight_rate_pack;
      termDays = cp.client.payment_term_days;
      const quote = quoteOrder(
        ctx,
        cp,
        items.map((i) => ({ productId: i.productId, packs: i.packs })),
        input.date,
      );
      warnings.push(...quote.warnings);
      lines = quote.lines.map((l) => ({
        productId: l.productId,
        orderItemId: null,
        description: l.productName,
        packs: l.packs,
        units: l.units,
        pricePack: l.netPricePack,
        lineTotal: l.lineTotal,
        grossTotal: l.grossTotal,
        discountAmount: l.discountAmount,
        unitCostPack: l.unitCostPack,
        costTotal: l.costTotal,
        lotId: items.find((i) => i.productId === l.productId)?.lotId,
      }));
    }

    // Validación de existencia
    for (const l of lines) {
      const p = ctx.products.get(l.productId)!;
      const stock = (await queryOne<{ s: number }>('SELECT stock_packs AS s FROM products WHERE id = $1', [l.productId], db))!.s;
      if (l.packs > stock) {
        warnings.push(
          `${p.name}: se despachan ${formatNumber(l.packs)} pacas y en inventario hay ${formatNumber(stock)}. El inventario quedará negativo.`,
        );
      }
    }
    if (warnings.length > 0 && !input.confirmWarnings) throw new WarningsError(warnings);

    const totals = computeOrderTotals({
      lines: lines.map((l) => ({ ...l })),
      freightIncluded,
      freightRatePack: freightRate,
    });
    const remission = await remissionNumber(db, input.remissionNumber);
    const dispatch = await insertDispatch(
      db,
      {
        ...input,
        kind: 'venta',
        orderId,
        clientId,
        maquilaServiceId: null,
        remission,
        totals,
        warnings,
      },
      userId,
    );

    for (const l of lines) {
      const lots = await availableLots(db, 'product_id', l.productId);
      await insertItemWithLots(db, dispatch!.id, l, lots);
      await moveProduct(db, {
        productId: l.productId,
        date: input.date,
        type: 'despacho',
        packs: l.packs,
        dispatchId: dispatch!.id,
        reference: `Despacho ${dispatch!.number} · Remisión ${remission}`,
        userId,
        allowNegative: true,
      });
      if (l.orderItemId) {
        await query('UPDATE order_items SET packs_dispatched = packs_dispatched + $2 WHERE id = $1', [l.orderItemId, l.packs], db);
      }
    }
    if (orderId) await refreshOrderStatus(db, orderId);

    const receivable = await createReceivable(db, {
      clientId,
      dispatchId: dispatch!.id,
      orderId,
      documentNumber: remission,
      issueDate: input.date,
      termDays: input.paymentMode === 'contado' ? 0 : termDays,
      amount: totals.total,
      paidNow: input.paymentMode === 'contado',
      paymentMethod: input.paymentMethod,
      userId,
    });
    return { dispatch, receivable };
  });
}

/** Despacho de maquila: sale de los lotes de maquila del cliente, no del inventario de venta. */
export async function createMaquilaDispatch(input: MaquilaDispatchInput, userId: number | null) {
  if (!Number.isInteger(input.packs) || input.packs <= 0) throw badRequest('Las pacas deben ser un número entero mayor que cero.');
  return withTransaction(async (db) => {
    const service = await loadMaquilaService(input.maquilaServiceId, db);
    const lots = await availableLots(db, 'maquila_service_id', service.id);
    const available = lots.reduce((s, l) => s + l.packsRemaining, 0);
    if (input.packs > available) {
      throw badRequest(`Solo hay ${available} pacas producidas disponibles para este servicio de maquila.`);
    }
    const client = await queryOne('SELECT * FROM clients WHERE id = $1', [service.client_id], db);
    const calc = service.calculation;
    const pricePack = Math.round(calc.pricePerPack * 100) / 100;
    const unitCostPack = Math.round(calc.costPerPack * 100) / 100;
    const line: PreparedLine = {
      productId: 0,
      orderItemId: null,
      description: `Maquila: ${service.name}`,
      packs: input.packs,
      units: input.packs * service.units_per_pack,
      pricePack,
      lineTotal: Math.round(pricePack * input.packs),
      grossTotal: Math.round(pricePack * input.packs),
      discountAmount: 0,
      unitCostPack,
      costTotal: unitCostPack * input.packs,
      lotId: input.lotId,
    };
    const totals = computeOrderTotals({
      lines: [line],
      freightIncluded: client.freight_included,
      freightRatePack: client.freight_rate_pack,
    });
    const remission = await remissionNumber(db, input.remissionNumber);
    const dispatch = await insertDispatch(
      db,
      { ...input, kind: 'maquila', orderId: null, clientId: client.id, maquilaServiceId: service.id, remission, totals, warnings: [] },
      userId,
    );
    await insertItemWithLots(db, dispatch!.id, line, lots);
    const receivable = await createReceivable(db, {
      clientId: client.id,
      dispatchId: dispatch!.id,
      orderId: null,
      documentNumber: remission,
      issueDate: input.date,
      termDays: input.paymentMode === 'contado' ? 0 : client.payment_term_days,
      amount: totals.total,
      paidNow: input.paymentMode === 'contado',
      paymentMethod: input.paymentMethod,
      userId,
    });
    return { dispatch, receivable };
  });
}

/** Anula un despacho: devuelve inventario y lotes, reabre el pedido y anula la cuenta por cobrar. */
export async function annulDispatch(id: number, userId: number | null, reason: string | null) {
  return withTransaction(async (db) => {
    const d = await queryOne('SELECT * FROM dispatches WHERE id = $1 FOR UPDATE', [id], db);
    if (!d) throw notFound('El despacho');
    if (d.status === 'anulado') throw conflict('El despacho ya está anulado.');
    const receivable = await queryOne('SELECT * FROM receivables WHERE dispatch_id = $1 FOR UPDATE', [id], db);
    if (receivable) {
      const paid = await queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM payments WHERE receivable_id = $1 AND reference IS DISTINCT FROM 'Pago de contado al despachar'`,
        [receivable.id],
        db,
      );
      if (paid!.n > 0) throw conflict('No se puede anular: la cuenta por cobrar ya tiene pagos registrados.');
    }
    const items = await query('SELECT * FROM dispatch_items WHERE dispatch_id = $1', [id], db);
    for (const item of items) {
      const lots = await query('SELECT * FROM dispatch_item_lots WHERE dispatch_item_id = $1', [item.id], db);
      for (const l of lots) {
        await query('UPDATE lots SET packs_remaining = packs_remaining + $2 WHERE id = $1', [l.lot_id, l.packs], db);
      }
      if (item.product_id) {
        await moveProduct(db, {
          productId: item.product_id,
          date: d.dispatch_date,
          type: 'anulacion',
          packs: item.packs,
          dispatchId: d.id,
          reference: `Anulación despacho ${d.number}`,
          notes: reason,
          userId,
        });
      }
      if (item.order_item_id) {
        await query('UPDATE order_items SET packs_dispatched = GREATEST(packs_dispatched - $2, 0) WHERE id = $1', [item.order_item_id, item.packs], db);
      }
    }
    if (d.order_id) await refreshOrderStatus(db, d.order_id);
    if (receivable) {
      await query('UPDATE receivables SET annulled = TRUE, balance = 0, notes = $2 WHERE id = $1', [receivable.id, `Anulada con el despacho: ${reason ?? ''}`], db);
    }
    await query(
      `UPDATE dispatches SET status = 'anulado', notes = COALESCE(notes || ' | ', '') || $2 WHERE id = $1`,
      [id, `Anulado: ${reason ?? 'sin motivo'}`],
      db,
    );
    return { ok: true };
  });
}
