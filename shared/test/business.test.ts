import { describe, expect, it } from 'vitest';
import {
  addDays,
  allocateLots,
  applyMovement,
  applyPayment,
  blownContainerCost,
  compareBlowScenario,
  computeLinePrice,
  computeMaquilaCost,
  computeOrderTotals,
  computeProductCost,
  costPerProducedUnit,
  countDifference,
  evaluatePackPricing,
  findVolumeDiscount,
  formatCOP,
  formatPct,
  inventoryValue,
  marginOnSales,
  markupOnCost,
  priceForMargin,
  productionMetrics,
  receivableBalance,
  receivableStatus,
  resolveAdminExpense,
  resolveSpecialPrice,
  theoreticalConsumption,
  type CostComponent,
  type VolumeTier,
} from '../src';

const noAdmin = { included: false, mode: 'pct_ventas' as const, perUnit: 0, pct: 0, description: '' };
const pack18 = { unitsPerPack: 18, packsPerPallet: 80 };

describe('formato', () => {
  it('muestra pesos colombianos sin decimales', () => {
    expect(formatCOP(125400)).toBe('$125.400');
    expect(formatCOP(-13000)).toBe('-$13.000');
    expect(formatPct(0.245)).toBe('24,5%');
  });
  it('suma días a fechas ISO', () => {
    expect(addDays('2026-09-15', 30)).toBe('2026-10-15');
  });
});

describe('margen y precio', () => {
  it('calcula el precio con margen sobre ventas, no con markup', () => {
    expect(priceForMargin(10000, 0.2)).toBeCloseTo(12500, 6);
    expect(priceForMargin(10000, 0.2)).not.toBeCloseTo(12000, 0);
  });
  it('calcula margen sobre ventas y markup', () => {
    expect(marginOnSales(12500, 10000)).toBeCloseTo(0.2, 6);
    expect(markupOnCost(12500, 10000)).toBeCloseTo(0.25, 6);
    expect(marginOnSales(15500, 11700)).toBeCloseTo(0.2452, 3);
  });
  it('incluye gasto administrativo como % de ventas', () => {
    expect(priceForMargin(10000, 0.2, 0.05)).toBeCloseTo(13333.33, 1);
    expect(marginOnSales(13333.33, 10000, 0.05)).toBeCloseTo(0.2, 3);
  });
  it('rechaza márgenes imposibles', () => {
    expect(() => priceForMargin(1000, 1)).toThrow();
    expect(() => priceForMargin(1000, -0.1)).toThrow();
  });
  it('evalúa estado del margen frente a mínimo y objetivo', () => {
    const r = evaluatePackPricing({ costPerPack: 11700, pricePack: 13000, unitsPerPack: 18, targetMargin: 0.25, minMargin: 0.15 });
    expect(r.status).toBe('bajo_minimo');
    expect(r.suggestedPricePack).toBe(15600); // 11700/0.75 = 15600
  });
});

describe('costo por botella, paca y estiba', () => {
  const components: CostComponent[] = [
    { supplyId: 1, name: 'Envase 600', role: 'envase', unit: 'unidad', quantity: 1, basis: 'unidad', unitCost: 300 },
    { supplyId: 2, name: 'Tapa', role: 'tapa', unit: 'unidad', quantity: 1, basis: 'unidad', unitCost: 40 },
    { supplyId: 3, name: 'Termo', role: 'termoencogible', unit: 'kg', quantity: 0.09, basis: 'paca', unitCost: 10000 },
    { supplyId: 4, name: 'Estiba', role: 'estiba', unit: 'unidad', quantity: 1, basis: 'estiba', unitCost: 14400 },
  ];
  it('suma componentes y calcula por paca y estiba', () => {
    const r = computeProductCost({
      packaging: pack18,
      components,
      laborPerUnit: 20,
      laborSource: '',
      energyPerUnit: 15,
      energySource: '',
      useBlown: false,
      admin: noAdmin,
    });
    // 300 + 40 + 900/18=50 + 14400/1440=10 + 20 + 15 = 435
    expect(r.costPerUnit).toBeCloseTo(435, 6);
    expect(r.costPerPack).toBeCloseTo(7830, 6);
    expect(r.costPerPallet).toBeCloseTo(7830 * 80, 6);
  });
  it('reemplaza el envase comprado por el soplado cuando se activa', () => {
    const blow = { preformCost: 180, energyPerUnit: 12, laborPerUnit: 8, wastePct: 0.1, overheadPerUnit: 10 };
    expect(blownContainerCost(blow)).toBeCloseTo(230, 6); // 180/0.9 + 30
    const base = { packaging: pack18, components, laborPerUnit: 20, laborSource: '', energyPerUnit: 15, energySource: '', blow, admin: noAdmin };
    const bought = computeProductCost({ ...base, useBlown: false });
    const blown = computeProductCost({ ...base, useBlown: true });
    const cmp = compareBlowScenario(bought, blown, 18, 1000);
    expect(cmp.savingPerUnit).toBeCloseTo(70, 6);
    expect(cmp.savingPerPack).toBeCloseTo(1260, 6);
    expect(cmp.monthlySaving).toBeCloseTo(1260000, 6);
  });
  it('agrega gasto administrativo por unidad o mensual', () => {
    const cfg = { enabled: true, mode: 'mensual' as const, pct: 0, perUnit: 0, monthlyAmount: 1_000_000, fallbackMonthlyUnits: 0 };
    expect(resolveAdminExpense(cfg, 100_000).perUnit).toBe(10);
    expect(resolveAdminExpense({ ...cfg, enabled: false }, 100_000).included).toBe(false);
  });
});

describe('mano de obra y energía por producción real', () => {
  it('divide el costo del turno entre las botellas producidas', () => {
    expect(costPerProducedUnit(400000, 20000)).toBe(20);
    expect(costPerProducedUnit(400000, 0)).toBe(0);
  });
  it('calcula rendimiento, desperdicio y costo real del lote', () => {
    const m = productionMetrics({ goodUnits: 19800, defectiveUnits: 200, unitsPerPack: 18, materialsCost: 7_000_000, laborCost: 400000, energyCost: 196000 });
    expect(m.yieldPct).toBeCloseTo(0.99, 6);
    expect(m.wastePct).toBeCloseTo(0.01, 6);
    expect(m.costPerUnit).toBeCloseTo(7_596_000 / 19800, 6);
    expect(m.costPerPack).toBeCloseTo((7_596_000 / 19800) * 18, 6);
  });
  it('calcula consumo teórico por base', () => {
    expect(theoreticalConsumption(1, 'unidad', pack18, 1800, 20)).toBe(1820);
    expect(theoreticalConsumption(0.09, 'paca', pack18, 1800, 20)).toBeCloseTo(9, 6);
  });
});

describe('descuentos por volumen y precio especial', () => {
  const tiers: VolumeTier[] = [
    { basis: 'pacas', minQty: 50, maxQty: 99, discountPct: 0.03, profileId: null },
    { basis: 'pacas', minQty: 100, maxQty: 199, discountPct: 0.05, profileId: null },
    { basis: 'pacas', minQty: 200, maxQty: null, discountPct: 0.07, profileId: null },
    { basis: 'estibas', minQty: 3, maxQty: null, discountPct: 0.08, profileId: 2 },
  ];
  it('aplica el rango correcto por pacas', () => {
    expect(findVolumeDiscount(tiers, 49, 80, null).pct).toBe(0);
    expect(findVolumeDiscount(tiers, 50, 80, null).pct).toBe(0.03);
    expect(findVolumeDiscount(tiers, 150, 80, null).pct).toBe(0.05);
    expect(findVolumeDiscount(tiers, 200, 80, null).pct).toBe(0.07);
  });
  it('aplica rangos por estiba solo al perfil indicado y toma el mayor', () => {
    expect(findVolumeDiscount(tiers, 240, 80, 2).pct).toBe(0.08);
    expect(findVolumeDiscount(tiers, 240, 80, 1).pct).toBe(0.07);
  });
  it('usa el precio especial vigente y vuelve al normal al vencer', () => {
    const specials = [{ productId: 1, pricePack: 14000, startDate: '2026-09-01', endDate: '2026-09-30', allowVolumeDiscount: false }];
    expect(resolveSpecialPrice(specials, 1, '2026-09-15')?.pricePack).toBe(14000);
    expect(resolveSpecialPrice(specials, 1, '2026-10-01')).toBeNull();
    expect(resolveSpecialPrice(specials, 2, '2026-09-15')).toBeNull();
  });
  it('combina descuento de perfil y volumen en la línea', () => {
    const line = computeLinePrice({
      productId: 1, packs: 100, unitsPerPack: 18, packsPerPallet: 80, basePricePack: 16000,
      profileId: 3, profileDiscountPct: 0.08, tiers, unitCostPack: 11700, minMargin: 0.15, targetMargin: 0.25,
    });
    // 16000 × 0,92 = 14720 × 0,95 = 13984
    expect(line.netPricePack).toBe(13984);
    expect(line.lineTotal).toBe(1_398_400);
    expect(line.discountAmount).toBe(1_600_000 - 1_398_400);
    expect(line.marginPct).toBeCloseTo((13984 - 11700) / 13984, 6);
  });
  it('el precio especial no acumula volumen salvo que se permita', () => {
    const special = { productId: 1, pricePack: 14000, startDate: '2026-01-01', endDate: null, allowVolumeDiscount: false };
    const base = { productId: 1, packs: 100, unitsPerPack: 18, packsPerPallet: 80, basePricePack: 16000, profileId: 3, profileDiscountPct: 0.08, tiers, unitCostPack: 11700, minMargin: 0.15, targetMargin: 0.25 };
    expect(computeLinePrice({ ...base, special }).netPricePack).toBe(14000);
    expect(computeLinePrice({ ...base, special: { ...special, allowVolumeDiscount: true } }).netPricePack).toBe(13300);
  });
  it('calcula flete cobrado o asumido en los totales', () => {
    const lines = [{ packs: 100, grossTotal: 1_600_000, discountAmount: 100_000, lineTotal: 1_500_000, costTotal: 1_170_000 }];
    const charged = computeOrderTotals({ lines, freightIncluded: false, freightRatePack: 300 });
    expect(charged.total).toBe(1_530_000);
    expect(charged.costTotal).toBe(1_170_000);
    const assumed = computeOrderTotals({ lines, freightIncluded: true, freightRatePack: 300 });
    expect(assumed.total).toBe(1_500_000);
    expect(assumed.costTotal).toBe(1_200_000);
  });
});

describe('maquila', () => {
  it('solo cuenta como costo los materiales que aporta la empresa', () => {
    const r = computeMaquilaCost({
      unitsPerPack: 24,
      items: [
        { role: 'envase', label: 'Envase', clientProvides: true, unitCost: 250, quantity: 1, basis: 'unidad' },
        { role: 'tapa', label: 'Tapa', clientProvides: false, unitCost: 40, quantity: 1, basis: 'unidad' },
        { role: 'termoencogible', label: 'Termo', clientProvides: false, unitCost: 9600, quantity: 0.1, basis: 'paca' },
      ],
      waterPerUnit: 5, energyPerUnit: 15, laborPerUnit: 20, otherPerUnit: 0,
      pricingBasis: 'paca', price: 3600,
    });
    expect(r.materialsPerUnit).toBeCloseTo(40 + 40, 6); // tapa 40 + 960/24
    expect(r.costPerUnit).toBeCloseTo(120, 6);
    expect(r.pricePerUnit).toBeCloseTo(150, 6);
    expect(r.marginPct).toBeCloseTo(0.2, 6);
  });
});

describe('inventario', () => {
  it('aplica entradas, consumos, ajustes y conteos', () => {
    expect(applyMovement(100, 'entrada', 50).stockAfter).toBe(150);
    expect(applyMovement(100, 'consumo', 30).stockAfter).toBe(70);
    expect(applyMovement(100, 'ajuste', -5).stockAfter).toBe(95);
    expect(applyMovement(830, 'conteo', 817)).toEqual({ delta: -13, stockAfter: 817 });
    expect(applyMovement(10, 'despacho', 10).stockAfter).toBe(0);
  });
  it('no permite cantidades negativas ni dejar existencia negativa sin autorización', () => {
    expect(() => applyMovement(100, 'entrada', -5)).toThrow();
    expect(() => applyMovement(10, 'despacho', 20)).toThrow(/insuficiente/);
    expect(applyMovement(10, 'despacho', 20, { allowNegative: true }).stockAfter).toBe(-10);
  });
  it('calcula diferencias de conteo y valor del inventario', () => {
    const d = countDifference(830, 817, 11700);
    expect(d.difference).toBe(-13);
    expect(d.differenceValue).toBe(-152100);
    expect(inventoryValue([{ qty: 10, unitCost: 100 }, { qty: -3, unitCost: 100 }])).toBe(1000);
  });
  it('asigna lotes FIFO respetando el lote preferido', () => {
    const lots = [
      { lotId: 1, code: 'A', packsRemaining: 30 },
      { lotId: 2, code: 'B', packsRemaining: 50 },
    ];
    expect(allocateLots(lots, 40).allocations).toEqual([
      { lotId: 1, code: 'A', packs: 30 },
      { lotId: 2, code: 'B', packs: 10 },
    ]);
    expect(allocateLots(lots, 40, 2).allocations[0]).toEqual({ lotId: 2, code: 'B', packs: 40 });
    expect(allocateLots(lots, 100).unallocated).toBe(20);
  });
});

describe('cartera', () => {
  it('actualiza el saldo después de un pago parcial y total', () => {
    const after = applyPayment(1_500_000, 500_000);
    expect(after).toBe(1_000_000);
    expect(applyPayment(after, 1_000_000)).toBe(0);
    expect(receivableBalance(1_500_000, [500_000, 200_000])).toBe(800_000);
  });
  it('no permite pagos mayores al saldo o no positivos', () => {
    expect(() => applyPayment(100_000, 200_000)).toThrow();
    expect(() => applyPayment(100_000, 0)).toThrow();
  });
  it('determina el estado según vencimiento', () => {
    expect(receivableStatus(0, '2026-09-01', '2026-09-30')).toBe('pagada');
    expect(receivableStatus(1000, '2026-09-01', '2026-09-30')).toBe('vencida');
    expect(receivableStatus(1000, '2026-10-03', '2026-09-30')).toBe('por_vencer');
    expect(receivableStatus(1000, '2026-11-30', '2026-09-30')).toBe('al_dia');
  });
});
