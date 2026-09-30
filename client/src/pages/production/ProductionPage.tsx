import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatCOP, formatDate, formatNumber, formatPct, formatUnitCOP } from '@alpe/shared';
import { DateRange, ErrorState, KeyValue, Loading, PageHeader, StatCard } from '@/components/common';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { useProducts } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api, qs } from '@/services/api';
import { daysAgo, formatDateTime, today } from '@/utils/dates';

export function ProductionPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'registros';
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Producción"
        description="Registros por lote y turno, costo real por botella y trazabilidad de lotes."
        actions={
          <Button onClick={() => navigate('/produccion/nueva')}>
            <Plus /> Registrar producción
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList>
          <TabsTrigger value="registros">Registros de producción</TabsTrigger>
          <TabsTrigger value="lotes">Lotes y trazabilidad</TabsTrigger>
        </TabsList>
        <TabsContent value="registros">
          <Runs />
        </TabsContent>
        <TabsContent value="lotes">
          <Lots />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Runs() {
  const [from, setFrom] = React.useState(daysAgo(60));
  const [to, setTo] = React.useState(today());
  const [productId, setProductId] = React.useState(0);
  const [selected, setSelected] = React.useState<number | null>(null);
  const products = useProducts();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['production', from, to, productId],
    queryFn: () => api.get<any[]>(`/production${qs({ from, to, productId })}`),
  });
  const valid = data.filter((r) => r.status === 'registrada');
  const packs = valid.filter((r) => !r.is_maquila).reduce((s, r) => s + r.packs_produced, 0);
  const units = valid.reduce((s, r) => s + r.good_units, 0);
  const defective = valid.reduce((s, r) => s + r.defective_units, 0);
  const labor = valid.reduce((s, r) => s + r.labor_cost, 0);

  const columns: Column<any>[] = [
    { key: 'date', header: 'Fecha', sort: (r) => `${r.run_date}${r.id}`, csv: (r) => r.run_date, cell: (r) => formatDate(r.run_date) },
    { key: 'shift', header: 'Turno', csv: (r) => r.shift, cell: (r) => r.shift },
    {
      key: 'item',
      header: 'Presentación',
      sort: (r) => r.item_name,
      csv: (r) => r.item_name,
      cell: (r) => (
        <div>
          <div className="font-medium">{r.item_name}</div>
          {r.is_maquila && <div className="text-xs text-muted-foreground">Maquila · {r.client_name}</div>}
        </div>
      ),
    },
    {
      key: 'lot',
      header: 'Lote',
      csv: (r) => r.lot_code,
      cell: (r) => (
        <Link to={`/produccion/lotes/${r.lot_id}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">
          {r.lot_code}
        </Link>
      ),
    },
    { key: 'packs', header: 'Pacas', align: 'right', sort: (r) => r.packs_produced, csv: (r) => r.packs_produced, cell: (r) => formatNumber(r.packs_produced) },
    { key: 'units', header: 'Botellas', align: 'right', csv: (r) => r.good_units, cell: (r) => formatNumber(r.good_units) },
    { key: 'defective', header: 'Defectuosas', align: 'right', csv: (r) => r.defective_units, cell: (r) => formatNumber(r.defective_units) },
    { key: 'yield', header: 'Rendimiento', align: 'right', sort: (r) => r.yield_pct, csv: (r) => Math.round(r.yield_pct * 10000) / 100, cell: (r) => formatPct(r.yield_pct) },
    { key: 'waste', header: 'Desperdicio', align: 'right', sort: (r) => r.waste_pct, csv: (r) => Math.round(r.waste_pct * 10000) / 100, cell: (r) => <span className={r.waste_pct > 0.02 ? 'text-amber-700' : ''}>{formatPct(r.waste_pct)}</span> },
    { key: 'labor', header: 'M. obra / botella', align: 'right', csv: (r) => Math.round((r.labor_cost / r.good_units) * 100) / 100, cell: (r) => formatUnitCOP(r.labor_cost / r.good_units) },
    { key: 'cpu', header: 'Costo real botella', align: 'right', sort: (r) => r.cost_per_unit, csv: (r) => Math.round(r.cost_per_unit * 100) / 100, cell: (r) => formatUnitCOP(r.cost_per_unit) },
    { key: 'cpp', header: 'Costo real paca', align: 'right', sort: (r) => r.cost_per_pack, csv: (r) => Math.round(r.cost_per_pack), cell: (r) => <span className="font-medium">{formatCOP(r.cost_per_pack)}</span> },
    { key: 'responsible', header: 'Responsable', csv: (r) => r.responsible, cell: (r) => <span className="text-xs">{r.responsible}</span> },
    { key: 'status', header: 'Estado', csv: (r) => r.status, cell: (r) => (r.status === 'anulada' ? <Badge variant="neutral">Anulada</Badge> : null) },
  ];

  if (error) return <ErrorState error={error} />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Pacas producidas (venta)" value={formatNumber(packs)} sub="Periodo seleccionado" />
        <StatCard label="Botellas buenas" value={formatNumber(units)} />
        <StatCard label="Desperdicio promedio" value={formatPct(units + defective ? defective / (units + defective) : 0)} />
        <StatCard label="Mano de obra por botella" value={formatUnitCOP(units ? labor / units : 0)} tip="Costo total de mano de obra ÷ botellas buenas producidas en el periodo." />
      </div>
      <DataTable
        rows={data}
        columns={columns}
        loading={isLoading}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.item_name} ${r.lot_code} ${r.responsible ?? ''} ${r.client_name ?? ''}`}
        exportName="produccion"
        onRowClick={(r) => setSelected(r.id)}
        rowClassName={(r) => (r.status === 'anulada' ? 'opacity-50' : undefined)}
        toolbar={
          <>
            <DateRange
              from={from}
              to={to}
              onChange={(f, t) => {
                setFrom(f);
                setTo(t);
              }}
            />
            <Select value={productId} onChange={(e) => setProductId(Number(e.target.value))} className="w-44" aria-label="Presentación">
              <option value={0}>Todas</option>
              {products.data?.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <RunDialog id={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function RunDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data: r, isLoading } = useQuery({ queryKey: ['production-run', id], queryFn: () => api.get(`/production/${id}`), enabled: !!id });
  const [annulOpen, setAnnulOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const annul = useSubmit({
    request: () => api.post(`/production/${id}/annul`, { reason }),
    successMessage: 'Producción anulada. Inventarios revertidos.',
    onSuccess: () => {
      setAnnulOpen(false);
      onClose();
    },
  });
  return (
    <Dialog
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={r ? `Producción · lote ${r.lot_code}` : 'Producción'}
      footer={
        r && (
          <>
            {r.status === 'registrada' && (
              <Button variant="outline" className="mr-auto" onClick={() => setAnnulOpen(true)}>
                Anular producción
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to={`/produccion/lotes/${r.lot_id}`}>Ver trazabilidad del lote</Link>
            </Button>
          </>
        )
      }
    >
      {isLoading || !r ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KeyValue label="Presentación">{r.item_name}</KeyValue>
            <KeyValue label="Fecha / turno">
              {formatDate(r.run_date)} · {r.shift}
            </KeyValue>
            <KeyValue label="Pacas">{formatNumber(r.packs_produced)}</KeyValue>
            <KeyValue label="Botellas buenas">{formatNumber(r.good_units)}</KeyValue>
            <KeyValue label="Defectuosas">{formatNumber(r.defective_units)}</KeyValue>
            <KeyValue label="Rendimiento">{formatPct(r.yield_pct)}</KeyValue>
            <KeyValue label="Trabajadores / horas">
              {r.workers} / {r.hours} h
            </KeyValue>
            <KeyValue label="Energía">{formatNumber(r.energy_kwh)} kWh</KeyValue>
            <KeyValue label="Mano de obra">{formatCOP(r.labor_cost)}</KeyValue>
            <KeyValue label="Costo energía">{formatCOP(r.energy_cost)}</KeyValue>
            <KeyValue label="Materiales">{formatCOP(r.materials_cost)}</KeyValue>
            <KeyValue label="Costo total">{formatCOP(r.total_cost)}</KeyValue>
            <KeyValue label="Costo real botella">{formatUnitCOP(r.cost_per_unit)}</KeyValue>
            <KeyValue label="Costo real paca">{formatCOP(r.cost_per_pack)}</KeyValue>
            <KeyValue label="Responsable">{r.responsible}</KeyValue>
            <KeyValue label="Registrado">{formatDateTime(r.created_at)}</KeyValue>
          </dl>
          <div>
            <p className="section-title mb-2">Insumos consumidos</p>
            <table className="w-full text-sm">
              <tbody>
                {r.consumptions.map((c: any) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-1.5">{c.supply_name}</td>
                    <td className="py-1.5 text-right tabular">
                      {formatNumber(c.quantity, 2)} {c.unit}
                    </td>
                    <td className="py-1.5 text-right tabular">{formatCOP(c.total_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.notes && <p className="text-sm text-muted-foreground">{r.notes}</p>}
        </div>
      )}
      <ConfirmDialog open={annulOpen} onOpenChange={setAnnulOpen} title="¿Anular esta producción?" destructive confirmLabel="Anular" loading={annul.loading} onConfirm={() => annul.submit(undefined)}>
        <p className="mb-3">Se retirarán las pacas del inventario y se devolverán los insumos consumidos. Solo es posible si el lote no se ha despachado.</p>
        <Input placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </Dialog>
  );
}

function Lots() {
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const navigate = useNavigate();
  const { data = [], isLoading } = useQuery({ queryKey: ['lots', debounced], queryFn: () => api.get<any[]>(`/lots${qs({ q: debounced })}`) });
  const columns: Column<any>[] = [
    { key: 'code', header: 'Lote', sort: (l) => l.code, csv: (l) => l.code, cell: (l) => <span className="font-medium text-primary">{l.code}</span> },
    {
      key: 'item',
      header: 'Producto',
      sort: (l) => l.item_name,
      csv: (l) => l.item_name,
      cell: (l) => (
        <div>
          <div>{l.item_name}</div>
          {l.is_maquila && <div className="text-xs text-muted-foreground">Maquila · {l.client_name}</div>}
        </div>
      ),
    },
    { key: 'date', header: 'Producción', sort: (l) => l.production_date, csv: (l) => l.production_date, cell: (l) => formatDate(l.production_date) },
    { key: 'expiry', header: 'Vencimiento', csv: (l) => l.expiry_date, cell: (l) => <span className="text-muted-foreground">{formatDate(l.expiry_date)}</span> },
    { key: 'produced', header: 'Pacas producidas', align: 'right', csv: (l) => l.packs_produced, cell: (l) => formatNumber(l.packs_produced) },
    { key: 'dispatched', header: 'Despachadas', align: 'right', csv: (l) => l.packs_produced - l.packs_remaining, cell: (l) => formatNumber(l.packs_produced - l.packs_remaining) },
    { key: 'remaining', header: 'En bodega', align: 'right', sort: (l) => l.packs_remaining, csv: (l) => l.packs_remaining, cell: (l) => formatNumber(l.packs_remaining) },
    {
      key: 'status',
      header: 'Estado',
      cell: (l) =>
        l.production_status === 'anulada' ? (
          <Badge variant="neutral">Anulado</Badge>
        ) : l.packs_remaining === 0 ? (
          <Badge variant="success">Despachado</Badge>
        ) : l.packs_remaining < l.packs_produced ? (
          <Badge variant="warning">Parcial</Badge>
        ) : (
          <Badge variant="info">En bodega</Badge>
        ),
    },
  ];
  return (
    <div className="space-y-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar lote por código, producto o cliente…" className="max-w-md" />
      <DataTable rows={data} columns={columns} loading={isLoading} rowKey={(l) => l.id} exportName="lotes" onRowClick={(l) => navigate(`/produccion/lotes/${l.id}`)} />
    </div>
  );
}
