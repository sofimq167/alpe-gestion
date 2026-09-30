import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Boxes, ClipboardList, Factory, PackageMinus, Receipt, Truck } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { formatCOP, formatDate, formatNumber, formatPct } from '@alpe/shared';
import { ErrorState, Loading, MarginText, OrderStatusBadge, PageHeader, StatCard } from '@/components/common';
import { MonthlySalesChart } from '@/components/common/Charts';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';

export function DashboardPage() {
  const { user } = useAuth();
  const { data: d, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/reports/dashboard'), refetchInterval: 120_000 });
  if (isLoading) return <Loading />;
  if (error || !d) return <ErrorState error={error} />;
  const m = d.month;

  return (
    <>
      <PageHeader
        title={`Hola, ${user?.name.split(' ')[0]}`}
        description={`Resumen del mes (${formatDate(m.from)} – ${formatDate(m.to)}). Las ventas se registran al despachar.`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/produccion/nueva">Registrar producción</Link>
            </Button>
            <Button asChild>
              <Link to="/pedidos/nuevo">Nuevo pedido</Link>
            </Button>
          </>
        }
      />

      {d.marginAlerts.length > 0 && (
        <Card className="mb-6 border-red-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-red-100 bg-red-50/70 px-5 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
              <AlertTriangle className="h-4 w-4" /> Margen bajo en {d.marginAlerts.length} presentación(es)
            </p>
            <Link to="/precios/presentaciones" className="text-xs font-medium text-red-800 hover:underline">
              Revisar precios →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 text-left font-medium">Presentación</th>
                  <th className="px-3 py-2 text-right font-medium">Margen actual</th>
                  <th className="px-3 py-2 text-right font-medium">Margen mínimo</th>
                  <th className="px-3 py-2 text-right font-medium">Costo paca</th>
                  <th className="px-3 py-2 text-right font-medium">Precio actual</th>
                  <th className="px-5 py-2 text-right font-medium">Precio sugerido</th>
                </tr>
              </thead>
              <tbody>
                {d.marginAlerts.map((a: any) => (
                  <tr key={a.productId} className="border-t">
                    <td className="px-5 py-2 font-medium">
                      <Link to={`/precios/calculador?p=${a.productId}`} className="hover:underline">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-red-700 tabular">{formatPct(a.marginPct)}</td>
                    <td className="px-3 py-2 text-right tabular">{formatPct(a.minMargin)}</td>
                    <td className="px-3 py-2 text-right tabular">{formatCOP(a.costPerPack)}</td>
                    <td className="px-3 py-2 text-right tabular">{formatCOP(a.listPricePack)}</td>
                    <td className="px-5 py-2 text-right font-medium tabular">{formatCOP(a.suggestedPricePack)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ventas del mes" value={formatCOP(m.revenue)} sub={m.maquilaSales > 0 ? `Incluye maquila ${formatCOP(m.maquilaSales)}` : `${m.dispatches} despachos`} />
        <StatCard label="Costo de ventas" value={formatCOP(m.costOfSales)} sub="Costo real de lo despachado" />
        <StatCard
          label="Margen bruto"
          value={formatPct(m.grossMarginPct)}
          sub={formatCOP(m.grossProfit)}
          tone={m.grossMarginPct < 0.15 ? 'danger' : m.grossMarginPct < 0.22 ? 'warning' : 'success'}
          tip="(Ventas − costo de ventas) ÷ ventas"
        />
        <StatCard
          label="Margen operativo estimado"
          value={formatPct(m.operatingMarginPct)}
          sub={`Gastos administrativos del mes: ${formatCOP(m.adminExpenses)}`}
          tone={m.operatingMarginPct < 0 ? 'danger' : 'default'}
          tip="(Utilidad bruta − gastos administrativos registrados en el mes) ÷ ventas"
        />
        <StatCard label="Pacas vendidas" value={formatNumber(m.packsSold)} sub="En el mes" />
        <StatCard label="Cartera pendiente" value={formatCOP(d.receivables.pending)} />
        <StatCard
          label="Cartera vencida"
          value={formatCOP(d.receivables.overdue)}
          sub={`${d.receivables.overdue_count} cuenta(s)`}
          tone={d.receivables.overdue > 0 ? 'danger' : 'success'}
        />
        <StatCard label="Inventario producto terminado" value={formatCOP(d.finishedGoods.value)} sub={`${formatNumber(d.finishedGoods.packs)} pacas a costo`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel icon={<Factory />} title="Producción de hoy" link="/produccion" empty="Aún no hay producción registrada hoy." items={d.productionToday}>
          {(r: any) => (
            <Row key={r.id} left={<>{r.name} <span className="text-xs text-muted-foreground">· {r.shift} · {r.lot_code}</span></>} right={`${formatNumber(r.packs_produced)} pacas`} />
          )}
        </Panel>
        <Panel icon={<Truck />} title="Despachos de hoy" link="/despachos" empty="No hay despachos hoy." items={d.dispatchesToday}>
          {(r: any) => <Row key={r.id} to={`/despachos/${r.id}`} left={<>{r.client_name} <span className="text-xs text-muted-foreground">· {r.packs_total} pacas</span></>} right={formatCOP(r.total)} />}
        </Panel>
        <Panel icon={<ClipboardList />} title={`Pedidos pendientes (${d.pendingOrdersCount})`} link="/pedidos" empty="No hay pedidos pendientes." items={d.pendingOrders}>
          {(r: any) => (
            <Row
              key={r.id}
              to={`/pedidos/${r.id}`}
              left={
                <>
                  {r.number} · {r.client_name}
                  <div className="text-xs text-muted-foreground">
                    {r.pending_packs} pacas · entrega {formatDate(r.delivery_date ?? r.order_date)}
                  </div>
                </>
              }
              right={<OrderStatusBadge status={r.status} />}
            />
          )}
        </Panel>
        <Panel icon={<Boxes />} title="Inventario bajo" link="/inventario" empty="Todas las presentaciones están sobre el mínimo." items={d.lowStockProducts}>
          {(r: any) => <Row key={r.id} left={r.name} right={<span className="text-red-700">{formatNumber(r.stockPacks)} / mín. {formatNumber(r.minStockPacks)}</span>} />}
        </Panel>
        <Panel icon={<PackageMinus />} title="Insumos próximos a agotarse" link="/inventario?tab=insumos" empty="Los insumos tienen existencia suficiente." items={d.lowSupplies}>
          {(r: any) => (
            <Row
              key={r.id}
              left={
                <>
                  {r.name}
                  <div className="text-xs text-muted-foreground">
                    {formatNumber(r.stock, 1)} {r.unit} · mín. {formatNumber(r.min_stock)}
                  </div>
                </>
              }
              right={<span className={r.stock <= r.min_stock ? 'text-red-700' : 'text-amber-700'}>{r.daysLeft !== null ? `${formatNumber(r.daysLeft)} días` : 'Bajo mínimo'}</span>}
            />
          )}
        </Panel>
        <Panel icon={<Receipt />} title="Cartera vencida" link="/cartera" empty="No hay cartera vencida." items={d.overdueList}>
          {(r: any) => (
            <Row
              key={r.id}
              to="/cartera"
              left={
                <>
                  {r.client_name}
                  <div className="text-xs text-muted-foreground">
                    {r.document_number} · {r.days_overdue} días vencida
                  </div>
                </>
              }
              right={<span className="font-medium text-red-700">{formatCOP(r.balance)}</span>}
            />
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader
            title="Ventas de los últimos 6 meses"
            description="Pase el cursor sobre cada mes para ver costo y margen"
            actions={
              <Link to="/finanzas" className="text-xs text-primary hover:underline">
                Ver finanzas
              </Link>
            }
          />
          <div className="p-4">
            <MonthlySalesChart data={d.evolution} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Presentaciones con menor margen" description="Con precio de lista y costo actual" />
          <ul className="divide-y">
            {d.lowestMarginProducts.map((p: any) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <Link to={`/precios/calculador?p=${p.id}`} className="hover:underline">
                  {p.name}
                </Link>
                <span className="text-right">
                  <MarginText value={p.marginPct} min={p.minMargin} target={p.targetMargin} />
                  <span className="ml-2 text-xs text-muted-foreground">mín. {formatPct(p.minMargin, 0)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Panel<T>({ icon, title, link, empty, items, children }: { icon: React.ReactNode; title: string; link: string; empty: string; items: T[]; children: (item: T) => React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b px-5 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground">
          {icon}
          {title}
        </p>
        <Link to={link} className="text-muted-foreground hover:text-foreground" aria-label={`Ir a ${title}`}>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      {items.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p> : <ul className="max-h-64 divide-y overflow-y-auto">{items.map(children)}</ul>}
    </Card>
  );
}

function Row({ left, right, to }: { left: React.ReactNode; right: React.ReactNode; to?: string }) {
  const content = (
    <>
      <div className="min-w-0 text-sm">{left}</div>
      <div className="shrink-0 text-sm tabular">{right}</div>
    </>
  );
  return (
    <li>
      {to ? (
        <Link to={to} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-muted/50">
          {content}
        </Link>
      ) : (
        <div className="flex items-center justify-between gap-3 px-5 py-2.5">{content}</div>
      )}
    </li>
  );
}
