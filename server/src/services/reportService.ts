// Indicadores del Dashboard y reportes financieros. Las ventas se reconocen al despachar.
import { addDays, inventoryValue, marginOnSales, todayISO } from '@alpe/shared';
import { env } from '../config/env';
import { query, queryOne, pool, type Db } from '../database/pool';
import { loadCostContext, marginAlerts, productSummary } from './costService';

function monthStart(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

async function salesTotals(from: string, to: string, db: Db) {
  const row = await queryOne(
    `SELECT
       COALESCE(SUM(products_total) FILTER (WHERE kind = 'venta'),0)::numeric AS sales,
       COALESCE(SUM(products_total) FILTER (WHERE kind = 'maquila'),0)::numeric AS maquila_sales,
       COALESCE(SUM(cost_total),0)::numeric AS cost,
       COALESCE(SUM(freight_charge),0)::numeric AS freight_charged,
       COALESCE(SUM(packs_total) FILTER (WHERE kind = 'venta'),0)::int AS packs,
       COUNT(*)::int AS dispatches
     FROM dispatches WHERE status = 'confirmado' AND dispatch_date BETWEEN $1 AND $2`,
    [from, to],
    db,
  );
  const expenses = await queryOne<{ total: number }>(
    'SELECT COALESCE(SUM(amount),0)::numeric AS total FROM admin_expenses WHERE expense_date BETWEEN $1 AND $2',
    [from, to],
    db,
  );
  const revenue = row.sales + row.maquila_sales;
  const grossProfit = revenue - row.cost;
  const adminExpenses = expenses?.total ?? 0;
  return {
    sales: row.sales,
    maquilaSales: row.maquila_sales,
    revenue,
    costOfSales: row.cost,
    grossProfit,
    grossMarginPct: marginOnSales(revenue, row.cost),
    adminExpenses,
    operatingProfit: grossProfit - adminExpenses,
    operatingMarginPct: revenue > 0 ? (grossProfit - adminExpenses) / revenue : 0,
    freightCharged: row.freight_charged,
    packsSold: row.packs,
    dispatches: row.dispatches,
  };
}

/** Lista de meses 'YYYY-MM' terminando en el mes de `today`. */
function lastMonths(months: number, today: string): string[] {
  const [y, m] = today.split('-').map(Number);
  const end = y * 12 + (m - 1);
  return Array.from({ length: months }, (_, i) => {
    const idx = end - (months - 1) + i;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
  });
}

async function monthlyEvolution(months: number, today: string, db: Db) {
  const monthList = lastMonths(months, today);
  const start = `${monthList[0]}-01`;
  const rows = await query(
    `SELECT to_char(dispatch_date, 'YYYY-MM') AS month,
       SUM(products_total)::numeric AS revenue, SUM(cost_total)::numeric AS cost, SUM(packs_total) FILTER (WHERE kind='venta')::int AS packs
     FROM dispatches WHERE status = 'confirmado' AND dispatch_date >= $1
     GROUP BY 1 ORDER BY 1`,
    [start],
    db,
  );
  const expenses = await query(
    `SELECT to_char(expense_date, 'YYYY-MM') AS month, SUM(amount)::numeric AS total FROM admin_expenses WHERE expense_date >= $1 GROUP BY 1`,
    [start],
    db,
  );
  const result: { month: string; revenue: number; cost: number; grossProfit: number; marginPct: number; adminExpenses: number; packs: number }[] = [];
  for (const month of monthList) {
    const r = rows.find((x) => x.month === month);
    const e = expenses.find((x) => x.month === month);
    const revenue = r?.revenue ?? 0;
    const cost = r?.cost ?? 0;
    result.push({
      month,
      revenue,
      cost,
      grossProfit: revenue - cost,
      marginPct: revenue > 0 ? (revenue - cost) / revenue : 0,
      adminExpenses: e?.total ?? 0,
      packs: r?.packs ?? 0,
    });
  }
  return result;
}

async function receivableTotals(today: string, db: Db) {
  return queryOne(
    `SELECT COALESCE(SUM(balance),0)::numeric AS pending,
            COALESCE(SUM(balance) FILTER (WHERE due_date < $1),0)::numeric AS overdue,
            COUNT(*) FILTER (WHERE balance > 0 AND due_date < $1)::int AS overdue_count
     FROM receivables WHERE NOT annulled AND balance > 0`,
    [today],
    db,
  );
}

export async function getDashboard(db: Db = pool) {
  const today = todayISO(env.timezone);
  const from = monthStart(today);
  const ctx = await loadCostContext(db);

  const [month, receivables, evolution, productionToday, dispatchesToday, pendingOrders, overdueList, supplies, consumption] =
    await Promise.all([
      salesTotals(from, today, db),
      receivableTotals(today, db),
      monthlyEvolution(6, today, db),
      query(
        `SELECT pr.id, pr.shift, pr.packs_produced, pr.good_units, pr.waste_pct, pr.is_maquila, l.code AS lot_code,
           COALESCE(p.name, ms.name) AS name
         FROM production_runs pr JOIN lots l ON l.id = pr.lot_id
         LEFT JOIN products p ON p.id = pr.product_id LEFT JOIN maquila_services ms ON ms.id = pr.maquila_service_id
         WHERE pr.run_date = $1 AND pr.status = 'registrada' ORDER BY pr.id`,
        [today],
        db,
      ),
      query(
        `SELECT d.id, d.number, d.remission_number, d.total, d.packs_total, d.kind, d.destination, c.name AS client_name
         FROM dispatches d JOIN clients c ON c.id = d.client_id
         WHERE d.dispatch_date = $1 AND d.status = 'confirmado' ORDER BY d.id DESC`,
        [today],
        db,
      ),
      query(
        `SELECT o.id, o.number, o.order_date, o.delivery_date, o.status, o.total, c.name AS client_name,
           (SELECT SUM(packs - packs_dispatched) FROM order_items WHERE order_id = o.id)::int AS pending_packs
         FROM orders o JOIN clients c ON c.id = o.client_id
         WHERE o.status IN ('confirmado','parcial') ORDER BY COALESCE(o.delivery_date, o.order_date) ASC LIMIT 10`,
        [],
        db,
      ),
      query(
        `SELECT r.id, r.document_number, r.due_date, r.balance, c.name AS client_name, ($1::date - r.due_date) AS days_overdue
         FROM receivables r JOIN clients c ON c.id = r.client_id
         WHERE NOT r.annulled AND r.balance > 0 AND r.due_date < $1 ORDER BY r.due_date ASC LIMIT 8`,
        [today],
        db,
      ),
      query('SELECT id, name, unit, stock, min_stock FROM supplies WHERE active AND is_inventoried ORDER BY name', [], db),
      query(
        `SELECT supply_id, SUM(-quantity)::numeric AS consumed FROM supply_movements
         WHERE type = 'consumo' AND movement_date >= $1 GROUP BY supply_id`,
        [addDays(today, -30)],
        db,
      ),
    ]);

  const pendingOrdersCount = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM orders WHERE status IN ('confirmado','parcial')`,
    [],
    db,
  );

  const products = [...ctx.products.values()].filter((p) => p.active).map((p) => productSummary(ctx, p.id));
  const finishedValue = inventoryValue(products.map((p) => ({ qty: p.stockPacks, unitCost: p.costPerPack })));
  const lowStockProducts = products
    .filter((p) => p.stockPacks <= p.minStockPacks)
    .map((p) => ({ id: p.id, name: p.name, stockPacks: p.stockPacks, minStockPacks: p.minStockPacks }));

  const consumptionById = new Map(consumption.map((c) => [c.supply_id, c.consumed / 30]));
  const lowSupplies = supplies
    .map((s) => {
      const daily = consumptionById.get(s.id) ?? 0;
      return { ...s, dailyUse: daily, daysLeft: daily > 0 ? Math.max(s.stock, 0) / daily : null };
    })
    .filter((s) => s.stock <= s.min_stock || (s.daysLeft !== null && s.daysLeft < 10))
    .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  return {
    today,
    month: { from, to: today, ...month },
    receivables,
    finishedGoods: {
      value: finishedValue,
      packs: products.reduce((s, p) => s + Math.max(p.stockPacks, 0), 0),
    },
    marginAlerts: marginAlerts(ctx),
    lowestMarginProducts: [...products].sort((a, b) => a.marginPct - b.marginPct).slice(0, 5),
    evolution,
    productionToday,
    dispatchesToday,
    pendingOrders,
    pendingOrdersCount: pendingOrdersCount?.n ?? 0,
    overdueList,
    lowStockProducts,
    lowSupplies,
    adminIncluded: ctx.admin.included,
  };
}

export async function getFinance(from: string, to: string, db: Db = pool) {
  const today = todayISO(env.timezone);
  const ctx = await loadCostContext(db);
  const [totals, byProduct, byClient, evolution, expenses, receivables] = await Promise.all([
    salesTotals(from, to, db),
    query(
      `SELECT COALESCE(di.product_id::text, 'mq-' || d.maquila_service_id) AS key, MAX(di.description) AS name,
         BOOL_OR(d.kind = 'maquila') AS is_maquila,
         SUM(di.packs)::int AS packs, SUM(di.line_total)::numeric AS revenue, SUM(di.cost_total)::numeric AS cost
       FROM dispatch_items di JOIN dispatches d ON d.id = di.dispatch_id
       WHERE d.status = 'confirmado' AND d.dispatch_date BETWEEN $1 AND $2
       GROUP BY 1 ORDER BY revenue DESC`,
      [from, to],
      db,
    ),
    query(
      `SELECT c.id, c.name, cp.name AS profile_name, SUM(d.packs_total)::int AS packs,
         SUM(d.products_total)::numeric AS revenue, SUM(d.cost_total)::numeric AS cost, COUNT(*)::int AS dispatches
       FROM dispatches d JOIN clients c ON c.id = d.client_id JOIN client_profiles cp ON cp.id = c.profile_id
       WHERE d.status = 'confirmado' AND d.dispatch_date BETWEEN $1 AND $2
       GROUP BY c.id, c.name, cp.name ORDER BY revenue DESC`,
      [from, to],
      db,
    ),
    monthlyEvolution(12, today, db),
    query(
      `SELECT category, SUM(amount)::numeric AS total, COUNT(*)::int AS n FROM admin_expenses
       WHERE expense_date BETWEEN $1 AND $2 GROUP BY category ORDER BY total DESC`,
      [from, to],
      db,
    ),
    receivableTotals(today, db),
  ]);
  const withMargin = <T extends { revenue: number; cost: number }>(r: T) => ({
    ...r,
    profit: r.revenue - r.cost,
    marginPct: marginOnSales(r.revenue, r.cost),
  });
  const currentMargins = [...ctx.products.values()]
    .filter((p) => p.active)
    .map((p) => productSummary(ctx, p.id))
    .sort((a, b) => a.marginPct - b.marginPct);
  return {
    from,
    to,
    totals,
    receivables,
    byProduct: byProduct.map(withMargin),
    byClient: byClient.map(withMargin),
    evolution,
    expensesByCategory: expenses,
    currentMargins: currentMargins.map((p) => ({
      id: p.id,
      name: p.name,
      marginPct: p.marginPct,
      minMargin: p.minMargin,
      targetMargin: p.targetMargin,
      status: p.status,
      costPerPack: p.costPerPack,
      listPricePack: p.listPricePack,
    })),
  };
}
