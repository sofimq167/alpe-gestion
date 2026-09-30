// Cálculo de costos por botella, paca y estiba.
// Todas las pantallas y el servidor usan estas funciones: no duplicar fórmulas.

import { formatNumber, formatPct, formatUnitCOP } from './format';

const BASIS_TEXT: Record<CostBasis, string> = { unidad: 'botella', paca: 'paca', estiba: 'estiba' };

/** Base sobre la que se expresa la cantidad de un componente de la receta. */
export type CostBasis = 'unidad' | 'paca' | 'estiba';

export interface Packaging {
  unitsPerPack: number; // botellas por paca
  packsPerPallet: number; // pacas por estiba
}

export interface CostComponent {
  supplyId: number;
  name: string;
  role: string; // envase, tapa, etiqueta, termoencogible, plastico, estiba, agua, otro
  unit: string;
  quantity: number; // cantidad del insumo por `basis`
  basis: CostBasis;
  unitCost: number; // costo del insumo por su unidad
}

export interface BlowConfig {
  preformName?: string;
  preformCost: number; // costo de la preforma por unidad
  energyPerUnit: number; // energía de soplado por envase
  laborPerUnit: number; // mano de obra de soplado por envase
  wastePct: number; // desperdicio de preformas (0.03 = 3%)
  overheadPerUnit: number; // depreciación / costo operativo por envase
}

export type AdminExpenseMode = 'pct_ventas' | 'por_unidad' | 'mensual';

export interface AdminExpenseConfig {
  enabled: boolean;
  mode: AdminExpenseMode;
  pct: number; // % sobre ventas (0.05 = 5%)
  perUnit: number; // $ por botella
  monthlyAmount: number; // $ mensuales a distribuir sobre la producción
  fallbackMonthlyUnits: number; // unidades mensuales estimadas si no hay producción registrada
}

/** Gasto administrativo ya resuelto para usar en costos y márgenes. */
export interface ResolvedAdmin {
  included: boolean;
  mode: AdminExpenseMode;
  perUnit: number; // se suma al costo por botella (modos por_unidad y mensual)
  pct: number; // se descuenta del margen sobre ventas (modo pct_ventas)
  description: string;
}

export interface CostLine {
  key: string;
  label: string;
  role: string;
  perUnit: number;
  detail: string;
}

export interface ProductCostInput {
  packaging: Packaging;
  components: CostComponent[];
  laborPerUnit: number;
  laborSource: string;
  energyPerUnit: number;
  energySource: string;
  useBlown: boolean;
  blow?: BlowConfig | null;
  admin: ResolvedAdmin;
}

export interface ProductCostResult {
  lines: CostLine[];
  containerSource: 'comprado' | 'soplado';
  variableCostPerUnit: number; // costo de producción por botella (sin gasto administrativo)
  adminPerUnit: number;
  adminPct: number;
  costPerUnit: number; // costo total por botella usado para el margen
  costPerPack: number;
  costPerPallet: number;
}

export function unitsPerBasis(basis: CostBasis, packaging: Packaging): number {
  if (basis === 'paca') return packaging.unitsPerPack;
  if (basis === 'estiba') return packaging.unitsPerPack * packaging.packsPerPallet;
  return 1;
}

/** Costo por botella de un componente: cantidad × costo ÷ botellas que cubre la base. */
export function componentCostPerUnit(component: CostComponent, packaging: Packaging): number {
  const divisor = unitsPerBasis(component.basis, packaging);
  if (divisor <= 0) return 0;
  return (component.quantity * component.unitCost) / divisor;
}

/**
 * Costo de un envase soplado internamente:
 * preforma ÷ (1 − desperdicio) + energía + mano de obra + depreciación/costo operativo.
 */
export function blownContainerCost(blow: BlowConfig): number {
  const waste = Math.min(Math.max(blow.wastePct, 0), 0.9);
  return blow.preformCost / (1 - waste) + blow.energyPerUnit + blow.laborPerUnit + blow.overheadPerUnit;
}

/** Costo por unidad = costo total ÷ unidades (mano de obra, energía, etc.). */
export function costPerProducedUnit(totalCost: number, units: number): number {
  if (!units || units <= 0) return 0;
  return totalCost / units;
}

/** Resuelve la configuración de gasto administrativo a un valor por unidad o un porcentaje. */
export function resolveAdminExpense(config: AdminExpenseConfig, monthlyUnitsProduced: number): ResolvedAdmin {
  if (!config.enabled) {
    return { included: false, mode: config.mode, perUnit: 0, pct: 0, description: 'No incluidos en el costo' };
  }
  if (config.mode === 'pct_ventas') {
    return {
      included: true,
      mode: config.mode,
      perUnit: 0,
      pct: config.pct,
      description: `${formatPct(config.pct)} sobre el precio de venta`,
    };
  }
  if (config.mode === 'por_unidad') {
    return {
      included: true,
      mode: config.mode,
      perUnit: config.perUnit,
      pct: 0,
      description: `${formatUnitCOP(config.perUnit)} por botella`,
    };
  }
  const units = monthlyUnitsProduced > 0 ? monthlyUnitsProduced : config.fallbackMonthlyUnits;
  const perUnit = units > 0 ? config.monthlyAmount / units : 0;
  return {
    included: true,
    mode: config.mode,
    perUnit,
    pct: 0,
    description: `Gasto mensual distribuido sobre ${formatNumber(units)} botellas`,
  };
}

/** Construye el costo completo de una presentación a partir de sus componentes. */
export function computeProductCost(input: ProductCostInput): ProductCostResult {
  const { packaging } = input;
  const lines: CostLine[] = [];
  const useBlown = input.useBlown && !!input.blow;
  let containerAdded = false;

  for (const c of input.components) {
    if (c.role === 'envase' && useBlown) {
      if (!containerAdded) {
        lines.push(blownLine(input.blow!));
        containerAdded = true;
      }
      continue;
    }
    lines.push({
      key: `insumo-${c.supplyId}`,
      label: c.name,
      role: c.role,
      perUnit: componentCostPerUnit(c, packaging),
      detail: `${formatNumber(c.quantity, 4)} ${c.unit} por ${BASIS_TEXT[c.basis]} × ${formatUnitCOP(c.unitCost)}`,
    });
  }
  if (useBlown && !containerAdded) lines.unshift(blownLine(input.blow!));

  lines.push({
    key: 'energia',
    label: 'Energía',
    role: 'energia',
    perUnit: input.energyPerUnit,
    detail: input.energySource,
  });
  lines.push({
    key: 'mano_obra',
    label: 'Mano de obra',
    role: 'mano_obra',
    perUnit: input.laborPerUnit,
    detail: input.laborSource,
  });

  const variableCostPerUnit = lines.reduce((sum, l) => sum + l.perUnit, 0);
  const adminPerUnit = input.admin.included ? input.admin.perUnit : 0;
  const adminPct = input.admin.included ? input.admin.pct : 0;
  const costPerUnit = variableCostPerUnit + adminPerUnit;
  return {
    lines,
    containerSource: useBlown ? 'soplado' : 'comprado',
    variableCostPerUnit,
    adminPerUnit,
    adminPct,
    costPerUnit,
    costPerPack: costPerUnit * packaging.unitsPerPack,
    costPerPallet: costPerUnit * packaging.unitsPerPack * packaging.packsPerPallet,
  };
}

function blownLine(blow: BlowConfig): CostLine {
  return {
    key: 'envase-soplado',
    label: 'Envase soplado internamente',
    role: 'envase',
    perUnit: blownContainerCost(blow),
    detail: `${blow.preformName ?? 'Preforma'} ${formatUnitCOP(blow.preformCost)} ÷ (1 − ${formatPct(blow.wastePct)} desperdicio) + energía ${formatUnitCOP(
      blow.energyPerUnit,
    )} + mano de obra ${formatUnitCOP(blow.laborPerUnit)} + costo operativo ${formatUnitCOP(blow.overheadPerUnit)}`,
  };
}

/** Comparación entre comprar el envase y soplarlo internamente. */
export interface BlowComparison {
  boughtCostPerUnit: number;
  blownCostPerUnit: number;
  savingPerUnit: number;
  savingPerPack: number;
  monthlySaving: number;
}

export function compareBlowScenario(
  bought: ProductCostResult,
  blown: ProductCostResult,
  unitsPerPack: number,
  monthlyPacks: number,
): BlowComparison {
  const savingPerUnit = bought.costPerUnit - blown.costPerUnit;
  return {
    boughtCostPerUnit: bought.costPerUnit,
    blownCostPerUnit: blown.costPerUnit,
    savingPerUnit,
    savingPerPack: savingPerUnit * unitsPerPack,
    monthlySaving: savingPerUnit * unitsPerPack * monthlyPacks,
  };
}
