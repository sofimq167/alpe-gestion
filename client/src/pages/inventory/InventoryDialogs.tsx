import * as React from 'react';
import { countDifference, formatCOP, formatNumber, formatPct } from '@alpe/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, NumberInput, Select } from '@/components/ui/form';
import { useSettings } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api } from '@/services/api';
import { today } from '@/utils/dates';

export interface CountItem {
  id: number;
  name: string;
  systemQty: number;
  unitValue: number;
  unit: string;
}

/** Conteo físico de varios ítems a la vez; ajusta la existencia al valor contado. */
export function PhysicalCountDialog({ open, onClose, itemType, items }: { open: boolean; onClose: () => void; itemType: 'producto' | 'insumo'; items: CountItem[] }) {
  const settings = useSettings();
  const threshold = settings.data?.operations.countDiffThresholdPct ?? 0.02;
  const [date, setDate] = React.useState(today());
  const [notes, setNotes] = React.useState('');
  const [counts, setCounts] = React.useState<Record<number, number | null>>({});
  React.useEffect(() => {
    if (open) {
      setCounts({});
      setNotes('');
      setDate(today());
    }
  }, [open]);
  const entered = items.filter((i) => counts[i.id] !== undefined && counts[i.id] !== null);
  const { submit, loading } = useSubmit({
    request: () => api.post('/inventory/counts', { date, itemType, notes, items: entered.map((i) => ({ itemId: i.id, physicalQty: counts[i.id] })) }),
    successMessage: 'Conteo físico registrado. Las existencias se ajustaron.',
    onSuccess: onClose,
  });
  const totalDiffValue = entered.reduce((s, i) => s + countDifference(i.systemQty, counts[i.id]!, i.unitValue).differenceValue, 0);
  const invalid = entered.some((i) => counts[i.id]! < 0 || (itemType === 'producto' && !Number.isInteger(counts[i.id]!)));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={`Conteo físico de ${itemType === 'producto' ? 'producto terminado' : 'insumos'}`}
      description="Escriba la cantidad contada solo en los ítems que contó. La existencia del sistema se ajustará a lo contado y quedará registrada la diferencia."
      footer={
        <>
          <span className="mr-auto self-center text-sm">
            Valor de la diferencia: <strong className={totalDiffValue < 0 ? 'text-red-700' : ''}>{formatCOP(totalDiffValue)}</strong>
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => submit(undefined)} disabled={loading || !entered.length || invalid}>
            Registrar conteo ({entered.length})
          </Button>
        </>
      }
    >
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Field label="Fecha del conteo">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Observaciones" className="sm:col-span-2">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: conteo mensual de bodega" />
        </Field>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 text-left font-medium">Ítem</th>
            <th className="py-2 text-right font-medium">Sistema</th>
            <th className="py-2 text-right font-medium">Físico</th>
            <th className="py-2 text-right font-medium">Diferencia</th>
            <th className="py-2 text-right font-medium">Valor diferencia</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const physical = counts[i.id];
            const diff = physical !== undefined && physical !== null ? countDifference(i.systemQty, physical, i.unitValue, threshold) : null;
            return (
              <tr key={i.id} className={`border-b last:border-0 ${diff?.relevant ? 'bg-red-50/60' : ''}`}>
                <td className="py-2">
                  {i.name} <span className="text-xs text-muted-foreground">({i.unit})</span>
                </td>
                <td className="py-2 text-right tabular">{formatNumber(i.systemQty, 2)}</td>
                <td className="py-2 text-right">
                  <NumberInput
                    value={physical ?? null}
                    onChange={(v) => setCounts((c) => ({ ...c, [i.id]: v }))}
                    className="ml-auto w-28"
                    placeholder="—"
                    onBlur={(e) => {
                      if (!e.target.value.trim()) setCounts((c) => ({ ...c, [i.id]: null }));
                    }}
                  />
                </td>
                <td className={`py-2 text-right tabular ${diff && diff.difference < 0 ? 'text-red-700' : diff && diff.difference > 0 ? 'text-emerald-700' : ''}`}>
                  {diff ? `${diff.difference > 0 ? '+' : ''}${formatNumber(diff.difference, 2)}` : '—'}
                  {diff?.relevant && <div className="text-xs">{formatPct(diff.differencePct)}</div>}
                </td>
                <td className="py-2 text-right tabular">{diff ? formatCOP(diff.differenceValue) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Dialog>
  );
}

export function MovementDialog({
  open,
  onClose,
  kind,
  items,
}: {
  open: boolean;
  onClose: () => void;
  kind: 'producto' | 'insumo';
  items: { id: number; name: string; stock: number; unit: string }[];
}) {
  const types = kind === 'insumo' ? [['entrada', 'Entrada (compra)'], ['ajuste', 'Ajuste (+ / −)'], ['perdida', 'Pérdida / desperdicio'], ['consumo', 'Consumo (fuera de producción)']] : [['ajuste', 'Ajuste (+ / −)'], ['perdida', 'Pérdida / avería']];
  const [form, setForm] = React.useState({ itemId: 0, type: types[0][0], quantity: 0, date: today(), reference: '', notes: '' });
  React.useEffect(() => {
    if (open) setForm({ itemId: 0, type: types[0][0], quantity: 0, date: today(), reference: '', notes: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const item = items.find((i) => i.id === form.itemId);
  const delta = form.type === 'ajuste' ? form.quantity : ['perdida', 'consumo'].includes(form.type) ? -form.quantity : form.quantity;
  const after = item ? item.stock + delta : null;
  const error =
    form.type !== 'ajuste' && form.quantity <= 0
      ? 'La cantidad debe ser mayor que cero'
      : form.type === 'ajuste' && form.quantity === 0
        ? 'El ajuste no puede ser cero'
        : kind === 'producto' && !Number.isInteger(form.quantity)
          ? 'Debe ser un número entero de pacas'
          : after !== null && after < 0
            ? 'La existencia quedaría negativa'
            : null;
  const { submit, loading } = useSubmit({
    request: () =>
      kind === 'insumo'
        ? api.post('/inventory/supplies/movements', { supplyId: form.itemId, date: form.date, type: form.type, quantity: form.quantity, reference: form.reference, notes: form.notes })
        : api.post('/inventory/products/movements', { productId: form.itemId, date: form.date, type: form.type, packs: form.quantity, reference: form.reference, notes: form.notes }),
    successMessage: 'Movimiento registrado.',
    onSuccess: onClose,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Registrar movimiento"
      description={kind === 'insumo' ? 'Entradas por compra, ajustes o pérdidas de insumos. Los consumos de producción se registran automáticamente.' : 'Ajustes o pérdidas de producto terminado. Producción y despachos se registran automáticamente.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => submit(undefined)} disabled={loading || !form.itemId || !!error}>
            Registrar movimiento
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={kind === 'insumo' ? 'Insumo' : 'Presentación'} required className="sm:col-span-2">
          <Select value={form.itemId || ''} onChange={(e) => set('itemId', Number(e.target.value))}>
            <option value="">Seleccione…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} (existencia {formatNumber(i.stock, 2)} {i.unit})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo de movimiento">
          <Select value={form.type} onChange={(e) => set('type', e.target.value)}>
            {types.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Cantidad${item ? ` (${item.unit})` : ''}`} hint={form.type === 'ajuste' ? 'Use signo menos para restar' : undefined} error={form.itemId ? error : null}>
          <NumberInput value={form.quantity} onChange={(v) => set('quantity', v)} />
        </Field>
        <Field label="Fecha">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Referencia" hint="Ej.: número de factura">
          <Input value={form.reference} onChange={(e) => set('reference', e.target.value)} />
        </Field>
        <Field label="Observaciones" className="sm:col-span-2">
          <Input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {item && after !== null && (
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Existencia después del movimiento: <strong className="text-foreground">{formatNumber(after, 2)} {item.unit}</strong>
          </p>
        )}
      </div>
    </Dialog>
  );
}
