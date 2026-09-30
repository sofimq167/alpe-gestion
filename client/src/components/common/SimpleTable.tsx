import * as React from 'react';

/** Tabla simple para listados cortos dentro de fichas de detalle. */
export function SimpleTable({ head, rows, empty }: { head: string[]; rows: { key: number; cells: React.ReactNode[]; onClick?: () => void }[]; empty: string }) {
  if (!rows.length) return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} onClick={r.onClick} className={`border-t ${r.onClick ? 'cursor-pointer hover:bg-muted/50' : ''}`}>
              {r.cells.map((cell, i) => (
                <td key={i} className="px-4 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
