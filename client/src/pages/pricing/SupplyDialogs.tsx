import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import {
  formatCOP,
  formatDate,
  formatNumber,
  formatPct,
  formatUnitCOP,
  SUPPLY_CATEGORIES,
  SUPPLY_CATEGORY_LABEL,
  SUPPLY_MOVEMENT_LABEL,
  UNITS,
  type MarginStatus,
} from '@alpe/shared';
import { Alert, Loading, MarginText } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, NumberInput, Select, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { InfoTip } from '@/components/ui/tooltip';
import { useSubmit } from '@/hooks/useSubmit';
import { api } from '@/services/api';
import type { Supply } from '@/types';
import { formatDateTime } from '@/utils/dates';

interface ImpactRow {
  productId: number;
  name: string;
  active: boolean;
  affectsCurrentCost: boolean;
  usedInBlowOnly: boolean;
  costPerPackBefore: number;
  costPerPackAfter: number;
  marginBefore: number;
  marginAfter: number;
  listPricePack: number;
  suggestedPricePack: number;
  minMargin: number;
  targetMargin: number;
  statusAfter: MarginStatus;
}

/** Cambio de costo de un insumo con vista previa de presentaciones afectadas. */
export function ChangeCostDialog({ supply, onClose }: { supply: Supply | null; onClose: () => void }) {
  const [newCost, setNewCost] = React.useState(0);
  const [debounced, setDebounced] = React.useState(0);
  const [note, setNote] = React.useState('');
  const [applyTo, setApplyTo] = React.useState<number[]>([]);

  React.useEffect(() => {
    if (supply) {
      setNewCost(supply.current_cost);
      setDebounced(supply.current_cost);
      setNote('');
      setApplyTo([]);
    }
  }, [supply]);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(newCost), 350);
    return () => clearTimeout(t);
  }, [newCost]);

  const preview = useQuery({
    queryKey: ['cost-preview', supply?.id, debounced],
    queryFn: () =>
      api.post<{ affectedCount: number; impact: ImpactRow[]; belowMinimum: number }>(`/supplies/${supply!.id}/cost-preview`, { newCost: debounced }),
    enabled: !!supply && debounced >= 0,
  });

  const { submit, loading } = useSubmit({
    request: () => api.post<{ impact: ImpactRow[]; updatedPrices: string[] }>(`/supplies/${supply!.id}/cost`, { newCost, note, applySuggestedTo: applyTo }),
    onSuccess: (r) => {
      const low = r.impact.filter((i) => i.affectsCurrentCost && i.statusAfter === 'bajo_minimo' && !applyTo.includes(i.productId));
      if (r.updatedPrices.length) toast.success(`Precios actualizados: ${r.updatedPrices.join(', ')}`);
      if (low.length) toast.warning(`Margen por debajo del mínimo en: ${low.map((l) => l.name).join(', ')}`, { duration: 8000 });
      onClose();
    },
    successMessage: 'Costo actualizado. Los costos y márgenes se recalcularon.',
  });

  if (!supply) return null;
  const changed = Math.abs(newCost - supply.current_cost) > 1e-9;
  const pctChange = supply.current_cost > 0 ? (newCost - supply.current_cost) / supply.current_cost : 0;
  const impact = preview.data?.impact ?? [];
  const affecting = impact.filter((i) => i.affectsCurrentCost);
  const belowMin = affecting.filter((i) => i.statusAfter === 'bajo_minimo');

  return (
    <Dialog
      open={!!supply}
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      title={`Cambiar costo: ${supply.name}`}
      description="Revise el impacto en costos y márgenes antes de confirmar. Nada se guarda hasta que presione Confirmar."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => submit(undefined)} disabled={!changed || loading || newCost < 0}>
            {loading ? 'Guardando…' : 'Confirmar cambio'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={`Costo actual (por ${supply.unit})`}>
          <div className="flex h-9 items-center rounded-md border bg-muted/50 px-3 text-sm tabular">{formatUnitCOP(supply.current_cost)}</div>
        </Field>
        <Field label={`Costo nuevo (por ${supply.unit})`} required>
          <MoneyInput value={newCost} onChange={setNewCost} decimals={2} autoFocus />
        </Field>
        <Field label="Variación">
          <div className={`flex h-9 items-center text-sm font-medium tabular ${pctChange > 0 ? 'text-red-700' : pctChange < 0 ? 'text-emerald-700' : ''}`}>
            {changed ? `${pctChange > 0 ? '+' : ''}${formatPct(pctChange)}` : 'Sin cambio'}
          </div>
        </Field>
      </div>
      <Field label="Motivo u observación" className="mt-4">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: nueva lista de precios del proveedor" />
      </Field>

      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">
            {preview.isLoading ? 'Calculando impacto…' : `El cambio afecta ${affecting.length} ${affecting.length === 1 ? 'presentación' : 'presentaciones'}.`}
          </p>
          {impact.length > affecting.length && (
            <span className="text-xs text-muted-foreground">
              ({impact.length - affecting.length} más lo usan solo en el escenario de soplado, sin afectar su costo actual)
            </span>
          )}
        </div>
        {changed && belowMin.length > 0 && (
          <Alert tone="danger" className="mb-3" title={`${belowMin.length} presentación(es) quedarían por debajo del margen mínimo`}>
            Marque “Aplicar precio sugerido” para actualizar su precio de lista al margen objetivo, o ajuste el precio después en Presentaciones.
          </Alert>
        )}
        {impact.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Presentación</th>
                  <th className="px-3 py-2 text-right font-medium">Costo paca anterior</th>
                  <th className="px-3 py-2 text-right font-medium">Costo paca nuevo</th>
                  <th className="px-3 py-2 text-right font-medium">Margen anterior</th>
                  <th className="px-3 py-2 text-right font-medium">Margen nuevo</th>
                  <th className="px-3 py-2 text-right font-medium">Precio actual</th>
                  <th className="px-3 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Precio sugerido
                      <InfoTip>Precio para lograr el margen objetivo: costo ÷ (1 − margen objetivo), redondeado.</InfoTip>
                    </span>
                  </th>
                  <th className="px-3 py-2 text-center font-medium">Aplicar precio sugerido</th>
                </tr>
              </thead>
              <tbody>
                {impact.map((r) => (
                  <tr key={r.productId} className={`border-t ${r.affectsCurrentCost ? '' : 'text-muted-foreground'}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      {r.usedInBlowOnly && <div className="text-xs text-muted-foreground">{r.affectsCurrentCost ? 'Preforma del envase soplado' : 'Solo en el escenario de soplado (no activo)'}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular">{formatCOP(r.costPerPackBefore)}</td>
                    <td className="px-3 py-2 text-right tabular">
                      <span className="inline-flex items-center gap-1">
                        {changed && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                        {formatCOP(r.costPerPackAfter)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MarginText value={r.marginBefore} min={r.minMargin} target={r.targetMargin} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        {r.statusAfter === 'bajo_minimo' && r.affectsCurrentCost && <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
                        <MarginText value={r.marginAfter} min={r.minMargin} target={r.targetMargin} />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular">{formatCOP(r.listPricePack)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular">{formatCOP(r.suggestedPricePack)}</td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                        disabled={!r.affectsCurrentCost || !changed}
                        checked={applyTo.includes(r.productId)}
                        onChange={(e) =>
                          setApplyTo((list) => (e.target.checked ? [...list, r.productId] : list.filter((x) => x !== r.productId)))
                        }
                        aria-label={`Aplicar precio sugerido a ${r.name}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!preview.isLoading && impact.length === 0 && (
          <p className="text-sm text-muted-foreground">Este insumo no está en la estructura de costos de ninguna presentación.</p>
        )}
      </div>
    </Dialog>
  );
}

const emptySupply = {
  code: '',
  name: '',
  category: 'otro',
  unit: 'unidad',
  currentCost: 0,
  supplier: '',
  isInventoried: true,
  minStock: 0,
  initialStock: 0,
  active: true,
  notes: '',
};

export function SupplyFormDialog({ supply, open, onClose }: { supply: Supply | null; open: boolean; onClose: () => void }) {
  const [form, setForm] = React.useState(emptySupply);
  React.useEffect(() => {
    if (!open) return;
    setForm(
      supply
        ? {
            code: supply.code ?? '',
            name: supply.name,
            category: supply.category,
            unit: supply.unit,
            currentCost: supply.current_cost,
            supplier: supply.supplier ?? '',
            isInventoried: supply.is_inventoried,
            minStock: supply.min_stock,
            initialStock: 0,
            active: supply.active,
            notes: supply.notes ?? '',
          }
        : emptySupply,
    );
  }, [supply, open]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const { submit, loading } = useSubmit({
    request: () => (supply ? api.put(`/supplies/${supply.id}`, form) : api.post('/supplies', form)),
    successMessage: supply ? 'Insumo actualizado.' : 'Insumo creado.',
    onSuccess: onClose,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={supply ? 'Editar insumo' : 'Nuevo insumo'}
      description={supply ? 'Para cambiar el costo use la opción “Cambiar costo”, que muestra el impacto en márgenes.' : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => submit(undefined)} disabled={loading || !form.name.trim()}>
            {loading ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Código">
          <Input value={form.code} onChange={(e) => set('code', e.target.value)} />
        </Field>
        <Field label="Categoría">
          <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
            {SUPPLY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {SUPPLY_CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unidad de medida">
          <Select value={form.unit} onChange={(e) => set('unit', e.target.value)}>
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Select>
        </Field>
        {!supply && (
          <Field label="Costo por unidad" required>
            <MoneyInput value={form.currentCost} onChange={(v) => set('currentCost', v)} decimals={2} />
          </Field>
        )}
        <Field label="Proveedor (opcional)">
          <Input value={form.supplier} onChange={(e) => set('supplier', e.target.value)} />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Switch checked={form.isInventoried} onCheckedChange={(v) => set('isInventoried', v)} id="inv" />
          <label htmlFor="inv" className="text-sm">
            Controlar inventario de este insumo
            <span className="block text-xs text-muted-foreground">Desactívelo para agua, energía o mano de obra.</span>
          </label>
        </div>
        {form.isInventoried && (
          <>
            <Field label="Existencia mínima" hint="Genera alerta de inventario bajo">
              <NumberInput value={form.minStock} onChange={(v) => set('minStock', v)} />
            </Field>
            {!supply && (
              <Field label="Existencia inicial">
                <NumberInput value={form.initialStock} onChange={(v) => set('initialStock', v)} />
              </Field>
            )}
          </>
        )}
        <div className="flex items-center gap-3">
          <Switch checked={form.active} onCheckedChange={(v) => set('active', v)} id="act" />
          <label htmlFor="act" className="text-sm">
            Activo
          </label>
        </div>
        <Field label="Observaciones" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

export function SupplyHistoryDialog({ supplyId, onClose }: { supplyId: number | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['supply', supplyId],
    queryFn: () => api.get(`/supplies/${supplyId}`),
    enabled: !!supplyId,
  });
  return (
    <Dialog open={!!supplyId} onOpenChange={(o) => !o && onClose()} size="lg" title={data?.name ?? 'Insumo'} description="Historial de costos, uso y movimientos">
      {isLoading || !data ? (
        <Loading />
      ) : (
        <Tabs defaultValue="costos">
          <TabsList>
            <TabsTrigger value="costos">Historial de costos</TabsTrigger>
            <TabsTrigger value="uso">Presentaciones que lo usan</TabsTrigger>
            {data.is_inventoried && <TabsTrigger value="movimientos">Movimientos</TabsTrigger>}
          </TabsList>
          <TabsContent value="costos">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 text-left font-medium">Fecha</th>
                  <th className="py-2 text-right font-medium">Valor anterior</th>
                  <th className="py-2 text-right font-medium">Valor nuevo</th>
                  <th className="py-2 text-right font-medium">Variación</th>
                  <th className="py-2 pl-4 text-left font-medium">Usuario / motivo</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((h: any) => (
                  <tr key={h.id} className="border-b last:border-0">
                    <td className="py-2">{formatDateTime(h.changed_at)}</td>
                    <td className="py-2 text-right tabular">{h.old_cost === null ? '—' : formatUnitCOP(h.old_cost)}</td>
                    <td className="py-2 text-right font-medium tabular">{formatUnitCOP(h.new_cost)}</td>
                    <td className="py-2 text-right tabular">{h.old_cost ? formatPct((h.new_cost - h.old_cost) / h.old_cost) : '—'}</td>
                    <td className="py-2 pl-4 text-xs text-muted-foreground">
                      {h.user_name ?? 'Sistema'}
                      {h.note ? ` · ${h.note}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>
          <TabsContent value="uso">
            {data.impact.length === 0 ? (
              <p className="text-sm text-muted-foreground">No se usa en ninguna presentación.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {data.impact.map((i: ImpactRow) => (
                  <li key={i.productId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>{i.name}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {i.usedInBlowOnly && <Badge variant="neutral">Escenario de soplado</Badge>}
                      Costo paca {formatCOP(i.costPerPackBefore)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="movimientos">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 text-left font-medium">Fecha</th>
                  <th className="py-2 text-left font-medium">Tipo</th>
                  <th className="py-2 text-right font-medium">Cantidad</th>
                  <th className="py-2 text-right font-medium">Saldo</th>
                  <th className="py-2 pl-4 text-left font-medium">Referencia</th>
                </tr>
              </thead>
              <tbody>
                {data.movements.map((m: any) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="py-2">{formatDate(m.movement_date)}</td>
                    <td className="py-2">{SUPPLY_MOVEMENT_LABEL[m.type as keyof typeof SUPPLY_MOVEMENT_LABEL]}</td>
                    <td className={`py-2 text-right tabular ${m.quantity < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {m.quantity > 0 ? '+' : ''}
                      {formatNumber(m.quantity, 2)}
                    </td>
                    <td className="py-2 text-right tabular">{formatNumber(m.stock_after, 2)}</td>
                    <td className="py-2 pl-4 text-xs text-muted-foreground">{m.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>
        </Tabs>
      )}
    </Dialog>
  );
}
