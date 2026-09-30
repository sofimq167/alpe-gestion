import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Ban, FileText, Printer, Trash2, Upload } from 'lucide-react';
import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatCOP, formatDate, formatNumber, formatPct, marginOnSales, receivableStatus } from '@alpe/shared';
import { Alert, ErrorState, KeyValue, Loading, PageHeader, ReceivableBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/form';
import { useSettings } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api } from '@/services/api';
import { formatDateTime, today } from '@/utils/dates';

export function DispatchDetailPage() {
  const { id } = useParams();
  const settings = useSettings();
  const { data: d, isLoading, error } = useQuery({ queryKey: ['dispatch', id], queryFn: () => api.get(`/dispatches/${id}`) });
  const [annulOpen, setAnnulOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);
  const annul = useSubmit({ request: () => api.post(`/dispatches/${id}/annul`, { reason }), successMessage: 'Despacho anulado. Inventario y cartera revertidos.', onSuccess: () => setAnnulOpen(false) });
  const upload = useSubmit({
    request: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.upload(`/dispatches/${id}/attachments`, fd);
    },
    successMessage: 'Archivo adjuntado.',
  });
  const removeFile = useSubmit({ request: (fileId: number) => api.del(`/attachments/${fileId}`), successMessage: 'Archivo eliminado.' });

  if (isLoading) return <Loading />;
  if (error || !d) return <ErrorState error={error} />;
  const margin = marginOnSales(d.products_total, d.cost_total);
  const r = d.receivable;

  return (
    <>
      <PageHeader
        back={
          <Link to="/despachos" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Despachos
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            Despacho {d.number}
            {d.status === 'anulado' ? <Badge variant="neutral">Anulado</Badge> : <Badge variant="success">Confirmado</Badge>}
            {d.kind === 'maquila' && <Badge variant="info">Maquila</Badge>}
          </span>
        }
        description={`Remisión ${d.remission_number} · ${formatDate(d.dispatch_date)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer /> Imprimir
            </Button>
            {d.status === 'confirmado' && (
              <Button variant="outline" onClick={() => setAnnulOpen(true)}>
                <Ban /> Anular
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <KeyValue label="Cliente">
                <Link to={`/clientes/${d.client_id}`} className="hover:underline">
                  {d.client_name}
                </Link>
              </KeyValue>
              <KeyValue label="Pedido relacionado">
                {d.order_id ? (
                  <Link to={`/pedidos/${d.order_id}`} className="text-primary hover:underline">
                    {d.order_number}
                  </Link>
                ) : d.kind === 'maquila' ? (
                  d.maquila_service_name
                ) : (
                  'Despacho directo'
                )}
              </KeyValue>
              <KeyValue label="Fecha">{formatDate(d.dispatch_date)}</KeyValue>
              <KeyValue label="Destino">{d.destination}</KeyValue>
              <KeyValue label="Vehículo">{d.vehicle}</KeyValue>
              <KeyValue label="Conductor">{d.driver}</KeyValue>
              <KeyValue label="Forma de pago">{d.payment_mode === 'contado' ? 'Contado' : 'Crédito'}</KeyValue>
              <KeyValue label="Registrado por">{d.created_by_name}</KeyValue>
              <KeyValue label="Fecha de registro">{formatDateTime(d.created_at)}</KeyValue>
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Productos y lotes" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 text-left font-medium">Producto</th>
                    <th className="px-3 py-2 text-right font-medium">Pacas</th>
                    <th className="px-3 py-2 text-right font-medium">Botellas</th>
                    <th className="px-3 py-2 text-right font-medium">Precio paca</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-5 py-2 text-left font-medium">Lotes</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i: any) => (
                    <tr key={i.id} className="border-t align-top">
                      <td className="px-5 py-2.5 font-medium">{i.description}</td>
                      <td className="px-3 py-2.5 text-right tabular">{formatNumber(i.packs)}</td>
                      <td className="px-3 py-2.5 text-right tabular">{formatNumber(i.units)}</td>
                      <td className="px-3 py-2.5 text-right tabular">{formatCOP(i.price_pack)}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular">{formatCOP(i.line_total)}</td>
                      <td className="px-5 py-2.5 text-xs">
                        {i.lots.length === 0 ? (
                          <span className="text-muted-foreground">Sin lote (existencia inicial)</span>
                        ) : (
                          i.lots.map((l: any) => (
                            <div key={l.id}>
                              <Link to={`/produccion/lotes/${l.lot_id}`} className="text-primary hover:underline">
                                {l.code}
                              </Link>{' '}
                              · {l.packs} pacas
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card className="print:hidden">
            <CardHeader
              title="Soporte de la remisión"
              description="Foto o PDF firmado de la remisión (máximo 2 MB)."
              actions={
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) upload.submit(f);
                      e.target.value = '';
                    }}
                  />
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.loading}>
                    <Upload /> Adjuntar archivo
                  </Button>
                </>
              }
            />
            <CardContent>
              {d.attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay archivos adjuntos.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {d.attachments.map((a: any) => (
                    <li key={a.id} className="flex items-center justify-between px-4 py-2 text-sm">
                      <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                        <FileText className="h-4 w-4" /> {a.filename}
                      </a>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {Math.round(a.size_bytes / 1024)} KB
                        <Button variant="ghost" size="icon" onClick={() => removeFile.submit(a.id)} aria-label="Eliminar archivo">
                          <Trash2 />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Valores" />
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <KeyValue label="Productos">{formatCOP(d.products_total)}</KeyValue>
                <KeyValue label="Flete cobrado">{formatCOP(d.freight_charge)}</KeyValue>
                <KeyValue label="Total">
                  <span className="text-base">{formatCOP(d.total)}</span>
                </KeyValue>
                <KeyValue label="Pacas">{formatNumber(d.packs_total)}</KeyValue>
                <KeyValue label="Costo real">{formatCOP(d.cost_total)}</KeyValue>
                <KeyValue label="Margen">{formatPct(margin)}</KeyValue>
              </dl>
            </CardContent>
          </Card>
          {r && (
            <Card>
              <CardHeader title="Cuenta por cobrar" />
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-2 gap-4">
                  <KeyValue label="Valor">{formatCOP(r.original_amount)}</KeyValue>
                  <KeyValue label="Saldo">{formatCOP(r.balance)}</KeyValue>
                  <KeyValue label="Vence">{formatDate(r.due_date)}</KeyValue>
                  <KeyValue label="Estado">
                    <ReceivableBadge status={receivableStatus(r.balance, r.due_date, today(), settings.data?.operations.dueSoonDays ?? 7, r.annulled)} />
                  </KeyValue>
                </dl>
                <Button variant="outline" size="sm" asChild className="w-full">
                  <Link to={`/cartera?cliente=${d.client_id}`}>Ver cartera del cliente</Link>
                </Button>
              </CardContent>
            </Card>
          )}
          {d.notes && (
            <Alert tone="info" title="Observaciones">
              {d.notes}
            </Alert>
          )}
        </div>
      </div>
      <ConfirmDialog open={annulOpen} onOpenChange={setAnnulOpen} title={`¿Anular el despacho ${d.number}?`} destructive confirmLabel="Anular despacho" cancelLabel="Volver" loading={annul.loading} onConfirm={() => annul.submit(undefined)}>
        <p className="mb-3">Se devolverá el producto al inventario y a sus lotes, se reabrirá el pedido y se anulará la cuenta por cobrar. No es posible si la cuenta ya tiene pagos.</p>
        <Input placeholder="Motivo de la anulación" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </>
  );
}
