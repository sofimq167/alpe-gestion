import { History, Pencil, Plus, TrendingUp } from 'lucide-react';
import * as React from 'react';
import { formatDate, formatNumber, formatUnitCOP, SUPPLY_CATEGORIES, SUPPLY_CATEGORY_LABEL, type SupplyCategory } from '@alpe/shared';
import { ErrorState, PageHeader } from '@/components/common';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Tooltip } from '@/components/ui/tooltip';
import { useSupplies } from '@/hooks/useData';
import type { Supply } from '@/types';
import { ChangeCostDialog, SupplyFormDialog, SupplyHistoryDialog } from './SupplyDialogs';

export function SuppliesPage() {
  const { data = [], isLoading, error } = useSupplies();
  const [category, setCategory] = React.useState('');
  const [costFor, setCostFor] = React.useState<Supply | null>(null);
  const [editing, setEditing] = React.useState<Supply | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [historyFor, setHistoryFor] = React.useState<number | null>(null);

  const rows = category ? data.filter((s) => s.category === category) : data;

  const columns: Column<Supply>[] = [
    {
      key: 'name',
      header: 'Insumo',
      sort: (s) => s.name,
      csv: (s) => s.name,
      cell: (s) => (
        <div>
          <div className="font-medium">{s.name}</div>
          <div className="text-xs text-muted-foreground">
            {s.code ? `${s.code} · ` : ''}
            {s.supplier ?? 'Sin proveedor'}
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Categoría',
      sort: (s) => s.category,
      csv: (s) => SUPPLY_CATEGORY_LABEL[s.category as SupplyCategory],
      cell: (s) => <Badge variant="neutral">{SUPPLY_CATEGORY_LABEL[s.category as SupplyCategory] ?? s.category}</Badge>,
    },
    { key: 'unit', header: 'Unidad', cell: (s) => s.unit, csv: (s) => s.unit },
    {
      key: 'cost',
      header: 'Costo actual',
      align: 'right',
      sort: (s) => s.current_cost,
      csv: (s) => s.current_cost,
      cell: (s) => <span className="font-medium">{formatUnitCOP(s.current_cost)}</span>,
    },
    {
      key: 'updated',
      header: 'Última actualización',
      sort: (s) => s.cost_updated_at,
      csv: (s) => s.cost_updated_at?.slice(0, 10),
      cell: (s) => <span className="text-muted-foreground">{formatDate(s.cost_updated_at?.slice(0, 10))}</span>,
    },
    {
      key: 'used',
      header: 'Usado en',
      align: 'center',
      sort: (s) => s.used_by,
      cell: (s) =>
        s.used_by > 0 ? (
          <Tooltip content={s.used_by_names.join(', ')}>
            <span className="cursor-default text-sm underline decoration-dotted underline-offset-4">{s.used_by} present.</span>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'stock',
      header: 'Existencia',
      align: 'right',
      sort: (s) => (s.is_inventoried ? s.stock : null),
      csv: (s) => (s.is_inventoried ? s.stock : ''),
      cell: (s) =>
        s.is_inventoried ? (
          <span className={s.stock <= s.min_stock ? 'font-medium text-red-700' : ''}>
            {formatNumber(s.stock, 2)} <span className="text-xs text-muted-foreground">{s.unit}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No inventariable</span>
        ),
    },
    {
      key: 'status',
      header: 'Estado',
      cell: (s) => (s.active ? <Badge variant="success">Activo</Badge> : <Badge variant="neutral">Inactivo</Badge>),
      csv: (s) => (s.active ? 'Activo' : 'Inactivo'),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (s) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" onClick={() => setCostFor(s)}>
            <TrendingUp /> Cambiar costo
          </Button>
          <Tooltip content="Historial">
            <Button size="icon" variant="ghost" onClick={() => setHistoryFor(s.id)} aria-label="Historial">
              <History />
            </Button>
          </Tooltip>
          <Tooltip content="Editar datos">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setEditing(s);
                setFormOpen(true);
              }}
              aria-label="Editar"
            >
              <Pencil />
            </Button>
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Insumos y costos"
        description="Variables maestras de costo. Al cambiar el costo de un insumo, el sistema recalcula automáticamente el costo y el margen de todas las presentaciones que lo usan."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus /> Nuevo insumo
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          loading={isLoading}
          rowKey={(s) => s.id}
          searchText={(s) => `${s.name} ${s.code ?? ''} ${s.supplier ?? ''}`}
          searchPlaceholder="Buscar insumo o proveedor…"
          exportName="insumos"
          onRowClick={(s) => setHistoryFor(s.id)}
          rowClassName={(s) => (s.active ? undefined : 'opacity-60')}
          toolbar={
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-48" aria-label="Categoría">
              <option value="">Todas las categorías</option>
              {SUPPLY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SUPPLY_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          }
        />
      )}
      <ChangeCostDialog supply={costFor} onClose={() => setCostFor(null)} />
      <SupplyFormDialog supply={editing} open={formOpen} onClose={() => setFormOpen(false)} />
      <SupplyHistoryDialog supplyId={historyFor} onClose={() => setHistoryFor(null)} />
    </>
  );
}
