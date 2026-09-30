// Guardado con manejo de errores y advertencias que requieren confirmación del usuario.
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ApiError } from '@/services/api';

interface Options<TPayload, TResult> {
  /** Función que llama a la API. `confirmWarnings` es true cuando el usuario aceptó las advertencias. */
  request: (payload: TPayload, confirmWarnings: boolean) => Promise<TResult>;
  onSuccess?: (result: TResult) => void;
  successMessage?: string | ((r: TResult) => string);
  /** Claves de react-query a refrescar después de guardar (por defecto se refresca todo). */
  invalidate?: string[][] | 'all';
}

export function useSubmit<TPayload, TResult = unknown>(options: Options<TPayload, TResult>) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = React.useState(false);
  const [pending, setPending] = React.useState<{ payload: TPayload; warnings: string[] } | null>(null);

  const run = async (payload: TPayload, confirm = false) => {
    setLoading(true);
    try {
      const result = await options.request(payload, confirm);
      setPending(null);
      const inv = options.invalidate ?? 'all';
      if (inv === 'all') await queryClient.invalidateQueries();
      else await Promise.all(inv.map((key) => queryClient.invalidateQueries({ queryKey: key })));
      const msg = typeof options.successMessage === 'function' ? options.successMessage(result) : options.successMessage;
      if (msg) toast.success(msg);
      options.onSuccess?.(result);
      return result;
    } catch (err) {
      if (err instanceof ApiError && err.needsConfirmation && err.warnings.length) {
        setPending({ payload, warnings: err.warnings });
      } else {
        toast.error(err instanceof Error ? err.message : 'No se pudo guardar.');
      }
      return undefined;
    } finally {
      setLoading(false);
    }
  };

  const dialog = (
    <ConfirmDialog
      open={!!pending}
      onOpenChange={(o) => !o && setPending(null)}
      title={
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" /> Revise antes de guardar
        </span>
      }
      confirmLabel="Guardar de todas formas"
      loading={loading}
      onConfirm={() => pending && run(pending.payload, true)}
    >
      <ul className="list-disc space-y-1.5 pl-5 text-foreground">
        {pending?.warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </ConfirmDialog>
  );

  return { submit: (payload: TPayload) => run(payload, false), loading, dialog };
}
