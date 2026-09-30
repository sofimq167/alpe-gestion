import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../database/pool';
import { requireModule } from '../middleware/auth';
import { listMaquilaServices, loadMaquilaService } from '../services/maquilaService';
import { badRequest, h, idParam } from '../utils/http';
import { money, optText, posInt } from '../utils/validators';

export const maquilaRouter = Router();

const serviceSchema = z.object({
  clientId: posInt,
  name: z.string().trim().min(1),
  volumeMl: posInt,
  unitsPerPack: posInt,
  pricingBasis: z.enum(['botella', 'paca']),
  price: money,
  waterCostPerUnit: money.default(0),
  energyCostPerUnit: money.default(0),
  laborCostPerUnit: money.default(0),
  otherCostPerUnit: money.default(0),
  active: z.boolean().default(true),
  notes: optText,
  items: z
    .array(
      z.object({
        role: z.string().trim().min(1),
        clientProvides: z.boolean(),
        supplyId: z.coerce.number().int().positive().optional().nullable(),
        quantity: z.coerce.number().positive().default(1),
        basis: z.enum(['unidad', 'paca', 'estiba']).default('unidad'),
      }),
    )
    .default([]),
});

maquilaRouter.get(
  '/services',
  h(async (_req, res) => {
    res.json(await listMaquilaServices());
  }),
);

maquilaRouter.get(
  '/services/:id',
  h(async (req, res) => {
    const service = await loadMaquilaService(idParam(req));
    const lots = await query(
      `SELECT * FROM lots WHERE maquila_service_id = $1 ORDER BY production_date DESC, id DESC LIMIT 100`,
      [service.id],
    );
    res.json({ ...service, lots });
  }),
);

async function saveService(id: number | null, d: z.infer<typeof serviceSchema>) {
  for (const i of d.items) {
    if (!i.clientProvides && !i.supplyId) throw badRequest(`Seleccione el insumo que aporta la empresa para "${i.role}".`);
  }
  const client = await queryOne(
    'SELECT c.id, cp.is_maquila FROM clients c JOIN client_profiles cp ON cp.id = c.profile_id WHERE c.id = $1',
    [d.clientId],
  );
  if (!client) throw badRequest('El cliente no existe.');
  return withTransaction(async (db) => {
    const values = [
      d.clientId,
      d.name,
      d.volumeMl,
      d.unitsPerPack,
      d.pricingBasis,
      d.price,
      d.waterCostPerUnit,
      d.energyCostPerUnit,
      d.laborCostPerUnit,
      d.otherCostPerUnit,
      d.active,
      d.notes,
    ];
    const row = id
      ? await queryOne(
          `UPDATE maquila_services SET client_id=$1, name=$2, volume_ml=$3, units_per_pack=$4, pricing_basis=$5, price=$6,
             water_cost_per_unit=$7, energy_cost_per_unit=$8, labor_cost_per_unit=$9, other_cost_per_unit=$10, active=$11, notes=$12
           WHERE id=$13 RETURNING *`,
          [...values, id],
          db,
        )
      : await queryOne(
          `INSERT INTO maquila_services (client_id, name, volume_ml, units_per_pack, pricing_basis, price, water_cost_per_unit,
             energy_cost_per_unit, labor_cost_per_unit, other_cost_per_unit, active, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          values,
          db,
        );
    if (!row) throw badRequest('El servicio de maquila no existe.');
    await query('DELETE FROM maquila_service_items WHERE service_id = $1', [row.id], db);
    for (const i of d.items) {
      await query(
        'INSERT INTO maquila_service_items (service_id, role, client_provides, supply_id, quantity, basis) VALUES ($1,$2,$3,$4,$5,$6)',
        [row.id, i.role, i.clientProvides, i.clientProvides ? null : i.supplyId, i.quantity, i.basis],
        db,
      );
    }
    return row;
  });
}

maquilaRouter.post(
  '/services',
  requireModule('maquila'),
  h(async (req, res) => {
    res.status(201).json(await saveService(null, serviceSchema.parse(req.body)));
  }),
);

maquilaRouter.put(
  '/services/:id',
  requireModule('maquila'),
  h(async (req, res) => {
    res.json(await saveService(idParam(req), serviceSchema.parse(req.body)));
  }),
);
