// Costos del servicio de maquila: estructura diferente a la venta normal.
// Los materiales que aporta el cliente NO son costo de la empresa.

import { componentCostPerUnit, type CostBasis } from './costing';
import { marginOnSales } from './pricing';

export type MaquilaPricingBasis = 'botella' | 'paca';

export interface MaquilaItem {
  role: string; // envase, tapa, etiqueta, termoencogible, otro
  label: string;
  clientProvides: boolean;
  unitCost: number; // costo del insumo de la empresa (si lo aporta)
  quantity: number;
  basis: CostBasis;
  unit?: string;
}

export interface MaquilaCostInput {
  unitsPerPack: number;
  items: MaquilaItem[];
  waterPerUnit: number;
  energyPerUnit: number;
  laborPerUnit: number;
  otherPerUnit: number;
  pricingBasis: MaquilaPricingBasis;
  price: number; // precio cobrado por botella o por paca según `pricingBasis`
}

export interface MaquilaCostResult {
  materialLines: { role: string; label: string; clientProvides: boolean; perUnit: number }[];
  materialsPerUnit: number; // materiales aportados por la empresa
  conversionPerUnit: number; // agua + energía + mano de obra + otros
  costPerUnit: number;
  costPerPack: number;
  pricePerUnit: number;
  pricePerPack: number;
  profitPerPack: number;
  marginPct: number;
}

export function computeMaquilaCost(input: MaquilaCostInput): MaquilaCostResult {
  const packaging = { unitsPerPack: input.unitsPerPack, packsPerPallet: 1 };
  const materialLines = input.items.map((item) => ({
    role: item.role,
    label: item.label,
    clientProvides: item.clientProvides,
    perUnit: item.clientProvides
      ? 0
      : componentCostPerUnit(
          {
            supplyId: 0,
            name: item.label,
            role: item.role,
            unit: item.unit ?? 'unidad',
            quantity: item.quantity,
            basis: item.basis,
            unitCost: item.unitCost,
          },
          packaging,
        ),
  }));
  const materialsPerUnit = materialLines.reduce((s, l) => s + l.perUnit, 0);
  const conversionPerUnit = input.waterPerUnit + input.energyPerUnit + input.laborPerUnit + input.otherPerUnit;
  const costPerUnit = materialsPerUnit + conversionPerUnit;
  const pricePerUnit = input.pricingBasis === 'paca' ? input.price / input.unitsPerPack : input.price;
  const pricePerPack = pricePerUnit * input.unitsPerPack;
  const costPerPack = costPerUnit * input.unitsPerPack;
  return {
    materialLines,
    materialsPerUnit,
    conversionPerUnit,
    costPerUnit,
    costPerPack,
    pricePerUnit,
    pricePerPack,
    profitPerPack: pricePerPack - costPerPack,
    marginPct: marginOnSales(pricePerPack, costPerPack),
  };
}
