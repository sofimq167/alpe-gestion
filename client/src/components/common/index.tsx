// Componentes comunes de página: encabezados, indicadores, estados y badges de negocio.
import { AlertTriangle, Loader2 } from 'lucide-react';
import * as React from 'react';
import { formatPct, ORDER_STATUS_LABEL, RECEIVABLE_STATUS_LABEL, type MarginStatus, type ReceivableStatus } from '@alpe/shared';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/form';
import { InfoTip } from '@/components/ui/tooltip';
import { useSettings } from '@/hooks/useData';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && <div className="mb-2">{back}</div>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tip,
  tone = 'default',
  icon,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tip?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
  onClick?: () => void;
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-emerald-700',
    warning: 'text-amber-700',
    danger: 'text-red-700',
  }[tone];
  return (
    <Card className={cn('p-4', onClick && 'cursor-pointer transition-colors hover:border-primary/40')} onClick={onClick}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {label}
          {tip && <InfoTip>{tip}</InfoTip>}
        </div>
        {icon && <span className="text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
      </div>
      <div className={cn('mt-2 text-2xl font-semibold tracking-tight tabular', toneClass)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <AlertTriangle className="h-4 w-4" />
      {error instanceof Error ? error.message : 'No se pudo cargar la información.'}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted-foreground [&_svg]:h-8 [&_svg]:w-8">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'warning', title, children, className }: { tone?: 'warning' | 'danger' | 'info' | 'success'; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const styles = {
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-red-200 bg-red-50 text-red-800',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone];
  return (
    <div className={cn('rounded-lg border px-4 py-3 text-sm', styles, className)}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn(title && 'mt-1', 'opacity-90')}>{children}</div>}
    </div>
  );
}

/** Par etiqueta / valor para fichas de detalle. */
export function KeyValue({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children ?? '—'}</dd>
    </div>
  );
}

const marginVariant: Record<MarginStatus, BadgeVariant> = { ok: 'success', bajo_objetivo: 'warning', bajo_minimo: 'danger' };
const marginText: Record<MarginStatus, string> = { ok: 'En objetivo', bajo_objetivo: 'Bajo objetivo', bajo_minimo: 'Margen bajo' };

export function MarginBadge({ status, value }: { status: MarginStatus; value?: number }) {
  return (
    <Badge variant={marginVariant[status]}>
      {value !== undefined ? formatPct(value) : marginText[status]}
    </Badge>
  );
}

export function MarginStatusBadge({ status }: { status: MarginStatus }) {
  return <Badge variant={marginVariant[status]}>{marginText[status]}</Badge>;
}

/** Margen coloreado según mínimo y objetivo. */
export function MarginText({ value, min, target }: { value: number; min: number; target?: number }) {
  const cls = value < min ? 'text-red-700 font-semibold' : target !== undefined && value < target ? 'text-amber-700' : 'text-emerald-700';
  return <span className={cn('tabular', cls)}>{formatPct(value)}</span>;
}

/** Margen agregado (pedido, cliente, periodo) coloreado con los márgenes por defecto de la configuración. */
export function AggMarginText({ value, target }: { value: number; target?: number }) {
  const { data } = useSettings();
  return <MarginText value={value} min={data?.pricing.defaultMinMargin ?? 0.15} target={target ?? data?.pricing.defaultTargetMargin ?? 0.25} />;
}

const receivableVariant: Record<ReceivableStatus, BadgeVariant> = {
  pagada: 'success',
  vencida: 'danger',
  por_vencer: 'warning',
  al_dia: 'info',
  anulada: 'neutral',
};

export function ReceivableBadge({ status }: { status: ReceivableStatus }) {
  return <Badge variant={receivableVariant[status]}>{RECEIVABLE_STATUS_LABEL[status]}</Badge>;
}

const orderVariant: Record<string, BadgeVariant> = { confirmado: 'info', parcial: 'warning', despachado: 'success', cancelado: 'neutral' };

export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge variant={orderVariant[status] ?? 'neutral'}>{ORDER_STATUS_LABEL[status as keyof typeof ORDER_STATUS_LABEL] ?? status}</Badge>;
}

/** Selector de rango de fechas. */
export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="sr-only" htmlFor="dr-from">
        Desde
      </Label>
      <Input id="dr-from" type="date" value={from} onChange={(e) => onChange(e.target.value, to)} className="h-9 w-[150px]" />
      <span className="text-xs text-muted-foreground">a</span>
      <Label className="sr-only" htmlFor="dr-to">
        Hasta
      </Label>
      <Input id="dr-to" type="date" value={to} onChange={(e) => onChange(from, e.target.value)} className="h-9 w-[150px]" />
    </div>
  );
}
