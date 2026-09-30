import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatCOP, formatDate, formatNumber, PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from '@alpe/shared';
import { Alert, KeyValue, PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/misc';
import { useClients, useProducts } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api } from '@/services/api';
import { today } from '@/utils/dates';

interface Line {
  productId: number;
  packs: number;
  lotId: number;
}

export function NewDispatchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = React.useState<'pedido' | 'directo'>(params.get('cliente') ? 'directo' : 'pedido');
  const [orderId, setOrderId] = React.useState(Number(params.get('pedido')) || 0);
  const [clientId, setClientId] = React.useState(Number(params.get('cliente')) || 0);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [form, setForm] = React.useState({
    date: today(),
    destination: '',
    vehicle: '',
    driver: '',
    remissionNumber: '',
    notes: '',
    paymentMode: 'credito' as 'credito' | 'contado',
    paymentMethod: 'efectivo',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const [file, setFile] = React.useState<File | null>(null);

  const clients = useClients();
  const products = useProducts();
  const pendingOrders = useQuery({ queryKey: ['orders', 'pendiente'], queryFn: () => api.get<any[]>('/orders?status=pendiente') });
  const order = useQuery({ queryKey: ['order', String(orderId)], queryFn: () => api.get(`/orders/${orderId}`), enabled: mode === 'pedido' && !!orderId });
  const lots = useQuery({ queryKey: ['lots', ''], queryFn: () => api.get<any[]>('/lots') });

  // Al elegir un pedido: cargar cliente, destino y pacas pendientes
  React.useEffect(() => {
    if (mode !== 'pedido' || !order.data) return;
    const o = order.data;
    setLines(o.items.filter((i: any) => i.packs > i.packs_dispatched).map((i: any) => ({ productId: i.product_id, packs: i.packs - i.packs_dispatched, lotId: 0 })));
    setForm((f) => ({ ...f, destination: [o.address, o.city].filter(Boolean).join(', '), paymentMode: o.payment_term_days === 0 ? 'contado' : 'credito' }));
  }, [order.data, mode]);

  const client = clients.data?.find((c) => c.id === (mode === 'pedido' ? order.data?.client_id : clientId));
  React.useEffect(() => {
    if (mode === 'directo' && client) {
      setForm((f) => ({ ...f, destination: [client.address, client.city].filter(Boolean).join(', '), paymentMode: client.payment_term_days === 0 ? 'contado' : 'credito' }));
      if (!lines.length) setLines([{ productId: 0, packs: 0, lotId: 0 }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, mode]);

  const validLines = lines.filter((l) => l.productId && l.packs > 0);
  const quote = useQuery({
    queryKey: ['quote', 'dispatch', clientId, form.date, validLines],
    queryFn: () => api.post('/pricing/quote', { clientId, date: form.date, items: validLines.map((l) => ({ productId: l.productId, packs: l.packs })) }),
    enabled: mode === 'directo' && !!clientId && validLines.length > 0,
    placeholderData: (p) => p,
    retry: false,
  });

  const { submit, loading, dialog } = useSubmit({
    request: async (_: void, confirmWarnings) => {
      const body = {
        ...form,
        orderId: mode === 'pedido' ? orderId : null,
        clientId: mode === 'directo' ? clientId : null,
        items: validLines.map((l) => ({ productId: l.productId, packs: l.packs, lotId: l.lotId || null })),
        confirmWarnings,
      };
      const r = await api.post('/dispatches', body);
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await api.upload(`/dispatches/${r.dispatch.id}/attachments`, fd).catch(() => undefined);
      }
      return r;
    },
    successMessage: (r: any) => `Despacho ${r.dispatch.number} registrado. Inventario descontado y cuenta por cobrar generada.`,
    onSuccess: (r: any) => navigate(`/despachos/${r.dispatch.id}`),
  });

  const productList = products.data?.products ?? [];
  const orderItem = (productId: number) => order.data?.items.find((i: any) => i.product_id === productId);
  const priceFor = (l: Line) => {
    if (mode === 'pedido') return orderItem(l.productId)?.net_price_pack ?? 0;
    return (quote.data?.lines ?? []).find((q: any) => q.productId === l.productId)?.netPricePack ?? 0;
  };
  const productsTotal = validLines.reduce((s, l) => s + priceFor(l) * l.packs, 0);
  const packs = validLines.reduce((s, l) => s + l.packs, 0);
  const freightIncluded = mode === 'pedido' ? order.data?.freight_included : client?.freight_included;
  const freightRate = mode === 'pedido' ? order.data?.freight_rate_pack : client?.freight_rate_pack;
  const freightCharge = freightIncluded ? 0 : Math.round(packs * (freightRate ?? 0));
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const invalidPacks = lines.some((l) => l.packs < 0 || !Number.isInteger(l.packs));

  return (
    <>
      <PageHeader
        back={
          <Link to="/despachos" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Despachos
          </Link>
        }
        title="Registrar despacho"
        description="Al confirmar se descuenta el inventario, se asignan los lotes, se actualiza el pedido y se genera la cuenta por cobrar."
      />
      <Tabs
        value={mode}
        onValueChange={(v) => {
          setMode(v as typeof mode);
          setLines([]);
        }}
        className="mb-6"
      >
        <TabsList>
          <TabsTrigger value="pedido">Desde un pedido</TabsTrigger>
          <TabsTrigger value="directo">Despacho directo (sin pedido)</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {mode === 'pedido' ? (
                <Field label="Pedido" required className="sm:col-span-2">
                  <Select value={orderId || ''} onChange={(e) => setOrderId(Number(e.target.value))}>
                    <option value="">Seleccione un pedido pendiente…</option>
                    {pendingOrders.data?.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.number} · {o.client_name} · {o.pending_packs} pacas pendientes · {formatDate(o.order_date)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Cliente" required className="sm:col-span-2">
                  <Select value={clientId || ''} onChange={(e) => setClientId(Number(e.target.value))}>
                    <option value="">Seleccione el cliente…</option>
                    {clients.data
                      ?.filter((c) => !c.is_maquila && c.status === 'activo')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
              <Field label="Fecha" required>
                <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
              </Field>
              <Field label="Número de remisión" hint="Vacío = se genera automáticamente">
                <Input value={form.remissionNumber} onChange={(e) => set('remissionNumber', e.target.value)} placeholder="REM-…" />
              </Field>
              <Field label="Destino" className="sm:col-span-2">
                <Input value={form.destination} onChange={(e) => set('destination', e.target.value)} />
              </Field>
              <Field label="Vehículo (placa)">
                <Input value={form.vehicle} onChange={(e) => set('vehicle', e.target.value.toUpperCase())} placeholder="ABC-123" />
              </Field>
              <Field label="Conductor">
                <Input value={form.driver} onChange={(e) => set('driver', e.target.value)} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Productos a despachar" description="Los lotes se asignan automáticamente del más antiguo al más reciente (puede elegir un lote)." />
            {lines.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">{mode === 'pedido' ? 'Seleccione un pedido.' : 'Seleccione un cliente.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Presentación</th>
                      <th className="px-3 py-2 text-right font-medium">Pacas</th>
                      <th className="px-3 py-2 text-right font-medium">Botellas</th>
                      <th className="px-3 py-2 text-right font-medium">Inventario</th>
                      <th className="px-3 py-2 text-left font-medium">Lote</th>
                      <th className="px-3 py-2 text-right font-medium">Precio paca</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const p = productList.find((x) => x.id === l.productId);
                      const oi = orderItem(l.productId);
                      const pending = oi ? oi.packs - oi.packs_dispatched : null;
                      const productLots = (lots.data ?? []).filter((x) => x.product_id === l.productId && x.packs_remaining > 0);
                      return (
                        <tr key={i} className="border-t align-top">
                          <td className="px-4 py-2">
                            {mode === 'pedido' ? (
                              <div>
                                <div className="font-medium">{p?.name}</div>
                                <div className="text-xs text-muted-foreground">Pendiente en pedido: {pending}</div>
                              </div>
                            ) : (
                              <Select value={l.productId || ''} onChange={(e) => update(i, { productId: Number(e.target.value), lotId: 0 })} className="min-w-[170px]">
                                <option value="">Seleccione…</option>
                                {productList
                                  .filter((x) => x.active && (x.id === l.productId || !lines.some((o) => o.productId === x.id)))
                                  .map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.name}
                                    </option>
                                  ))}
                              </Select>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <NumberInput value={l.packs} onChange={(v) => update(i, { packs: v })} className="w-24" />
                            {pending !== null && l.packs > pending && <p className="mt-1 text-xs text-destructive">Máximo {pending}</p>}
                          </td>
                          <td className="px-3 py-2 text-right tabular text-muted-foreground">{p ? formatNumber(l.packs * p.unitsPerPack) : '—'}</td>
                          <td className={`px-3 py-2 text-right tabular ${p && l.packs > p.stockPacks ? 'font-medium text-red-700' : ''}`}>{p ? formatNumber(p.stockPacks) : '—'}</td>
                          <td className="px-3 py-2">
                            <Select value={l.lotId || ''} onChange={(e) => update(i, { lotId: Number(e.target.value) })} className="min-w-[170px]" disabled={!l.productId}>
                              <option value="">Automático (más antiguo)</option>
                              {productLots.map((lot) => (
                                <option key={lot.id} value={lot.id}>
                                  {lot.code} · {lot.packs_remaining} pacas
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="px-3 py-2 text-right tabular">{l.productId && priceFor(l) ? formatCOP(priceFor(l)) : '—'}</td>
                          <td className="px-2 py-2">
                            {mode === 'directo' && (
                              <Button variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Quitar">
                                <Trash2 />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {mode === 'directo' && clientId > 0 && (
              <div className="border-t px-4 py-3">
                <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { productId: 0, packs: 0, lotId: 0 }])}>
                  <Plus /> Agregar producto
                </Button>
              </div>
            )}
          </Card>

          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Observaciones" className="sm:col-span-2">
                <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
              <Field label="Foto o PDF de la remisión (opcional)" hint="JPG, PNG, WEBP o PDF. Máximo 2 MB." className="sm:col-span-2">
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="py-1.5"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && f.size > 2 * 1024 * 1024) {
                      alert('El archivo supera 2 MB.');
                      e.target.value = '';
                      return;
                    }
                    setFile(f);
                  }}
                />
              </Field>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader title="Resumen" />
            <CardContent className="space-y-4 text-sm">
              {client && (
                <dl className="grid grid-cols-2 gap-3">
                  <KeyValue label="Cliente">{client.name}</KeyValue>
                  <KeyValue label="Plazo">{client.payment_term_days ? `${client.payment_term_days} días` : 'Contado'}</KeyValue>
                </dl>
              )}
              <div className="space-y-2 border-t pt-3">
                <Row label="Pacas" value={formatNumber(packs)} />
                <Row label="Valor productos" value={formatCOP(productsTotal)} />
                <Row label={freightIncluded ? 'Flete (incluido)' : 'Flete cobrado'} value={formatCOP(freightCharge)} />
                <div className="flex justify-between border-t pt-2 text-base font-semibold">
                  <span>Total</span>
                  <span className="tabular">{formatCOP(productsTotal + freightCharge)}</span>
                </div>
              </div>
              <Field label="Forma de pago">
                <Select value={form.paymentMode} onChange={(e) => set('paymentMode', e.target.value as 'credito' | 'contado')}>
                  <option value="credito">Crédito (genera cuenta por cobrar)</option>
                  <option value="contado">Contado (pagado al entregar)</option>
                </Select>
              </Field>
              {form.paymentMode === 'contado' && (
                <Field label="Medio de pago">
                  <Select value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {validLines.some((l) => {
                const p = productList.find((x) => x.id === l.productId);
                return p && l.packs > p.stockPacks;
              }) && <Alert tone="warning">Hay productos con inventario insuficiente. Se pedirá confirmación.</Alert>}
              <Button className="w-full" size="lg" onClick={() => submit()} disabled={loading || !validLines.length || invalidPacks || (mode === 'pedido' ? !orderId : !clientId)}>
                {loading ? 'Registrando…' : 'Confirmar despacho'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
      {dialog}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
