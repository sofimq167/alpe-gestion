// Controles de formulario: Input, Textarea, Select nativo, Label y Field.
import * as LabelPrimitive from '@radix-ui/react-label';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { InfoTip } from './tooltip';

const fieldBase =
  'flex w-full rounded-md border border-input bg-card px-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'h-9 py-1', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(fieldBase, 'min-h-[72px] py-2', className)} {...props} />,
);
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(fieldBase, 'h-9 py-1 pr-8', className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn('text-[13px] font-medium leading-none text-foreground', className)} {...props} />
));
Label.displayName = 'Label';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  tip?: React.ReactNode;
  error?: string | null;
  className?: string;
  children: React.ReactNode;
  required?: boolean;
}

/** Campo con etiqueta, ayuda opcional y mensaje de error. */
export function Field({ label, htmlFor, hint, tip, error, className, children, required }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-1">
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Input numérico que acepta porcentajes: el usuario escribe 25 y el valor es 0,25. */
export function PercentInput({
  value,
  onChange,
  ...props
}: { value: number; onChange: (v: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = React.useState(() => formatPctInput(value));
  React.useEffect(() => {
    if (Math.abs(parseLocaleNumber(text) / 100 - value) > 1e-9) setText(formatPctInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseLocaleNumber(e.target.value);
          if (Number.isFinite(n)) onChange(n / 100);
        }}
        className="pr-7 text-right tabular"
        {...props}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
    </div>
  );
}

function formatPctInput(v: number) {
  if (!Number.isFinite(v)) return '';
  return String(Math.round(v * 10000) / 100).replace('.', ',');
}

/** Convierte "1.234,5" o "1234.5" a número. */
export function parseLocaleNumber(text: string): number {
  const t = text.trim();
  if (!t) return NaN;
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  // "12.500" (miles) vs "12.5" (decimal): si hay exactamente 3 dígitos tras el punto, se toma como miles
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  return Number(t);
}

/** Input de dinero en COP: muestra separador de miles mientras se escribe. */
export function MoneyInput({
  value,
  onChange,
  decimals = 0,
  ...props
}: { value: number | null; onChange: (v: number) => void; decimals?: number } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
>) {
  const fmt = (v: number | null) =>
    v === null || !Number.isFinite(v) ? '' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: decimals }).format(v);
  const [text, setText] = React.useState(() => fmt(value));
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    if (!focused) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
      <Input
        inputMode="decimal"
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(fmt(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseLocaleNumber(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="pl-6 text-right tabular"
        {...props}
      />
    </div>
  );
}

/** Input numérico simple (cantidades) que acepta coma decimal. */
export function NumberInput({
  value,
  onChange,
  ...props
}: { value: number | null; onChange: (v: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = React.useState(() => (value === null ? '' : String(value).replace('.', ',')));
  React.useEffect(() => {
    const current = parseLocaleNumber(text);
    if (value === null || !Number.isFinite(value)) return;
    if (!Number.isFinite(current) || Math.abs(current - value) > 1e-9) setText(String(value).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseLocaleNumber(e.target.value);
        onChange(Number.isFinite(n) ? n : 0);
      }}
      className={cn('text-right tabular', props.className)}
      {...props}
    />
  );
}
