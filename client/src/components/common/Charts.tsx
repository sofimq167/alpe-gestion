// Gráficas mínimas y accionables. Colores validados (azul/naranja, apto para daltonismo).
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCOP, formatMonth, formatNumber, formatPct } from '@alpe/shared';

export const SERIES = { primary: '#2a78d6', secondary: '#eb6834' };
const axis = { stroke: 'hsl(215 14% 44%)', fontSize: 11 };

export interface MonthPoint {
  month: string;
  revenue: number;
  cost: number;
  grossProfit: number;
  marginPct: number;
  adminExpenses: number;
  packs: number;
}

/** Quita los meses iniciales sin actividad (antes de empezar a usar el sistema). */
export function trimLeadingEmpty(data: MonthPoint[]): MonthPoint[] {
  const first = data.findIndex((d) => d.revenue !== 0 || d.cost !== 0 || d.adminExpenses !== 0);
  return first <= 0 ? data : data.slice(first);
}

const compact = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `$${formatNumber(v / 1_000_000, 1)} M` : Math.abs(v) >= 1000 ? `$${formatNumber(v / 1000)} mil` : `$${v}`;

function MonthTooltip({ active, payload }: { active?: boolean; payload?: { payload: MonthPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold capitalize">{formatMonth(p.month)}</p>
      <p>Ventas: {formatCOP(p.revenue)}</p>
      <p>Costo de ventas: {formatCOP(p.cost)}</p>
      <p>Utilidad bruta: {formatCOP(p.grossProfit)}</p>
      <p>Margen bruto: {formatPct(p.marginPct)}</p>
      <p className="text-muted-foreground">Pacas vendidas: {formatNumber(p.packs)}</p>
    </div>
  );
}

/** Ventas mensuales (una serie). El detalle de costo y margen aparece al pasar el cursor. */
export function MonthlySalesChart({ data, height = 240 }: { data: MonthPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={trimLeadingEmpty(data)} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(214 20% 92%)" />
        <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m).split(' ')[0]} tick={axis} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={compact} tick={axis} axisLine={false} tickLine={false} width={70} />
        <Tooltip content={<MonthTooltip />} cursor={{ fill: 'hsl(210 20% 96%)' }} />
        <Bar dataKey="revenue" name="Ventas" fill={SERIES.primary} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Ventas vs. costo de ventas por mes (mismo eje en pesos). */
export function SalesVsCostChart({ data, height = 280 }: { data: MonthPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={trimLeadingEmpty(data)} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(214 20% 92%)" />
        <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m).split(' ')[0]} tick={axis} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={compact} tick={axis} axisLine={false} tickLine={false} width={70} />
        <Tooltip content={<MonthTooltip />} cursor={{ stroke: 'hsl(214 20% 80%)' }} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: 'hsl(215 28% 14%)' }} />
        <Line type="monotone" dataKey="revenue" name="Ventas" stroke={SERIES.primary} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
        <Line type="monotone" dataKey="cost" name="Costo de ventas" stroke={SERIES.secondary} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
