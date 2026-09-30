// Reglas de precio por cliente: precio especial, perfil, descuentos por volumen.

import { formatDate, formatPct } from './format';
import { marginOnSales, marginStatus, type MarginStatus } from './pricing';

export type VolumeBasis = 'pacas' | 'estibas';

export interface VolumeTier {
  id?: number;
  basis: VolumeBasis;
  minQty: number;
  maxQty: number | null;
  discountPct: number;
  profileId: number | null; // null = aplica a todos los perfiles
  active?: boolean;
}

export interface VolumeDiscountResult {
  pct: number;
  tier: VolumeTier | null;
  description: string;
}

/**
 * Busca el mejor descuento por volumen para una línea.
 * - Rangos por pacas: se comparan con la cantidad de pacas.
 * - Rangos por estibas: se comparan con las estibas completas (pacas ÷ pacas por estiba).
 * Si varios rangos aplican se usa el de mayor descuento. Los rangos del perfil y los generales compiten.
 */
export function findVolumeDiscount(
  tiers: VolumeTier[],
  packs: number,
  packsPerPallet: number,
  profileId: number | null,
): VolumeDiscountResult {
  const pallets = packsPerPallet > 0 ? Math.floor(packs / packsPerPallet) : 0;
  let best: VolumeTier | null = null;
  for (const t of tiers) {
    if (t.active === false) continue;
    if (t.profileId !== null && t.profileId !== profileId) continue;
    const qty = t.basis === 'estibas' ? pallets : packs;
    if (qty < t.minQty) continue;
    if (t.maxQty !== null && qty > t.maxQty) continue;
    if (!best || t.discountPct > best.discountPct) best = t;
  }
  if (!best || best.discountPct <= 0) return { pct: 0, tier: null, description: 'Sin descuento por volumen' };
  const range = best.maxQty === null ? `${best.minQty}+` : `${best.minQty}–${best.maxQty}`;
  return {
    pct: best.discountPct,
    tier: best,
    description: `${formatPct(best.discountPct)} por volumen (${range} ${best.basis})`,
  };
}

export interface SpecialPrice {
  id?: number;
  productId: number;
  pricePack: number;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // null = sin vencimiento
  allowVolumeDiscount: boolean;
  active?: boolean;
}

/** Precio especial vigente para un producto en una fecha (el más reciente si hay varios). */
export function resolveSpecialPrice(specials: SpecialPrice[], productId: number, date: string): SpecialPrice | null {
  const valid = specials.filter(
    (s) =>
      s.active !== false &&
      s.productId === productId &&
      s.startDate <= date &&
      (s.endDate === null || s.endDate >= date),
  );
  if (valid.length === 0) return null;
  return valid.sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
}

export type PriceSource = 'especial' | 'perfil' | 'lista';

export interface LinePriceInput {
  productId: number;
  packs: number;
  unitsPerPack: number;
  packsPerPallet: number;
  basePricePack: number; // precio de lista
  profileId: number | null;
  profileDiscountPct: number;
  profilePricePack?: number | null; // precio fijo de la lista del perfil (opcional)
  special?: SpecialPrice | null;
  tiers: VolumeTier[];
  unitCostPack: number;
  adminPct?: number;
  minMargin: number;
  targetMargin: number;
}

export interface LinePrice {
  productId: number;
  packs: number;
  units: number;
  listPricePack: number;
  priceSource: PriceSource;
  priceSourceLabel: string;
  profileDiscountPct: number;
  volumeDiscountPct: number;
  volumeDescription: string;
  netPricePack: number;
  netPriceUnit: number;
  grossTotal: number;
  discountAmount: number;
  lineTotal: number;
  unitCostPack: number;
  costTotal: number;
  marginPct: number;
  expectedMarginPct: number;
  status: MarginStatus;
}

/**
 * Precio de una línea de pedido:
 * 1. Precio especial vigente (no se combina con perfil; volumen solo si está permitido).
 * 2. Precio fijo del perfil (lista de precios del perfil).
 * 3. Precio de lista × (1 − descuento del perfil).
 * Luego se aplica el descuento por volumen: neto = base × (1 − % volumen).
 */
export function computeLinePrice(input: LinePriceInput): LinePrice {
  if (!Number.isInteger(input.packs) || input.packs <= 0) {
    throw new Error('La cantidad de pacas debe ser un número entero mayor que cero.');
  }
  let source: PriceSource;
  let label: string;
  let priceBeforeVolume: number;
  let profileDiscountPct = 0;
  let volumeAllowed = true;

  if (input.special) {
    source = 'especial';
    label = input.special.endDate ? `Precio especial hasta ${formatDate(input.special.endDate)}` : 'Precio especial vigente';
    priceBeforeVolume = input.special.pricePack;
    volumeAllowed = input.special.allowVolumeDiscount;
  } else if (input.profilePricePack && input.profilePricePack > 0) {
    source = 'perfil';
    label = 'Precio de la lista del perfil';
    priceBeforeVolume = input.profilePricePack;
  } else {
    source = 'lista';
    profileDiscountPct = input.profileDiscountPct;
    label =
      profileDiscountPct > 0
        ? `Precio de lista − ${formatPct(profileDiscountPct)} del perfil`
        : 'Precio de lista';
    priceBeforeVolume = input.basePricePack * (1 - profileDiscountPct);
  }

  const volume = volumeAllowed
    ? findVolumeDiscount(input.tiers, input.packs, input.packsPerPallet, input.profileId)
    : { pct: 0, tier: null, description: 'El precio especial no acumula descuento por volumen' };

  const netPricePack = Math.round(priceBeforeVolume * (1 - volume.pct));
  const grossTotal = Math.round(input.basePricePack * input.packs);
  const lineTotal = netPricePack * input.packs;
  const costTotal = input.unitCostPack * input.packs;
  const adminPct = input.adminPct ?? 0;
  const marginPct = marginOnSales(lineTotal, costTotal, adminPct);
  return {
    productId: input.productId,
    packs: input.packs,
    units: input.packs * input.unitsPerPack,
    listPricePack: input.basePricePack,
    priceSource: source,
    priceSourceLabel: label,
    profileDiscountPct,
    volumeDiscountPct: volume.pct,
    volumeDescription: volume.description,
    netPricePack,
    netPriceUnit: netPricePack / input.unitsPerPack,
    grossTotal,
    discountAmount: grossTotal - lineTotal,
    lineTotal,
    unitCostPack: input.unitCostPack,
    costTotal,
    marginPct,
    expectedMarginPct: input.targetMargin,
    status: marginStatus(marginPct, input.minMargin, input.targetMargin),
  };
}

export interface OrderTotalsInput {
  lines: Pick<LinePrice, 'grossTotal' | 'discountAmount' | 'lineTotal' | 'costTotal' | 'packs'>[];
  freightIncluded: boolean; // true: la empresa asume el flete (es costo); false: se cobra al cliente
  freightRatePack: number;
  adminPct?: number;
}

export interface OrderTotals {
  packs: number;
  grossTotal: number;
  discountTotal: number;
  productsTotal: number;
  freightCharge: number; // valor cobrado al cliente
  freightCost: number; // costo de flete que asume la empresa
  total: number;
  costTotal: number; // costo de producto + flete asumido
  marginPct: number;
}

/** Totales de un pedido o despacho. El margen se calcula sobre el valor de producto. */
export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const packs = input.lines.reduce((s, l) => s + l.packs, 0);
  const grossTotal = input.lines.reduce((s, l) => s + l.grossTotal, 0);
  const discountTotal = input.lines.reduce((s, l) => s + l.discountAmount, 0);
  const productsTotal = input.lines.reduce((s, l) => s + l.lineTotal, 0);
  const productCost = input.lines.reduce((s, l) => s + l.costTotal, 0);
  const freightValue = Math.round(packs * (input.freightRatePack || 0));
  const freightCharge = input.freightIncluded ? 0 : freightValue;
  const freightCost = input.freightIncluded ? freightValue : 0;
  const costTotal = productCost + freightCost;
  return {
    packs,
    grossTotal,
    discountTotal,
    productsTotal,
    freightCharge,
    freightCost,
    total: productsTotal + freightCharge,
    costTotal,
    marginPct: marginOnSales(productsTotal, costTotal, input.adminPct ?? 0),
  };
}
