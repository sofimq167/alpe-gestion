// Movimientos de inventario (insumos y producto terminado) y conteos físicos.

export type SupplyMovementType = 'entrada' | 'consumo' | 'ajuste' | 'perdida' | 'conteo';
export type ProductMovementType = 'produccion' | 'despacho' | 'ajuste' | 'conteo' | 'perdida' | 'anulacion';

export class InventoryError extends Error {
  constructor(
    message: string,
    public code: 'CANTIDAD_INVALIDA' | 'STOCK_INSUFICIENTE',
  ) {
    super(message);
  }
}

export interface MovementResult {
  delta: number; // cambio con signo
  stockAfter: number;
}

/**
 * Aplica un movimiento de inventario.
 * - entrada / produccion / anulacion: suma la cantidad.
 * - consumo / perdida / despacho: resta la cantidad.
 * - ajuste: la cantidad lleva signo (+ o −).
 * - conteo: la cantidad es la existencia física; el delta es la diferencia.
 * Lanza error si la existencia queda negativa, salvo que se permita explícitamente.
 */
export function applyMovement(
  currentStock: number,
  type: SupplyMovementType | ProductMovementType,
  quantity: number,
  options: { allowNegative?: boolean } = {},
): MovementResult {
  if (!Number.isFinite(quantity)) throw new InventoryError('La cantidad no es válida.', 'CANTIDAD_INVALIDA');
  let delta: number;
  switch (type) {
    case 'entrada':
    case 'produccion':
    case 'anulacion':
      if (quantity <= 0) throw new InventoryError('La cantidad debe ser mayor que cero.', 'CANTIDAD_INVALIDA');
      delta = quantity;
      break;
    case 'consumo':
    case 'perdida':
    case 'despacho':
      if (quantity <= 0) throw new InventoryError('La cantidad debe ser mayor que cero.', 'CANTIDAD_INVALIDA');
      delta = -quantity;
      break;
    case 'ajuste':
      if (quantity === 0) throw new InventoryError('El ajuste no puede ser cero.', 'CANTIDAD_INVALIDA');
      delta = quantity;
      break;
    case 'conteo':
      if (quantity < 0) throw new InventoryError('El conteo físico no puede ser negativo.', 'CANTIDAD_INVALIDA');
      delta = quantity - currentStock;
      break;
    default:
      throw new InventoryError('Tipo de movimiento no válido.', 'CANTIDAD_INVALIDA');
  }
  const stockAfter = roundQty(currentStock + delta);
  if (stockAfter < 0 && !options.allowNegative) {
    throw new InventoryError(
      `Existencia insuficiente: hay ${roundQty(currentStock)} y se requieren ${roundQty(-delta)}.`,
      'STOCK_INSUFICIENTE',
    );
  }
  return { delta: roundQty(delta), stockAfter };
}

function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface CountDifference {
  systemQty: number;
  physicalQty: number;
  difference: number; // físico − sistema
  differenceValue: number;
  differencePct: number;
  relevant: boolean;
}

/** Diferencia entre existencia teórica y conteo físico. */
export function countDifference(
  systemQty: number,
  physicalQty: number,
  unitValue: number,
  thresholdPct = 0.02,
): CountDifference {
  const difference = roundQty(physicalQty - systemQty);
  const differencePct = systemQty !== 0 ? difference / Math.abs(systemQty) : difference !== 0 ? 1 : 0;
  return {
    systemQty,
    physicalQty,
    difference,
    differenceValue: difference * unitValue,
    differencePct,
    relevant: Math.abs(differencePct) >= thresholdPct && difference !== 0,
  };
}

/** Valor del inventario = Σ existencia × costo unitario (ignora existencias negativas). */
export function inventoryValue(items: { qty: number; unitCost: number }[]): number {
  return items.reduce((s, i) => s + Math.max(i.qty, 0) * i.unitCost, 0);
}

export interface LotBalance {
  lotId: number;
  code: string;
  packsRemaining: number;
}

export interface LotAllocation {
  lotId: number;
  code: string;
  packs: number;
}

/**
 * Asigna pacas a lotes: primero el lote preferido (si se indica), luego los más antiguos (FIFO).
 * Retorna las asignaciones y las pacas que no se pudieron asignar a ningún lote.
 */
export function allocateLots(
  lots: LotBalance[],
  packs: number,
  preferredLotId?: number | null,
): { allocations: LotAllocation[]; unallocated: number } {
  const ordered = [...lots].sort((a, b) =>
    a.lotId === preferredLotId ? -1 : b.lotId === preferredLotId ? 1 : 0,
  );
  let pending = packs;
  const allocations: LotAllocation[] = [];
  for (const lot of ordered) {
    if (pending <= 0) break;
    if (lot.packsRemaining <= 0) continue;
    const take = Math.min(lot.packsRemaining, pending);
    allocations.push({ lotId: lot.lotId, code: lot.code, packs: take });
    pending -= take;
  }
  return { allocations, unallocated: pending };
}
