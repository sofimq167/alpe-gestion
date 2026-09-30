import { Plus, RefreshCcw } from 'lucide-react';
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatCOP, formatPct, formatUnitCOP } from '@alpe/shared';
import { Alert, ErrorState, MarginStatusBadge, MarginText, PageHeader } from '@/components/common';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useProducts } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api } from '@/services/api';
import type { ProductSummary } from '@/types';
import { MarginFormulaHelp } from './CalculatorPage';
import { ProductDialog } from './ProductDialogs';

export function ProductsPage() {
  const { data, isLoading, error } = useProducts();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = React.useState<ProductSummary | null>(null);
  const [open, setOpen] = React.useState(false);
  const [recalcOpen, setRecalcOpen] = React.useState(false);
  const products = data?.products ?? [];

  React.useEffect(() => {
    const id = Number(params.get('editar'));
    if (id && products.length) {
      const p = products.find((x) => x.id === id);
      if (p) {
        setEditing(p);
        setOpen(true);
      }
    }
  }, [params, products]);

  // mantener el producto abierto sincronizado con los datos recalculados
  const current = editing ? (products.find((p) => p.id === editing.id) ?? editing) : null;
  const lowCount = products.filter((p) => p.active && p.status === 'bajo_minimo').length;

  const columns: Column<ProductSummary>[] = [
    {
      key: 'name',
      header: 'Presentación',
      sort: (p) => p.volumeMl,
      csv: (p) => p.name,
      cell: (p) => (
        <div>
          <div className="font-medium">{p.name}</div>
          <div className="text-xs text-muted-foreground">
            {p.unitsPerPack} und/paca · {p.packsPerPallet} pacas/estiba
          </div>
        </div>
      ),
    },
    {
      key: 'container',
      header: 'Envase',
      csv: (p) => p.containerSource,
      cell: (p) => <Badge variant={p.containerSource === 'soplado' ? 'info' : 'neutral'}>{p.containerSource === 'soplado' ? 'Soplado' : 'Comprado'}</Badge>,
    },
    { key: 'cu', header: 'Costo botella', align: 'right', sort: (p) => p.costPerUnit, csv: (p) => Math.round(p.costPerUnit * 100) / 100, cell: (p) => formatUnitCOP(p.costPerUnit) },
    { key: 'cp', header: 'Costo paca', align: 'right', sort: (p) => p.costPerPack, csv: (p) => Math.round(p.costPerPack), cell: (p) => formatCOP(p.costPerPack) },
    {
      key: 'price',
      header: 'Precio paca',
      align: 'right',
      sort: (p) => p.listPricePack,
      csv: (p) => p.listPricePack,
      cell: (p) => (
        <div>
          <div className="font-medium">{formatCOP(p.listPricePack)}</div>
          <div className="text-xs text-muted-foreground">{formatUnitCOP(p.priceUnit)} / botella</div>
        </div>
      ),
    },
    {
      key: 'margin',
      header: (
        <span className="inline-flex items-center gap-1">
          Margen <MarginFormulaHelp />
        </span>
      ),
      csvHeader: 'Margen',
      align: 'right',
      sort: (p) => p.marginPct,
      csv: (p) => Math.round(p.marginPct * 10000) / 100,
      cell: (p) => (
        <div>
          <MarginText value={p.marginPct} min={p.minMargin} target={p.targetMargin} />
          <div className="text-xs text-muted-foreground">{formatCOP(p.profitPerPack)} / paca</div>
        </div>
      ),
    },
    {
      key: 'targets',
      header: 'Objetivo / mínimo',
      align: 'right',
      csv: (p) => `${formatPct(p.targetMargin)} / ${formatPct(p.minMargin)}`,
      cell: (p) => (
        <span className="text-muted-foreground">
          {formatPct(p.targetMargin, 0)} / {formatPct(p.minMargin, 0)}
        </span>
      ),
    },
    { key: 'suggested', header: 'Precio sugerido', align: 'right', sort: (p) => p.suggestedPricePack, csv: (p) => p.suggestedPricePack, cell: (p) => formatCOP(p.suggestedPricePack) },
    { key: 'status', header: 'Estado', sort: (p) => p.status, cell: (p) => (p.active ? <MarginStatusBadge status={p.status} /> : <Badge variant="neutral">Inactiva</Badge>) },
  ];

  return (
    <>
      <PageHeader
        title="Presentaciones"
        description="Costo, precio de lista y margen de cada presentación. Los costos se recalculan automáticamente cuando cambian los insumos o la producción real."
        actions={
          <>
            <Button variant="outline" onClick={() => setRecalcOpen(true)}>
              <RefreshCcw /> Recalcular precios
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus /> Nueva presentación
            </Button>
          </>
        }
      />
      {lowCount > 0 && (
        <Alert tone="danger" className="mb-4" title={`${lowCount} presentación(es) con margen por debajo del mínimo`}>
          Revise el precio de lista o use “Recalcular precios” para aplicar el precio sugerido.
        </Alert>
      )}
      {data?.admin && (
        <p className="mb-3 text-xs text-muted-foreground">
          Gastos administrativos: {data.admin.included ? <strong>incluidos</strong> : 'no incluidos'} {data.admin.included && `(${data.admin.description})`}
        </p>
      )}
      {error ? (
        <ErrorState error={error} />
      ) : (
        <DataTable
          rows={products}
          columns={columns}
          loading={isLoading}
          rowKey={(p) => p.id}
          searchText={(p) => `${p.name} ${p.code ?? ''}`}
          exportName="presentaciones"
          onRowClick={(p) => {
            setEditing(p);
            setOpen(true);
          }}
          rowClassName={(p) => (p.active ? undefined : 'opacity-60')}
        />
      )}
      <ProductDialog
        product={current}
        open={open}
        onClose={() => {
          setOpen(false);
          if (params.get('editar')) setParams({});
        }}
      />
      <RecalculateDialog open={recalcOpen} onClose={() => setRecalcOpen(false)} products={products} />
    </>
  );
}

function RecalculateDialog({ open, onClose, products }: { open: boolean; onClose: () => void; products: ProductSummary[] }) {
  const candidates = products.filter((p) => p.active && p.suggestedPricePack !== p.listPricePack);
  const [selected, setSelected] = React.useState<number[]>([]);
  React.useEffect(() => {
    if (open) setSelected(candidates.filter((p) => p.status !== 'ok').map((p) => p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const { submit, loading } = useSubmit({
    request: () => api.post<{ changed: unknown[] }>('/products/apply-suggested', { productIds: selected }),
    successMessage: (r) => `${r.changed.length} precio(s) actualizado(s) al margen objetivo.`,
    onSuccess: onClose,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title="Recalcular precios"
      description="Aplica el precio sugerido (costo ÷ (1 − margen objetivo), redondeado) a las presentaciones seleccionadas."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => submit(undefined)} disabled={loading || !selected.length}>
            Aplicar a {selected.length} presentación(es)
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todas las presentaciones ya tienen el precio sugerido.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="w-8 py-2" />
              <th className="py-2 text-left font-medium">Presentación</th>
              <th className="py-2 text-right font-medium">Precio actual</th>
              <th className="py-2 text-right font-medium">Margen actual</th>
              <th className="py-2 text-right font-medium">Precio sugerido</th>
              <th className="py-2 text-right font-medium">Margen objetivo</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={selected.includes(p.id)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))}
                    aria-label={p.name}
                  />
                </td>
                <td className="py-2 font-medium">{p.name}</td>
                <td className="py-2 text-right tabular">{formatCOP(p.listPricePack)}</td>
                <td className="py-2 text-right">
                  <MarginText value={p.marginPct} min={p.minMargin} target={p.targetMargin} />
                </td>
                <td className="py-2 text-right font-medium tabular">{formatCOP(p.suggestedPricePack)}</td>
                <td className="py-2 text-right tabular">{formatPct(p.targetMargin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
