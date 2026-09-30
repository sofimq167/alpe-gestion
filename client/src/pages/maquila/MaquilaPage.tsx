import { useQuery } from '@tanstack/react-query';
import { Factory, Handshake, Pencil, Plus, Truck } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCOP, formatDate, formatNumber, formatPct, formatUnitCOP } from '@alpe/shared';
import { EmptyState, ErrorState, Loading, PageHeader, AggMarginText } from '@/components/common';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { useMaquilaServices } from '@/hooks/useData';
import { api } from '@/services/api';
import type { MaquilaService } from '@/types';
import { MaquilaDispatchDialog, MaquilaServiceDialog } from './MaquilaDialogs';

export function MaquilaPage() {
  const { data = [], isLoading, error } = useMaquilaServices();
  const navigate = useNavigate();
  const [editing, setEditing] = React.useState<MaquilaService | null>(null);
  const [open, setOpen] = React.useState(false);
  const [dispatchFor, setDispatchFor] = React.useState<MaquilaService | null>(null);

  return (
    <>
      <PageHeader
        title="Maquila"
        description="Servicios de envasado para clientes con marca propia. Se manejan separados de la venta normal: costos, producción, inventario y despachos propios."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus /> Nuevo servicio
          </Button>
        }
      />
      <Tabs defaultValue="servicios">
        <TabsList>
          <TabsTrigger value="servicios">Servicios</TabsTrigger>
          <TabsTrigger value="produccion">Producción de maquila</TabsTrigger>
          <TabsTrigger value="despachos">Despachos de maquila</TabsTrigger>
        </TabsList>
        <TabsContent value="servicios">
          {isLoading ? (
            <Loading />
          ) : error ? (
            <ErrorState error={error} />
          ) : data.length === 0 ? (
            <EmptyState icon={<Handshake />} title="No hay servicios de maquila" description="Cree un servicio indicando el cliente, los materiales que aporta y el precio." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.map((s) => (
                <Card key={s.id} className={`p-5 ${s.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{s.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {s.client_name} · {s.volume_ml} ml · {s.units_per_pack} und/paca
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditing(s);
                        setOpen(true);
                      }}
                      aria-label="Editar"
                    >
                      <Pencil />
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {s.items.map((i) => (
                      <Badge key={i.id} variant={i.client_provides ? 'neutral' : 'info'}>
                        {i.role}: {i.client_provides ? 'cliente' : 'empresa'}
                      </Badge>
                    ))}
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">Costo del servicio</dt>
                      <dd className="font-medium tabular">{formatCOP(s.calculation.costPerPack)}/paca</dd>
                      <dd className="text-xs text-muted-foreground">{formatUnitCOP(s.calculation.costPerUnit)}/und</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Materiales empresa</dt>
                      <dd className="font-medium tabular">{formatUnitCOP(s.calculation.materialsPerUnit)}/und</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Precio cobrado</dt>
                      <dd className="font-medium tabular">{formatCOP(s.calculation.pricePerPack)}/paca</dd>
                      <dd className="text-xs text-muted-foreground">
                        {s.pricing_basis === 'botella' ? `${formatUnitCOP(s.price)} por botella` : `${formatCOP(s.price)} por paca`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Margen</dt>
                      <dd className="text-base">
                        <AggMarginText value={s.calculation.marginPct} />
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <span className="text-sm">
                      Producido por despachar: <strong>{formatNumber(s.stock_packs)} pacas</strong>
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => navigate(`/produccion/nueva?maquila=${s.id}`)} disabled={!s.active}>
                        <Factory /> Registrar producción
                      </Button>
                      <Button size="sm" onClick={() => setDispatchFor(s)} disabled={s.stock_packs <= 0}>
                        <Truck /> Despachar
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="produccion">
          <MaquilaRuns />
        </TabsContent>
        <TabsContent value="despachos">
          <MaquilaDispatches />
        </TabsContent>
      </Tabs>
      <MaquilaServiceDialog service={editing} open={open} onClose={() => setOpen(false)} />
      <MaquilaDispatchDialog service={dispatchFor} onClose={() => setDispatchFor(null)} />
    </>
  );
}

function MaquilaRuns() {
  const navigate = useNavigate();
  const { data = [], isLoading } = useQuery({ queryKey: ['production', 'maquila'], queryFn: () => api.get<any[]>('/production?maquila=si') });
  const columns: Column<any>[] = [
    { key: 'date', header: 'Fecha', sort: (r) => r.run_date, csv: (r) => r.run_date, cell: (r) => formatDate(r.run_date) },
    { key: 'client', header: 'Cliente', csv: (r) => r.client_name, cell: (r) => r.client_name },
    { key: 'service', header: 'Servicio', csv: (r) => r.item_name, cell: (r) => r.item_name },
    { key: 'lot', header: 'Lote', csv: (r) => r.lot_code, cell: (r) => <span className="text-primary">{r.lot_code}</span> },
    { key: 'packs', header: 'Pacas', align: 'right', csv: (r) => r.packs_produced, cell: (r) => formatNumber(r.packs_produced) },
    { key: 'waste', header: 'Desperdicio', align: 'right', csv: (r) => r.waste_pct, cell: (r) => formatPct(r.waste_pct) },
    { key: 'cost', header: 'Costo real paca', align: 'right', csv: (r) => Math.round(r.cost_per_pack), cell: (r) => formatCOP(r.cost_per_pack) },
  ];
  return <DataTable rows={data} columns={columns} loading={isLoading} rowKey={(r) => r.id} exportName="produccion-maquila" onRowClick={(r) => navigate(`/produccion/lotes/${r.lot_id}`)} />;
}

function MaquilaDispatches() {
  const navigate = useNavigate();
  const { data = [], isLoading } = useQuery({ queryKey: ['dispatches', 'maquila'], queryFn: () => api.get<any[]>('/dispatches?kind=maquila') });
  const columns: Column<any>[] = [
    { key: 'number', header: 'Despacho', csv: (d) => d.number, cell: (d) => <span className="font-medium">{d.number}</span> },
    { key: 'date', header: 'Fecha', sort: (d) => d.dispatch_date, csv: (d) => d.dispatch_date, cell: (d) => formatDate(d.dispatch_date) },
    { key: 'client', header: 'Cliente', csv: (d) => d.client_name, cell: (d) => d.client_name },
    { key: 'summary', header: 'Servicio', csv: (d) => d.summary, cell: (d) => <span className="text-xs">{d.summary}</span> },
    { key: 'total', header: 'Valor', align: 'right', csv: (d) => d.total, cell: (d) => formatCOP(d.total) },
    { key: 'margin', header: 'Margen', align: 'right', cell: (d) => (d.products_total ? formatPct((d.products_total - d.cost_total) / d.products_total) : '—') },
    { key: 'status', header: 'Estado', cell: (d) => (d.status === 'anulado' ? <Badge variant="neutral">Anulado</Badge> : <Badge variant="success">Confirmado</Badge>) },
  ];
  return <DataTable rows={data} columns={columns} loading={isLoading} rowKey={(d) => d.id} exportName="despachos-maquila" onRowClick={(d) => navigate(`/despachos/${d.id}`)} />;
}
