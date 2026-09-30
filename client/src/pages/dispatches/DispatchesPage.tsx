import { useQuery } from '@tanstack/react-query';
import { Paperclip, Plus } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCOP, formatDate } from '@alpe/shared';
import { DateRange, ErrorState, PageHeader } from '@/components/common';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { useClients, useProducts } from '@/hooks/useData';
import { api, qs } from '@/services/api';
import { daysAgo, today } from '@/utils/dates';

interface DispatchRow {
  id: number;
  number: string;
  kind: 'venta' | 'maquila';
  dispatch_date: string;
  client_name: string;
  order_number: string | null;
  remission_number: string;
  destination: string | null;
  vehicle: string | null;
  driver: string | null;
  packs_total: number;
  products_total: number;
  total: number;
  cost_total: number;
  status: string;
  summary: string;
  attachments: number;
  created_by_name: string | null;
}

export function DispatchesPage() {
  const navigate = useNavigate();
  const [from, setFrom] = React.useState(daysAgo(60));
  const [to, setTo] = React.useState(today());
  const [clientId, setClientId] = React.useState(0);
  const [productId, setProductId] = React.useState(0);
  const [kind, setKind] = React.useState('');
  const clients = useClients();
  const products = useProducts();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['dispatches', from, to, clientId, productId, kind],
    queryFn: () => api.get<DispatchRow[]>(`/dispatches${qs({ from, to, clientId, productId, kind })}`),
  });

  const columns: Column<DispatchRow>[] = [
    {
      key: 'number',
      header: 'Despacho',
      sort: (d) => d.id,
      csv: (d) => d.number,
      cell: (d) => (
        <div>
          <div className="flex items-center gap-1.5 font-medium">
            {d.number}
            {d.attachments > 0 && <Paperclip className="h-3 w-3 text-muted-foreground" />}
          </div>
          <div className="text-xs text-muted-foreground">Rem. {d.remission_number}</div>
        </div>
      ),
    },
    { key: 'remission', header: 'Remisión', csv: (d) => d.remission_number, cell: () => null, className: 'hidden' },
    { key: 'date', header: 'Fecha', sort: (d) => d.dispatch_date, csv: (d) => d.dispatch_date, cell: (d) => formatDate(d.dispatch_date) },
    {
      key: 'client',
      header: 'Cliente',
      sort: (d) => d.client_name,
      csv: (d) => d.client_name,
      cell: (d) => (
        <div>
          <div>{d.client_name}</div>
          <div className="text-xs text-muted-foreground">{d.order_number ? `Pedido ${d.order_number}` : d.kind === 'maquila' ? 'Maquila' : 'Directo'}</div>
        </div>
      ),
    },
    { key: 'order', header: 'Pedido', csv: (d) => d.order_number, cell: () => null, className: 'hidden' },
    { key: 'summary', header: 'Productos', csv: (d) => d.summary, cell: (d) => <span className="line-clamp-2 max-w-[220px] text-xs text-muted-foreground">{d.summary}</span> },
    { key: 'destination', header: 'Destino', sort: (d) => d.destination, csv: (d) => d.destination, cell: (d) => <span className="line-clamp-2 max-w-[180px] text-xs">{d.destination}</span> },
    {
      key: 'vehicle',
      header: 'Vehículo / conductor',
      sort: (d) => d.vehicle,
      csv: (d) => `${d.vehicle ?? ''} ${d.driver ?? ''}`.trim(),
      cell: (d) => (
        <div className="text-xs">
          <div>{d.vehicle}</div>
          <div className="text-muted-foreground">{d.driver}</div>
        </div>
      ),
    },
    { key: 'packs', header: 'Pacas', align: 'right', sort: (d) => d.packs_total, csv: (d) => d.packs_total, cell: (d) => d.packs_total },
    { key: 'total', header: 'Total', align: 'right', sort: (d) => d.total, csv: (d) => d.total, cell: (d) => <span className="font-medium">{formatCOP(d.total)}</span> },
    { key: 'cost', header: 'Costo', csv: (d) => d.cost_total, cell: () => null, className: 'hidden' },
    { key: 'status', header: 'Estado', csv: (d) => d.status, cell: (d) => (d.status === 'anulado' ? <Badge variant="neutral">Anulado</Badge> : <Badge variant="success">Confirmado</Badge>) },
  ];

  return (
    <>
      <PageHeader
        title="Despachos"
        description="Historial de despachos. Filtre por fecha, cliente, producto o busque por destino, conductor, vehículo o remisión."
        actions={
          <Button onClick={() => navigate('/despachos/nuevo')}>
            <Plus /> Registrar despacho
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} />
      ) : (
        <DataTable
          rows={data}
          columns={columns}
          loading={isLoading}
          rowKey={(d) => d.id}
          searchText={(d) => `${d.number} ${d.remission_number} ${d.client_name} ${d.destination ?? ''} ${d.vehicle ?? ''} ${d.driver ?? ''} ${d.order_number ?? ''}`}
          searchPlaceholder="Remisión, destino, conductor, placa…"
          exportName="despachos"
          onRowClick={(d) => navigate(`/despachos/${d.id}`)}
          rowClassName={(d) => (d.status === 'anulado' ? 'opacity-50' : undefined)}
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
              <Select value={clientId} onChange={(e) => setClientId(Number(e.target.value))} className="w-48" aria-label="Cliente">
                <option value={0}>Todos los clientes</option>
                {clients.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select value={productId} onChange={(e) => setProductId(Number(e.target.value))} className="w-40" aria-label="Producto">
                <option value={0}>Todos los productos</option>
                {products.data?.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-32" aria-label="Tipo">
                <option value="">Venta y maquila</option>
                <option value="venta">Venta</option>
                <option value="maquila">Maquila</option>
              </Select>
            </>
          }
        />
      )}
    </>
  );
}
