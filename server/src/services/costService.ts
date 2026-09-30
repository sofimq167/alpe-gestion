// Servicio de costos: carga los datos de la base y usa las fórmulas centralizadas de @alpe/shared.
import {
  compareBlowScenario,
  computeProductCost,
  evaluatePackPricing,
  resolveAdminExpense,
  weightedCostPerUnit,
  type BlowConfig,
  type CostComponent,
  type PackPricing,
  type ProductCostResult,
  type ResolvedAdmin,
} from '@alpe/shared';
import { all, query, pool, type Db } from '../database/pool';
import { getSettings, type Settings } from './settingsService';
import { todayISO, addDays } from '@alpe/shared';
import { env } from '../config/env';

export interface SupplyRow {
  id: number;
  code: string | null;
  name: string;
  category: string;
  unit: string;
  current_cost: number;
  supplier: string | null;
  is_inventoried: boolean;
  stock: number;
  min_stock: number;
  active: boolean;
  cost_updated_at: string;
}

export interface ProductRow {
  id: number;
  code: string | null;
  name: string;
  volume_ml: number;
  units_per_pack: number;
  packs_per_pallet: number;
  weight_kg_pack: number | null;
  active: boolean;
  min_margin: number;
  target_margin: number;
  list_price_pack: number;
  price_updated_at: string;
  use_blown: boolean;
  std_labor_per_unit: number;
  std_energy_per_unit: number;
  stock_packs: number;
  min_stock_packs: number;
  notes: string | null;
}

interface ComponentRow {
  id: number;
  product_id: number;
  supply_id: number;
  role: string;
  quantity: number;
  basis: 'unidad' | 'paca' | 'estiba';
}

interface BlowRow {
  product_id: number;
  preform_supply_id: number;
  energy_per_unit: number;
  labor_per_unit: number;
  waste_pct: number;
  overhead_per_unit: number;
  notes: string | null;
}

export interface CostContext {
  settings: Settings;
  admin: ResolvedAdmin;
  supplies: Map<number, SupplyRow>;
  products: Map<number, ProductRow>;
  components: Map<number, ComponentRow[]>;
  blow: Map<number, BlowRow>;
  laborReal: Map<number, { perUnit: number; runs: number }>;
  energyReal: Map<number, { perUnit: number; runs: number }>;
  monthlyPacks: Map<number, number>;
}

/** Carga todo lo necesario para calcular costos en pocas consultas. */
export async function loadCostContext(db: Db = pool): Promise<CostContext> {
  const settings = await getSettings(db);
  const today = todayISO(env.timezone);
  const since = addDays(today, -settings.production.lookbackDays);
  const salesSince = addDays(today, -settings.operations.monthlyPacksLookbackDays);

  const [supplies, products, components, blows, runs, monthlyUnits, sold] = await all(db, [
    () => query<SupplyRow>('SELECT * FROM supplies', [], db),
    () => query<ProductRow>('SELECT * FROM products ORDER BY volume_ml, name', [], db),
    () => query<ComponentRow>('SELECT * FROM product_components ORDER BY id', [], db),
    () => query<BlowRow>('SELECT * FROM blow_configs', [], db),
    () => query<{ product_id: number; labor_cost: number; energy_cost: number; good_units: number }>(
      `SELECT product_id, labor_cost, energy_cost, good_units FROM production_runs
       WHERE status = 'registrada' AND NOT is_maquila AND run_date >= $1`,
      [since],
      db,
    ),
    () => query<{ units: number }>(
      `SELECT COALESCE(SUM(good_units),0)::bigint AS units FROM production_runs
       WHERE status = 'registrada' AND run_date >= $1`,
      [addDays(today, -30)],
      db,
    ),
    () => query<{ product_id: number; packs: number }>(
      `SELECT di.product_id, SUM(di.packs)::bigint AS packs FROM dispatch_items di
       JOIN dispatches d ON d.id = di.dispatch_id
       WHERE d.status = 'confirmado' AND d.kind = 'venta' AND d.dispatch_date >= $1 AND di.product_id IS NOT NULL
       GROUP BY di.product_id`,
      [salesSince],
      db,
    ),
  ] as const);

  const componentsByProduct = new Map<number, ComponentRow[]>();
  for (const c of components) {
    const list = componentsByProduct.get(c.product_id) ?? [];
    list.push(c);
    componentsByProduct.set(c.product_id, list);
  }

  const laborReal = new Map<number, { perUnit: number; runs: number }>();
  const energyReal = new Map<number, { perUnit: number; runs: number }>();
  const byProduct = new Map<number, typeof runs>();
  for (const r of runs) {
    const list = byProduct.get(r.product_id) ?? [];
    list.push(r);
    byProduct.set(r.product_id, list);
  }
  for (const [productId, list] of byProduct) {
    const labor = weightedCostPerUnit(list.map((r) => ({ cost: r.labor_cost, units: r.good_units })));
    const energy = weightedCostPerUnit(list.map((r) => ({ cost: r.energy_cost, units: r.good_units })));
    if (labor !== null && labor > 0) laborReal.set(productId, { perUnit: labor, runs: list.length });
    if (energy !== null && energy > 0) energyReal.set(productId, { perUnit: energy, runs: list.length });
  }

  return {
    settings,
    admin: resolveAdminExpense(settings.admin_expenses, monthlyUnits[0]?.units ?? 0),
    supplies: new Map(supplies.map((s) => [s.id, s])),
    products: new Map(products.map((p) => [p.id, p])),
    components: componentsByProduct,
    blow: new Map(blows.map((b) => [b.product_id, b])),
    laborReal,
    energyReal,
    monthlyPacks: new Map(sold.map((s) => [s.product_id, s.packs])),
  };
}

export interface CostOptions {
  useBlown?: boolean;
  supplyOverrides?: Map<number, number>;
  laborOverride?: number;
  energyOverride?: number;
}

function supplyCost(ctx: CostContext, supplyId: number, overrides?: Map<number, number>): number {
  return overrides?.get(supplyId) ?? ctx.supplies.get(supplyId)?.current_cost ?? 0;
}

export function blowConfigFor(ctx: CostContext, productId: number, overrides?: Map<number, number>): BlowConfig | null {
  const b = ctx.blow.get(productId);
  if (!b) return null;
  return {
    preformName: ctx.supplies.get(b.preform_supply_id)?.name,
    preformCost: supplyCost(ctx, b.preform_supply_id, overrides),
    energyPerUnit: b.energy_per_unit,
    laborPerUnit: b.labor_per_unit,
    wastePct: b.waste_pct,
    overheadPerUnit: b.overhead_per_unit,
  };
}

/** Costo completo de una presentación. */
export function productCost(ctx: CostContext, productId: number, options: CostOptions = {}): ProductCostResult {
  const product = ctx.products.get(productId);
  if (!product) throw new Error(`Presentación ${productId} no encontrada`);
  const lookback = ctx.settings.production.lookbackDays;
  const components: CostComponent[] = (ctx.components.get(productId) ?? []).map((c) => {
    const supply = ctx.supplies.get(c.supply_id);
    return {
      supplyId: c.supply_id,
      name: supply?.name ?? 'Insumo',
      role: c.role,
      unit: supply?.unit ?? 'unidad',
      quantity: c.quantity,
      basis: c.basis,
      unitCost: supplyCost(ctx, c.supply_id, options.supplyOverrides),
    };
  });
  const labor = ctx.laborReal.get(productId);
  const energy = ctx.energyReal.get(productId);
  const laborPerUnit = options.laborOverride ?? labor?.perUnit ?? product.std_labor_per_unit;
  const energyPerUnit = options.energyOverride ?? energy?.perUnit ?? product.std_energy_per_unit;
  return computeProductCost({
    packaging: { unitsPerPack: product.units_per_pack, packsPerPallet: product.packs_per_pallet },
    components,
    laborPerUnit,
    laborSource:
      options.laborOverride !== undefined
        ? 'Valor simulado'
        : labor
          ? `Real: costo de turnos ÷ botellas producidas (${labor.runs} producciones, últimos ${lookback} días)`
          : 'Estándar configurado (sin producción reciente)',
    energyPerUnit,
    energySource:
      options.energyOverride !== undefined
        ? 'Valor simulado'
        : energy
          ? `Real: costo de energía ÷ botellas producidas (${energy.runs} producciones, últimos ${lookback} días)`
          : 'Estándar configurado (sin producción reciente)',
    useBlown: options.useBlown ?? product.use_blown,
    blow: blowConfigFor(ctx, productId, options.supplyOverrides),
    admin: ctx.admin,
  });
}

export function productPricing(ctx: CostContext, productId: number, cost: ProductCostResult, pricePack?: number): PackPricing {
  const product = ctx.products.get(productId)!;
  return evaluatePackPricing({
    costPerPack: cost.costPerPack,
    pricePack: pricePack ?? product.list_price_pack,
    unitsPerPack: product.units_per_pack,
    targetMargin: product.target_margin,
    minMargin: product.min_margin,
    adminPct: cost.adminPct,
    roundingStep: ctx.settings.pricing.roundingStep,
  });
}

/** Resumen de costo, precio y margen de una presentación (para listados y alertas). */
export function productSummary(ctx: CostContext, productId: number, options: CostOptions = {}) {
  const p = ctx.products.get(productId)!;
  const cost = productCost(ctx, productId, options);
  const pricing = productPricing(ctx, productId, cost);
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    volumeMl: p.volume_ml,
    unitsPerPack: p.units_per_pack,
    packsPerPallet: p.packs_per_pallet,
    weightKgPack: p.weight_kg_pack,
    active: p.active,
    minMargin: p.min_margin,
    targetMargin: p.target_margin,
    listPricePack: p.list_price_pack,
    priceUpdatedAt: p.price_updated_at,
    useBlown: p.use_blown,
    hasBlowConfig: ctx.blow.has(p.id),
    stockPacks: p.stock_packs,
    minStockPacks: p.min_stock_packs,
    stdLaborPerUnit: p.std_labor_per_unit,
    stdEnergyPerUnit: p.std_energy_per_unit,
    notes: p.notes,
    containerSource: cost.containerSource,
    costPerUnit: cost.costPerUnit,
    costPerPack: cost.costPerPack,
    costPerPallet: cost.costPerPallet,
    adminIncluded: ctx.admin.included,
    priceUnit: pricing.priceUnit,
    marginPct: pricing.marginPct,
    markupPct: pricing.markupPct,
    profitPerPack: pricing.profitPerPack,
    suggestedPricePack: pricing.suggestedPricePack,
    minPricePack: pricing.minPricePack,
    status: pricing.status,
  };
}

export type ProductSummary = ReturnType<typeof productSummary>;

/** Detalle completo para el calculador: desglose, precios y comparación de soplado. */
export function productCalculation(ctx: CostContext, productId: number) {
  const p = ctx.products.get(productId)!;
  const bought = productCost(ctx, productId, { useBlown: false });
  const blowCfg = blowConfigFor(ctx, productId);
  const blown = blowCfg ? productCost(ctx, productId, { useBlown: true }) : null;
  const monthlyPacks = ctx.monthlyPacks.get(productId) ?? 0;
  return {
    summary: productSummary(ctx, productId),
    admin: ctx.admin,
    bought: { cost: bought, pricing: productPricing(ctx, productId, bought) },
    blown: blown ? { cost: blown, pricing: productPricing(ctx, productId, blown) } : null,
    blowConfig: blowCfg,
    comparison: blown ? compareBlowScenario(bought, blown, p.units_per_pack, monthlyPacks) : null,
    monthlyPacks,
    monthlyPacksDays: ctx.settings.operations.monthlyPacksLookbackDays,
  };
}

/** Presentaciones que usan un insumo (en su receta o como preforma de soplado). */
export function productsUsingSupply(ctx: CostContext, supplyId: number): number[] {
  const ids = new Set<number>();
  for (const [productId, list] of ctx.components) {
    if (list.some((c) => c.supply_id === supplyId)) ids.add(productId);
  }
  for (const [productId, b] of ctx.blow) {
    if (b.preform_supply_id === supplyId) ids.add(productId);
  }
  return [...ids];
}

/** Impacto de cambiar el costo de un insumo, antes de guardar. */
export function supplyCostImpact(ctx: CostContext, supplyId: number, newCost: number) {
  const overrides = new Map([[supplyId, newCost]]);
  return productsUsingSupply(ctx, supplyId)
    .map((productId) => {
      const p = ctx.products.get(productId)!;
      const before = productSummary(ctx, productId);
      const after = productSummary(ctx, productId, { supplyOverrides: overrides });
      const usedInBlowOnly =
        !(ctx.components.get(productId) ?? []).some((c) => c.supply_id === supplyId) && ctx.blow.has(productId);
      return {
        productId,
        name: p.name,
        active: p.active,
        affectsCurrentCost: !usedInBlowOnly || p.use_blown,
        usedInBlowOnly,
        costPerPackBefore: before.costPerPack,
        costPerPackAfter: after.costPerPack,
        costPerUnitBefore: before.costPerUnit,
        costPerUnitAfter: after.costPerUnit,
        marginBefore: before.marginPct,
        marginAfter: after.marginPct,
        listPricePack: p.list_price_pack,
        suggestedPricePack: after.suggestedPricePack,
        minMargin: p.min_margin,
        targetMargin: p.target_margin,
        statusAfter: after.status,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Presentaciones activas con margen por debajo del mínimo. */
export function marginAlerts(ctx: CostContext) {
  return [...ctx.products.values()]
    .filter((p) => p.active)
    .map((p) => productSummary(ctx, p.id))
    .filter((s) => s.status === 'bajo_minimo')
    .map((s) => ({
      productId: s.id,
      name: s.name,
      marginPct: s.marginPct,
      minMargin: s.minMargin,
      targetMargin: s.targetMargin,
      listPricePack: s.listPricePack,
      suggestedPricePack: s.suggestedPricePack,
      costPerPack: s.costPerPack,
    }));
}
