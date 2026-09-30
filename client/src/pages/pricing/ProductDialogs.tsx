import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import {
  BASIS_LABEL,
  COMPONENT_ROLE_LABEL,
  COMPONENT_ROLES,
  formatCOP,
  formatPct,
  formatUnitCOP,
  marginOnSales,
  priceForMargin,
  roundPriceUp,
  type ComponentRole,
} from '@alpe/shared';
import { Alert, Loading, MarginText } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, NumberInput, PercentInput, Select, Textarea } from '@/components/ui/form';
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { useSettings, useSupplies } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api } from '@/services/api';
import type { ProductDetail, ProductSummary } from '@/types';
import { formatDateTime } from '@/utils/dates';

interface GeneralForm {
  code: string;
  name: string;
  volumeMl: number;
  unitsPerPack: number;
  packsPerPallet: number;
  weightKgPack: number;
  minMargin: number;
  targetMargin: number;
  stdLaborPerUnit: number;
  stdEnergyPerUnit: number;
  minStockPacks: number;
  active: boolean;
  useBlown: boolean;
  notes: string;
  listPricePack: number;
  initialStock: number;
}

type ComponentForm = { supplyId: number; role: ComponentRole; quantity: number; basis: 'unidad' | 'paca' | 'estiba' };

function toForm(p: ProductSummary | null, defaults: { min: number; target: number }): GeneralForm {
  return {
    code: p?.code ?? '',
    name: p?.name ?? '',
    volumeMl: p?.volumeMl ?? 600,
    unitsPerPack: p?.unitsPerPack ?? 12,
    packsPerPallet: p?.packsPerPallet ?? 80,
    weightKgPack: p?.weightKgPack ?? 0,
    minMargin: p?.minMargin ?? defaults.min,
    targetMargin: p?.targetMargin ?? defaults.target,
    stdLaborPerUnit: p?.stdLaborPerUnit ?? 0,
    stdEnergyPerUnit: p?.stdEnergyPerUnit ?? 0,
    minStockPacks: p?.minStockPacks ?? 0,
    active: p?.active ?? true,
    useBlown: p?.useBlown ?? false,
    notes: p?.notes ?? '',
    listPricePack: p?.listPricePack ?? 0,
    initialStock: 0,
  };
}

function GeneralFields({ form, set, isNew }: { form: GeneralForm; set: <K extends keyof GeneralForm>(k: K, v: GeneralForm[K]) => void; isNew: boolean }) {
  const marginError = form.minMargin > form.targetMargin ? 'El margen mínimo no puede superar el objetivo' : null;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Nombre" required className="sm:col-span-2">
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Agua 600 ml" />
      </Field>
      <Field label="Código">
        <Input value={form.code} onChange={(e) => set('code', e.target.value)} />
      </Field>
      <Field label="Volumen (ml)" required>
        <NumberInput value={form.volumeMl} onChange={(v) => set('volumeMl', Math.round(v))} />
      </Field>
      <Field label="Botellas por paca" required>
        <NumberInput value={form.unitsPerPack} onChange={(v) => set('unitsPerPack', Math.round(v))} />
      </Field>
      <Field label="Pacas por estiba" required>
        <NumberInput value={form.packsPerPallet} onChange={(v) => set('packsPerPallet', Math.round(v))} />
      </Field>
      <Field label="Peso aproximado por paca (kg)">
        <NumberInput value={form.weightKgPack} onChange={(v) => set('weightKgPack', v)} />
      </Field>
      <Field label="Margen objetivo" tip="Margen operativo deseado sobre el precio de venta. Se usa para calcular el precio sugerido.">
        <PercentInput value={form.targetMargin} onChange={(v) => set('targetMargin', v)} />
      </Field>
      <Field label="Margen mínimo permitido" error={marginError} tip="Por debajo de este margen el sistema genera alertas y pide confirmación en pedidos.">
        <PercentInput value={form.minMargin} onChange={(v) => set('minMargin', v)} />
      </Field>
      <Field label="Mano de obra estándar por botella" tip="Se usa solo si no hay producción registrada recientemente. Con producción real, se calcula costo de turnos ÷ botellas producidas.">
        <MoneyInput value={form.stdLaborPerUnit} onChange={(v) => set('stdLaborPerUnit', v)} decimals={2} />
      </Field>
      <Field label="Energía estándar por botella" tip="Se usa solo si no hay producción registrada recientemente.">
        <MoneyInput value={form.stdEnergyPerUnit} onChange={(v) => set('stdEnergyPerUnit', v)} decimals={2} />
      </Field>
      <Field label="Inventario mínimo (pacas)">
        <NumberInput value={form.minStockPacks} onChange={(v) => set('minStockPacks', Math.round(v))} />
      </Field>
      {isNew && (
        <>
          <Field label="Precio de lista por paca">
            <MoneyInput value={form.listPricePack} onChange={(v) => set('listPricePack', v)} />
          </Field>
          <Field label="Inventario inicial (pacas)">
            <NumberInput value={form.initialStock} onChange={(v) => set('initialStock', Math.round(v))} />
          </Field>
        </>
      )}
      <div className="flex items-center gap-3 sm:col-span-3">
        <Switch checked={form.active} onCheckedChange={(v) => set('active', v)} id="pactive" />
        <label htmlFor="pactive" className="text-sm">
          Presentación activa (disponible para pedidos)
        </label>
      </div>
      <Field label="Observaciones" className="sm:col-span-3">
        <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </div>
  );
}

function ComponentsEditor({ value, onChange }: { value: ComponentForm[]; onChange: (v: ComponentForm[]) => void }) {
  const supplies = useSupplies();
  const list = (supplies.data ?? []).filter((s) => s.active && !['energia', 'mano_obra'].includes(s.category));
  const update = (i: number, patch: Partial<ComponentForm>) => onChange(value.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Indique la cantidad de cada insumo y sobre qué base se consume. Ej.: 1 tapa por botella, 0,09 kg de termoencogible por paca, 1 estiba por estiba. La energía y la
        mano de obra se toman de la producción real.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Tipo</th>
              <th className="px-3 py-2 text-left font-medium">Insumo</th>
              <th className="px-3 py-2 text-right font-medium">Cantidad</th>
              <th className="px-3 py-2 text-left font-medium">Base</th>
              <th className="px-3 py-2 text-right font-medium">Costo insumo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {value.map((c, i) => {
              const supply = list.find((s) => s.id === c.supplyId);
              return (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">
                    <Select value={c.role} onChange={(e) => update(i, { role: e.target.value as ComponentRole })} className="w-40">
                      {COMPONENT_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {COMPONENT_ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <Select value={c.supplyId || ''} onChange={(e) => update(i, { supplyId: Number(e.target.value) })} className="min-w-[220px]">
                      <option value="">Seleccione…</option>
                      {list.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <NumberInput value={c.quantity} onChange={(v) => update(i, { quantity: v })} className="w-24" />
                  </td>
                  <td className="px-3 py-2">
                    <Select value={c.basis} onChange={(e) => update(i, { basis: e.target.value as ComponentForm['basis'] })} className="w-32">
                      {(['unidad', 'paca', 'estiba'] as const).map((b) => (
                        <option key={b} value={b}>
                          {BASIS_LABEL[b]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular">
                    {supply ? `${formatUnitCOP(supply.current_cost)} / ${supply.unit}` : '—'}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button variant="ghost" size="icon" onClick={() => onChange(value.filter((_, idx) => idx !== i))} aria-label="Quitar">
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button variant="outline" size="sm" onClick={() => onChange([...value, { supplyId: 0, role: 'otro', quantity: 1, basis: 'unidad' }])}>
        <Plus /> Agregar componente
      </Button>
    </div>
  );
}

export function ProductDialog({ product, open, onClose }: { product: ProductSummary | null; open: boolean; onClose: () => void }) {
  const settings = useSettings();
  const defaults = { min: settings.data?.pricing.defaultMinMargin ?? 0.15, target: settings.data?.pricing.defaultTargetMargin ?? 0.25 };
  const [form, setForm] = React.useState<GeneralForm>(toForm(product, defaults));
  const [components, setComponents] = React.useState<ComponentForm[]>([]);
  const [tab, setTab] = React.useState('general');
  const detail = useQuery({
    queryKey: ['product', product?.id],
    queryFn: () => api.get<ProductDetail>(`/products/${product!.id}`),
    enabled: open && !!product,
  });
  React.useEffect(() => {
    if (open) {
      setForm(toForm(product, defaults));
      setTab('general');
      if (!product) setComponents([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product]);
  React.useEffect(() => {
    if (detail.data) {
      setComponents(detail.data.components.map((c) => ({ supplyId: c.supply_id, role: c.role as ComponentRole, quantity: c.quantity, basis: c.basis })));
    }
  }, [detail.data]);
  const set = <K extends keyof GeneralForm>(k: K, v: GeneralForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const saveGeneral = useSubmit({
    request: () =>
      product
        ? api.put(`/products/${product.id}`, form)
        : api.post('/products', { ...form, components: components.filter((c) => c.supplyId) }),
    successMessage: product ? 'Presentación actualizada.' : 'Presentación creada.',
    onSuccess: () => !product && onClose(),
  });
  const saveComponents = useSubmit({
    request: () => api.put(`/products/${product!.id}/components`, { components: components.filter((c) => c.supplyId) }),
    successMessage: 'Estructura de costos guardada. Costos y márgenes recalculados.',
  });

  const footer =
    tab === 'general' ? (
      <>
        <Button variant="outline" onClick={onClose}>
          Cerrar
        </Button>
        <Button onClick={() => saveGeneral.submit(undefined)} disabled={saveGeneral.loading || !form.name.trim() || form.minMargin > form.targetMargin}>
          {saveGeneral.loading ? 'Guardando…' : product ? 'Guardar cambios' : 'Crear presentación'}
        </Button>
      </>
    ) : tab === 'componentes' && product ? (
      <>
        <Button variant="outline" onClick={onClose}>
          Cerrar
        </Button>
        <Button onClick={() => saveComponents.submit(undefined)} disabled={saveComponents.loading}>
          {saveComponents.loading ? 'Guardando…' : 'Guardar estructura de costos'}
        </Button>
      </>
    ) : (
      <Button variant="outline" onClick={onClose}>
        Cerrar
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} size="xl" title={product ? product.name : 'Nueva presentación'} footer={footer}>
      {product && detail.isLoading ? (
        <Loading />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="general">Datos generales</TabsTrigger>
            <TabsTrigger value="componentes">Estructura de costos</TabsTrigger>
            {product && <TabsTrigger value="soplado">Soplado</TabsTrigger>}
            {product && <TabsTrigger value="precio">Precio e historial</TabsTrigger>}
          </TabsList>
          <TabsContent value="general">
            <GeneralFields form={form} set={set} isNew={!product} />
          </TabsContent>
          <TabsContent value="componentes">
            <ComponentsEditor value={components} onChange={setComponents} />
            {!product && <p className="mt-3 text-xs text-muted-foreground">La estructura se guarda junto con la presentación al presionar “Crear presentación” en Datos generales.</p>}
          </TabsContent>
          {product && detail.data && (
            <TabsContent value="soplado">
              <BlowConfigForm productId={product.id} detail={detail.data} />
            </TabsContent>
          )}
          {product && detail.data && (
            <TabsContent value="precio">
              <PriceForm product={product} detail={detail.data} />
            </TabsContent>
          )}
        </Tabs>
      )}
      {saveGeneral.dialog}
    </Dialog>
  );
}

function BlowConfigForm({ productId, detail }: { productId: number; detail: ProductDetail }) {
  const supplies = useSupplies();
  const preforms = (supplies.data ?? []).filter((s) => s.category === 'preforma' || s.category === 'envase');
  const raw = detail.blowRaw;
  const [form, setForm] = React.useState({
    preformSupplyId: raw?.preform_supply_id ?? 0,
    energyPerUnit: raw?.energy_per_unit ?? 0,
    laborPerUnit: raw?.labor_per_unit ?? 0,
    wastePct: raw?.waste_pct ?? 0.03,
    overheadPerUnit: raw?.overhead_per_unit ?? 0,
    notes: raw?.notes ?? '',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useSubmit({ request: () => api.put(`/products/${productId}/blow`, form), successMessage: 'Escenario de soplado guardado.' });
  const remove = useSubmit({ request: () => api.put(`/products/${productId}/blow`, { remove: true }), successMessage: 'Escenario de soplado eliminado.' });
  const preform = preforms.find((p) => p.id === form.preformSupplyId);
  const blownCost = preform ? preform.current_cost / (1 - form.wastePct) + form.energyPerUnit + form.laborPerUnit + form.overheadPerUnit : 0;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Costo del envase soplado = preforma ÷ (1 − desperdicio) + energía + mano de obra + depreciación/costo operativo, por envase.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Preforma" required className="sm:col-span-2">
          <Select value={form.preformSupplyId || ''} onChange={(e) => set('preformSupplyId', Number(e.target.value))}>
            <option value="">Seleccione…</option>
            {preforms.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({formatUnitCOP(s.current_cost)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Desperdicio de preformas">
          <PercentInput value={form.wastePct} onChange={(v) => set('wastePct', v)} />
        </Field>
        <Field label="Energía de soplado por envase">
          <MoneyInput value={form.energyPerUnit} onChange={(v) => set('energyPerUnit', v)} decimals={2} />
        </Field>
        <Field label="Mano de obra de soplado por envase">
          <MoneyInput value={form.laborPerUnit} onChange={(v) => set('laborPerUnit', v)} decimals={2} />
        </Field>
        <Field label="Depreciación / costo operativo por envase">
          <MoneyInput value={form.overheadPerUnit} onChange={(v) => set('overheadPerUnit', v)} decimals={2} />
        </Field>
        <Field label="Observaciones" className="sm:col-span-3">
          <Input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
        <span>
          Costo estimado del envase soplado: <strong className="tabular">{formatUnitCOP(blownCost)}</strong>
          {detail.bought.cost.lines.find((l) => l.role === 'envase') && (
            <span className="text-muted-foreground"> · envase comprado: {formatUnitCOP(detail.bought.cost.lines.find((l) => l.role === 'envase')!.perUnit)}</span>
          )}
        </span>
        <div className="flex gap-2">
          {raw && (
            <Button variant="outline" size="sm" onClick={() => remove.submit(undefined)} disabled={remove.loading}>
              Eliminar escenario
            </Button>
          )}
          <Button size="sm" onClick={() => save.submit(undefined)} disabled={save.loading || !form.preformSupplyId}>
            Guardar escenario
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Para activar o desactivar el uso del envase soplado, use el interruptor en el Calculador de precios.</p>
    </div>
  );
}

function PriceForm({ product, detail }: { product: ProductSummary; detail: ProductDetail }) {
  const [price, setPrice] = React.useState(product.listPricePack);
  const [reason, setReason] = React.useState('');
  React.useEffect(() => setPrice(product.listPricePack), [product.listPricePack]);
  const cost = product.costPerPack;
  const adminPct = detail.admin.included ? detail.admin.pct : 0;
  const margin = marginOnSales(price, cost, adminPct);
  const save = useSubmit({
    request: () => api.put(`/products/${product.id}/price`, { price, reason }),
    successMessage: 'Precio de lista actualizado.',
    onSuccess: () => setReason(''),
  });
  const suggested = roundPriceUp(priceForMargin(cost, product.targetMargin, adminPct), 100);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Costo por paca">
          <div className="flex h-9 items-center text-sm font-medium tabular">{formatCOP(cost)}</div>
        </Field>
        <Field label="Nuevo precio por paca">
          <MoneyInput value={price} onChange={setPrice} />
        </Field>
        <Field label="Margen resultante">
          <div className="flex h-9 items-center text-sm">
            <MarginText value={margin} min={product.minMargin} target={product.targetMargin} />
          </div>
        </Field>
        <Field label="Precio sugerido">
          <button type="button" className="flex h-9 items-center text-sm font-medium text-primary hover:underline tabular" onClick={() => setPrice(suggested)}>
            {formatCOP(suggested)} (usar)
          </button>
        </Field>
      </div>
      {margin < product.minMargin && <Alert tone="danger">Con este precio el margen ({formatPct(margin)}) queda por debajo del mínimo ({formatPct(product.minMargin)}).</Alert>}
      <div className="flex items-end gap-3">
        <Field label="Motivo del cambio" className="flex-1">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: ajuste por incremento de insumos" />
        </Field>
        <Button onClick={() => save.submit(undefined)} disabled={save.loading || price <= 0 || price === product.listPricePack}>
          Guardar precio
        </Button>
      </div>
      <div>
        <p className="section-title mb-2">Historial de precios</p>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Fecha</th>
              <th className="py-2 text-right font-medium">Precio anterior</th>
              <th className="py-2 text-right font-medium">Precio nuevo</th>
              <th className="py-2 pl-4 text-left font-medium">Usuario / motivo</th>
            </tr>
          </thead>
          <tbody>
            {detail.priceHistory.map((h) => (
              <tr key={h.id} className="border-b last:border-0">
                <td className="py-2">{formatDateTime(h.changed_at)}</td>
                <td className="py-2 text-right tabular">{h.old_price === null ? '—' : formatCOP(h.old_price)}</td>
                <td className="py-2 text-right font-medium tabular">{formatCOP(h.new_price)}</td>
                <td className="py-2 pl-4 text-xs text-muted-foreground">
                  {h.user_name ?? 'Sistema'}
                  {h.reason ? ` · ${h.reason}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
