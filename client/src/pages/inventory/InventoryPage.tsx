import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, PlusCircle } from 'lucide-react';
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatCOP, formatDate, formatNumber, formatPct, PRODUCT_MOVEMENT_LABEL, SUPPLY_CATEGORY_LABEL, SUPPLY_MOVEMENT_LABEL, type SupplyCategory } from '@alpe/shared';
import { DateRange, ErrorState, PageHeader, StatCard } from '@/components/common';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { api, qs } from '@/services/api';
import { daysAgo, today } from '@/utils/dates';
import { MovementDialog, PhysicalCountDialog } from './InventoryDialogs';

export function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'producto';
  return (
    <>
      <PageHeader title="Inventario" description="Existencias de producto terminado e insumos. Producción y despachos actualizan el inventario automáticamente." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList>
          <TabsTrigger value="producto">Producto terminado</TabsTrigger>
          <TabsTrigger value="insumos">Insumos</TabsTrigger>
          <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
          <TabsTrigger value="conteos">Conteos físicos</TabsTrigger>
        </TabsList>
        <TabsContent value="producto">
          <FinishedGoods />
        </TabsContent>
        <TabsContent value="insumos">
          <SuppliesStock />
        </TabsContent>
        <TabsContent value="movimientos">
          <Movements />
        </TabsContent>
        <TabsContent value="conteos">
          <Counts />
        </TabsContent>
      </Tabs>
    </>
  );
}

function FinishedGoods() {
  const { data = [], isLoading, error } = useQuery({ queryKey: ['inventory', 'products'], queryFn: () => api.get<any[]>('/inventory/products') });
  const [countOpen, setCountOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const active = data.filter((p) => p.active || p.stockPacks !== 0);
  const totalValue = active.reduce((s, p) => s + p.value, 0);
  const totalPacks = active.reduce((s, p) => s + Math.max(p.stockPacks, 0), 0);
  const low = active.filter((p) => p.low).length;

  const columns: Column<any>[] = [
    { key: 'name', header: 'Presentación', sort: (p) => p.name, csv: (p) => p.name, cell: (p) => <span className="font-medium">{p.name}</span> },
    {
      key: 'stock',
      header: 'Existencia teórica',
      align: 'right',
      sort: (p) => p.stockPacks,
      csv: (p) => p.stockPacks,
      cell: (p) => (
        <div>
          <div className={`font-medium ${p.low ? 'text-red-700' : ''}`}>{formatNumber(p.stockPacks)} pacas</div>
          <div className="text-xs text-muted-foreground">{formatNumber(p.stockUnits)} botellas</div>
        </div>
      ),
    },
    { key: 'min', header: 'Mínimo', align: 'right', csv: (p) => p.minStockPacks, cell: (p) => <span className="text-muted-foreground">{formatNumber(p.minStockPacks)}</span> },
    { key: 'cost', header: 'Costo paca', align: 'right', csv: (p) => Math.round(p.costPerPack), cell: (p) => formatCOP(p.costPerPack) },
    { key: 'value', header: 'Valor', align: 'right', sort: (p) => p.value, csv: (p) => Math.round(p.value), cell: (p) => <span className="font-medium">{formatCOP(p.value)}</span> },
    {
      key: 'count',
      header: 'Último conteo físico',
      csv: (p) => (p.lastCount ? `${p.lastCount.count_date}: sistema ${p.lastCount.system_qty} / físico ${p.lastCount.physical_qty}` : ''),
      cell: (p) =>
        p.lastCount ? (
          <div className="text-xs">
            <div>{formatDate(p.lastCount.count_date)}</div>
            <div className="text-muted-foreground">
              Sistema {formatNumber(p.lastCount.system_qty)} · Físico {formatNumber(p.lastCount.physical_qty)}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Sin conteos</span>
        ),
    },
    {
      key: 'diff',
      header: 'Diferencia',
      align: 'right',
      csv: (p) => p.lastCount?.difference ?? '',
      cell: (p) =>
        p.lastCount ? (
          <div className={p.lastCount.relevant ? 'font-medium text-red-700' : p.lastCount.difference === 0 ? 'text-emerald-700' : ''}>
            <div>
              {p.lastCount.difference > 0 ? '+' : ''}
              {formatNumber(p.lastCount.difference)} pacas
            </div>
            <div className="text-xs">{formatCOP(p.lastCount.difference_value)}</div>
          </div>
        ) : (
          '—'
        ),
    },
    { key: 'status', header: 'Estado', cell: (p) => (p.low ? <Badge variant="danger">Inventario bajo</Badge> : <Badge variant="success">OK</Badge>) },
  ];

  if (error) return <ErrorState error={error} />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Pacas en bodega" value={formatNumber(totalPacks)} />
        <StatCard label="Valor del inventario (a costo)" value={formatCOP(totalValue)} />
        <StatCard label="Presentaciones con inventario bajo" value={low} tone={low ? 'danger' : 'success'} />
      </div>
      <DataTable
        rows={active}
        columns={columns}
        loading={isLoading}
        rowKey={(p) => p.id}
        exportName="inventario-producto-terminado"
        rowClassName={(p) => (p.lastCount?.relevant ? 'bg-red-50/40' : undefined)}
        toolbar={
          <div className="flex gap-2">
            <Button onClick={() => setCountOpen(true)}>
              <ClipboardCheck /> Conteo físico
            </Button>
            <Button variant="outline" onClick={() => setMoveOpen(true)}>
              <PlusCircle /> Registrar movimiento
            </Button>
          </div>
        }
      />
      <PhysicalCountDialog
        open={countOpen}
        onClose={() => setCountOpen(false)}
        itemType="producto"
        items={active.map((p) => ({ id: p.id, name: p.name, systemQty: p.stockPacks, unitValue: p.costPerPack, unit: 'pacas' }))}
      />
      <MovementDialog open={moveOpen} onClose={() => setMoveOpen(false)} kind="producto" items={active.map((p) => ({ id: p.id, name: p.name, stock: p.stockPacks, unit: 'pacas' }))} />
    </div>
  );
}

function SuppliesStock() {
  const { data = [], isLoading, error } = useQuery({ queryKey: ['inventory', 'supplies'], queryFn: () => api.get<any[]>('/inventory/supplies') });
  const [countOpen, setCountOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const active = data.filter((s) => s.active);
  const columns: Column<any>[] = [
    {
      key: 'name',
      header: 'Insumo',
      sort: (s) => s.name,
      csv: (s) => s.name,
      cell: (s) => (
        <div>
          <div className="font-medium">{s.name}</div>
          <div className="text-xs text-muted-foreground">{SUPPLY_CATEGORY_LABEL[s.category as SupplyCategory]}</div>
        </div>
      ),
    },
    {
      key: 'stock',
      header: 'Existencia',
      align: 'right',
      sort: (s) => s.stock,
      csv: (s) => s.stock,
      cell: (s) => (
        <span className={s.low ? 'font-medium text-red-700' : 'font-medium'}>
          {formatNumber(s.stock, 2)} <span className="text-xs font-normal text-muted-foreground">{s.unit}</span>
        </span>
      ),
    },
    { key: 'min', header: 'Mínimo', align: 'right', csv: (s) => s.min_stock, cell: (s) => <span className="text-muted-foreground">{formatNumber(s.min_stock, 2)}</span> },
    { key: 'daily', header: 'Consumo diario', align: 'right', sort: (s) => s.daily_use, csv: (s) => Math.round(s.daily_use * 100) / 100, cell: (s) => (s.daily_use ? formatNumber(s.daily_use, 1) : '—') },
    {
      key: 'days',
      header: 'Días de cobertura',
      align: 'right',
      sort: (s) => s.days_left ?? 9999,
      csv: (s) => (s.days_left === null ? '' : Math.round(s.days_left)),
      cell: (s) => (s.days_left === null ? <span className="text-muted-foreground">—</span> : <span className={s.days_left < 10 ? 'font-medium text-amber-700' : ''}>{formatNumber(s.days_left)} días</span>),
    },
    { key: 'value', header: 'Valor', align: 'right', sort: (s) => s.value, csv: (s) => Math.round(s.value), cell: (s) => formatCOP(s.value) },
    {
      key: 'status',
      header: 'Estado',
      cell: (s) => (s.low ? <Badge variant="danger">Bajo mínimo</Badge> : s.days_left !== null && s.days_left < 10 ? <Badge variant="warning">Próximo a agotarse</Badge> : <Badge variant="success">OK</Badge>),
    },
  ];
  if (error) return <ErrorState error={error} />;
  return (
    <>
      <DataTable
        rows={active}
        columns={columns}
        loading={isLoading}
        rowKey={(s) => s.id}
        searchText={(s) => s.name}
        exportName="inventario-insumos"
        toolbar={
          <div className="flex gap-2">
            <Button onClick={() => setMoveOpen(true)}>
              <PlusCircle /> Registrar movimiento
            </Button>
            <Button variant="outline" onClick={() => setCountOpen(true)}>
              <ClipboardCheck /> Conteo físico
            </Button>
          </div>
        }
      />
      <PhysicalCountDialog
        open={countOpen}
        onClose={() => setCountOpen(false)}
        itemType="insumo"
        items={active.map((s) => ({ id: s.id, name: s.name, systemQty: s.stock, unitValue: s.current_cost, unit: s.unit }))}
      />
      <MovementDialog open={moveOpen} onClose={() => setMoveOpen(false)} kind="insumo" items={active.map((s) => ({ id: s.id, name: s.name, stock: s.stock, unit: s.unit }))} />
    </>
  );
}

function Movements() {
  const [kind, setKind] = React.useState<'producto' | 'insumo'>('producto');
  const [from, setFrom] = React.useState(daysAgo(30));
  const [to, setTo] = React.useState(today());
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['movements', kind, from, to],
    queryFn: () => api.get<any[]>(`/inventory/movements${qs({ kind, from, to })}`),
  });
  const labels: Record<string, string> = kind === 'producto' ? PRODUCT_MOVEMENT_LABEL : SUPPLY_MOVEMENT_LABEL;
  const columns: Column<any>[] = [
    { key: 'date', header: 'Fecha', sort: (m) => `${m.movement_date}-${String(m.id).padStart(8, '0')}`, csv: (m) => m.movement_date, cell: (m) => formatDate(m.movement_date) },
    { key: 'item', header: kind === 'producto' ? 'Presentación' : 'Insumo', sort: (m) => m.item_name, csv: (m) => m.item_name, cell: (m) => <span className="font-medium">{m.item_name}</span> },
    { key: 'type', header: 'Tipo', sort: (m) => m.type, csv: (m) => labels[m.type], cell: (m) => <Badge variant="neutral">{labels[m.type] ?? m.type}</Badge> },
    {
      key: 'qty',
      header: 'Cantidad',
      align: 'right',
      csv: (m) => m.quantity ?? m.packs,
      cell: (m) => {
        const q = m.quantity ?? m.packs;
        return (
          <span className={q < 0 ? 'text-red-700' : 'text-emerald-700'}>
            {q > 0 ? '+' : ''}
            {formatNumber(q, 2)} <span className="text-xs text-muted-foreground">{m.unit}</span>
          </span>
        );
      },
    },
    { key: 'after', header: 'Saldo', align: 'right', csv: (m) => m.stock_after, cell: (m) => formatNumber(m.stock_after, 2) },
    { key: 'ref', header: 'Referencia', csv: (m) => m.reference, cell: (m) => <span className="text-xs">{m.reference}{m.lot_code ? ` · ${m.lot_code}` : ''}</span> },
    { key: 'notes', header: 'Observaciones', csv: (m) => m.notes, cell: (m) => <span className="text-xs text-muted-foreground">{m.notes}</span> },
    { key: 'user', header: 'Usuario', csv: (m) => m.user_name, cell: (m) => <span className="text-xs text-muted-foreground">{m.user_name}</span> },
  ];
  if (error) return <ErrorState error={error} />;
  return (
    <DataTable
      rows={data}
      columns={columns}
      loading={isLoading}
      rowKey={(m) => m.id}
      searchText={(m) => `${m.item_name} ${m.reference ?? ''} ${m.notes ?? ''} ${m.lot_code ?? ''}`}
      exportName={`movimientos-${kind}`}
      defaultSort={{ key: 'date', dir: 'desc' }}
      toolbar={
        <>
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'producto' | 'insumo')} className="w-48" aria-label="Tipo de inventario">
            <option value="producto">Producto terminado</option>
            <option value="insumo">Insumos</option>
          </Select>
          <DateRange
            from={from}
            to={to}
            onChange={(f, t) => {
              setFrom(f);
              setTo(t);
            }}
          />
        </>
      }
    />
  );
}

function Counts() {
  const { data = [], isLoading, error } = useQuery({ queryKey: ['counts'], queryFn: () => api.get<any[]>('/inventory/counts') });
  const columns: Column<any>[] = [
    { key: 'date', header: 'Fecha', sort: (c) => c.count_date, csv: (c) => c.count_date, cell: (c) => formatDate(c.count_date) },
    { key: 'type', header: 'Tipo', csv: (c) => c.item_type, cell: (c) => <Badge variant="neutral">{c.item_type === 'producto' ? 'Producto' : 'Insumo'}</Badge> },
    { key: 'item', header: 'Ítem', sort: (c) => c.item_name, csv: (c) => c.item_name, cell: (c) => <span className="font-medium">{c.item_name}</span> },
    { key: 'system', header: 'Sistema', align: 'right', csv: (c) => c.system_qty, cell: (c) => `${formatNumber(c.system_qty, 2)} ${c.unit}` },
    { key: 'physical', header: 'Físico', align: 'right', csv: (c) => c.physical_qty, cell: (c) => `${formatNumber(c.physical_qty, 2)} ${c.unit}` },
    {
      key: 'diff',
      header: 'Diferencia',
      align: 'right',
      sort: (c) => c.difference,
      csv: (c) => c.difference,
      cell: (c) => (
        <span className={c.difference < 0 ? 'font-medium text-red-700' : c.difference > 0 ? 'text-emerald-700' : ''}>
          {c.difference > 0 ? '+' : ''}
          {formatNumber(c.difference, 2)}
          {c.system_qty ? <span className="ml-1 text-xs">({formatPct(c.difference / c.system_qty)})</span> : null}
        </span>
      ),
    },
    { key: 'value', header: 'Valor diferencia', align: 'right', sort: (c) => c.difference_value, csv: (c) => Math.round(c.difference_value), cell: (c) => formatCOP(c.difference_value) },
    { key: 'notes', header: 'Observaciones', csv: (c) => c.notes, cell: (c) => <span className="text-xs text-muted-foreground">{c.notes}</span> },
    { key: 'user', header: 'Usuario', csv: (c) => c.user_name, cell: (c) => <span className="text-xs text-muted-foreground">{c.user_name}</span> },
  ];
  if (error) return <ErrorState error={error} />;
  return <DataTable rows={data} columns={columns} loading={isLoading} rowKey={(c) => c.id} searchText={(c) => c.item_name} exportName="conteos-fisicos" />;
}
