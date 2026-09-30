// Datos de demostración realistas para una embotelladora de agua colombiana.
// Se generan usando los mismos servicios de la aplicación, por lo que inventario, lotes,
// despachos, cartera y costos quedan consistentes entre sí.
import { addDays, priceForMargin, roundPriceUp, todayISO } from '@alpe/shared';
import { env } from '../config/env';
import { loadCostContext, productCost } from '../services/costService';
import { createSaleDispatch, createMaquilaDispatch } from '../services/dispatchService';
import { createOrder } from '../services/orderService';
import { createProduction } from '../services/productionService';
import { registerPayment } from '../services/receivableService';
import { saveSetting } from '../services/settingsService';
import { moveProduct, moveSupply, registerPhysicalCount } from '../services/inventoryService';
import { pool, query, queryOne, withTransaction } from './pool';

// Generador pseudoaleatorio con semilla (resultados repetibles)
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const rand = rng(20260930);
const between = (a: number, b: number) => Math.round(a + rand() * (b - a));
const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];

type SupplySeed = [code: string, name: string, category: string, unit: string, cost: number, supplier: string, inventoried: boolean, minStock: number];

const SUPPLIES: SupplySeed[] = [
  ['PRE-13', 'Preforma PET 13 g (300 ml)', 'preforma', 'unidad', 148, 'Plásticos Andinos S.A.S.', true, 10000],
  ['PRE-20', 'Preforma PET 20 g (500–600 ml)', 'preforma', 'unidad', 188, 'Plásticos Andinos S.A.S.', true, 20000],
  ['PRE-32', 'Preforma PET 32 g (1.000 ml)', 'preforma', 'unidad', 262, 'Plásticos Andinos S.A.S.', true, 2000],
  ['PRE-42', 'Preforma PET 42 g (1.500 ml)', 'preforma', 'unidad', 318, 'Plásticos Andinos S.A.S.', true, 2000],
  ['ENV-300', 'Envase PET 300 ml comprado', 'envase', 'unidad', 232, 'Envases de Colombia S.A.', true, 2000],
  ['ENV-500', 'Envase PET 500 ml comprado', 'envase', 'unidad', 268, 'Envases de Colombia S.A.', true, 2000],
  ['ENV-600', 'Envase PET 600 ml comprado', 'envase', 'unidad', 286, 'Envases de Colombia S.A.', true, 4000],
  ['ENV-1000', 'Envase PET 1.000 ml comprado', 'envase', 'unidad', 385, 'Envases de Colombia S.A.', true, 4000],
  ['ENV-1500', 'Envase PET 1.500 ml comprado', 'envase', 'unidad', 472, 'Envases de Colombia S.A.', true, 4000],
  ['GAR-5L', 'Garrafa PET 5 litros con asa', 'envase', 'unidad', 1150, 'Envases de Colombia S.A.', true, 300],
  ['TAP-28', 'Tapa rosca 28 mm', 'tapa', 'unidad', 41, 'Tapas y Cierres Ltda.', true, 30000],
  ['TAP-48', 'Tapa 48 mm garrafa', 'tapa', 'unidad', 118, 'Tapas y Cierres Ltda.', true, 300],
  ['ETQ-P', 'Etiqueta termoencogible pequeña', 'etiqueta', 'unidad', 27, 'Litografía La Sabana', true, 30000],
  ['ETQ-G', 'Etiqueta termoencogible grande', 'etiqueta', 'unidad', 38, 'Litografía La Sabana', true, 5000],
  ['ETQ-5L', 'Etiqueta garrafa 5 L', 'etiqueta', 'unidad', 84, 'Litografía La Sabana', true, 300],
  ['TER', 'Película termoencogible para paca', 'termoencogible', 'kg', 11800, 'Polímeros del Centro', true, 150],
  ['STR', 'Plástico stretch para estiba', 'plastico', 'kg', 9600, 'Polímeros del Centro', true, 10],
  ['EST', 'Estiba de madera', 'estiba', 'unidad', 18000, 'Maderas El Roble', true, 20],
  ['AGUA', 'Agua tratada (captación, filtración y ozono)', 'agua', 'litro', 4.2, '', false, 0],
  ['KWH', 'Energía eléctrica (tarifa kWh)', 'energia', 'kWh', 820, 'Enel Colombia', false, 0],
  ['MO-H', 'Mano de obra operario (hora)', 'mano_obra', 'hora', 8500, '', false, 0],
];

interface ProductSeed {
  code: string;
  name: string;
  volume: number;
  upp: number;
  ppp: number;
  weight: number;
  min: number;
  target: number;
  labor: number;
  energy: number;
  minStock: number;
  container: string;
  cap: string;
  label: string;
  termo: number; // kg por paca
  stretch: number; // kg por estiba
  blow?: { preform: string; energy: number; labor: number; waste: number; overhead: number; use: boolean };
  marginAtList: number; // margen con el que se fija el precio de lista inicial
  rate: number; // botellas por hora de la línea
  batch: number; // pacas por lote típico
  reorder: number; // punto de reposición (pacas)
  initialStock: number;
}

const PRODUCTS: ProductSeed[] = [
  { code: '300', name: 'Agua 300 ml', volume: 300, upp: 24, ppp: 100, weight: 7.6, min: 0.15, target: 0.25, labor: 18, energy: 10, minStock: 250, container: 'ENV-300', cap: 'TAP-28', label: 'ETQ-P', termo: 0.1, stretch: 0.35, blow: { preform: 'PRE-13', energy: 8, labor: 6, waste: 0.03, overhead: 11, use: true }, marginAtList: 0.3, rate: 3000, batch: 700, reorder: 500, initialStock: 500 },
  { code: '500', name: 'Agua 500 ml', volume: 500, upp: 20, ppp: 90, weight: 10.4, min: 0.15, target: 0.25, labor: 19, energy: 11, minStock: 120, container: 'ENV-500', cap: 'TAP-28', label: 'ETQ-P', termo: 0.09, stretch: 0.35, blow: { preform: 'PRE-20', energy: 9, labor: 6, waste: 0.03, overhead: 12, use: true }, marginAtList: 0.29, rate: 2600, batch: 400, reorder: 300, initialStock: 300 },
  { code: '600', name: 'Agua 600 ml', volume: 600, upp: 18, ppp: 80, weight: 11.2, min: 0.15, target: 0.25, labor: 20, energy: 12, minStock: 500, container: 'ENV-600', cap: 'TAP-28', label: 'ETQ-P', termo: 0.09, stretch: 0.35, blow: { preform: 'PRE-20', energy: 9, labor: 6, waste: 0.03, overhead: 12, use: true }, marginAtList: 0.28, rate: 2500, batch: 1400, reorder: 1500, initialStock: 1500 },
  { code: '1000', name: 'Agua 1.000 ml', volume: 1000, upp: 12, ppp: 70, weight: 12.5, min: 0.15, target: 0.24, labor: 26, energy: 15, minStock: 100, container: 'ENV-1000', cap: 'TAP-28', label: 'ETQ-G', termo: 0.085, stretch: 0.35, blow: { preform: 'PRE-32', energy: 12, labor: 7, waste: 0.03, overhead: 14, use: false }, marginAtList: 0.27, rate: 1800, batch: 350, reorder: 300, initialStock: 300 },
  { code: '1500', name: 'Agua 1.500 ml', volume: 1500, upp: 12, ppp: 55, weight: 18.6, min: 0.15, target: 0.24, labor: 30, energy: 18, minStock: 80, container: 'ENV-1500', cap: 'TAP-28', label: 'ETQ-G', termo: 0.1, stretch: 0.35, blow: { preform: 'PRE-42', energy: 14, labor: 8, waste: 0.035, overhead: 15, use: false }, marginAtList: 0.14, rate: 1400, batch: 450, reorder: 400, initialStock: 400 },
  { code: '5L', name: 'Agua 5 litros', volume: 5000, upp: 4, ppp: 40, weight: 20.4, min: 0.14, target: 0.22, labor: 85, energy: 40, minStock: 60, container: 'GAR-5L', cap: 'TAP-48', label: 'ETQ-5L', termo: 0.06, stretch: 0.35, marginAtList: 0.24, rate: 500, batch: 200, reorder: 180, initialStock: 180 },
];

const PROFILES = [
  { name: 'Tienda / minorista', description: 'Tiendas de barrio y minimercados. Pago de contado.', discount: 0, minOrder: 5, term: 0, maquila: false },
  { name: 'Mayorista', description: 'Mayoristas y autoservicios.', discount: 0.05, minOrder: 30, term: 15, maquila: false },
  { name: 'Distribuidor', description: 'Distribuidores con ruta propia.', discount: 0.08, minOrder: 50, term: 30, maquila: false },
  { name: 'Cliente especial', description: 'Hoteles, clubes y eventos con condiciones negociadas.', discount: 0.03, minOrder: 10, term: 30, maquila: false },
  { name: 'Cliente de maquila', description: 'Clientes que contratan envasado con su propia marca.', discount: 0, minOrder: 0, term: 30, maquila: true },
];

type ClientSeed = [name: string, doc: string, contact: string, phone: string, city: string, address: string, profile: number, term: number, freightIncluded: boolean, freightRate: number, credit: number | null];

const CLIENTS: ClientSeed[] = [
  ['Tienda Doña Rosa', 'CC 52.418.337', 'Rosa Elena Cárdenas', '310 482 1190', 'Chía', 'Cra 11 # 8-42, Centro', 0, 0, true, 250, null],
  ['Minimercado El Progreso', 'NIT 1.072.645.118-3', 'Jairo Moreno', '312 590 4471', 'Cajicá', 'Calle 3 # 5-18', 0, 0, true, 250, null],
  ['Autoservicio Santa Fe', 'NIT 900.582.117-4', 'Liliana Suárez', '601 866 2210', 'Zipaquirá', 'Av. Industrial # 12-60', 0, 8, true, 250, 3000000],
  ['Tienda Mi Barrio La 80', 'CC 79.845.002', 'Hernán Rojas', '315 330 9821', 'Bogotá', 'Calle 80 # 94-21', 0, 0, true, 300, null],
  ['Comercializadora Los Andes S.A.S.', 'NIT 901.244.867-1', 'Andrea Pineda', '601 745 3300', 'Bogotá', 'Cra 68 # 13-45 Bodega 4', 1, 15, false, 350, 25000000],
  ['Mayorista La Sabana Ltda.', 'NIT 832.004.551-9', 'Óscar Beltrán', '601 852 6617', 'Funza', 'Parque Industrial Funza, Bodega 22', 1, 15, false, 350, 20000000],
  ['Supermercados Merkafácil S.A.S.', 'NIT 900.917.330-2', 'Diana Castillo', '601 877 1204', 'Mosquera', 'Calle 3 # 2-80', 1, 30, true, 300, 30000000],
  ['Distribuidora Sabana Centro S.A.S.', 'NIT 901.100.342-6', 'Carlos Andrés Gómez', '311 208 5563', 'Zipaquirá', 'Km 2 vía Zipaquirá–Ubaté', 2, 30, true, 0, 60000000],
  ['Distribuciones Hidro Boyacá S.A.S.', 'NIT 900.733.889-0', 'Mónica Rincón', '320 447 1026', 'Tunja', 'Av. Norte # 45-12', 2, 30, false, 900, 50000000],
  ['Distrihogar del Norte S.A.S.', 'NIT 901.522.019-5', 'Fabio Quintero', '316 772 0934', 'Sopó', 'Vereda Briceño, Bodega 3', 2, 30, true, 0, 40000000],
  ['Hotel Campestre El Refugio', 'NIT 800.245.991-7', 'Paula Herrera', '601 862 7700', 'La Calera', 'Km 5 vía La Calera', 3, 30, true, 400, 12000000],
  ['Club Deportivo Los Cerros', 'NIT 860.013.442-1', 'Santiago Vélez', '601 612 3344', 'Bogotá', 'Calle 152 # 58-10', 3, 30, true, 300, 10000000],
  ['Eventos y Banquetes Gourmet S.A.S.', 'NIT 901.388.410-8', 'Natalia Ospina', '318 229 6540', 'Bogotá', 'Cra 15 # 93-60 Of. 402', 3, 15, true, 300, 15000000],
  ['Gimnasios BodyFit S.A.S.', 'NIT 901.455.672-3', 'Camilo Arango', '313 667 2099', 'Bogotá', 'Calle 100 # 19-54', 4, 30, false, 300, 20000000],
  ['Hoteles Cadena Andina S.A.S.', 'NIT 900.664.120-5', 'Juliana Méndez', '601 634 8800', 'Bogotá', 'Av. El Dorado # 69-76', 4, 30, true, 0, 25000000],
];

export async function seedDemoData(userId: number | null) {
  const today = todayISO(env.timezone);
  const start = addDays(today, -150);
  const code = new Map<string, number>(); // código de insumo -> id
  const productIds = new Map<string, number>();

  // ---------- Empresa y configuración ----------
  await saveSetting('company', {
    name: 'ALPE Agua Purificada S.A.S.',
    nit: '901.234.567-8',
    address: 'Km 3 vía Chía–Cajicá, Bodega 7',
    city: 'Chía, Cundinamarca',
    phone: '601 863 4455',
    email: 'contacto@alpe.com.co',
  }, userId);

  await withTransaction(async (db) => {
    // ---------- Insumos ----------
    for (const [c, name, category, unit, cost, supplier, inventoried, minStock] of SUPPLIES) {
      const s = await queryOne(
        `INSERT INTO supplies (code, name, category, unit, current_cost, supplier, is_inventoried, min_stock, cost_updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [c, name, category, unit, cost, supplier || null, inventoried, minStock, `${start}T08:00:00-05:00`],
        db,
      );
      code.set(c, s!.id);
      await query(
        'INSERT INTO supply_cost_history (supply_id, old_cost, new_cost, changed_at, user_id, note) VALUES ($1,NULL,$2,$3,$4,$5)',
        [s!.id, cost, `${start}T08:00:00-05:00`, userId, 'Costo inicial'],
        db,
      );
    }
    // Historial de cambios de costo de preformas y termoencogible
    const history: [string, number, number, number][] = [
      ['PRE-20', 178, 184, -120],
      ['PRE-20', 184, 188, -60],
      ['PRE-13', 142, 148, -75],
      ['TER', 11200, 11800, -40],
      ['TAP-28', 39, 41, -90],
    ];
    for (const [c, oldCost, newCost, daysAgo] of history) {
      await query(
        'INSERT INTO supply_cost_history (supply_id, old_cost, new_cost, changed_at, user_id, note) VALUES ($1,$2,$3,$4,$5,$6)',
        [code.get(c), oldCost, newCost, `${addDays(today, daysAgo)}T10:00:00-05:00`, userId, 'Actualización de lista del proveedor'],
        db,
      );
    }
    await query(`UPDATE supply_cost_history SET old_cost = NULL, new_cost = 178 WHERE note = 'Costo inicial' AND supply_id = $1`, [code.get('PRE-20')], db);
    await query(`UPDATE supply_cost_history SET new_cost = 142 WHERE note = 'Costo inicial' AND supply_id = $1`, [code.get('PRE-13')], db);
    await query(`UPDATE supply_cost_history SET new_cost = 11200 WHERE note = 'Costo inicial' AND supply_id = $1`, [code.get('TER')], db);
    await query(`UPDATE supply_cost_history SET new_cost = 39 WHERE note = 'Costo inicial' AND supply_id = $1`, [code.get('TAP-28')], db);

    // Existencias iniciales de insumos
    const initialStock: Record<string, number> = {
      'PRE-13': 30000, 'PRE-20': 70000, 'PRE-32': 9000, 'PRE-42': 8000, 'ENV-300': 6000, 'ENV-500': 6000, 'ENV-600': 18000,
      'ENV-1000': 9000, 'ENV-1500': 9000, 'GAR-5L': 1400, 'TAP-28': 110000, 'TAP-48': 1400, 'ETQ-P': 90000, 'ETQ-G': 16000,
      'ETQ-5L': 1400, TER: 600, STR: 40, EST: 80,
    };
    for (const [c, qty] of Object.entries(initialStock)) {
      await moveSupply(db, { supplyId: code.get(c)!, date: start, type: 'entrada', quantity: qty, reference: 'Saldo inicial', userId });
    }

    // ---------- Presentaciones ----------
    for (const p of PRODUCTS) {
      const row = await queryOne(
        `INSERT INTO products (code, name, volume_ml, units_per_pack, packs_per_pallet, weight_kg_pack, min_margin, target_margin,
           std_labor_per_unit, std_energy_per_unit, min_stock_packs, use_blown, price_updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [p.code, p.name, p.volume, p.upp, p.ppp, p.weight, p.min, p.target, p.labor, p.energy, p.minStock, p.blow?.use ?? false, `${start}T08:00:00-05:00`],
        db,
      );
      const id = row!.id;
      productIds.set(p.code, id);
      const comps: [string, string, number, string][] = [
        ['envase', p.container, 1, 'unidad'],
        ['tapa', p.cap, 1, 'unidad'],
        ['etiqueta', p.label, 1, 'unidad'],
        ['termoencogible', 'TER', p.termo, 'paca'],
        ['plastico', 'STR', p.stretch, 'estiba'],
        ['estiba', 'EST', 1, 'estiba'],
        ['agua', 'AGUA', Math.round((p.volume / 1000) * 1.08 * 1000) / 1000, 'unidad'],
      ];
      for (const [role, c, qty, basis] of comps) {
        await query('INSERT INTO product_components (product_id, supply_id, role, quantity, basis) VALUES ($1,$2,$3,$4,$5)', [id, code.get(c), role, qty, basis], db);
      }
      if (p.blow) {
        await query(
          `INSERT INTO blow_configs (product_id, preform_supply_id, energy_per_unit, labor_per_unit, waste_pct, overhead_per_unit, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, code.get(p.blow.preform), p.blow.energy, p.blow.labor, p.blow.waste, p.blow.overhead, 'Sopladora semiautomática 2 cavidades. Costo operativo incluye depreciación y mantenimiento.'],
          db,
        );
      }
    }

    // ---------- Precios de lista (a partir del costo y un margen inicial) ----------
    const ctx = await loadCostContext(db);
    const listPrice = new Map<string, number>();
    for (const p of PRODUCTS) {
      const id = productIds.get(p.code)!;
      const cost = productCost(ctx, id);
      const price = roundPriceUp(priceForMargin(cost.costPerPack, p.marginAtList), 100);
      const oldPrice = roundPriceUp(price * 0.95, 100);
      await query('UPDATE products SET list_price_pack = $1 WHERE id = $2', [price, id], db);
      listPrice.set(p.code, price);
      await query(
        'INSERT INTO product_price_history (product_id, old_price, new_price, changed_at, user_id, reason) VALUES ($1,NULL,$2,$3,$4,$5), ($1,$2,$6,$7,$4,$8)',
        [id, oldPrice, `${start}T08:00:00-05:00`, userId, 'Precio inicial', price, `${addDays(today, -70)}T09:00:00-05:00`, 'Ajuste por incremento de insumos'],
        db,
      );
    }

    // ---------- Perfiles, descuentos y clientes ----------
    const profileIds: number[] = [];
    for (const pr of PROFILES) {
      const r = await queryOne(
        `INSERT INTO client_profiles (name, description, base_discount_pct, min_order_packs, payment_term_days, is_maquila)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [pr.name, pr.description, pr.discount, pr.minOrder, pr.term, pr.maquila],
        db,
      );
      profileIds.push(r!.id);
    }
    const tiers: [number | null, string, number, number | null, number][] = [
      [null, 'pacas', 50, 99, 0.03],
      [null, 'pacas', 100, 199, 0.05],
      [null, 'pacas', 200, null, 0.07],
      [profileIds[2], 'estibas', 1, 2, 0.04],
      [profileIds[2], 'estibas', 3, null, 0.06],
    ];
    for (const [pid, basis, min, max, pct] of tiers) {
      await query('INSERT INTO volume_discounts (profile_id, basis, min_qty, max_qty, discount_pct) VALUES ($1,$2,$3,$4,$5)', [pid, basis, min, max, pct], db);
    }
    for (const [name, doc, contact, phone, city, address, profileIdx, term, freightIncluded, freightRate, credit] of CLIENTS) {
      const email = `${contact.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}@${name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z]/g, '')
        .slice(0, 14)}.com.co`;
      await query(
        `INSERT INTO clients (name, document, contact_name, phone, email, address, city, profile_id, payment_term_days, freight_included, freight_rate_pack, credit_limit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [name, doc, contact, phone, email, address, city, profileIds[profileIdx], term, freightIncluded, freightRate, credit],
        db,
      );
    }
    const clientId = async (name: string) => (await queryOne('SELECT id FROM clients WHERE name = $1', [name], db))!.id as number;
    // Precios especiales: uno vigente y uno vencido
    await query(
      `INSERT INTO client_special_prices (client_id, product_id, price_pack, start_date, end_date, allow_volume_discount, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7)`,
      [await clientId('Hotel Campestre El Refugio'), productIds.get('600'), roundPriceUp(listPrice.get('600')! * 0.92, 100), addDays(today, -45), addDays(today, 60), 'Contrato temporada alta', userId],
      db,
    );
    await query(
      `INSERT INTO client_special_prices (client_id, product_id, price_pack, start_date, end_date, allow_volume_discount, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7)`,
      [await clientId('Club Deportivo Los Cerros'), productIds.get('300'), roundPriceUp(listPrice.get('300')! * 0.9, 100), addDays(today, -120), addDays(today, -20), 'Torneo de verano (vencido)', userId],
      db,
    );
    // Lista de precios fija para mayoristas en 5 litros
    await query('INSERT INTO profile_prices (profile_id, product_id, price_pack) VALUES ($1,$2,$3)', [
      profileIds[1],
      productIds.get('5L'),
      roundPriceUp(listPrice.get('5L')! * 0.97, 100),
    ], db);

    // ---------- Servicios de maquila ----------
    const bodyfit = await queryOne(
      `INSERT INTO maquila_services (client_id, name, volume_ml, units_per_pack, pricing_basis, price, water_cost_per_unit, energy_cost_per_unit, labor_cost_per_unit, other_cost_per_unit, notes)
       VALUES ($1,'Agua BodyFit 600 ml (marca propia)',600,18,'paca',8900,2.9,12,20,4,'El cliente entrega las etiquetas impresas con su marca.') RETURNING id`,
      [await clientId('Gimnasios BodyFit S.A.S.')],
      db,
    );
    for (const [role, provides, c, qty, basis] of [
      ['envase', false, 'ENV-600', 1, 'unidad'],
      ['tapa', false, 'TAP-28', 1, 'unidad'],
      ['etiqueta', true, null, 1, 'unidad'],
      ['termoencogible', false, 'TER', 0.09, 'paca'],
    ] as [string, boolean, string | null, number, string][]) {
      await query('INSERT INTO maquila_service_items (service_id, role, client_provides, supply_id, quantity, basis) VALUES ($1,$2,$3,$4,$5,$6)', [bodyfit!.id, role, provides, c ? code.get(c) : null, qty, basis], db);
    }
    const andina = await queryOne(
      `INSERT INTO maquila_services (client_id, name, volume_ml, units_per_pack, pricing_basis, price, water_cost_per_unit, energy_cost_per_unit, labor_cost_per_unit, other_cost_per_unit, notes)
       VALUES ($1,'Agua de cortesía Hoteles Andina 300 ml',300,24,'botella',215,1.4,10,18,3,'El cliente aporta envase y etiqueta. ALPE aporta tapa y empaque.') RETURNING id`,
      [await clientId('Hoteles Cadena Andina S.A.S.')],
      db,
    );
    for (const [role, provides, c, qty, basis] of [
      ['envase', true, null, 1, 'unidad'],
      ['tapa', false, 'TAP-28', 1, 'unidad'],
      ['etiqueta', true, null, 1, 'unidad'],
      ['termoencogible', false, 'TER', 0.1, 'paca'],
    ] as [string, boolean, string | null, number, string][]) {
      await query('INSERT INTO maquila_service_items (service_id, role, client_provides, supply_id, quantity, basis) VALUES ($1,$2,$3,$4,$5,$6)', [andina!.id, role, provides, c ? code.get(c) : null, qty, basis], db);
    }
  });

  // ---------- Operación histórica: producción, pedidos, despachos y pagos ----------
  // Los eventos se ejecutan en orden cronológico para que existencias, lotes y movimientos sean coherentes.
  const clients = await query(`SELECT c.*, cp.name AS profile_name, cp.is_maquila FROM clients c JOIN client_profiles cp ON cp.id = c.profile_id`);
  const byName = (n: string) => clients.find((c) => c.name === n)!;
  const shifts = ['Mañana', 'Tarde', 'Noche'];
  const responsibles = ['Luis Fernando Parra', 'Marcela Ruiz', 'Édgar Salazar'];
  const labor = 8500;
  const kwh = 820;
  type Ev = { date: string; order: number; run: () => Promise<unknown> };
  const events: Ev[] = [];

  // Saldo inicial de producto terminado
  await withTransaction(async (db) => {
    for (const p of PRODUCTS) {
      await moveProduct(db, { productId: productIds.get(p.code)!, date: start, type: 'ajuste', packs: p.initialStock, reference: 'Saldo inicial', userId });
    }
  });

  const produce = (p: ProductSeed, date: string, packs: number, shift: string) => {
    const units = packs * p.upp;
    const workers = between(4, 6);
    const hours = Math.max(1, Math.round((units / p.rate) * 2) / 2);
    const energyKwh = Math.round((units * p.energy * (0.9 + rand() * 0.2)) / kwh);
    return createProduction(
      {
        date,
        shift,
        productId: productIds.get(p.code),
        packs,
        defectiveUnits: Math.round(units * (0.004 + rand() * 0.012)),
        workers,
        hours,
        laborCost: workers * hours * labor,
        energyKwh,
        energyCost: energyKwh * kwh,
        responsible: pick(responsibles),
        confirmWarnings: true,
      },
      userId,
    );
  };

  // Revisión de producción cada 2 días: se produce lo que está por debajo del punto de reposición.
  for (let d = start; d < today; d = addDays(d, 2)) {
    const date = d;
    events.push({
      date,
      order: 0,
      run: async () => {
        const stocks = await query('SELECT code, stock_packs FROM products');
        const needs = PRODUCTS.map((p) => ({ p, stock: stocks.find((s) => s.code === p.code)!.stock_packs }))
          .filter((x) => x.stock < x.p.reorder)
          .sort((a, b) => a.stock / a.p.reorder - b.stock / b.p.reorder)
          .slice(0, 2);
        for (let i = 0; i < needs.length; i++) {
          await produce(needs[i].p, date, Math.round(needs[i].p.batch * (0.85 + rand() * 0.3)), shifts[i]);
        }
      },
    });
  }

  // Compras cada 4 días de insumos según punto de reposición (existencia < 2 × mínimo)
  for (let d = addDays(start, 4); d < addDays(today, -1); d = addDays(d, 4)) {
    const date = d;
    events.push({
      date,
      order: 0,
      run: () =>
        withTransaction(async (db) => {
          const low = await query('SELECT id, min_stock, stock FROM supplies WHERE is_inventoried AND stock < min_stock * 2', [], db);
          const invoice = `FV-${between(10000, 99999)}`;
          for (const s of low) {
            const qty = s.min_stock < 100 ? Math.ceil(s.min_stock * 4) : Math.ceil((s.min_stock * 4) / 100) * 100;
            await moveSupply(db, { supplyId: s.id, date, type: 'entrada', quantity: qty, reference: `Factura proveedor ${invoice}`, userId });
          }
        }),
    });
  }

  // Pedidos (20) y despachos asociados
  const orderPlan: [string, [string, number][], number][] = [
    // [cliente, [[presentación, pacas]], días atrás]
    ['Distribuidora Sabana Centro S.A.S.', [['600', 720], ['1500', 180]], 140],
    ['Comercializadora Los Andes S.A.S.', [['600', 360], ['300', 240]], 132],
    ['Distribuciones Hidro Boyacá S.A.S.', [['600', 480], ['1000', 210]], 125],
    ['Mayorista La Sabana Ltda.', [['1500', 330], ['5L', 120]], 118],
    ['Hotel Campestre El Refugio', [['600', 120], ['300', 90]], 110],
    ['Distrihogar del Norte S.A.S.', [['600', 600], ['500', 270]], 101],
    ['Supermercados Merkafácil S.A.S.', [['600', 270], ['1500', 180], ['5L', 90]], 95],
    ['Distribuidora Sabana Centro S.A.S.', [['600', 960], ['300', 300]], 88],
    ['Club Deportivo Los Cerros', [['300', 180], ['600', 75]], 80],
    ['Comercializadora Los Andes S.A.S.', [['1000', 270], ['600', 300]], 72],
    ['Eventos y Banquetes Gourmet S.A.S.', [['300', 270], ['500', 120]], 64],
    ['Distribuciones Hidro Boyacá S.A.S.', [['600', 720], ['1500', 240]], 57],
    ['Mayorista La Sabana Ltda.', [['600', 450], ['5L', 150]], 49],
    ['Distrihogar del Norte S.A.S.', [['600', 480], ['1000', 180]], 41],
    ['Supermercados Merkafácil S.A.S.', [['600', 240], ['300', 180]], 33],
    ['Distribuidora Sabana Centro S.A.S.', [['600', 720], ['500', 240]], 24],
    ['Hotel Campestre El Refugio', [['600', 150]], 15],
    ['Comercializadora Los Andes S.A.S.', [['600', 390], ['1500', 150]], 8],
    ['Distribuciones Hidro Boyacá S.A.S.', [['600', 480], ['300', 180]], 3],
    ['Eventos y Banquetes Gourmet S.A.S.', [['500', 180], ['600', 120]], 1],
  ];
  const vehicles = [['WNK-418', 'Jhon Jairo Pérez'], ['SXT-092', 'William Castro'], ['TRL-771', 'Arley Sánchez']];
  orderPlan.forEach(([clientName, items, daysAgo], i) => {
    const client = byName(clientName);
    const orderDate = addDays(today, -daysAgo);
    const dispatchDate = addDays(orderDate, 1 + (i % 2));
    let orderId = 0;
    events.push({
      date: orderDate,
      order: 1,
      run: async () => {
        const order = await createOrder(
          {
            clientId: client.id,
            orderDate,
            deliveryDate: addDays(orderDate, 2),
            items: items.map(([c, packs]) => ({ productId: productIds.get(c)!, packs })),
            confirmWarnings: true,
          },
          userId,
        );
        orderId = order!.id;
      },
    });
    // Los 3 pedidos más recientes quedan pendientes; el de hace 8 días queda con despacho parcial.
    if (daysAgo <= 3) return;
    const [plate, driver] = vehicles[i % vehicles.length];
    const partial = daysAgo === 8;
    events.push({
      date: dispatchDate,
      order: 2,
      run: () =>
        createSaleDispatch(
          {
            orderId,
            date: dispatchDate,
            destination: `${client.address}, ${client.city}`,
            vehicle: plate,
            driver,
            paymentMode: client.payment_term_days === 0 ? 'contado' : 'credito',
            items: items.map(([c, packs]) => ({ productId: productIds.get(c)!, packs: partial ? Math.floor(packs / 2) : packs })),
            confirmWarnings: true,
          },
          userId,
        ),
    });
  });

  // Despachos directos a tiendas (sin pedido previo)
  const shops = ['Tienda Doña Rosa', 'Minimercado El Progreso', 'Autoservicio Santa Fe', 'Tienda Mi Barrio La 80'];
  for (let k = 0; k < 10; k++) {
    const client = byName(shops[k % shops.length]);
    const date = k === 9 ? today : addDays(today, -(138 - k * 15));
    const packs600 = between(15, 40);
    const packs300 = between(10, 25);
    events.push({
      date,
      order: 3,
      run: () =>
        createSaleDispatch(
          {
            clientId: client.id,
            date,
            destination: `${client.address}, ${client.city}`,
            vehicle: 'NHR-203',
            driver: 'Arley Sánchez',
            paymentMode: client.payment_term_days === 0 ? 'contado' : 'credito',
            paymentMethod: 'efectivo',
            items: [
              { productId: productIds.get('600')!, packs: packs600 },
              { productId: productIds.get('300')!, packs: packs300 },
            ],
            confirmWarnings: true,
          },
          userId,
        ),
    });
  }

  // Maquila: producción y despacho
  const services = await query('SELECT * FROM maquila_services ORDER BY id');
  for (let k = 0; k < 4; k++) {
    const s = services[k % services.length];
    const date = addDays(today, -(110 - k * 28));
    const packs = s.units_per_pack === 18 ? 400 : 300;
    events.push({
      date,
      order: 1,
      run: () =>
        createProduction(
          { date, shift: 'Tarde', maquilaServiceId: s.id, packs, defectiveUnits: 40, workers: 4, hours: 3, laborCost: 4 * 3 * labor, energyKwh: 90, energyCost: 90 * kwh, responsible: 'Édgar Salazar', confirmWarnings: true },
          userId,
        ),
    });
    events.push({
      date: addDays(date, 2),
      order: 2,
      run: () =>
        createMaquilaDispatch(
          { maquilaServiceId: s.id, packs, date: addDays(date, 2), destination: 'Bodega del cliente', vehicle: 'SXT-092', driver: 'William Castro', paymentMode: 'credito' },
          userId,
        ),
    });
  }

  // Producción de hoy (para el Dashboard)
  events.push({ date: today, order: 9, run: () => produce(PRODUCTS.find((p) => p.code === '600')!, today, 820, 'Mañana') });

  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  for (const e of events) await e.run();

  // Pagos: las cuentas antiguas se pagan; algunas con pagos parciales; otras quedan vencidas.
  const receivables = await query(`SELECT * FROM receivables WHERE balance > 0 AND NOT annulled ORDER BY issue_date`);
  for (const r of receivables) {
    const age = Math.round((Date.parse(today) - Date.parse(r.issue_date)) / 86400000);
    const payDate = addDays(r.due_date, between(-5, 6));
    if (payDate > today) continue;
    if (age > 70 || (age > 35 && rand() < 0.55)) {
      await registerPayment(r.id, { date: payDate, amount: r.balance, method: pick(['transferencia', 'transferencia', 'consignacion']), reference: `TRF-${between(100000, 999999)}`, userId });
    } else if (age > 30 && rand() < 0.5) {
      await registerPayment(r.id, { date: payDate, amount: Math.round(r.balance * 0.4), method: 'transferencia', reference: `Abono TRF-${between(100000, 999999)}`, notes: 'Abono parcial', userId });
    }
  }

  // Gastos administrativos mensuales
  for (let m = 5; m >= 0; m--) {
    const d = addDays(`${today.slice(0, 7)}-01`, -m * 30);
    const monthDay = `${d.slice(0, 7)}-05`;
    if (monthDay > today) continue;
    for (const [category, desc, amount] of [
      ['Nómina administrativa', 'Auxiliar administrativa y vendedor (proporción)', 1_600_000],
      ['Arriendo', 'Oficina y bodega (proporción administrativa)', 900_000],
      ['Contabilidad', 'Asesoría contable', 450_000],
      ['Servicios públicos oficina', 'Internet, telefonía y aseo', 220_000],
      ['Mercadeo', 'Material POP y redes sociales', between(100_000, 350_000)],
    ] as [string, string, number][]) {
      await query('INSERT INTO admin_expenses (expense_date, category, description, amount, created_by) VALUES ($1,$2,$3,$4,$5)', [monthDay, category, desc, amount, userId]);
    }
  }

  // Conteo físico con diferencia en 600 ml
  await withTransaction(async (db) => {
    const p = await queryOne('SELECT id, stock_packs FROM products WHERE code = $1', ['600'], db);
    const ctx = await loadCostContext(db);
    const cost = productCost(ctx, p.id);
    await registerPhysicalCount(db, {
      itemType: 'producto',
      itemId: p.id,
      date: addDays(today, -2),
      physicalQty: Math.max(p.stock_packs - 13, 0),
      unitValue: cost.costPerPack,
      thresholdPct: 0.02,
      notes: 'Conteo mensual de bodega. Pacas averiadas por montacargas.',
      userId,
    });
  });

  await pool.query('ANALYZE');
}
