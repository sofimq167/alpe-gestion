import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardPlus, Pencil, Plus } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatCOP, formatDate, formatPct, type MarginStatus, type ReceivableStatus } from '@alpe/shared';
import { ErrorState, KeyValue, Loading, MarginText, OrderStatusBadge, PageHeader, ReceivableBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { SimpleTable } from '@/components/common/SimpleTable';
import { api } from '@/services/api';
import type { Client } from '@/types';
import { ClientFormDialog, SpecialPriceDialog, type SpecialPriceRow } from './ClientDialogs';

interface ClientDetail extends Client {
  base_discount_pct: number;
  min_order_packs: number;
  specials: SpecialPriceRow[];
  orders: { id: number; number: string; order_date: string; status: string; total: number; margin_pct: number }[];
  dispatches: { id: number; number: string; remission_number: string; dispatch_date: string; total: number; packs_total: number; status: string; kind: string }[];
  receivables: { id: number; document_number: string; issue_date: string; due_date: string; original_amount: number; balance: number; status: ReceivableStatus; days_overdue: number }[];
  prices: { productId: number; name: string; listPricePack: number; netPricePack: number; source: string; sourceLabel: string; marginPct: number; status: MarginStatus }[];
}

export function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: c, isLoading, error } = useQuery({ queryKey: ['client', id], queryFn: () => api.get<ClientDetail>(`/clients/${id}`) });
  const [editOpen, setEditOpen] = React.useState(false);
  const [special, setSpecial] = React.useState<{ row: SpecialPriceRow | null } | null>(null);

  if (isLoading) return <Loading />;
  if (error || !c) return <ErrorState error={error} />;
  const pending = c.receivables.filter((r) => r.status !== 'pagada' && r.status !== 'anulada');

  return (
    <>
      <PageHeader
        back={
          <Link to="/clientes" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Clientes
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {c.name}
            <Badge variant={c.status === 'activo' ? 'success' : c.status === 'bloqueado' ? 'danger' : 'neutral'}>{c.status}</Badge>
          </span>
        }
        description={`${c.profile_name} · ${c.document ?? 'Sin documento'} · ${c.city ?? ''}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil /> Editar
            </Button>
            {c.is_maquila ? (
              <Button asChild>
                <Link to="/maquila">Ir a Maquila</Link>
              </Button>
            ) : (
              <Button onClick={() => navigate(`/pedidos/nuevo?cliente=${c.id}`)} disabled={c.status !== 'activo'}>
                <ClipboardPlus /> Nuevo pedido
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Condiciones comerciales" />
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <KeyValue label="Perfil">{c.profile_name}</KeyValue>
                <KeyValue label="Descuento del perfil">{formatPct(c.base_discount_pct, 0)}</KeyValue>
                <KeyValue label="Pedido mínimo">{c.min_order_packs} pacas</KeyValue>
                <KeyValue label="Plazo de pago">{c.payment_term_days ? `${c.payment_term_days} días` : 'Contado'}</KeyValue>
                <KeyValue label="Flete">{c.freight_included ? `Incluido (costo ${formatCOP(c.freight_rate_pack)}/paca)` : `Se cobra ${formatCOP(c.freight_rate_pack)}/paca`}</KeyValue>
                <KeyValue label="Límite de crédito">{c.credit_limit ? formatCOP(c.credit_limit) : 'Sin límite'}</KeyValue>
                <KeyValue label="Saldo en cartera">{formatCOP(c.balance)}</KeyValue>
                <KeyValue label="Vencido">
                  <span className={c.overdue > 0 ? 'text-red-700' : ''}>{formatCOP(c.overdue)}</span>
                </KeyValue>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Contacto" />
            <CardContent>
              <dl className="grid gap-4">
                <KeyValue label="Persona de contacto">{c.contact_name}</KeyValue>
                <KeyValue label="Teléfono">{c.phone}</KeyValue>
                <KeyValue label="Correo">{c.email}</KeyValue>
                <KeyValue label="Dirección">
                  {c.address}
                  {c.city ? `, ${c.city}` : ''}
                </KeyValue>
                {c.notes && <KeyValue label="Observaciones">{c.notes}</KeyValue>}
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {!c.is_maquila && (
            <Card>
              <CardHeader title="Precios vigentes para este cliente" description="Precio por paca hoy (sin descuento por volumen, que se calcula en el pedido)." />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2 text-left font-medium">Presentación</th>
                      <th className="px-3 py-2 text-right font-medium">Precio lista</th>
                      <th className="px-3 py-2 text-right font-medium">Precio cliente</th>
                      <th className="px-3 py-2 text-left font-medium">Origen</th>
                      <th className="px-5 py-2 text-right font-medium">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.prices.map((p) => (
                      <tr key={p.productId} className="border-t">
                        <td className="px-5 py-2 font-medium">{p.name}</td>
                        <td className="px-3 py-2 text-right tabular text-muted-foreground">{formatCOP(p.listPricePack)}</td>
                        <td className="px-3 py-2 text-right font-medium tabular">{formatCOP(p.netPricePack)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={p.source === 'especial' ? 'info' : 'neutral'}>{p.sourceLabel}</Badge>
                        </td>
                        <td className="px-5 py-2 text-right">
                          <MarginText value={p.marginPct} min={0} />
                          {p.status === 'bajo_minimo' && <span className="ml-1 text-xs text-red-700">bajo mínimo</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Tabs defaultValue={c.is_maquila ? 'despachos' : 'especiales'}>
            <TabsList>
              {!c.is_maquila && <TabsTrigger value="especiales">Precios especiales ({c.specials.length})</TabsTrigger>}
              {!c.is_maquila && <TabsTrigger value="pedidos">Pedidos ({c.orders.length})</TabsTrigger>}
              <TabsTrigger value="despachos">Despachos ({c.dispatches.length})</TabsTrigger>
              <TabsTrigger value="cartera">Cartera ({pending.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="especiales">
              <div className="mb-3 flex justify-end">
                <Button size="sm" onClick={() => setSpecial({ row: null })}>
                  <Plus /> Agregar precio especial
                </Button>
              </div>
              <SimpleTable
                empty="Este cliente no tiene precios especiales."
                head={['Presentación', 'Precio paca', 'Vigencia', 'Volumen', 'Estado']}
                rows={c.specials.map((s) => ({
                  key: s.id,
                  onClick: () => setSpecial({ row: s }),
                  cells: [
                    s.product_name,
                    <span className="font-medium tabular">{formatCOP(s.price_pack)}</span>,
                    `${formatDate(s.start_date)} → ${s.end_date ? formatDate(s.end_date) : 'sin vencimiento'}`,
                    s.allow_volume_discount ? 'Acumula' : 'No acumula',
                    s.vigente ? <Badge variant="success">Vigente</Badge> : s.vencido ? <Badge variant="neutral">Vencido</Badge> : <Badge variant="warning">{s.active ? 'Programado' : 'Inactivo'}</Badge>,
                  ],
                }))}
              />
            </TabsContent>
            <TabsContent value="pedidos">
              <SimpleTable
                empty="Sin pedidos."
                head={['Pedido', 'Fecha', 'Total', 'Margen', 'Estado']}
                rows={c.orders.map((o) => ({
                  key: o.id,
                  onClick: () => navigate(`/pedidos/${o.id}`),
                  cells: [o.number, formatDate(o.order_date), formatCOP(o.total), formatPct(o.margin_pct), <OrderStatusBadge status={o.status} />],
                }))}
              />
            </TabsContent>
            <TabsContent value="despachos">
              <SimpleTable
                empty="Sin despachos."
                head={['Despacho', 'Remisión', 'Fecha', 'Pacas', 'Total', 'Estado']}
                rows={c.dispatches.map((d) => ({
                  key: d.id,
                  onClick: () => navigate(`/despachos/${d.id}`),
                  cells: [d.number, d.remission_number, formatDate(d.dispatch_date), d.packs_total, formatCOP(d.total), d.status === 'anulado' ? <Badge variant="neutral">Anulado</Badge> : <Badge variant="success">Confirmado</Badge>],
                }))}
              />
            </TabsContent>
            <TabsContent value="cartera">
              <SimpleTable
                empty="Sin cuentas por cobrar."
                head={['Documento', 'Fecha', 'Vence', 'Valor', 'Saldo', 'Estado']}
                rows={c.receivables.map((r) => ({
                  key: r.id,
                  onClick: () => navigate(`/cartera?cliente=${c.id}`),
                  cells: [
                    r.document_number,
                    formatDate(r.issue_date),
                    formatDate(r.due_date),
                    formatCOP(r.original_amount),
                    <span className="font-medium">{formatCOP(r.balance)}</span>,
                    <span className="flex items-center gap-1.5">
                      <ReceivableBadge status={r.status} />
                      {r.days_overdue > 0 && <span className="text-xs text-red-700">{r.days_overdue} días</span>}
                    </span>,
                  ],
                }))}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <ClientFormDialog client={c} open={editOpen} onClose={() => setEditOpen(false)} />
      <SpecialPriceDialog clientId={c.id} row={special?.row ?? null} open={!!special} onClose={() => setSpecial(null)} />
    </>
  );
}
