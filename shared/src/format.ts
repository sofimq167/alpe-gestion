// Formato de moneda, porcentajes y fechas para Colombia (es-CO).

const intFormatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

/** Redondea a un número de decimales evitando errores de coma flotante. */
export function round(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Formatea un valor en pesos colombianos: 125400 -> "$125.400".
 * `decimals` permite mostrar centavos en costos unitarios pequeños ($20,5).
 */
export function formatCOP(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const formatter =
    decimals === 0
      ? intFormatter
      : new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  const text = formatter.format(decimals === 0 ? Math.round(abs) : round(abs, decimals));
  const sign = value < 0 && round(abs, decimals) !== 0 ? '-' : '';
  return `${sign}$${text}`;
}

/** Costo unitario: muestra hasta 2 decimales cuando el valor es pequeño. */
export function formatUnitCOP(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return formatCOP(value, Math.abs(value) < 1000 ? 2 : 0);
}

/** 0.245 -> "24,5%" */
export function formatPct(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const pct = round(value * 100, decimals);
  return (
    new Intl.NumberFormat('es-CO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(pct === 0 ? 0 : pct) + '%'
  );
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: decimals }).format(value);
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria del negocio. */
export function todayISO(timeZone = 'America/Bogota', now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Suma días a una fecha ISO (YYYY-MM-DD) sin problemas de zona horaria. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Diferencia en días entre dos fechas ISO (b - a). */
export function diffDays(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-09-15" -> "15 sep 2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-09" -> "sep 2026" */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
