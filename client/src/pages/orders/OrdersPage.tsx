import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCOP, formatDate, formatPct, ORDER_STATUS_LABEL } from '@alpe/shared';
import { DateRange, ErrorState, OrderStatusBadge, PageHeader, AggMarginText } from '@/components/common';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { api, qs } from '@/services/api';
import { daysAgo, today } from '@/utils/dates';

interface OrderRow {
  id: number;
  number: string;
  client_name: string;
  profile_name: string;
  order_date: string;
  delivery_date: string | null;
  status: string;
  total: number;
  products_total: number;
  cost_total: number;
  margin_pct: number;
  expected_margin_pct: number;
  packs: number;
  pending_packs: number;
  summary: string;
  created_by_name: string;
}

export function OrdersPage() {
  const navigate = useNavigate();
  const [from, setFrom] = React.useState(daysAgo(90));
  const [to, setTo] = React.useState(today());
  const [status, setStatus] = React.useState('');
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['orders', from, to, status],
    queryFn: () => api.get<OrderRow[]>(`/orders${qs({ from, to, status })}`),
  });

  const columns: Column<OrderRow>[] = [
    { key: 'number', header: 'Pedido', sort: (o) => o.id, csv: (o) => o.number, cell: (o) => <span className="font-medium">{o.number}</span> },
    { key: 'date', header: 'Fecha', sort: (o) => o.order_date, csv: (o) => o.order_date, cell: (o) => formatDate(o.order_date) },
    {
      key: 'client',
      header: 'Cliente',
      sort: (o) => o.client_name,
      csv: (o) => o.client_name,
      cell: (o) => (
        <div>
          <div>{o.client_name}</div>
          <div className="text-xs text-muted-foreground">{o.profile_name}</div>
        </div>
      ),
    },
    { key: 'summary', header: 'Productos', csv: (o) => o.summary, cell: (o) => <span className="line-clamp-2 max-w-xs text-xs text-muted-foreground">{o.summary}</span> },
    {
      key: 'packs',
      header: 'Pacas',
      align: 'right',
      sort: (o) => o.packs,
      csv: (o) => o.packs,
      cell: (o) => (
        <div>
          <div>{o.packs}</div>
          {o.pending_packs > 0 && o.status !== 'cancelado' && <div className="text-xs text-amber-700">{o.pending_packs} pendientes</div>}
        </div>
      ),
    },
    { key: 'total', header: 'Total', align: 'right', sort: (o) => o.total, csv: (o) => o.total, cell: (o) => <span className="font-medium">{formatCOP(o.total)}</span> },
    { key: 'cost', header: 'Costo', csv: (o) => o.cost_total, cell: () => null, className: 'hidden' },
    {
      key: 'margin',
      header: 'Margen real',
      align: 'right',
      sort: (o) => o.margin_pct,
      csv: (o) => Math.round(o.margin_pct * 10000) / 100,
      cell: (o) => <AggMarginText value={o.margin_pct} target={o.expected_margin_pct} />,
    },
    { key: 'expected', header: 'Margen esperado', csv: (o) => Math.round(o.expected_margin_pct * 10000) / 100, cell: (o) => <span className="text-xs text-muted-foreground">{formatPct(o.expected_margin_pct)}</span>, align: 'right' },
    { key: 'status', header: 'Estado', sort: (o) => o.status, csv: (o) => ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL], cell: (o) => <OrderStatusBadge status={o.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Pedidos"
        description="Pedidos confirmados de clientes. El precio y el margen se calculan con las reglas del cliente al momento de crear el pedido."
        actions={
          <Button onClick={() => navigate('/pedidos/nuevo')}>
            <Plus /> Nuevo pedido
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
          rowKey={(o) => o.id}
          searchText={(o) => `${o.number} ${o.client_name} ${o.summary}`}
          searchPlaceholder="Buscar pedido o cliente…"
          exportName="pedidos"
          onRowClick={(o) => navigate(`/pedidos/${o.id}`)}
          rowClassName={(o) => (o.status === 'cancelado' ? 'opacity-50' : undefined)}
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
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Estado">
                <option value="">Todos los estados</option>
                <option value="pendiente">Pendientes de despacho</option>
                {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </>
          }
        />
      )}
    </>
  );
}
