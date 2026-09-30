import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { addDays, EXPENSE_CATEGORIES, formatCOP, formatDate, formatMonth, formatNumber, formatPct } from '@alpe/shared';
import { DateRange, ErrorState, Loading, MarginStatusBadge, MarginText, PageHeader, StatCard, AggMarginText } from '@/components/common';
import { SalesVsCostChart, trimLeadingEmpty } from '@/components/common/Charts';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, Select } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { useSubmit } from '@/hooks/useSubmit';
import { api, qs } from '@/services/api';
import { monthStart, today } from '@/utils/dates';

function presets() {
  const t = today();
  const ms = monthStart();
  const prevEnd = addDays(ms, -1);
  const prevStart = `${prevEnd.slice(0, 7)}-01`;
  return [
    { label: 'Este mes', from: ms, to: t },
    { label: 'Mes anterior', from: prevStart, to: prevEnd },
    { label: 'Últimos 90 días', from: addDays(t, -90), to: t },
    { label: 'Este año', from: `${t.slice(0, 4)}-01-01`, to: t },
  ];
}

export function FinancePage() {
  const [range, setRange] = React.useState({ from: monthStart(), to: today() });
  const { data: f, isLoading, error } = useQuery({ queryKey: ['finance', range], queryFn: () => api.get(`/reports/finance${qs(range)}`) });

  return (
    <>
      <PageHeader
        title="Finanzas"
        description="Ventas, costos y márgenes reales (según lo despachado), por producto y por cliente."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {presets().map((p) => (
              <Button key={p.label} size="sm" variant={range.from === p.from && range.to === p.to ? 'secondary' : 'ghost'} onClick={() => setRange({ from: p.from, to: p.to })}>
                {p.label}
              </Button>
            ))}
            <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
          </div>
        }
      />
      <Tabs defaultValue="resumen">
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="gastos">Gastos administrativos</TabsTrigger>
        </TabsList>
        <TabsContent value="resumen">
          {isLoading ? <Loading /> : error || !f ? <ErrorState error={error} /> : <Summary f={f} />}
        </TabsContent>
        <TabsContent value="gastos">
          <Expenses from={range.from} to={range.to} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Summary({ f }: { f: any }) {
  const t = f.totals;
  const productCols: Column<any>[] = [
    {
      key: 'name',
      header: 'Producto',
      sort: (r) => r.name,
      csv: (r) => r.name,
      cell: (r) => (
        <span className="font-medium">
          {r.name} {r.is_maquila && <Badge variant="info">Maquila</Badge>}
        </span>
      ),
    },
    { key: 'packs', header: 'Pacas', align: 'right', sort: (r) => r.packs, csv: (r) => r.packs, cell: (r) => formatNumber(r.packs) },
    { key: 'revenue', header: 'Ventas', align: 'right', sort: (r) => r.revenue, csv: (r) => r.revenue, cell: (r) => formatCOP(r.revenue) },
    { key: 'share', header: '% ventas', align: 'right', cell: (r) => formatPct(t.revenue ? r.revenue / t.revenue : 0) },
    { key: 'cost', header: 'Costo', align: 'right', sort: (r) => r.cost, csv: (r) => Math.round(r.cost), cell: (r) => formatCOP(r.cost) },
    { key: 'profit', header: 'Utilidad bruta', align: 'right', sort: (r) => r.profit, csv: (r) => Math.round(r.profit), cell: (r) => formatCOP(r.profit) },
    { key: 'margin', header: 'Margen', align: 'right', sort: (r) => r.marginPct, csv: (r) => Math.round(r.marginPct * 10000) / 100, cell: (r) => <AggMarginText value={r.marginPct} /> },
  ];
  const clientCols: Column<any>[] = [
    { key: 'name', header: 'Cliente', sort: (r) => r.name, csv: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'profile', header: 'Perfil', csv: (r) => r.profile_name, cell: (r) => <span className="text-xs text-muted-foreground">{r.profile_name}</span> },
    { key: 'dispatches', header: 'Despachos', align: 'right', csv: (r) => r.dispatches, cell: (r) => r.dispatches },
    { key: 'packs', header: 'Pacas', align: 'right', sort: (r) => r.packs, csv: (r) => r.packs, cell: (r) => formatNumber(r.packs) },
    { key: 'revenue', header: 'Ventas', align: 'right', sort: (r) => r.revenue, csv: (r) => r.revenue, cell: (r) => formatCOP(r.revenue) },
    { key: 'cost', header: 'Costo', align: 'right', sort: (r) => r.cost, csv: (r) => Math.round(r.cost), cell: (r) => formatCOP(r.cost) },
    { key: 'profit', header: 'Utilidad bruta', align: 'right', sort: (r) => r.profit, csv: (r) => Math.round(r.profit), cell: (r) => formatCOP(r.profit) },
    { key: 'margin', header: 'Margen', align: 'right', sort: (r) => r.marginPct, csv: (r) => Math.round(r.marginPct * 10000) / 100, cell: (r) => <AggMarginText value={r.marginPct} /> },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ventas" value={formatCOP(t.revenue)} sub={`Agua ${formatCOP(t.sales)} · Maquila ${formatCOP(t.maquilaSales)}`} />
        <StatCard label="Costo de ventas" value={formatCOP(t.costOfSales)} />
        <StatCard label="Margen bruto" value={formatPct(t.grossMarginPct)} sub={formatCOP(t.grossProfit)} tip="(Ventas − costo de ventas) ÷ ventas" />
        <StatCard
          label="Margen operativo estimado"
          value={formatPct(t.operatingMarginPct)}
          sub={`Utilidad ${formatCOP(t.operatingProfit)} · gastos adm. ${formatCOP(t.adminExpenses)}`}
          tone={t.operatingProfit < 0 ? 'danger' : 'default'}
          tip="(Utilidad bruta − gastos administrativos registrados en el periodo) ÷ ventas"
        />
        <StatCard label="Pacas vendidas" value={formatNumber(t.packsSold)} sub={`${t.dispatches} despachos`} />
        <StatCard label="Flete cobrado a clientes" value={formatCOP(t.freightCharged)} />
        <StatCard label="Cartera pendiente" value={formatCOP(f.receivables.pending)} />
        <StatCard label="Cartera vencida" value={formatCOP(f.receivables.overdue)} tone={f.receivables.overdue > 0 ? 'danger' : 'success'} />
      </div>

      <Card>
        <CardHeader title="Evolución mensual (hasta 12 meses)" description="Ventas y costo de ventas en pesos. La tabla inferior muestra los mismos valores." />
        <div className="p-4">
          <SalesVsCostChart data={f.evolution} />
        </div>
        <div className="overflow-x-auto border-t">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Mes</th>
                {trimLeadingEmpty(f.evolution).map((m: any) => (
                  <th key={m.month} className="px-2 py-2 text-right font-medium capitalize">
                    {formatMonth(m.month).split(' ')[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              <tr className="border-t">
                <td className="px-4 py-1.5 font-medium">Ventas</td>
                {trimLeadingEmpty(f.evolution).map((m: any) => (
                  <td key={m.month} className="px-2 py-1.5 text-right">{formatNumber(m.revenue / 1_000_000, 1)} M</td>
                ))}
              </tr>
              <tr className="border-t">
                <td className="px-4 py-1.5 font-medium">Margen bruto</td>
                {trimLeadingEmpty(f.evolution).map((m: any) => (
                  <td key={m.month} className="px-2 py-1.5 text-right">{m.revenue ? formatPct(m.marginPct, 0) : '—'}</td>
                ))}
              </tr>
              <tr className="border-t">
                <td className="px-4 py-1.5 font-medium">Gastos adm.</td>
                {trimLeadingEmpty(f.evolution).map((m: any) => (
                  <td key={m.month} className="px-2 py-1.5 text-right">{formatNumber(m.adminExpenses / 1_000_000, 1)} M</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div>
        <p className="section-title mb-3">Ventas y margen por producto</p>
        <DataTable rows={f.byProduct} columns={productCols} rowKey={(r) => r.key} exportName="ventas-por-producto" defaultSort={{ key: 'revenue', dir: 'desc' }} emptyMessage="Sin ventas en el periodo." />
      </div>
      <div>
        <p className="section-title mb-3">Ventas y margen por cliente (top clientes)</p>
        <DataTable rows={f.byClient} columns={clientCols} rowKey={(r) => r.id} searchText={(r) => r.name} exportName="ventas-por-cliente" defaultSort={{ key: 'revenue', dir: 'desc' }} pageSize={15} emptyMessage="Sin ventas en el periodo." />
      </div>
      <Card>
        <CardHeader title="Margen actual por presentación" description="Con el precio de lista y el costo de hoy. Ordenado de menor a mayor margen." />
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-2 text-left font-medium">Presentación</th>
              <th className="px-3 py-2 text-right font-medium">Costo paca</th>
              <th className="px-3 py-2 text-right font-medium">Precio lista</th>
              <th className="px-3 py-2 text-right font-medium">Margen</th>
              <th className="px-3 py-2 text-right font-medium">Mínimo / objetivo</th>
              <th className="px-5 py-2 text-left font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {f.currentMargins.map((p: any) => (
              <tr key={p.id} className="border-t">
                <td className="px-5 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2 text-right tabular">{formatCOP(p.costPerPack)}</td>
                <td className="px-3 py-2 text-right tabular">{formatCOP(p.listPricePack)}</td>
                <td className="px-3 py-2 text-right">
                  <MarginText value={p.marginPct} min={p.minMargin} target={p.targetMargin} />
                </td>
                <td className="px-3 py-2 text-right tabular text-muted-foreground">
                  {formatPct(p.minMargin, 0)} / {formatPct(p.targetMargin, 0)}
                </td>
                <td className="px-5 py-2">
                  <MarginStatusBadge status={p.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Expenses({ from, to }: { from: string; to: string }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['expenses', from, to], queryFn: () => api.get<any[]>(`/expenses${qs({ from, to })}`) });
  const [editing, setEditing] = React.useState<any | 'new' | null>(null);
  const [deleting, setDeleting] = React.useState<any | null>(null);
  const del = useSubmit({ request: () => api.del(`/expenses/${deleting.id}`), successMessage: 'Gasto eliminado.', onSuccess: () => setDeleting(null) });
  const total = data.reduce((s, e) => s + e.amount, 0);
  const columns: Column<any>[] = [
    { key: 'date', header: 'Fecha', sort: (e) => e.expense_date, csv: (e) => e.expense_date, cell: (e) => formatDate(e.expense_date) },
    { key: 'category', header: 'Categoría', sort: (e) => e.category, csv: (e) => e.category, cell: (e) => <Badge variant="neutral">{e.category}</Badge> },
    { key: 'description', header: 'Descripción', csv: (e) => e.description, cell: (e) => e.description },
    { key: 'amount', header: 'Valor', align: 'right', sort: (e) => e.amount, csv: (e) => e.amount, cell: (e) => <span className="font-medium">{formatCOP(e.amount)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (e) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => setEditing(e)} aria-label="Editar">
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setDeleting(e)} aria-label="Eliminar">
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Gastos administrativos del periodo" value={formatCOP(total)} sub={`${data.length} registros`} />
      </div>
      <p className="text-sm text-muted-foreground">
        Estos gastos se restan de la utilidad bruta para calcular el margen operativo. Para incluirlos en el costo de cada botella, configure la opción en Configuración → Costos y gastos.
      </p>
      <DataTable
        rows={data}
        columns={columns}
        loading={isLoading}
        rowKey={(e) => e.id}
        searchText={(e) => `${e.category} ${e.description ?? ''}`}
        exportName="gastos-administrativos"
        toolbar={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Registrar gasto
          </Button>
        }
      />
      <ExpenseDialog expense={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="¿Eliminar este gasto?" destructive confirmLabel="Eliminar" loading={del.loading} onConfirm={() => del.submit(undefined)}>
        {deleting && `${deleting.category} · ${formatCOP(deleting.amount)}`}
      </ConfirmDialog>
    </div>
  );
}

function ExpenseDialog({ expense, onClose }: { expense: any | 'new' | null; onClose: () => void }) {
  const [form, setForm] = React.useState({ date: today(), category: EXPENSE_CATEGORIES[0] as string, description: '', amount: 0 });
  React.useEffect(() => {
    if (expense && expense !== 'new') setForm({ date: expense.expense_date, category: expense.category, description: expense.description ?? '', amount: expense.amount });
    else if (expense === 'new') setForm({ date: today(), category: EXPENSE_CATEGORIES[0], description: '', amount: 0 });
  }, [expense]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useSubmit({
    request: () => (expense === 'new' ? api.post('/expenses', form) : api.put(`/expenses/${expense.id}`, form)),
    successMessage: 'Gasto guardado.',
    onSuccess: onClose,
  });
  return (
    <Dialog
      open={!!expense}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title={expense === 'new' ? 'Registrar gasto administrativo' : 'Editar gasto'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.submit(undefined)} disabled={save.loading || form.amount <= 0}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Fecha">
            <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Valor" required>
            <MoneyInput value={form.amount} onChange={(v) => set('amount', v)} />
          </Field>
        </div>
        <Field label="Categoría">
          <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Descripción">
          <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
