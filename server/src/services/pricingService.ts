// Precios por cliente: combina perfil, lista del perfil, precio especial vigente y descuentos por volumen.
import {
  computeLinePrice,
  computeOrderTotals,
  formatCOP,
  formatPct,
  resolveSpecialPrice,
  type LinePrice,
  type SpecialPrice,
  type VolumeTier,
} from '@alpe/shared';
import { all, query, queryOne, pool, type Db } from '../database/pool';
import { badRequest, notFound } from '../utils/http';
import { productCost, type CostContext } from './costService';

export interface ClientPricing {
  client: {
    id: number;
    name: string;
    status: string;
    profile_id: number;
    payment_term_days: number;
    freight_included: boolean;
    freight_rate_pack: number;
    credit_limit: number | null;
    city: string | null;
    address: string | null;
  };
  profile: { id: number; name: string; base_discount_pct: number; min_order_packs: number; payment_term_days: number; is_maquila: boolean };
  specials: SpecialPrice[];
  tiers: VolumeTier[];
  profilePrices: Map<number, number>;
  openBalance: number;
}

export async function loadVolumeTiers(db: Db = pool): Promise<VolumeTier[]> {
  const rows = await query(
    'SELECT id, profile_id, basis, min_qty, max_qty, discount_pct, active FROM volume_discounts WHERE active ORDER BY basis, min_qty',
    [],
    db,
  );
  return rows.map((t) => ({
    id: t.id,
    basis: t.basis,
    minQty: t.min_qty,
    maxQty: t.max_qty,
    discountPct: t.discount_pct,
    profileId: t.profile_id,
    active: t.active,
  }));
}

export async function loadClientPricing(clientId: number, db: Db = pool): Promise<ClientPricing> {
  const client = await queryOne(
    `SELECT id, name, status, profile_id, payment_term_days, freight_included, freight_rate_pack, credit_limit, city, address
     FROM clients WHERE id = $1`,
    [clientId],
    db,
  );
  if (!client) throw notFound('El cliente');
  const [profile, specials, tiers, profilePrices, balance] = await all(db, [
    () => queryOne('SELECT * FROM client_profiles WHERE id = $1', [client.profile_id], db),
    () => query('SELECT * FROM client_special_prices WHERE client_id = $1 AND active', [clientId], db),
    () => loadVolumeTiers(db),
    () => query('SELECT product_id, price_pack FROM profile_prices WHERE profile_id = $1', [client.profile_id], db),
    () => queryOne<{ balance: number }>(
      'SELECT COALESCE(SUM(balance),0)::numeric AS balance FROM receivables WHERE client_id = $1 AND NOT annulled',
      [clientId],
      db,
    ),
  ] as const);
  return {
    client,
    profile: profile as ClientPricing['profile'],
    specials: specials.map((s) => ({
      id: s.id,
      productId: s.product_id,
      pricePack: s.price_pack,
      startDate: s.start_date,
      endDate: s.end_date,
      allowVolumeDiscount: s.allow_volume_discount,
      active: s.active,
    })),
    tiers,
    profilePrices: new Map(profilePrices.map((p) => [p.product_id, p.price_pack])),
    openBalance: balance?.balance ?? 0,
  };
}

export type QuotedLine = LinePrice & { productName: string; unitsPerPack: number; minMargin: number; targetMargin: number };

/** Calcula el precio de un producto para un cliente en una fecha. */
export function quoteLine(ctx: CostContext, cp: ClientPricing, productId: number, packs: number, date: string): QuotedLine {
  const product = ctx.products.get(productId);
  if (!product) throw notFound('La presentación');
  if (!product.active) throw badRequest(`La presentación "${product.name}" está inactiva.`);
  const cost = productCost(ctx, productId);
  const line = computeLinePrice({
    productId,
    packs,
    unitsPerPack: product.units_per_pack,
    packsPerPallet: product.packs_per_pallet,
    basePricePack: product.list_price_pack,
    profileId: cp.profile.id,
    profileDiscountPct: cp.profile.base_discount_pct,
    profilePricePack: cp.profilePrices.get(productId) ?? null,
    special: resolveSpecialPrice(cp.specials, productId, date),
    tiers: cp.tiers,
    unitCostPack: Math.round(cost.costPerPack * 100) / 100,
    adminPct: cost.adminPct,
    minMargin: product.min_margin,
    targetMargin: product.target_margin,
  });
  return {
    ...line,
    productName: product.name,
    unitsPerPack: product.units_per_pack,
    minMargin: product.min_margin,
    targetMargin: product.target_margin,
  };
}

/** Cotización completa de un pedido con totales y advertencias. */
export function quoteOrder(
  ctx: CostContext,
  cp: ClientPricing,
  items: { productId: number; packs: number }[],
  date: string,
) {
  if (items.length === 0) throw badRequest('Agregue al menos un producto.');
  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.productId)) throw badRequest('Hay productos repetidos: combine las cantidades en una sola línea.');
    seen.add(item.productId);
  }
  const lines = items.map((i) => quoteLine(ctx, cp, i.productId, i.packs, date));
  const totals = computeOrderTotals({
    lines,
    freightIncluded: cp.client.freight_included,
    freightRatePack: cp.client.freight_rate_pack,
    adminPct: ctx.admin.included ? ctx.admin.pct : 0,
  });
  const expectedMarginPct =
    totals.productsTotal > 0
      ? lines.reduce((s, l) => s + l.targetMargin * l.lineTotal, 0) / totals.productsTotal
      : 0;

  const warnings: string[] = [];
  for (const l of lines) {
    if (l.status === 'bajo_minimo') {
      warnings.push(
        `${l.productName}: el margen de esta venta es ${formatPct(l.marginPct)}, por debajo del mínimo permitido (${formatPct(l.minMargin)}).`,
      );
    }
  }
  if (cp.profile.min_order_packs > 0 && totals.packs < cp.profile.min_order_packs) {
    warnings.push(
      `El pedido tiene ${totals.packs} pacas y el pedido mínimo del perfil ${cp.profile.name} es ${cp.profile.min_order_packs} pacas.`,
    );
  }
  if (cp.client.credit_limit !== null && cp.client.credit_limit > 0 && cp.openBalance + totals.total > cp.client.credit_limit) {
    warnings.push(
      `El cliente supera su límite de crédito: saldo actual ${formatCOP(cp.openBalance)} + este pedido ${formatCOP(totals.total)} > límite ${formatCOP(cp.client.credit_limit)}.`,
    );
  }
  return {
    client: {
      id: cp.client.id,
      name: cp.client.name,
      profileName: cp.profile.name,
      profileDiscountPct: cp.profile.base_discount_pct,
      minOrderPacks: cp.profile.min_order_packs,
      paymentTermDays: cp.client.payment_term_days,
      freightIncluded: cp.client.freight_included,
      freightRatePack: cp.client.freight_rate_pack,
      creditLimit: cp.client.credit_limit,
      openBalance: cp.openBalance,
    },
    lines,
    totals: { ...totals, expectedMarginPct },
    warnings,
  };
}
