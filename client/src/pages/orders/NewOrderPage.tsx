import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatCOP, formatNumber, formatPct, formatUnitCOP, type LinePrice } from '@alpe/shared';
import { Alert, KeyValue, MarginText, PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field, Input, NumberInput, Select, Textarea } from '@/components/ui/form';
import { InfoTip } from '@/components/ui/tooltip';
import { useClients, useProducts, useProfiles } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api, ApiError } from '@/services/api';
import { today } from '@/utils/dates';
import { MarginFormulaHelp } from '../pricing/CalculatorPage';

interface Quote {
  client: {
    id: number;
    name: string;
    profileName: string;
    profileDiscountPct: number;
    minOrderPacks: number;
    paymentTermDays: number;
    freightIncluded: boolean;
    freightRatePack: number;
    creditLimit: number | null;
    openBalance: number;
  };
  lines: (LinePrice & { productName: string; unitsPerPack: number; minMargin: number; targetMargin: number })[];
  totals: {
    packs: number;
    grossTotal: number;
    discountTotal: number;
    productsTotal: number;
    freightCharge: number;
    freightCost: number;
    total: number;
    costTotal: number;
    marginPct: number;
    expectedMarginPct: number;
  };
  warnings: string[];
}

export function NewOrderPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const clients = useClients();
  const profiles = useProfiles();
  const products = useProducts();
  const [clientId, setClientId] = React.useState(Number(params.get('cliente')) || 0);
  const [orderDate, setOrderDate] = React.useState(today());
  const [deliveryDate, setDeliveryDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [items, setItems] = React.useState<{ productId: number; packs: number }[]>([{ productId: 0, packs: 0 }]);
  const valid = items.filter((i) => i.productId && i.packs > 0 && Number.isInteger(i.packs));
  const [debounced, setDebounced] = React.useState(valid);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(valid), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(valid)]);

  const saleClients = (clients.data ?? []).filter((c) => !c.is_maquila && c.status === 'activo');
  const client = clients.data?.find((c) => c.id === clientId);
  const profile = profiles.data?.find((p) => p.id === client?.profile_id);
  const activeProducts = (products.data?.products ?? []).filter((p) => p.active);

  const quote = useQuery({
    queryKey: ['quote', clientId, orderDate, debounced],
    queryFn: () => api.post<Quote>('/pricing/quote', { clientId, date: orderDate, items: debounced }),
    enabled: !!clientId && debounced.length > 0,
    placeholderData: (prev) => prev,
    retry: false,
  });

  const { submit, loading, dialog } = useSubmit({
    request: (_: void, confirmWarnings) => api.post('/orders', { clientId, orderDate, deliveryDate, notes, items: valid, confirmWarnings }),
    successMessage: (o: any) => `Pedido ${o.number} confirmado.`,
    onSuccess: (o: any) => navigate(`/pedidos/${o.id}`),
  });

  const q = quote.data && debounced.length ? quote.data : null;
  const lineFor = (productId: number) => q?.lines.find((l) => l.productId === productId);
  const updateItem = (i: number, patch: Partial<{ productId: number; packs: number }>) => setItems((list) => list.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const usedIds = items.map((i) => i.productId);

  return (
    <>
      <PageHeader
        back={
          <Link to="/pedidos" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Pedidos
          </Link>
        }
        title="Nuevo pedido"
        description="Al seleccionar el cliente se cargan automáticamente su perfil, precios, descuentos, plazo y condición de flete."
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label="Cliente" required className="sm:col-span-3">
                <Select value={clientId || ''} onChange={(e) => setClientId(Number(e.target.value))} autoFocus>
                  <option value="">Seleccione el cliente…</option>
                  {saleClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.profile_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Fecha del pedido" required>
                <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </Field>
              <Field label="Fecha de entrega (opcional)">
                <Input type="date" value={deliveryDate} min={orderDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              </Field>
            </CardContent>
          </Card>

          {client && (
            <Card>
              <CardHeader title="Condiciones del cliente" description="Cargadas automáticamente del perfil y la ficha del cliente." />
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <KeyValue label="Perfil">{client.profile_name}</KeyValue>
                <KeyValue label="Descuento del perfil">{formatPct(profile?.base_discount_pct ?? 0, 0)}</KeyValue>
                <KeyValue label="Pedido mínimo">{profile?.min_order_packs ?? 0} pacas</KeyValue>
                <KeyValue label="Plazo">{client.payment_term_days ? `${client.payment_term_days} días` : 'Contado'}</KeyValue>
                <KeyValue label="Flete">{client.freight_included ? 'Incluido (asume la empresa)' : `Se cobra ${formatCOP(client.freight_rate_pack)}/paca`}</KeyValue>
                <KeyValue label="Saldo en cartera">{formatCOP(client.balance)}</KeyValue>
                <KeyValue label="Límite de crédito">{client.credit_limit ? formatCOP(client.credit_limit) : 'Sin límite'}</KeyValue>
                <KeyValue label="Cartera vencida">
                  <span className={client.overdue > 0 ? 'text-red-700' : ''}>{formatCOP(client.overdue)}</span>
                </KeyValue>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader title="Productos" description="Cantidades en pacas. El precio unitario, descuentos y margen se calculan automáticamente." />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Presentación</th>
                    <th className="px-3 py-2 text-right font-medium">Pacas</th>
                    <th className="px-3 py-2 text-right font-medium">Precio lista</th>
                    <th className="px-3 py-2 text-right font-medium">Descuento</th>
                    <th className="px-3 py-2 text-right font-medium">Precio paca</th>
                    <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="inline-flex items-center gap-1">
                        Margen <MarginFormulaHelp />
                      </span>
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const l = lineFor(item.productId);
                    const product = activeProducts.find((p) => p.id === item.productId);
                    return (
                      <React.Fragment key={i}>
                        <tr className="border-t align-top">
                          <td className="px-4 py-2">
                            <Select value={item.productId || ''} onChange={(e) => updateItem(i, { productId: Number(e.target.value) })} className="min-w-[180px]">
                              <option value="">Seleccione…</option>
                              {activeProducts
                                .filter((p) => p.id === item.productId || !usedIds.includes(p.id))
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                            </Select>
                            {product && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Disponible: {formatNumber(product.stockPacks)} pacas · {product.unitsPerPack} und/paca
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <NumberInput value={item.packs || null} onChange={(v) => updateItem(i, { packs: v })} className="w-24" placeholder="0" />
                            {item.packs < 0 || (item.packs && !Number.isInteger(item.packs)) ? <p className="mt-1 text-xs text-destructive">Entero positivo</p> : null}
                          </td>
                          <td className="px-3 py-2 text-right tabular text-muted-foreground">{l ? formatCOP(l.listPricePack) : '—'}</td>
                          <td className="px-3 py-2 text-right tabular">
                            {l ? (
                              <div>
                                <div>{formatCOP(l.discountAmount)}</div>
                                <div className="text-xs text-muted-foreground">
                                  {l.priceSource === 'especial'
                                    ? 'Precio especial'
                                    : [l.profileDiscountPct > 0 && `perfil ${formatPct(l.profileDiscountPct, 0)}`, l.volumeDiscountPct > 0 && `volumen ${formatPct(l.volumeDiscountPct, 0)}`]
                                        .filter(Boolean)
                                        .join(' + ') || '—'}
                                </div>
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular">
                            {l ? (
                              <div>
                                <div className="font-medium">{formatCOP(l.netPricePack)}</div>
                                <div className="text-xs text-muted-foreground">{formatUnitCOP(l.netPriceUnit)} / und</div>
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-medium tabular">{l ? formatCOP(l.lineTotal) : '—'}</td>
                          <td className="px-3 py-2 text-right">
                            {l ? (
                              <span className="inline-flex items-center gap-1">
                                {l.status === 'bajo_minimo' && <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
                                <MarginText value={l.marginPct} min={l.minMargin} target={l.targetMargin} />
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <Button variant="ghost" size="icon" onClick={() => setItems((list) => list.filter((_, idx) => idx !== i))} disabled={items.length === 1} aria-label="Quitar">
                              <Trash2 />
                            </Button>
                          </td>
                        </tr>
                        {l && (
                          <tr>
                            <td colSpan={8} className="px-4 pb-2 text-xs text-muted-foreground">
                              <Badge variant={l.priceSource === 'especial' ? 'info' : 'neutral'}>{l.priceSourceLabel}</Badge> <span className="ml-1">{l.volumeDescription}</span>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t px-4 py-3">
              <Button variant="outline" size="sm" onClick={() => setItems((l) => [...l, { productId: 0, packs: 0 }])} disabled={items.length >= activeProducts.length}>
                <Plus /> Agregar producto
              </Button>
            </div>
          </Card>
          <Field label="Observaciones">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader title="Resumen del pedido" />
            <CardContent className="space-y-3 text-sm">
              {quote.error && <Alert tone="danger">{quote.error instanceof ApiError ? quote.error.message : 'No se pudo calcular.'}</Alert>}
              {!q ? (
                <p className="text-muted-foreground">Seleccione el cliente y agregue productos para ver precios y márgenes.</p>
              ) : (
                <>
                  <SummaryRow label="Pacas" value={formatNumber(q.totals.packs)} />
                  <SummaryRow label="Valor a precio de lista" value={formatCOP(q.totals.grossTotal)} />
                  <SummaryRow label="Descuentos" value={`− ${formatCOP(q.totals.discountTotal)}`} />
                  <SummaryRow label="Subtotal productos" value={formatCOP(q.totals.productsTotal)} strong />
                  <SummaryRow
                    label={q.client.freightIncluded ? 'Flete (incluido, lo asume la empresa)' : 'Flete cobrado'}
                    value={q.client.freightIncluded ? formatCOP(0) : formatCOP(q.totals.freightCharge)}
                  />
                  <div className="flex items-center justify-between border-t pt-3 text-base font-semibold">
                    <span>Total</span>
                    <span className="tabular">{formatCOP(q.totals.total)}</span>
                  </div>
                  <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                    <SummaryRow label={<span className="inline-flex items-center gap-1">Costo real <InfoTip>Costo actual de producción de las pacas{q.client.freightIncluded ? ' + flete asumido' : ''}.</InfoTip></span>} value={formatCOP(q.totals.costTotal)} />
                    <SummaryRow label="Utilidad bruta" value={formatCOP(q.totals.productsTotal - q.totals.costTotal)} />
                    <div className="grid grid-cols-2 gap-3 border-t pt-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Margen esperado</p>
                        <p className="text-lg font-semibold tabular">{formatPct(q.totals.expectedMarginPct)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Margen real de esta venta</p>
                        <p className="text-lg font-semibold">
                          <MarginText value={q.totals.marginPct} min={Math.min(...q.lines.map((l) => l.minMargin))} target={q.totals.expectedMarginPct} />
                        </p>
                      </div>
                    </div>
                  </div>
                  {q.warnings.length > 0 && (
                    <Alert tone="warning" title="Advertencias">
                      <ul className="list-disc space-y-1 pl-4">
                        {q.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}
                </>
              )}
              <Button className="w-full" size="lg" onClick={() => submit()} disabled={!clientId || !valid.length || loading || valid.length !== items.filter((i) => i.productId).length}>
                {loading ? 'Guardando…' : 'Confirmar pedido'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
      {dialog}
    </>
  );
}

function SummaryRow({ label, value, strong }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular ${strong ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  );
}
