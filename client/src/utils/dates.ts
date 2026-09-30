import { addDays, todayISO } from '@alpe/shared';

export const today = () => todayISO('America/Bogota');
export const monthStart = () => `${today().slice(0, 7)}-01`;
export const daysAgo = (n: number) => addDays(today(), -n);

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(iso));
}
