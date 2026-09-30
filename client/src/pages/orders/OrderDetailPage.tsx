import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Ban, Truck } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatCOP, formatDate, formatPct } from '@alpe/shared';
import { Alert, ErrorState, KeyValue, Loading, MarginText, OrderStatusBadge, PageHeader, AggMarginText } from '@/components/common';
import { SimpleTable } from '@/components/common/SimpleTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/form';
import { useSubmit } from '@/hooks/useSubmit';
import { api } from '@/services/api';
import { formatDateTime } from '@/utils/dates';

export function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: o, isLoading, error } = useQuery({ queryKey: ['order', id], queryFn: () => api.get(`/orders/${id}`) });
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const cancel = useSubmit({
    request: () => api.post(`/orders/${id}/cancel`, { reason }),
    successMessage: 'Pedido cancelado.',
    onSuccess: () => setCancelOpen(false),
  });

  if (isLoading) return <Loading />;
  if (error || !o) return <ErrorState error={error} />;
  const pendingPacks = o.items.reduce((s: number, i: any) => s + i.packs - i.packs_dispatched, 0);
  const canDispatch = ['confirmado', 'parcial'].includes(o.status);

  return (
    <>
      <PageHeader
        back={
          <Link to="/pedidos" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Pedidos
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            Pedido {o.number} <OrderStatusBadge status={o.status} />
          </span>
        }
        description={
          <>
            <Link to={`/clientes/${o.client_id}`} className="hover:underline">
              {o.client_name}
            </Link>{' '}
            · {o.profile_name} · {formatDate(o.order_date)}
          </>
        }
        actions={
          <>
            {o.status === 'confirmado' && (
              <Button variant="outline" onClick={() => setCancelOpen(true)}>
                <Ban /> Cancelar pedido
              </Button>
            )}
            {canDispatch && (
              <Button onClick={() => navigate(`/despachos/nuevo?pedido=${o.id}`)}>
                <Truck /> Registrar despacho
              </Button>
            )}
          </>
        }
      />
      {o.warnings_accepted && (
        <Alert tone="warning" className="mb-6" title="Este pedido se confirmó con advertencias">
          {o.warnings_accepted}
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Productos" description={pendingPacks > 0 && o.status !== 'cancelado' ? `${pendingPacks} pacas pendientes por despachar` : undefined} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 text-left font-medium">Presentación</th>
                    <th className="px-3 py-2 text-right font-medium">Pacas</th>
                    <th className="px-3 py-2 text-right font-medium">Despachadas</th>
                    <th className="px-3 py-2 text-right font-medium">Precio lista</th>
                    <th className="px-3 py-2 text-right font-medium">Precio paca</th>
                    <th className="px-3 py-2 text-right font-medium">Descuento</th>
                    <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                    <th className="px-5 py-2 text-right font-medium">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((i: any) => (
                    <tr key={i.id} className="border-t">
                      <td className="px-5 py-2.5">
                        <div className="font-medium">{i.product_name}</div>
                        <div className="text-xs text-muted-foreground">{i.price_source_label}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular">{i.packs}</td>
                      <td className="px-3 py-2.5 text-right tabular">
                        <span className={i.packs_dispatched >= i.packs ? 'text-emerald-700' : i.packs_dispatched > 0 ? 'text-amber-700' : 'text-muted-foreground'}>{i.packs_dispatched}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular text-muted-foreground">{formatCOP(i.list_price_pack)}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular">{formatCOP(i.net_price_pack)}</td>
                      <td className="px-3 py-2.5 text-right tabular">
                        {formatCOP(i.discount_amount)}
                        <div className="text-xs text-muted-foreground">
                          {[i.profile_discount_pct > 0 && `perfil ${formatPct(i.profile_discount_pct, 0)}`, i.volume_discount_pct > 0 && `volumen ${formatPct(i.volume_discount_pct, 0)}`]
                            .filter(Boolean)
                            .join(' + ')}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular">{formatCOP(i.line_total)}</td>
                      <td className="px-5 py-2.5 text-right">
                        <MarginText value={i.margin_pct} min={i.min_margin} target={i.target_margin} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div>
            <p className="section-title mb-3">Despachos de este pedido</p>
            <SimpleTable
              empty="Aún no se ha despachado este pedido."
              head={['Despacho', 'Remisión', 'Fecha', 'Pacas', 'Total', 'Estado']}
              rows={o.dispatches.map((d: any) => ({
                key: d.id,
                onClick: () => navigate(`/despachos/${d.id}`),
                cells: [d.number, d.remission_number, formatDate(d.dispatch_date), d.packs_total, formatCOP(d.total), d.status === 'anulado' ? <Badge variant="neutral">Anulado</Badge> : <Badge variant="success">Confirmado</Badge>],
              }))}
            />
          </div>
        </div>
        <Card className="self-start">
          <CardHeader title="Totales" />
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-4">
              <KeyValue label="Valor a precio de lista">{formatCOP(o.gross_total)}</KeyValue>
              <KeyValue label="Descuentos">{formatCOP(o.discount_total)}</KeyValue>
              <KeyValue label="Subtotal productos">{formatCOP(o.products_total)}</KeyValue>
              <KeyValue label={o.freight_included ? 'Flete asumido' : 'Flete cobrado'}>{formatCOP(o.freight_included ? o.freight_cost : o.freight_charge)}</KeyValue>
              <KeyValue label="Total">
                <span className="text-base">{formatCOP(o.total)}</span>
              </KeyValue>
              <KeyValue label="Costo real">{formatCOP(o.cost_total)}</KeyValue>
              <KeyValue label="Margen esperado">{formatPct(o.expected_margin_pct)}</KeyValue>
              <KeyValue label="Margen real">
                <AggMarginText value={o.margin_pct} target={o.expected_margin_pct} />
              </KeyValue>
              <KeyValue label="Plazo">{o.payment_term_days ? `${o.payment_term_days} días` : 'Contado'}</KeyValue>
              <KeyValue label="Entrega">{formatDate(o.delivery_date)}</KeyValue>
            </dl>
            <div className="border-t pt-3 text-xs text-muted-foreground">
              Registrado por {o.created_by_name ?? '—'} · {formatDateTime(o.created_at)}
              {o.notes && <p className="mt-2 text-foreground">{o.notes}</p>}
            </div>
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title={`¿Cancelar el pedido ${o.number}?`} destructive confirmLabel="Cancelar pedido" cancelLabel="Volver" loading={cancel.loading} onConfirm={() => cancel.submit(undefined)}>
        <p className="mb-3">El pedido quedará cancelado y no se podrá despachar.</p>
        <Input placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </>
  );
}
