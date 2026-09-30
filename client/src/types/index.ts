// Tipos de las respuestas de la API usadas en varias pantallas.
import type { BlowComparison, BlowConfig, MarginStatus, PackPricing, ProductCostResult, ResolvedAdmin } from '@alpe/shared';

export interface ProductSummary {
  id: number;
  code: string | null;
  name: string;
  volumeMl: number;
  unitsPerPack: number;
  packsPerPallet: number;
  weightKgPack: number | null;
  active: boolean;
  minMargin: number;
  targetMargin: number;
  listPricePack: number;
  priceUpdatedAt: string;
  useBlown: boolean;
  hasBlowConfig: boolean;
  stockPacks: number;
  minStockPacks: number;
  stdLaborPerUnit: number;
  stdEnergyPerUnit: number;
  notes: string | null;
  containerSource: 'comprado' | 'soplado';
  costPerUnit: number;
  costPerPack: number;
  costPerPallet: number;
  adminIncluded: boolean;
  priceUnit: number;
  marginPct: number;
  markupPct: number;
  profitPerPack: number;
  suggestedPricePack: number;
  minPricePack: number;
  status: MarginStatus;
}

export interface ProductDetail {
  summary: ProductSummary;
  admin: ResolvedAdmin;
  bought: { cost: ProductCostResult; pricing: PackPricing };
  blown: { cost: ProductCostResult; pricing: PackPricing } | null;
  blowConfig: BlowConfig | null;
  comparison: BlowComparison | null;
  monthlyPacks: number;
  monthlyPacksDays: number;
  components: {
    id: number;
    supply_id: number;
    supply_name: string;
    unit: string;
    current_cost: number;
    role: string;
    quantity: number;
    basis: 'unidad' | 'paca' | 'estiba';
    category: string;
  }[];
  blowRaw: {
    preform_supply_id: number;
    energy_per_unit: number;
    labor_per_unit: number;
    waste_pct: number;
    overhead_per_unit: number;
    notes: string | null;
  } | null;
  priceHistory: { id: number; old_price: number | null; new_price: number; changed_at: string; user_name: string | null; reason: string | null }[];
}

export interface Supply {
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
  notes: string | null;
  cost_updated_at: string;
  used_by: number;
  used_by_names: string[];
}

export interface Profile {
  id: number;
  name: string;
  description: string | null;
  base_discount_pct: number;
  min_order_packs: number;
  payment_term_days: number;
  is_maquila: boolean;
  active: boolean;
  clients: number;
}

export interface Client {
  id: number;
  name: string;
  document: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  profile_id: number;
  profile_name: string;
  is_maquila: boolean;
  payment_term_days: number;
  freight_included: boolean;
  freight_rate_pack: number;
  credit_limit: number | null;
  status: 'activo' | 'inactivo' | 'bloqueado';
  notes: string | null;
  balance: number;
  overdue: number;
  last_dispatch: string | null;
}

export interface Settings {
  company: { name: string; nit: string; address: string; city: string; phone: string; email: string };
  admin_expenses: { enabled: boolean; mode: 'pct_ventas' | 'por_unidad' | 'mensual'; pct: number; perUnit: number; monthlyAmount: number; fallbackMonthlyUnits: number };
  production: { lookbackDays: number; shifts: string[]; shelfLifeDays: number; laborHourCost: number; energyKwhCost: number };
  pricing: { roundingStep: number; defaultMinMargin: number; defaultTargetMargin: number };
  operations: { dueSoonDays: number; countDiffThresholdPct: number; monthlyPacksLookbackDays: number };
}

export interface MaquilaService {
  id: number;
  client_id: number;
  client_name: string;
  name: string;
  volume_ml: number;
  units_per_pack: number;
  pricing_basis: 'botella' | 'paca';
  price: number;
  water_cost_per_unit: number;
  energy_cost_per_unit: number;
  labor_cost_per_unit: number;
  other_cost_per_unit: number;
  active: boolean;
  notes: string | null;
  stock_packs: number;
  items: { id: number; role: string; client_provides: boolean; supply_id: number | null; supply_name: string | null; quantity: number; basis: 'unidad' | 'paca' | 'estiba'; supply_cost: number | null }[];
  calculation: {
    materialLines: { role: string; label: string; clientProvides: boolean; perUnit: number }[];
    materialsPerUnit: number;
    conversionPerUnit: number;
    costPerUnit: number;
    costPerPack: number;
    pricePerUnit: number;
    pricePerPack: number;
    profitPerPack: number;
    marginPct: number;
  };
}
