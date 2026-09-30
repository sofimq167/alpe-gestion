// Precios y márgenes.
// Métrica principal: MARGEN SOBRE VENTAS = (precio − costo) ÷ precio.
// Precio objetivo = costo ÷ (1 − margen). NO es costo × (1 + margen) (eso sería markup).

export const MAX_MARGIN = 0.95;

export class PricingError extends Error {}

/** Valida que un margen sea posible (entre 0% y 95%). */
export function isValidMargin(margin: number): boolean {
  return Number.isFinite(margin) && margin >= 0 && margin < MAX_MARGIN;
}

/**
 * Precio de venta para lograr un margen sobre ventas.
 * Si hay gasto administrativo como % de ventas, también se descuenta del precio:
 * precio = costo ÷ (1 − margen − %admin)
 */
export function priceForMargin(cost: number, margin: number, adminPct = 0): number {
  const denominator = 1 - margin - adminPct;
  if (!isValidMargin(margin) || denominator <= 0.01) {
    throw new PricingError('El margen deseado no es posible: debe ser mayor o igual a 0% y menor a 95%.');
  }
  return cost / denominator;
}

/** Margen sobre ventas: (precio − costo) ÷ precio, menos el % administrativo si aplica. */
export function marginOnSales(price: number, cost: number, adminPct = 0): number {
  if (!price || price <= 0) return cost > 0 ? -1 : 0;
  return (price - cost) / price - adminPct;
}

/** Markup sobre costo: (precio − costo) ÷ costo. Solo informativo. */
export function markupOnCost(price: number, cost: number): number {
  if (!cost || cost <= 0) return 0;
  return (price - cost) / cost;
}

/** Redondea un precio hacia arriba al múltiplo indicado (ej. $100). */
export function roundPriceUp(price: number, step = 100): number {
  if (step <= 0) return Math.round(price);
  return Math.ceil(price / step - 1e-9) * step;
}

export type MarginStatus = 'ok' | 'bajo_objetivo' | 'bajo_minimo';

export function marginStatus(margin: number, minMargin: number, targetMargin: number): MarginStatus {
  if (margin < minMargin - 1e-9) return 'bajo_minimo';
  if (margin < targetMargin - 1e-9) return 'bajo_objetivo';
  return 'ok';
}

export interface PackPricingInput {
  costPerPack: number;
  pricePack: number;
  unitsPerPack: number;
  targetMargin: number;
  minMargin: number;
  adminPct?: number;
  roundingStep?: number;
}

export interface PackPricing {
  costPerPack: number;
  costPerUnit: number;
  pricePack: number;
  priceUnit: number;
  marginPct: number;
  markupPct: number;
  profitPerPack: number;
  profitPerUnit: number;
  suggestedPricePack: number;
  minPricePack: number;
  status: MarginStatus;
}

/** Evalúa el precio de una paca frente a su costo y márgenes objetivo/mínimo. */
export function evaluatePackPricing(input: PackPricingInput): PackPricing {
  const adminPct = input.adminPct ?? 0;
  const step = input.roundingStep ?? 100;
  const marginPct = marginOnSales(input.pricePack, input.costPerPack, adminPct);
  const adminValue = input.pricePack * adminPct;
  const profitPerPack = input.pricePack - input.costPerPack - adminValue;
  return {
    costPerPack: input.costPerPack,
    costPerUnit: input.costPerPack / input.unitsPerPack,
    pricePack: input.pricePack,
    priceUnit: input.pricePack / input.unitsPerPack,
    marginPct,
    markupPct: markupOnCost(input.pricePack, input.costPerPack),
    profitPerPack,
    profitPerUnit: profitPerPack / input.unitsPerPack,
    suggestedPricePack: roundPriceUp(priceForMargin(input.costPerPack, input.targetMargin, adminPct), step),
    minPricePack: roundPriceUp(priceForMargin(input.costPerPack, input.minMargin, adminPct), step),
    status: marginStatus(marginPct, input.minMargin, input.targetMargin),
  };
}
