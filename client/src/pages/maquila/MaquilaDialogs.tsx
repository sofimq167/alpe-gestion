import * as React from 'react';
import { COMPONENT_ROLE_LABEL, computeMaquilaCost, formatCOP, formatNumber, formatUnitCOP, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type ComponentRole } from '@alpe/shared';
import { AggMarginText } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/misc';
import { useClients, useSupplies } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api } from '@/services/api';
import type { MaquilaService } from '@/types';
import { today } from '@/utils/dates';

type Item = { role: string; clientProvides: boolean; supplyId: number; quantity: number; basis: 'unidad' | 'paca' | 'estiba' };
const DEFAULT_ITEMS: Item[] = [
  { role: 'envase', clientProvides: true, supplyId: 0, quantity: 1, basis: 'unidad' },
  { role: 'tapa', clientProvides: false, supplyId: 0, quantity: 1, basis: 'unidad' },
  { role: 'etiqueta', clientProvides: true, supplyId: 0, quantity: 1, basis: 'unidad' },
  { role: 'termoencogible', clientProvides: false, supplyId: 0, quantity: 0.09, basis: 'paca' },
];

export function MaquilaServiceDialog({ service, open, onClose }: { service: MaquilaService | null; open: boolean; onClose: () => void }) {
  const clients = useClients();
  const supplies = useSupplies();
  const [form, setForm] = React.useState({
    clientId: 0,
    name: '',
    volumeMl: 600,
    unitsPerPack: 18,
    pricingBasis: 'paca' as 'botella' | 'paca',
    price: 0,
    waterCostPerUnit: 0,
    energyCostPerUnit: 0,
    laborCostPerUnit: 0,
    otherCostPerUnit: 0,
    active: true,
    notes: '',
  });
  const [items, setItems] = React.useState<Item[]>(DEFAULT_ITEMS);
  React.useEffect(() => {
    if (!open) return;
    if (service) {
      setForm({
        clientId: service.client_id,
        name: service.name,
        volumeMl: service.volume_ml,
        unitsPerPack: service.units_per_pack,
        pricingBasis: service.pricing_basis,
        price: service.price,
        waterCostPerUnit: service.water_cost_per_unit,
        energyCostPerUnit: service.energy_cost_per_unit,
        laborCostPerUnit: service.labor_cost_per_unit,
        otherCostPerUnit: service.other_cost_per_unit,
        active: service.active,
        notes: service.notes ?? '',
      });
      setItems(service.items.map((i) => ({ role: i.role, clientProvides: i.client_provides, supplyId: i.supply_id ?? 0, quantity: i.quantity, basis: i.basis })));
    } else {
      setForm((f) => ({ ...f, clientId: 0, name: '', price: 0, notes: '', active: true }));
      setItems(DEFAULT_ITEMS);
    }
  }, [service, open]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const updateItem = (i: number, patch: Partial<Item>) => setItems((list) => list.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const supplyList = (supplies.data ?? []).filter((s) => s.active && s.is_inventoried);
  const calc = computeMaquilaCost({
    unitsPerPack: form.unitsPerPack || 1,
    items: items.map((i) => {
      const s = supplyList.find((x) => x.id === i.supplyId);
      return { role: i.role, label: i.role, clientProvides: i.clientProvides, unitCost: s?.current_cost ?? 0, quantity: i.quantity, basis: i.basis };
    }),
    waterPerUnit: form.waterCostPerUnit,
    energyPerUnit: form.energyCostPerUnit,
    laborPerUnit: form.laborCostPerUnit,
    otherPerUnit: form.otherCostPerUnit,
    pricingBasis: form.pricingBasis,
    price: form.price,
  });
  const save = useSubmit({
    request: () => {
      const body = { ...form, items: items.map((i) => ({ ...i, supplyId: i.clientProvides ? null : i.supplyId })) };
      return service ? api.put(`/maquila/services/${service.id}`, body) : api.post('/maquila/services', body);
    },
    successMessage: 'Servicio de maquila guardado.',
    onSuccess: onClose,
  });
  const maquilaClients = (clients.data ?? []).filter((c) => c.is_maquila || c.id === form.clientId);
  const missingSupply = items.some((i) => !i.clientProvides && !i.supplyId);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      title={service ? `Servicio: ${service.name}` : 'Nuevo servicio de maquila'}
      description="Indique qué materiales aporta el cliente. Solo los que aporta la empresa se cuentan como costo."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.submit(undefined)} disabled={save.loading || !form.clientId || !form.name.trim() || missingSupply}>
            Guardar servicio
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Cliente de maquila" required className="sm:col-span-2" hint={maquilaClients.length === 0 ? 'Cree primero un cliente con perfil “Cliente de maquila”.' : undefined}>
              <Select value={form.clientId || ''} onChange={(e) => set('clientId', Number(e.target.value))}>
                <option value="">Seleccione…</option>
                {maquilaClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Volumen (ml)">
              <NumberInput value={form.volumeMl} onChange={(v) => set('volumeMl', Math.round(v))} />
            </Field>
            <Field label="Nombre del servicio" required className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Agua marca propia 600 ml" />
            </Field>
            <Field label="Botellas por paca">
              <NumberInput value={form.unitsPerPack} onChange={(v) => set('unitsPerPack', Math.round(v))} />
            </Field>
            <Field label="Precio cobrado por">
              <Select value={form.pricingBasis} onChange={(e) => set('pricingBasis', e.target.value as 'botella' | 'paca')}>
                <option value="paca">Paca</option>
                <option value="botella">Botella</option>
              </Select>
            </Field>
            <Field label={`Precio por ${form.pricingBasis}`} required>
              <MoneyInput value={form.price} onChange={(v) => set('price', v)} decimals={form.pricingBasis === 'botella' ? 2 : 0} />
            </Field>
          </div>

          <div>
            <p className="section-title mb-2">Materiales</p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Elemento</th>
                    <th className="px-3 py-2 text-left font-medium">¿Lo aporta el cliente?</th>
                    <th className="px-3 py-2 text-left font-medium">Insumo de la empresa</th>
                    <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                    <th className="px-3 py-2 text-left font-medium">Base</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-medium">{COMPONENT_ROLE_LABEL[it.role as ComponentRole] ?? it.role}</td>
                      <td className="px-3 py-2">
                        <label className="flex items-center gap-2">
                          <Switch checked={it.clientProvides} onCheckedChange={(v) => updateItem(i, { clientProvides: v })} />
                          <span className="text-xs">{it.clientProvides ? 'Sí, lo aporta el cliente' : 'No, lo aporta la empresa'}</span>
                        </label>
                      </td>
                      <td className="px-3 py-2">
                        {!it.clientProvides && (
                          <Select value={it.supplyId || ''} onChange={(e) => updateItem(i, { supplyId: Number(e.target.value) })} className="min-w-[200px]">
                            <option value="">Seleccione…</option>
                            {supplyList.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({formatUnitCOP(s.current_cost)})
                              </option>
                            ))}
                          </Select>
                        )}
                      </td>
                      <td className="px-3 py-2">{!it.clientProvides && <NumberInput value={it.quantity} onChange={(v) => updateItem(i, { quantity: v })} className="w-20" />}</td>
                      <td className="px-3 py-2">
                        {!it.clientProvides && (
                          <Select value={it.basis} onChange={(e) => updateItem(i, { basis: e.target.value as Item['basis'] })} className="w-28">
                            <option value="unidad">por botella</option>
                            <option value="paca">por paca</option>
                          </Select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Agua por botella">
              <MoneyInput value={form.waterCostPerUnit} onChange={(v) => set('waterCostPerUnit', v)} decimals={2} />
            </Field>
            <Field label="Energía por botella">
              <MoneyInput value={form.energyCostPerUnit} onChange={(v) => set('energyCostPerUnit', v)} decimals={2} />
            </Field>
            <Field label="Mano de obra por botella">
              <MoneyInput value={form.laborCostPerUnit} onChange={(v) => set('laborCostPerUnit', v)} decimals={2} />
            </Field>
            <Field label="Otros por botella">
              <MoneyInput value={form.otherCostPerUnit} onChange={(v) => set('otherCostPerUnit', v)} decimals={2} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.active} onCheckedChange={(v) => set('active', v)} /> Activo
            </label>
            <Field label="Observaciones" className="sm:col-span-4">
              <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="space-y-3 self-start rounded-lg border bg-muted/30 p-4 text-sm">
          <p className="section-title">Costo del servicio</p>
          <Line label="Materiales de la empresa" value={formatUnitCOP(calc.materialsPerUnit)} />
          <Line label="Agua, energía, mano de obra y otros" value={formatUnitCOP(calc.conversionPerUnit)} />
          <Line label="Costo por botella" value={formatUnitCOP(calc.costPerUnit)} strong />
          <Line label="Costo por paca" value={formatCOP(calc.costPerPack)} strong />
          <div className="border-t pt-3" />
          <Line label="Precio por botella" value={formatUnitCOP(calc.pricePerUnit)} />
          <Line label="Precio por paca" value={formatCOP(calc.pricePerPack)} />
          <Line label="Utilidad por paca" value={formatCOP(calc.profitPerPack)} />
          <div className="flex justify-between">
            <span className="text-muted-foreground">Margen de la maquila</span>
            <AggMarginText value={calc.marginPct} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular ${strong ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  );
}

export function MaquilaDispatchDialog({ service, onClose }: { service: MaquilaService | null; onClose: () => void }) {
  const [form, setForm] = React.useState({ date: today(), packs: 0, destination: '', vehicle: '', driver: '', remissionNumber: '', notes: '', paymentMode: 'credito' as 'credito' | 'contado', paymentMethod: 'transferencia' });
  React.useEffect(() => {
    if (service) setForm((f) => ({ ...f, packs: service.stock_packs, date: today(), destination: '', notes: '', remissionNumber: '' }));
  }, [service]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useSubmit({
    request: () => api.post('/dispatches/maquila', { ...form, maquilaServiceId: service!.id }),
    successMessage: (r: any) => `Despacho de maquila ${r.dispatch.number} registrado. Cuenta por cobrar generada.`,
    onSuccess: onClose,
  });
  if (!service) return null;
  const error = form.packs > service.stock_packs ? `Solo hay ${service.stock_packs} pacas producidas disponibles` : form.packs <= 0 || !Number.isInteger(form.packs) ? 'Indique un número entero de pacas' : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Despacho de maquila · ${service.client_name}`}
      description={`${service.name}. Disponible: ${formatNumber(service.stock_packs)} pacas producidas.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.submit(undefined)} disabled={save.loading || !!error}>
            Confirmar despacho
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pacas" required error={error}>
          <NumberInput value={form.packs} onChange={(v) => set('packs', v)} />
        </Field>
        <Field label="Fecha">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Destino" className="sm:col-span-2">
          <Input value={form.destination} onChange={(e) => set('destination', e.target.value)} />
        </Field>
        <Field label="Vehículo">
          <Input value={form.vehicle} onChange={(e) => set('vehicle', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Conductor">
          <Input value={form.driver} onChange={(e) => set('driver', e.target.value)} />
        </Field>
        <Field label="Número de remisión" hint="Vacío = automático">
          <Input value={form.remissionNumber} onChange={(e) => set('remissionNumber', e.target.value)} />
        </Field>
        <Field label="Forma de pago">
          <Select value={form.paymentMode} onChange={(e) => set('paymentMode', e.target.value as 'credito' | 'contado')}>
            <option value="credito">Crédito</option>
            <option value="contado">Contado</option>
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
        <p className="text-sm sm:col-span-2">
          Valor del servicio: <strong>{formatCOP(Math.round(service.calculation.pricePerPack * (form.packs || 0)))}</strong>
        </p>
      </div>
    </Dialog>
  );
}
