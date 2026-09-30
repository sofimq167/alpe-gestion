// Pedidos: el precio lo calcula siempre el servidor con las reglas del cliente.
import { query, queryOne, withTransaction } from '../database/pool';
import { badRequest, conflict, notFound, WarningsError } from '../utils/http';
import { loadCostContext } from './costService';
import { loadClientPricing, quoteOrder } from './pricingService';

export interface OrderInput {
  clientId: number;
  orderDate: string;
  deliveryDate?: string | null;
  notes?: string | null;
  items: { productId: number; packs: number }[];
  confirmWarnings?: boolean;
}

export async function createOrder(input: OrderInput, userId: number | null) {
  return withTransaction(async (db) => {
    const ctx = await loadCostContext(db);
    const cp = await loadClientPricing(input.clientId, db);
    if (cp.client.status !== 'activo') throw badRequest(`El cliente está ${cp.client.status}. Actívelo antes de crear pedidos.`);
    if (cp.profile.is_maquila) {
      throw badRequest('Este cliente es de maquila. Registre sus servicios desde el módulo Maquila.');
    }
    const quote = quoteOrder(ctx, cp, input.items, input.orderDate);
    if (quote.warnings.length > 0 && !input.confirmWarnings) throw new WarningsError(quote.warnings);
    const t = quote.totals;
    const order = await queryOne(
      `INSERT INTO orders (client_id, order_date, delivery_date, status, payment_term_days, freight_included, freight_rate_pack,
         gross_total, discount_total, products_total, freight_charge, freight_cost, total, cost_total, margin_pct, expected_margin_pct,
         warnings_accepted, notes, created_by)
       VALUES ($1,$2,$3,'confirmado',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        input.clientId,
        input.orderDate,
        input.deliveryDate ?? null,
        cp.client.payment_term_days,
        cp.client.freight_included,
        cp.client.freight_rate_pack,
        t.grossTotal,
        t.discountTotal,
        t.productsTotal,
        t.freightCharge,
        t.freightCost,
        t.total,
        t.costTotal,
        t.marginPct,
        t.expectedMarginPct,
        quote.warnings.length ? quote.warnings.join(' | ') : null,
        input.notes ?? null,
        userId,
      ],
      db,
    );
    for (const l of quote.lines) {
      await query(
        `INSERT INTO order_items (order_id, product_id, packs, units_per_pack, list_price_pack, price_source, price_source_label,
           profile_discount_pct, volume_discount_pct, net_price_pack, gross_total, discount_amount, line_total, unit_cost_pack,
           cost_total, margin_pct, min_margin, target_margin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          order!.id,
          l.productId,
          l.packs,
          l.unitsPerPack,
          l.listPricePack,
          l.priceSource,
          l.priceSourceLabel,
          l.profileDiscountPct,
          l.volumeDiscountPct,
          l.netPricePack,
          l.grossTotal,
          l.discountAmount,
          l.lineTotal,
          l.unitCostPack,
          l.costTotal,
          l.marginPct,
          l.minMargin,
          l.targetMargin,
        ],
        db,
      );
    }
    return order;
  });
}

export async function cancelOrder(id: number, reason: string | null) {
  return withTransaction(async (db) => {
    const order = await queryOne('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id], db);
    if (!order) throw notFound('El pedido');
    if (order.status === 'cancelado') throw conflict('El pedido ya está cancelado.');
    const active = await queryOne(
      `SELECT COUNT(*)::int AS n FROM dispatches WHERE order_id = $1 AND status = 'confirmado'`,
      [id],
      db,
    );
    if (active!.n > 0) throw conflict('No se puede cancelar: el pedido tiene despachos. Anule primero los despachos.');
    await query(
      `UPDATE orders SET status = 'cancelado', notes = COALESCE(notes || ' | ', '') || $2 WHERE id = $1`,
      [id, `Cancelado: ${reason ?? 'sin motivo'}`],
      db,
    );
    return { ok: true };
  });
}

/** Recalcula el estado del pedido según lo despachado. */
export async function refreshOrderStatus(db: import('pg').PoolClient, orderId: number) {
  const row = await queryOne<{ packs: number; dispatched: number }>(
    'SELECT SUM(packs)::int AS packs, SUM(packs_dispatched)::int AS dispatched FROM order_items WHERE order_id = $1',
    [orderId],
    db,
  );
  const status = !row || row.dispatched <= 0 ? 'confirmado' : row.dispatched >= row.packs ? 'despachado' : 'parcial';
  await query(`UPDATE orders SET status = $2 WHERE id = $1 AND status <> 'cancelado'`, [orderId, status], db);
}
