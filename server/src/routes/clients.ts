import { Router } from 'express';
import { z } from 'zod';
import { resolveSpecialPrice, todayISO } from '@alpe/shared';
import { env } from '../config/env';
import { query, queryOne } from '../database/pool';
import { requireModule } from '../middleware/auth';
import { loadCostContext, productSummary } from '../services/costService';
import { loadClientPricing, quoteLine, quoteOrder } from '../services/pricingService';
import { listReceivables } from '../services/receivableService';
import { badRequest, conflict, h, idParam, notFound } from '../utils/http';
import { isoDate, money, nonNegInt, optText, pct, posInt } from '../utils/validators';

export const clientsRouter = Router();

const clientSchema = z.object({
  name: z.string().trim().min(1),
  document: optText,
  contactName: optText,
  phone: optText,
  email: z.string().trim().email().optional().nullable().or(z.literal('')).transform((v) => v || null),
  address: optText,
  city: optText,
  profileId: posInt,
  paymentTermDays: nonNegInt,
  freightIncluded: z.boolean(),
  freightRatePack: money.default(0),
  creditLimit: money.optional().nullable(),
  status: z.enum(['activo', 'inactivo', 'bloqueado']).default('activo'),
  notes: optText,
});

clientsRouter.get(
  '/',
  h(async (_req, res) => {
    res.json(
      await query(
        `SELECT c.*, cp.name AS profile_name, cp.is_maquila,
           COALESCE((SELECT SUM(balance) FROM receivables r WHERE r.client_id = c.id AND NOT r.annulled), 0)::numeric AS balance,
           COALESCE((SELECT SUM(balance) FROM receivables r WHERE r.client_id = c.id AND NOT r.annulled AND r.due_date < CURRENT_DATE), 0)::numeric AS overdue,
           (SELECT MAX(dispatch_date) FROM dispatches d WHERE d.client_id = c.id AND d.status = 'confirmado') AS last_dispatch
         FROM clients c JOIN client_profiles cp ON cp.id = c.profile_id
         ORDER BY c.status, c.name`,
      ),
    );
  }),
);

clientsRouter.get(
  '/:id',
  h(async (req, res) => {
    const id = idParam(req);
    const client = await queryOne(
      `SELECT c.*, cp.name AS profile_name, cp.base_discount_pct, cp.min_order_packs, cp.is_maquila
       FROM clients c JOIN client_profiles cp ON cp.id = c.profile_id WHERE c.id = $1`,
      [id],
    );
    if (!client) throw notFound('El cliente');
    const today = todayISO(env.timezone);
    const [specials, orders, dispatches, receivables] = await Promise.all([
      query(
        `SELECT sp.*, p.name AS product_name FROM client_special_prices sp JOIN products p ON p.id = sp.product_id
         WHERE sp.client_id = $1 ORDER BY sp.start_date DESC`,
        [id],
      ),
      query('SELECT id, number, order_date, status, total, margin_pct FROM orders WHERE client_id = $1 ORDER BY order_date DESC, id DESC LIMIT 30', [id]),
      query(
        `SELECT id, number, remission_number, dispatch_date, total, packs_total, status, kind FROM dispatches
         WHERE client_id = $1 ORDER BY dispatch_date DESC, id DESC LIMIT 30`,
        [id],
      ),
      listReceivables({ clientId: id }),
    ]);
    // Precios vigentes del cliente para cada presentación activa (1 paca, sin volumen)
    const ctx = await loadCostContext();
    const cp = await loadClientPricing(id);
    const prices = client.is_maquila
      ? []
      : [...ctx.products.values()]
          .filter((p) => p.active)
          .map((p) => {
            const line = quoteLine(ctx, cp, p.id, 1, today);
            return {
              productId: p.id,
              name: p.name,
              listPricePack: p.list_price_pack,
              netPricePack: line.netPricePack,
              source: line.priceSource,
              sourceLabel: line.priceSourceLabel,
              marginPct: line.marginPct,
              status: line.status,
              special: resolveSpecialPrice(cp.specials, p.id, today),
            };
          });
    res.json({
      ...client,
      specials: specials.map((s) => ({
        ...s,
        vigente: s.active && s.start_date <= today && (s.end_date === null || s.end_date >= today),
        vencido: s.end_date !== null && s.end_date < today,
      })),
      orders,
      dispatches,
      receivables,
      prices,
    });
  }),
);

clientsRouter.post(
  '/',
  requireModule('clientes'),
  h(async (req, res) => {
    const d = clientSchema.parse(req.body);
    const row = await queryOne(
      `INSERT INTO clients (name, document, contact_name, phone, email, address, city, profile_id, payment_term_days, freight_included,
         freight_rate_pack, credit_limit, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [d.name, d.document, d.contactName, d.phone, d.email, d.address, d.city, d.profileId, d.paymentTermDays, d.freightIncluded, d.freightRatePack, d.creditLimit ?? null, d.status, d.notes],
    );
    res.status(201).json(row);
  }),
);

clientsRouter.put(
  '/:id',
  requireModule('clientes'),
  h(async (req, res) => {
    const id = idParam(req);
    const d = clientSchema.parse(req.body);
    const row = await queryOne(
      `UPDATE clients SET name=$1, document=$2, contact_name=$3, phone=$4, email=$5, address=$6, city=$7, profile_id=$8,
         payment_term_days=$9, freight_included=$10, freight_rate_pack=$11, credit_limit=$12, status=$13, notes=$14
       WHERE id=$15 RETURNING *`,
      [d.name, d.document, d.contactName, d.phone, d.email, d.address, d.city, d.profileId, d.paymentTermDays, d.freightIncluded, d.freightRatePack, d.creditLimit ?? null, d.status, d.notes, id],
    );
    if (!row) throw notFound('El cliente');
    res.json(row);
  }),
);

// ---- Precios especiales ----
const specialSchema = z
  .object({
    productId: posInt,
    pricePack: z.coerce.number().positive('debe ser mayor que cero'),
    startDate: isoDate,
    endDate: isoDate.optional().nullable().or(z.literal('')).transform((v) => v || null),
    allowVolumeDiscount: z.boolean().default(false),
    active: z.boolean().default(true),
    notes: optText,
  })
  .refine((d) => !d.endDate || d.endDate >= d.startDate, { message: 'La fecha de vencimiento debe ser posterior a la de inicio.', path: ['endDate'] });

clientsRouter.post(
  '/:id/special-prices',
  requireModule('clientes'),
  h(async (req, res) => {
    const clientId = idParam(req);
    const d = specialSchema.parse(req.body);
    const row = await queryOne(
      `INSERT INTO client_special_prices (client_id, product_id, price_pack, start_date, end_date, allow_volume_discount, active, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [clientId, d.productId, d.pricePack, d.startDate, d.endDate, d.allowVolumeDiscount, d.active, d.notes, req.user!.id],
    );
    res.status(201).json(row);
  }),
);

clientsRouter.put(
  '/:id/special-prices/:spId',
  requireModule('clientes'),
  h(async (req, res) => {
    const d = specialSchema.parse(req.body);
    const row = await queryOne(
      `UPDATE client_special_prices SET product_id=$1, price_pack=$2, start_date=$3, end_date=$4, allow_volume_discount=$5, active=$6, notes=$7
       WHERE id=$8 AND client_id=$9 RETURNING *`,
      [d.productId, d.pricePack, d.startDate, d.endDate, d.allowVolumeDiscount, d.active, d.notes, idParam(req, 'spId'), idParam(req)],
    );
    if (!row) throw notFound('El precio especial');
    res.json(row);
  }),
);

clientsRouter.delete(
  '/:id/special-prices/:spId',
  requireModule('clientes'),
  h(async (req, res) => {
    await query('DELETE FROM client_special_prices WHERE id = $1 AND client_id = $2', [idParam(req, 'spId'), idParam(req)]);
    res.json({ ok: true });
  }),
);

// ================= Perfiles, listas de precios y descuentos =================
export const pricingRouter = Router();

const profileSchema = z.object({
  name: z.string().trim().min(1),
  description: optText,
  baseDiscountPct: pct,
  minOrderPacks: nonNegInt,
  paymentTermDays: nonNegInt,
  isMaquila: z.boolean().default(false),
  active: z.boolean().default(true),
});

pricingRouter.get(
  '/profiles',
  h(async (_req, res) => {
    res.json(
      await query(
        `SELECT cp.*, (SELECT COUNT(*) FROM clients c WHERE c.profile_id = cp.id)::int AS clients
         FROM client_profiles cp ORDER BY cp.is_maquila, cp.name`,
      ),
    );
  }),
);

pricingRouter.post(
  '/profiles',
  requireModule('configuracion'),
  h(async (req, res) => {
    const d = profileSchema.parse(req.body);
    res.status(201).json(
      await queryOne(
        `INSERT INTO client_profiles (name, description, base_discount_pct, min_order_packs, payment_term_days, is_maquila, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [d.name, d.description, d.baseDiscountPct, d.minOrderPacks, d.paymentTermDays, d.isMaquila, d.active],
      ),
    );
  }),
);

pricingRouter.put(
  '/profiles/:id',
  requireModule('configuracion'),
  h(async (req, res) => {
    const d = profileSchema.parse(req.body);
    const row = await queryOne(
      `UPDATE client_profiles SET name=$1, description=$2, base_discount_pct=$3, min_order_packs=$4, payment_term_days=$5, is_maquila=$6, active=$7
       WHERE id=$8 RETURNING *`,
      [d.name, d.description, d.baseDiscountPct, d.minOrderPacks, d.paymentTermDays, d.isMaquila, d.active, idParam(req)],
    );
    if (!row) throw notFound('El perfil');
    res.json(row);
  }),
);

/** Matriz de precios: presentación × perfil, con margen resultante. */
pricingRouter.get(
  '/matrix',
  h(async (_req, res) => {
    const ctx = await loadCostContext();
    const profiles = await query('SELECT * FROM client_profiles WHERE active AND NOT is_maquila ORDER BY base_discount_pct, name');
    const overrides = await query('SELECT * FROM profile_prices');
    const products = [...ctx.products.values()].filter((p) => p.active).map((p) => productSummary(ctx, p.id));
    res.json({
      profiles,
      rows: products.map((p) => ({
        product: p,
        prices: profiles.map((pr) => {
          const override = overrides.find((o) => o.profile_id === pr.id && o.product_id === p.id);
          const price = override ? override.price_pack : Math.round(p.listPricePack * (1 - pr.base_discount_pct));
          const margin = price > 0 ? (price - p.costPerPack) / price - (ctx.admin.included ? ctx.admin.pct : 0) : 0;
          return {
            profileId: pr.id,
            pricePack: price,
            isOverride: !!override,
            marginPct: margin,
            belowMin: margin < p.minMargin,
          };
        }),
      })),
    });
  }),
);

pricingRouter.put(
  '/profile-prices',
  requireModule('precios'),
  h(async (req, res) => {
    const d = z
      .object({ profileId: posInt, productId: posInt, pricePack: z.coerce.number().min(0).nullable() })
      .parse(req.body);
    if (!d.pricePack) {
      await query('DELETE FROM profile_prices WHERE profile_id = $1 AND product_id = $2', [d.profileId, d.productId]);
    } else {
      await query(
        `INSERT INTO profile_prices (profile_id, product_id, price_pack) VALUES ($1,$2,$3)
         ON CONFLICT (profile_id, product_id) DO UPDATE SET price_pack = $3, updated_at = now()`,
        [d.profileId, d.productId, Math.round(d.pricePack)],
      );
    }
    res.json({ ok: true });
  }),
);

const tierSchema = z
  .object({
    profileId: z.coerce.number().int().positive().optional().nullable(),
    basis: z.enum(['pacas', 'estibas']),
    minQty: posInt,
    maxQty: z.coerce.number().int().positive().optional().nullable(),
    discountPct: pct,
    active: z.boolean().default(true),
  })
  .refine((d) => !d.maxQty || d.maxQty >= d.minQty, { message: 'El máximo debe ser mayor o igual al mínimo.', path: ['maxQty'] });

pricingRouter.get(
  '/volume-discounts',
  h(async (_req, res) => {
    res.json(
      await query(
        `SELECT v.*, cp.name AS profile_name FROM volume_discounts v LEFT JOIN client_profiles cp ON cp.id = v.profile_id
         ORDER BY v.profile_id NULLS FIRST, v.basis, v.min_qty`,
      ),
    );
  }),
);

async function checkOverlap(d: z.infer<typeof tierSchema>, excludeId: number | null) {
  const overlap = await queryOne(
    `SELECT id FROM volume_discounts WHERE active AND basis = $1 AND profile_id IS NOT DISTINCT FROM $2 AND id <> $3
       AND min_qty <= COALESCE($5, 2147483647) AND COALESCE(max_qty, 2147483647) >= $4`,
    [d.basis, d.profileId ?? null, excludeId ?? 0, d.minQty, d.maxQty ?? null],
  );
  if (overlap) throw conflict('El rango se cruza con otro rango existente del mismo tipo y perfil.');
}

pricingRouter.post(
  '/volume-discounts',
  requireModule('precios'),
  h(async (req, res) => {
    const d = tierSchema.parse(req.body);
    if (d.active) await checkOverlap(d, null);
    res.status(201).json(
      await queryOne(
        'INSERT INTO volume_discounts (profile_id, basis, min_qty, max_qty, discount_pct, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [d.profileId ?? null, d.basis, d.minQty, d.maxQty ?? null, d.discountPct, d.active],
      ),
    );
  }),
);

pricingRouter.put(
  '/volume-discounts/:id',
  requireModule('precios'),
  h(async (req, res) => {
    const id = idParam(req);
    const d = tierSchema.parse(req.body);
    if (d.active) await checkOverlap(d, id);
    res.json(
      await queryOne(
        'UPDATE volume_discounts SET profile_id=$1, basis=$2, min_qty=$3, max_qty=$4, discount_pct=$5, active=$6 WHERE id=$7 RETURNING *',
        [d.profileId ?? null, d.basis, d.minQty, d.maxQty ?? null, d.discountPct, d.active, id],
      ),
    );
  }),
);

pricingRouter.delete(
  '/volume-discounts/:id',
  requireModule('precios'),
  h(async (req, res) => {
    await query('DELETE FROM volume_discounts WHERE id = $1', [idParam(req)]);
    res.json({ ok: true });
  }),
);

/** Cotización en vivo para el formulario de pedidos (no guarda nada). */
pricingRouter.post(
  '/quote',
  h(async (req, res) => {
    const d = z
      .object({
        clientId: posInt,
        date: isoDate,
        items: z.array(z.object({ productId: posInt, packs: posInt })).min(1),
      })
      .parse(req.body);
    const ctx = await loadCostContext();
    const cp = await loadClientPricing(d.clientId);
    if (cp.profile.is_maquila) throw badRequest('Este cliente es de maquila: use el módulo Maquila.');
    res.json(quoteOrder(ctx, cp, d.items, d.date));
  }),
);

