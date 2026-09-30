// Indicadores de producción: rendimiento, desperdicio y costo real del lote.

import { costPerProducedUnit, unitsPerBasis, type CostBasis, type Packaging } from './costing';

export interface ProductionMetricsInput {
  goodUnits: number; // botellas buenas (pacas × botellas por paca)
  defectiveUnits: number;
  unitsPerPack: number;
  materialsCost: number;
  laborCost: number;
  energyCost: number;
}

export interface ProductionMetrics {
  totalUnits: number;
  yieldPct: number; // buenas ÷ totales
  wastePct: number; // defectuosas ÷ totales
  laborPerUnit: number;
  energyPerUnit: number;
  materialsPerUnit: number;
  totalCost: number;
  costPerUnit: number; // costo real por botella buena
  costPerPack: number;
}

export function productionMetrics(input: ProductionMetricsInput): ProductionMetrics {
  const totalUnits = input.goodUnits + input.defectiveUnits;
  const totalCost = input.materialsCost + input.laborCost + input.energyCost;
  const costPerUnit = costPerProducedUnit(totalCost, input.goodUnits);
  return {
    totalUnits,
    yieldPct: totalUnits > 0 ? input.goodUnits / totalUnits : 0,
    wastePct: totalUnits > 0 ? input.defectiveUnits / totalUnits : 0,
    laborPerUnit: costPerProducedUnit(input.laborCost, input.goodUnits),
    energyPerUnit: costPerProducedUnit(input.energyCost, input.goodUnits),
    materialsPerUnit: costPerProducedUnit(input.materialsCost, input.goodUnits),
    totalCost,
    costPerUnit,
    costPerPack: costPerUnit * input.unitsPerPack,
  };
}

/**
 * Consumo teórico de un insumo en una producción.
 * - Base "unidad": se consume también en las botellas defectuosas.
 * - Base "paca" / "estiba": se consume solo en producto bueno empacado.
 */
export function theoreticalConsumption(
  quantity: number,
  basis: CostBasis,
  packaging: Packaging,
  goodUnits: number,
  defectiveUnits: number,
): number {
  if (basis === 'unidad') return quantity * (goodUnits + defectiveUnits);
  return (quantity * goodUnits) / unitsPerBasis(basis, packaging);
}

/** Promedio ponderado costo/unidades de varios turnos (ej. mano de obra real por botella). */
export function weightedCostPerUnit(runs: { cost: number; units: number }[]): number | null {
  const units = runs.reduce((s, r) => s + r.units, 0);
  if (units <= 0) return null;
  return runs.reduce((s, r) => s + r.cost, 0) / units;
}
