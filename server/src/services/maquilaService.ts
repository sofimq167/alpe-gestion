// Servicios de maquila: estructura de costos propia (el cliente puede aportar materiales).
import { computeMaquilaCost, COMPONENT_ROLE_LABEL, type ComponentRole } from '@alpe/shared';
import { query, queryOne, pool, type Db } from '../database/pool';
import { notFound } from '../utils/http';

export async function loadMaquilaService(id: number, db: Db = pool) {
  const service = await queryOne(
    `SELECT ms.*, c.name AS client_name FROM maquila_services ms JOIN clients c ON c.id = ms.client_id WHERE ms.id = $1`,
    [id],
    db,
  );
  if (!service) throw notFound('El servicio de maquila');
  const items = await query(
    `SELECT i.*, s.name AS supply_name, s.unit AS supply_unit, s.current_cost AS supply_cost, s.is_inventoried
     FROM maquila_service_items i LEFT JOIN supplies s ON s.id = i.supply_id
     WHERE i.service_id = $1 ORDER BY i.id`,
    [id],
    db,
  );
  return { ...service, items, calculation: maquilaCalculation(service, items) };
}

export function maquilaCalculation(service: any, items: any[]) {
  return computeMaquilaCost({
    unitsPerPack: service.units_per_pack,
    items: items.map((i) => ({
      role: i.role,
      label: i.client_provides
        ? `${COMPONENT_ROLE_LABEL[i.role as ComponentRole] ?? i.role} (aporta el cliente)`
        : (i.supply_name ?? i.role),
      clientProvides: i.client_provides,
      unitCost: i.supply_cost ?? 0,
      quantity: i.quantity,
      basis: i.basis,
      unit: i.supply_unit,
    })),
    waterPerUnit: service.water_cost_per_unit,
    energyPerUnit: service.energy_cost_per_unit,
    laborPerUnit: service.labor_cost_per_unit,
    otherPerUnit: service.other_cost_per_unit,
    pricingBasis: service.pricing_basis,
    price: service.price,
  });
}

export async function listMaquilaServices(db: Db = pool) {
  const services = await query(
    `SELECT ms.*, c.name AS client_name,
       COALESCE((SELECT SUM(packs_remaining) FROM lots l WHERE l.maquila_service_id = ms.id), 0)::int AS stock_packs
     FROM maquila_services ms JOIN clients c ON c.id = ms.client_id ORDER BY ms.active DESC, c.name, ms.name`,
    [],
    db,
  );
  const items = await query(
    `SELECT i.*, s.name AS supply_name, s.unit AS supply_unit, s.current_cost AS supply_cost
     FROM maquila_service_items i LEFT JOIN supplies s ON s.id = i.supply_id ORDER BY i.id`,
    [],
    db,
  );
  return services.map((s) => {
    const own = items.filter((i) => i.service_id === s.id);
    return { ...s, items: own, calculation: maquilaCalculation(s, own) };
  });
}
