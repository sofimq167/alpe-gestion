// Migración inicial: estructura completa de la base de datos.
export const sql = /* sql */ `
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin'
                CHECK (role IN ('admin','ventas','produccion','despachos','administracion')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES users(id)
);

-- ---------------- Insumos ----------------
CREATE TABLE supplies (
  id              SERIAL PRIMARY KEY,
  code            TEXT UNIQUE,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  unit            TEXT NOT NULL,
  current_cost    NUMERIC(14,4) NOT NULL CHECK (current_cost >= 0),
  supplier        TEXT,
  is_inventoried  BOOLEAN NOT NULL DEFAULT TRUE,
  stock           NUMERIC(16,3) NOT NULL DEFAULT 0,
  min_stock       NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,
  cost_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE supply_cost_history (
  id         SERIAL PRIMARY KEY,
  supply_id  INT NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
  old_cost   NUMERIC(14,4),
  new_cost   NUMERIC(14,4) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id    INT REFERENCES users(id),
  note       TEXT
);
CREATE INDEX ON supply_cost_history (supply_id, changed_at DESC);

-- ---------------- Presentaciones ----------------
CREATE TABLE products (
  id                  SERIAL PRIMARY KEY,
  code                TEXT UNIQUE,
  name                TEXT NOT NULL,
  volume_ml           INT NOT NULL CHECK (volume_ml > 0),
  units_per_pack      INT NOT NULL CHECK (units_per_pack > 0),
  packs_per_pallet    INT NOT NULL CHECK (packs_per_pallet > 0),
  weight_kg_pack      NUMERIC(8,2),
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  min_margin          NUMERIC(6,4) NOT NULL CHECK (min_margin >= 0 AND min_margin < 0.95),
  target_margin       NUMERIC(6,4) NOT NULL CHECK (target_margin >= 0 AND target_margin < 0.95),
  list_price_pack     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (list_price_pack >= 0),
  price_updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  use_blown           BOOLEAN NOT NULL DEFAULT FALSE,
  std_labor_per_unit  NUMERIC(12,4) NOT NULL DEFAULT 0,
  std_energy_per_unit NUMERIC(12,4) NOT NULL DEFAULT 0,
  stock_packs         INT NOT NULL DEFAULT 0,
  min_stock_packs     INT NOT NULL DEFAULT 0 CHECK (min_stock_packs >= 0),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_margin <= target_margin)
);

-- Estructura de costos (receta) de cada presentación
CREATE TABLE product_components (
  id         SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supply_id  INT NOT NULL REFERENCES supplies(id) ON DELETE RESTRICT,
  role       TEXT NOT NULL,
  quantity   NUMERIC(14,6) NOT NULL CHECK (quantity > 0),
  basis      TEXT NOT NULL DEFAULT 'unidad' CHECK (basis IN ('unidad','paca','estiba')),
  UNIQUE (product_id, supply_id)
);

-- Escenario de soplado interno del envase
CREATE TABLE blow_configs (
  product_id        INT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  preform_supply_id INT NOT NULL REFERENCES supplies(id) ON DELETE RESTRICT,
  energy_per_unit   NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (energy_per_unit >= 0),
  labor_per_unit    NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (labor_per_unit >= 0),
  waste_pct         NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct < 0.9),
  overhead_per_unit NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (overhead_per_unit >= 0),
  notes             TEXT
);

CREATE TABLE product_price_history (
  id         SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_price  NUMERIC(14,2),
  new_price  NUMERIC(14,2) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id    INT REFERENCES users(id),
  reason     TEXT
);
CREATE INDEX ON product_price_history (product_id, changed_at DESC);

-- ---------------- Clientes y precios ----------------
CREATE TABLE client_profiles (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  description       TEXT,
  base_discount_pct NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (base_discount_pct >= 0 AND base_discount_pct < 0.9),
  min_order_packs   INT NOT NULL DEFAULT 0 CHECK (min_order_packs >= 0),
  payment_term_days INT NOT NULL DEFAULT 0 CHECK (payment_term_days >= 0),
  is_maquila        BOOLEAN NOT NULL DEFAULT FALSE,
  active            BOOLEAN NOT NULL DEFAULT TRUE
);

-- Lista de precios por perfil (precio fijo opcional por presentación)
CREATE TABLE profile_prices (
  profile_id INT NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_pack NUMERIC(14,2) NOT NULL CHECK (price_pack > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, product_id)
);

CREATE TABLE volume_discounts (
  id           SERIAL PRIMARY KEY,
  profile_id   INT REFERENCES client_profiles(id) ON DELETE CASCADE,
  basis        TEXT NOT NULL CHECK (basis IN ('pacas','estibas')),
  min_qty      INT NOT NULL CHECK (min_qty > 0),
  max_qty      INT CHECK (max_qty IS NULL OR max_qty >= min_qty),
  discount_pct NUMERIC(6,4) NOT NULL CHECK (discount_pct >= 0 AND discount_pct < 0.9),
  active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE clients (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  document          TEXT,
  contact_name      TEXT,
  phone             TEXT,
  email             TEXT,
  address           TEXT,
  city              TEXT,
  profile_id        INT NOT NULL REFERENCES client_profiles(id),
  payment_term_days INT NOT NULL DEFAULT 0 CHECK (payment_term_days >= 0),
  freight_included  BOOLEAN NOT NULL DEFAULT TRUE,
  freight_rate_pack NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (freight_rate_pack >= 0),
  credit_limit      NUMERIC(16,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
  status            TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo','inactivo','bloqueado')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON clients (profile_id);

CREATE TABLE client_special_prices (
  id                    SERIAL PRIMARY KEY,
  client_id             INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  product_id            INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_pack            NUMERIC(14,2) NOT NULL CHECK (price_pack > 0),
  start_date            DATE NOT NULL,
  end_date              DATE CHECK (end_date IS NULL OR end_date >= start_date),
  allow_volume_discount BOOLEAN NOT NULL DEFAULT FALSE,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  notes                 TEXT,
  created_by            INT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON client_special_prices (client_id, product_id);

-- ---------------- Pedidos ----------------
CREATE SEQUENCE order_number_seq START 1001;
CREATE TABLE orders (
  id                  SERIAL PRIMARY KEY,
  number              TEXT NOT NULL UNIQUE DEFAULT ('PED-' || nextval('order_number_seq')),
  client_id           INT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  order_date          DATE NOT NULL,
  delivery_date       DATE,
  status              TEXT NOT NULL DEFAULT 'confirmado'
                      CHECK (status IN ('confirmado','parcial','despachado','cancelado')),
  payment_term_days   INT NOT NULL DEFAULT 0,
  freight_included    BOOLEAN NOT NULL DEFAULT TRUE,
  freight_rate_pack   NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_total         NUMERIC(16,2) NOT NULL DEFAULT 0,
  discount_total      NUMERIC(16,2) NOT NULL DEFAULT 0,
  products_total      NUMERIC(16,2) NOT NULL DEFAULT 0,
  freight_charge      NUMERIC(16,2) NOT NULL DEFAULT 0,
  freight_cost        NUMERIC(16,2) NOT NULL DEFAULT 0,
  total               NUMERIC(16,2) NOT NULL DEFAULT 0,
  cost_total          NUMERIC(16,2) NOT NULL DEFAULT 0,
  margin_pct          NUMERIC(8,4) NOT NULL DEFAULT 0,
  expected_margin_pct NUMERIC(8,4) NOT NULL DEFAULT 0,
  warnings_accepted   TEXT,
  notes               TEXT,
  created_by          INT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON orders (client_id);
CREATE INDEX ON orders (order_date);

CREATE TABLE order_items (
  id                  SERIAL PRIMARY KEY,
  order_id            INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id          INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  packs               INT NOT NULL CHECK (packs > 0),
  units_per_pack      INT NOT NULL,
  list_price_pack     NUMERIC(14,2) NOT NULL,
  price_source        TEXT NOT NULL,
  price_source_label  TEXT,
  profile_discount_pct NUMERIC(6,4) NOT NULL DEFAULT 0,
  volume_discount_pct NUMERIC(6,4) NOT NULL DEFAULT 0,
  net_price_pack      NUMERIC(14,2) NOT NULL,
  gross_total         NUMERIC(16,2) NOT NULL,
  discount_amount     NUMERIC(16,2) NOT NULL,
  line_total          NUMERIC(16,2) NOT NULL,
  unit_cost_pack      NUMERIC(14,2) NOT NULL,
  cost_total          NUMERIC(16,2) NOT NULL,
  margin_pct          NUMERIC(8,4) NOT NULL,
  min_margin          NUMERIC(6,4) NOT NULL,
  target_margin       NUMERIC(6,4) NOT NULL,
  packs_dispatched    INT NOT NULL DEFAULT 0 CHECK (packs_dispatched >= 0)
);
CREATE INDEX ON order_items (order_id);

-- ---------------- Maquila ----------------
CREATE TABLE maquila_services (
  id                   SERIAL PRIMARY KEY,
  client_id            INT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name                 TEXT NOT NULL,
  volume_ml            INT NOT NULL CHECK (volume_ml > 0),
  units_per_pack       INT NOT NULL CHECK (units_per_pack > 0),
  pricing_basis        TEXT NOT NULL CHECK (pricing_basis IN ('botella','paca')),
  price                NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  water_cost_per_unit  NUMERIC(12,4) NOT NULL DEFAULT 0,
  energy_cost_per_unit NUMERIC(12,4) NOT NULL DEFAULT 0,
  labor_cost_per_unit  NUMERIC(12,4) NOT NULL DEFAULT 0,
  other_cost_per_unit  NUMERIC(12,4) NOT NULL DEFAULT 0,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE maquila_service_items (
  id              SERIAL PRIMARY KEY,
  service_id      INT NOT NULL REFERENCES maquila_services(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  client_provides BOOLEAN NOT NULL DEFAULT TRUE,
  supply_id       INT REFERENCES supplies(id) ON DELETE RESTRICT,
  quantity        NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  basis           TEXT NOT NULL DEFAULT 'unidad' CHECK (basis IN ('unidad','paca','estiba')),
  CHECK (client_provides OR supply_id IS NOT NULL)
);

-- ---------------- Producción y lotes ----------------
CREATE TABLE lots (
  id                 SERIAL PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  product_id         INT REFERENCES products(id),
  maquila_service_id INT REFERENCES maquila_services(id),
  client_id          INT REFERENCES clients(id),
  is_maquila         BOOLEAN NOT NULL DEFAULT FALSE,
  production_date    DATE NOT NULL,
  expiry_date        DATE,
  packs_produced     INT NOT NULL CHECK (packs_produced >= 0),
  packs_remaining    INT NOT NULL CHECK (packs_remaining >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (product_id IS NOT NULL OR maquila_service_id IS NOT NULL)
);
CREATE INDEX ON lots (product_id, production_date);
CREATE INDEX ON lots (maquila_service_id, production_date);

CREATE TABLE production_runs (
  id                 SERIAL PRIMARY KEY,
  run_date           DATE NOT NULL,
  shift              TEXT NOT NULL,
  product_id         INT REFERENCES products(id),
  maquila_service_id INT REFERENCES maquila_services(id),
  is_maquila         BOOLEAN NOT NULL DEFAULT FALSE,
  lot_id             INT NOT NULL REFERENCES lots(id),
  packs_produced     INT NOT NULL CHECK (packs_produced > 0),
  good_units         INT NOT NULL CHECK (good_units > 0),
  defective_units    INT NOT NULL DEFAULT 0 CHECK (defective_units >= 0),
  workers            INT NOT NULL DEFAULT 0 CHECK (workers >= 0),
  hours              NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (hours >= 0),
  labor_cost         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (labor_cost >= 0),
  energy_kwh         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (energy_kwh >= 0),
  energy_cost        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (energy_cost >= 0),
  materials_cost     NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_cost         NUMERIC(16,2) NOT NULL DEFAULT 0,
  cost_per_unit      NUMERIC(12,4) NOT NULL DEFAULT 0,
  cost_per_pack      NUMERIC(14,2) NOT NULL DEFAULT 0,
  yield_pct          NUMERIC(8,4) NOT NULL DEFAULT 0,
  waste_pct          NUMERIC(8,4) NOT NULL DEFAULT 0,
  responsible        TEXT,
  notes              TEXT,
  status             TEXT NOT NULL DEFAULT 'registrada' CHECK (status IN ('registrada','anulada')),
  created_by         INT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (product_id IS NOT NULL OR maquila_service_id IS NOT NULL)
);
CREATE INDEX ON production_runs (run_date);
CREATE INDEX ON production_runs (product_id, run_date);

CREATE TABLE production_consumptions (
  id            SERIAL PRIMARY KEY,
  production_id INT NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
  supply_id     INT NOT NULL REFERENCES supplies(id),
  quantity      NUMERIC(16,3) NOT NULL CHECK (quantity >= 0),
  unit_cost     NUMERIC(14,4) NOT NULL,
  total_cost    NUMERIC(16,2) NOT NULL,
  inventoried   BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX ON production_consumptions (production_id);

-- ---------------- Inventario ----------------
CREATE TABLE supply_movements (
  id            SERIAL PRIMARY KEY,
  supply_id     INT NOT NULL REFERENCES supplies(id) ON DELETE RESTRICT,
  movement_date DATE NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('entrada','consumo','ajuste','perdida','conteo')),
  quantity      NUMERIC(16,3) NOT NULL,
  stock_after   NUMERIC(16,3) NOT NULL,
  unit_cost     NUMERIC(14,4),
  reference     TEXT,
  notes         TEXT,
  production_id INT REFERENCES production_runs(id),
  user_id       INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON supply_movements (supply_id, movement_date DESC);

-- ---------------- Despachos ----------------
CREATE SEQUENCE dispatch_number_seq START 1001;
CREATE SEQUENCE remission_number_seq START 5001;
CREATE TABLE dispatches (
  id                 SERIAL PRIMARY KEY,
  number             TEXT NOT NULL UNIQUE DEFAULT ('DES-' || nextval('dispatch_number_seq')),
  kind               TEXT NOT NULL DEFAULT 'venta' CHECK (kind IN ('venta','maquila')),
  dispatch_date      DATE NOT NULL,
  order_id           INT REFERENCES orders(id),
  client_id          INT NOT NULL REFERENCES clients(id),
  maquila_service_id INT REFERENCES maquila_services(id),
  remission_number   TEXT NOT NULL,
  destination        TEXT,
  vehicle            TEXT,
  driver             TEXT,
  notes              TEXT,
  payment_mode       TEXT NOT NULL DEFAULT 'credito' CHECK (payment_mode IN ('credito','contado')),
  products_total     NUMERIC(16,2) NOT NULL DEFAULT 0,
  freight_charge     NUMERIC(16,2) NOT NULL DEFAULT 0,
  freight_cost       NUMERIC(16,2) NOT NULL DEFAULT 0,
  total              NUMERIC(16,2) NOT NULL DEFAULT 0,
  cost_total         NUMERIC(16,2) NOT NULL DEFAULT 0,
  packs_total        INT NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'confirmado' CHECK (status IN ('confirmado','anulado')),
  warnings_accepted  TEXT,
  created_by         INT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON dispatches (dispatch_date);
CREATE INDEX ON dispatches (client_id);
CREATE INDEX ON dispatches (order_id);

CREATE TABLE dispatch_items (
  id             SERIAL PRIMARY KEY,
  dispatch_id    INT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  product_id     INT REFERENCES products(id),
  order_item_id  INT REFERENCES order_items(id),
  description    TEXT NOT NULL,
  packs          INT NOT NULL CHECK (packs > 0),
  units          INT NOT NULL,
  price_pack     NUMERIC(14,2) NOT NULL,
  line_total     NUMERIC(16,2) NOT NULL,
  unit_cost_pack NUMERIC(14,2) NOT NULL,
  cost_total     NUMERIC(16,2) NOT NULL
);
CREATE INDEX ON dispatch_items (dispatch_id);
CREATE INDEX ON dispatch_items (product_id);

CREATE TABLE dispatch_item_lots (
  id               SERIAL PRIMARY KEY,
  dispatch_item_id INT NOT NULL REFERENCES dispatch_items(id) ON DELETE CASCADE,
  lot_id           INT NOT NULL REFERENCES lots(id),
  packs            INT NOT NULL CHECK (packs > 0)
);
CREATE INDEX ON dispatch_item_lots (lot_id);

CREATE TABLE attachments (
  id          SERIAL PRIMARY KEY,
  dispatch_id INT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INT NOT NULL,
  data        BYTEA NOT NULL,
  uploaded_by INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_movements (
  id            SERIAL PRIMARY KEY,
  product_id    INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  movement_date DATE NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('produccion','despacho','ajuste','conteo','perdida','anulacion')),
  packs         INT NOT NULL,
  stock_after   INT NOT NULL,
  lot_id        INT REFERENCES lots(id),
  production_id INT REFERENCES production_runs(id),
  dispatch_id   INT REFERENCES dispatches(id),
  reference     TEXT,
  notes         TEXT,
  user_id       INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON product_movements (product_id, movement_date DESC);

CREATE TABLE physical_counts (
  id               SERIAL PRIMARY KEY,
  count_date       DATE NOT NULL,
  item_type        TEXT NOT NULL CHECK (item_type IN ('producto','insumo')),
  product_id       INT REFERENCES products(id),
  supply_id        INT REFERENCES supplies(id),
  system_qty       NUMERIC(16,3) NOT NULL,
  physical_qty     NUMERIC(16,3) NOT NULL CHECK (physical_qty >= 0),
  difference       NUMERIC(16,3) NOT NULL,
  unit_value       NUMERIC(14,4) NOT NULL,
  difference_value NUMERIC(16,2) NOT NULL,
  notes            TEXT,
  user_id          INT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------- Cartera ----------------
CREATE TABLE receivables (
  id              SERIAL PRIMARY KEY,
  client_id       INT NOT NULL REFERENCES clients(id),
  dispatch_id     INT UNIQUE REFERENCES dispatches(id),
  order_id        INT REFERENCES orders(id),
  document_number TEXT NOT NULL,
  issue_date      DATE NOT NULL,
  due_date        DATE NOT NULL,
  original_amount NUMERIC(16,2) NOT NULL CHECK (original_amount >= 0),
  balance         NUMERIC(16,2) NOT NULL CHECK (balance >= 0),
  annulled        BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (balance <= original_amount)
);
CREATE INDEX ON receivables (client_id);
CREATE INDEX ON receivables (due_date);

CREATE TABLE payments (
  id            SERIAL PRIMARY KEY,
  receivable_id INT NOT NULL REFERENCES receivables(id) ON DELETE RESTRICT,
  payment_date  DATE NOT NULL,
  amount        NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  method        TEXT NOT NULL,
  reference     TEXT,
  notes         TEXT,
  created_by    INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON payments (receivable_id);

-- ---------------- Gastos administrativos ----------------
CREATE TABLE admin_expenses (
  id           SERIAL PRIMARY KEY,
  expense_date DATE NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT,
  amount       NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  created_by   INT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON admin_expenses (expense_date);
`;
