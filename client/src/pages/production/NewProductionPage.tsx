import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatCOP, formatNumber, formatPct, formatUnitCOP, productionMetrics } from '@alpe/shared';
import { Alert, PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field, Input, MoneyInput, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/misc';
import { InfoTip } from '@/components/ui/tooltip';
import { useMaquilaServices, useProducts, useSettings } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api, qs } from '@/services/api';
import { today } from '@/utils/dates';

interface Consumption {
  supplyId: number;
  name: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  inventoried: boolean;
  stock: number;
}

export function NewProductionPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const products = useProducts();
  const services = useMaquilaServices();
  const [kind, setKind] = React.useState<'producto' | 'maquila'>(params.get('maquila') ? 'maquila' : 'producto');
  const [form, setForm] = React.useState({
    date: today(),
    shift: '',
    productId: 0,
    maquilaServiceId: Number(params.get('maquila')) || 0,
    packs: 0,
    defectiveUnits: 0,
    workers: 5,
    hours: 8,
    laborCost: 0,
    energyKwh: 0,
    energyCost: 0,
    responsible: '',
    notes: '',
    lotCode: '',
  });
  const [laborManual, setLaborManual] = React.useState(false);
  const [energyManual, setEnergyManual] = React.useState(false);
  const [consumptions, setConsumptions] = React.useState<Consumption[]>([]);
  const [consumptionEdited, setConsumptionEdited] = React.useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const cfg = settings.data?.production;
  React.useEffect(() => {
    if (cfg && !form.shift) set('shift', cfg.shifts[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);
  // Costos sugeridos a partir de las variables de producción (editable)
  React.useEffect(() => {
    if (cfg && !laborManual) set('laborCost', Math.round(form.workers * form.hours * cfg.laborHourCost));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.workers, form.hours, cfg, laborManual]);
  React.useEffect(() => {
    if (cfg && !energyManual) set('energyCost', Math.round(form.energyKwh * cfg.energyKwhCost));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.energyKwh, cfg, energyManual]);

  const targetId = kind === 'producto' ? form.productId : form.maquilaServiceId;
  const suggest = useQuery({
    queryKey: ['suggest', kind, targetId, form.packs, form.defectiveUnits],
    queryFn: () =>
      api.get<Consumption[]>(
        `/production/suggest${qs({ productId: kind === 'producto' ? form.productId : undefined, maquilaServiceId: kind === 'maquila' ? form.maquilaServiceId : undefined, packs: form.packs, defectiveUnits: form.defectiveUnits })}`,
      ),
    enabled: !!targetId && form.packs > 0 && Number.isInteger(form.packs),
  });
  React.useEffect(() => {
    if (suggest.data && !consumptionEdited) setConsumptions(suggest.data);
  }, [suggest.data, consumptionEdited]);

  const product = products.data?.products.find((p) => p.id === form.productId);
  const service = services.data?.find((s) => s.id === form.maquilaServiceId);
  const upp = kind === 'producto' ? (product?.unitsPerPack ?? 0) : (service?.units_per_pack ?? 0);
  const goodUnits = form.packs * upp;
  const materialsCost = consumptions.reduce((s, c) => s + c.quantity * c.unitCost, 0);
  const metrics = productionMetrics({ goodUnits, defectiveUnits: form.defectiveUnits, unitsPerPack: upp || 1, materialsCost, laborCost: form.laborCost, energyCost: form.energyCost });
  const shortages = consumptions.filter((c) => c.inventoried && c.quantity > c.stock);

  const { submit, loading, dialog } = useSubmit({
    request: (_: void, confirmWarnings) =>
      api.post('/production', {
        ...form,
        productId: kind === 'producto' ? form.productId : null,
        maquilaServiceId: kind === 'maquila' ? form.maquilaServiceId : null,
        consumptions: consumptions.map((c) => ({ supplyId: c.supplyId, quantity: c.quantity })),
        confirmWarnings,
      }),
    successMessage: (r: any) => `Producción registrada. Lote ${r.lot_code}. Inventario actualizado.`,
    onSuccess: (r: any) => navigate(kind === 'maquila' ? '/maquila' : `/produccion/lotes/${r.lot_id}`),
  });

  const invalid = !targetId || form.packs <= 0 || !Number.isInteger(form.packs) || form.defectiveUnits < 0 || !Number.isInteger(form.defectiveUnits) || !form.shift;

  return (
    <>
      <PageHeader
        back={
          <Link to="/produccion" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Producción
          </Link>
        }
        title="Registrar producción"
        description="Al guardar se crea el lote, aumenta el inventario de producto terminado y se descuentan los insumos consumidos. La mano de obra y la energía del turno alimentan el costo real por botella."
      />
      <Tabs
        value={kind}
        onValueChange={(v) => {
          setKind(v as typeof kind);
          setConsumptionEdited(false);
        }}
        className="mb-6"
      >
        <TabsList>
          <TabsTrigger value="producto">Producción propia</TabsTrigger>
          <TabsTrigger value="maquila">Producción de maquila</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Lote y turno" />
            <CardContent className="grid gap-4 sm:grid-cols-3">
              {kind === 'producto' ? (
                <Field label="Presentación" required className="sm:col-span-2">
                  <Select
                    value={form.productId || ''}
                    onChange={(e) => {
                      set('productId', Number(e.target.value));
                      setConsumptionEdited(false);
                    }}
                  >
                    <option value="">Seleccione…</option>
                    {products.data?.products
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.unitsPerPack} und/paca)
                        </option>
                      ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Servicio de maquila" required className="sm:col-span-2">
                  <Select
                    value={form.maquilaServiceId || ''}
                    onChange={(e) => {
                      set('maquilaServiceId', Number(e.target.value));
                      setConsumptionEdited(false);
                    }}
                  >
                    <option value="">Seleccione…</option>
                    {services.data
                      ?.filter((s) => s.active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.client_name} · {s.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
              <Field label="Código de lote" hint="Vacío = automático (L-AAMMDD-código)">
                <Input value={form.lotCode} onChange={(e) => set('lotCode', e.target.value.toUpperCase())} />
              </Field>
              <Field label="Fecha" required>
                <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
              </Field>
              <Field label="Turno" required>
                <Select value={form.shift} onChange={(e) => set('shift', e.target.value)}>
                  {cfg?.shifts.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Responsable">
                <Input value={form.responsible} onChange={(e) => set('responsible', e.target.value)} />
              </Field>
              <Field label="Pacas producidas (buenas)" required hint={upp ? `${formatNumber(goodUnits)} botellas` : undefined}>
                <NumberInput value={form.packs || null} onChange={(v) => set('packs', v)} placeholder="0" />
              </Field>
              <Field label="Botellas defectuosas" tip="Botellas descartadas en el proceso. Consumen insumos pero no entran al inventario.">
                <NumberInput value={form.defectiveUnits} onChange={(v) => set('defectiveUnits', v)} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Mano de obra y energía del turno" description="El costo por botella se calcula dividiendo el costo del turno entre las botellas producidas." />
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label="Número de trabajadores">
                <NumberInput value={form.workers} onChange={(v) => set('workers', Math.max(0, Math.round(v)))} />
              </Field>
              <Field label="Horas trabajadas">
                <NumberInput value={form.hours} onChange={(v) => set('hours', v)} />
              </Field>
              <Field label="Costo de mano de obra" hint={!laborManual && cfg ? `${form.workers} × ${form.hours} h × ${formatCOP(cfg.laborHourCost)}` : 'Valor manual'}>
                <MoneyInput
                  value={form.laborCost}
                  onChange={(v) => {
                    setLaborManual(true);
                    set('laborCost', v);
                  }}
                />
              </Field>
              <Field label="Consumo de energía (kWh)">
                <NumberInput value={form.energyKwh} onChange={(v) => set('energyKwh', v)} />
              </Field>
              <Field label="Costo de energía" hint={!energyManual && cfg ? `kWh × ${formatCOP(cfg.energyKwhCost)}` : 'Valor manual'}>
                <MoneyInput
                  value={form.energyCost}
                  onChange={(v) => {
                    setEnergyManual(true);
                    set('energyCost', v);
                  }}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              title="Consumo de insumos"
              description={kind === 'maquila' ? 'Solo los materiales que aporta la empresa. Lo que aporta el cliente no se descuenta.' : 'Calculado según la estructura de costos. Ajuste las cantidades si el consumo real fue diferente.'}
              actions={
                consumptionEdited && (
                  <Button variant="ghost" size="sm" onClick={() => setConsumptionEdited(false)}>
                    <RefreshCw /> Recalcular
                  </Button>
                )
              }
            />
            {consumptions.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">Seleccione la presentación y las pacas para calcular el consumo.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2 text-left font-medium">Insumo</th>
                      <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                      <th className="px-3 py-2 text-right font-medium">Existencia</th>
                      <th className="px-3 py-2 text-right font-medium">Costo unitario</th>
                      <th className="px-5 py-2 text-right font-medium">Costo total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consumptions.map((c, i) => (
                      <tr key={c.supplyId} className="border-t">
                        <td className="px-5 py-2">
                          {c.name}
                          {!c.inventoried && <span className="ml-1 text-xs text-muted-foreground">(no inventariable)</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1.5">
                            <NumberInput
                              value={c.quantity}
                              onChange={(v) => {
                                setConsumptionEdited(true);
                                setConsumptions((list) => list.map((x, idx) => (idx === i ? { ...x, quantity: Math.max(0, v) } : x)));
                              }}
                              className="w-28"
                            />
                            <span className="w-10 text-xs text-muted-foreground">{c.unit}</span>
                          </div>
                        </td>
                        <td className={`px-3 py-2 text-right tabular ${c.inventoried && c.quantity > c.stock ? 'font-medium text-red-700' : 'text-muted-foreground'}`}>
                          {c.inventoried ? formatNumber(c.stock, 2) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular">{formatUnitCOP(c.unitCost)}</td>
                        <td className="px-5 py-2 text-right tabular">{formatCOP(c.quantity * c.unitCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Field label="Observaciones">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader title="Indicadores del lote" />
            <CardContent className="space-y-3 text-sm">
              <Metric label="Botellas buenas" value={formatNumber(goodUnits)} />
              <Metric label="Rendimiento" value={formatPct(metrics.yieldPct)} tip="Botellas buenas ÷ botellas totales" />
              <Metric label="Desperdicio" value={formatPct(metrics.wastePct)} tip="Botellas defectuosas ÷ botellas totales" warn={metrics.wastePct > 0.02} />
              <div className="space-y-2 border-t pt-3">
                <Metric label="Materiales" value={formatCOP(materialsCost)} />
                <Metric label="Mano de obra" value={formatCOP(form.laborCost)} />
                <Metric label="Energía" value={formatCOP(form.energyCost)} />
                <Metric label="Costo total del lote" value={formatCOP(metrics.totalCost)} strong />
              </div>
              <div className="space-y-2 border-t pt-3">
                <Metric label="Mano de obra por botella" value={formatUnitCOP(metrics.laborPerUnit)} />
                <Metric label="Energía por botella" value={formatUnitCOP(metrics.energyPerUnit)} />
                <Metric label="Costo real por botella" value={formatUnitCOP(metrics.costPerUnit)} strong />
                <Metric label="Costo real por paca" value={formatCOP(metrics.costPerPack)} strong />
                {product && goodUnits > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Costo estándar actual de la presentación: {formatCOP(product.costPerPack)} por paca.
                  </p>
                )}
              </div>
              {shortages.length > 0 && <Alert tone="warning">Hay insumos con existencia insuficiente. Se pedirá confirmación.</Alert>}
              <Button className="w-full" size="lg" onClick={() => submit()} disabled={invalid || loading}>
                {loading ? 'Guardando…' : 'Finalizar y registrar producción'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
      {dialog}
    </>
  );
}

function Metric({ label, value, strong, tip, warn }: { label: string; value: string; strong?: boolean; tip?: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1 text-muted-foreground">
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
      </span>
      <span className={`tabular ${strong ? 'font-semibold' : ''} ${warn ? 'text-amber-700' : ''}`}>{value}</span>
    </div>
  );
}
