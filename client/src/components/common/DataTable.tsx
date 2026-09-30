// Tabla reutilizable: búsqueda, orden por columna, paginación y exportación CSV.
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { downloadCSV } from '@/utils/csv';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Valor para ordenar (si no se indica, la columna no se puede ordenar). */
  sort?: (row: T) => string | number | null | undefined;
  /** Valor para CSV (si no se indica, la columna no se exporta). */
  csv?: (row: T) => string | number | null | undefined;
  csvHeader?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  exportName?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  emptyMessage?: React.ReactNode;
  loading?: boolean;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  footer?: React.ReactNode;
  compact?: boolean;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = 'Buscar…',
  toolbar,
  exportName,
  pageSize = 25,
  onRowClick,
  rowClassName,
  emptyMessage = 'No hay registros para mostrar.',
  loading,
  defaultSort,
  footer,
  compact,
}: DataTableProps<T>) {
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const [page, setPage] = React.useState(0);

  const filtered = React.useMemo(() => {
    if (!search.trim() || !searchText) return rows;
    const terms = normalize(search).split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      const text = normalize(searchText(r));
      return terms.every((t) => text.includes(t));
    });
  }, [rows, search, searchText]);

  const sorted = React.useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.sort!(a);
      const vb = col.sort!(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'es') * dir;
    });
  }, [filtered, sort, columns]);

  React.useEffect(() => setPage(0), [search, rows.length]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = sorted.slice(page * pageSize, page * pageSize + pageSize);

  const exportCsv = () => {
    if (!exportName) return;
    const cols = columns.filter((c) => c.csv).map((c) => ({ header: c.csvHeader ?? (typeof c.header === 'string' ? c.header : c.key), value: c.csv! }));
    downloadCSV(exportName, sorted, cols);
  };

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }));
  };

  return (
    <div className="space-y-3">
      {(searchText || toolbar || exportName) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchText && (
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} className="pl-8" />
            </div>
          )}
          {toolbar}
          {exportName && (
            <Button variant="outline" size="sm" className="ml-auto h-9" onClick={exportCsv} disabled={!sorted.length}>
              <Download /> Exportar CSV
            </Button>
          )}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'whitespace-nowrap px-3 py-2.5 text-xs font-medium text-muted-foreground',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                    c.sort && 'cursor-pointer select-none hover:text-foreground',
                    c.className,
                  )}
                  onClick={c.sort ? () => toggleSort(c.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            ) : current.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              current.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn('border-b last:border-0 transition-colors', onRowClick && 'cursor-pointer hover:bg-muted/50', rowClassName?.(row))}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        compact ? 'px-3 py-1.5' : 'px-3 py-2.5',
                        c.align === 'right' ? 'text-right tabular' : c.align === 'center' ? 'text-center' : 'text-left',
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {footer && current.length > 0 && <tfoot className="border-t bg-muted/30 font-medium">{footer}</tfoot>}
        </table>
      </div>
      {sorted.length > pageSize && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} de {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Anterior">
              <ChevronLeft />
            </Button>
            <span className="px-2">
              Página {page + 1} de {pages}
            </span>
            <Button variant="outline" size="icon" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Siguiente">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
      {sorted.length > 0 && sorted.length <= pageSize && searchText && (
        <p className="text-xs text-muted-foreground">{sorted.length} registro(s)</p>
      )}
    </div>
  );
}
