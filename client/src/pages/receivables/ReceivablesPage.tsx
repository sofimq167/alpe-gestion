import { useQuery } from '@tanstack/react-query';
import { Banknote } from 'lucide-react';
import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { applyPayment, formatCOP, formatDate, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, RECEIVABLE_STATUS_LABEL, type ReceivableStatus } from '@alpe/shared';
import { DateRange, ErrorState, KeyValue, Loading, PageHeader, ReceivableBadge, StatCard } from '@/components/common';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, Select } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { useClients } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api, qs } from '@/services/api';
import { formatDateTime, monthStart, today } from '@/utils/dates';

interface Receivable {
  id: number;
  client_id: number;
  client_name: string;
  document_number: string;
  dispatch_id: number | null;
  dispatch_number: string | null;
  order_number: string | null;
  issue_date: string;
  due_date: string;
  original_amount: number;
  balance: number;
  paid: number;
  status: ReceivableStatus;
  days_overdue: number;
}

export function ReceivablesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'cartera';
  return (
    <>
      <PageHeader title="Cartera" description="Cuentas por cobrar generadas por los despachos. Registre pagos parciales o totales y el saldo se actualiza automáticamente." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList>
          <TabsTrigger value="cartera">Cuentas por cobrar</TabsTrigger>
          <TabsTrigger value="pagos">Pagos recibidos</TabsTrigger>
        </TabsList>
        <TabsContent value="cartera">
          <ReceivablesTable initialClient={Number(params.get('cliente')) || 0} />
        </TabsContent>
        <TabsContent value="pagos">
          <PaymentsTable />
        </TabsContent>
      </Tabs>
    </>
  );
}

function ReceivablesTable({ initialClient }: { initialClient: number }) {
  const [status, setStatus] = React.useState('pendiente');
  const [clientId, setClientId] = React.useState(initialClient);
  const [paying, setPaying] = React.useState<Receivable | null>(null);
  const [detail, setDetail] = React.useState<number | null>(null);
  const clients = useClients();
  const all = useQuery({ queryKey: ['receivables', 'all', clientId], queryFn: () => api.get<Receivable[]>(`/receivables${qs({ clientId })}`) });
  const rows = (all.data ?? []).filter((r) => (status === 'pendiente' ? r.status !== 'pagada' && r.status !== 'anulada' : status ? r.status === status : true));
  const pending = (all.data ?? []).filter((r) => r.status !== 'pagada' && r.status !== 'anulada');
  const overdue = pending.filter((r) => r.status === 'vencida');
  const soon = pending.filter((r) => r.status === 'por_vencer');
  const sum = (list: Receivable[]) => list.reduce((s, r) => s + r.balance, 0);

  const columns: Column<Receivable>[] = [
    {
      key: 'client',
      header: 'Cliente',
      sort: (r) => r.client_name,
      csv: (r) => r.client_name,
      cell: (r) => (
        <Link to={`/clientes/${r.client_id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
          {r.client_name}
        </Link>
      ),
    },
    {
      key: 'doc',
      header: 'Factura / remisión',
      sort: (r) => r.document_number,
      csv: (r) => r.document_number,
      cell: (r) => (
        <div>
          <div>{r.document_number}</div>
          <div className="text-xs text-muted-foreground">{r.order_number ? `Pedido ${r.order_number}` : r.dispatch_number}</div>
        </div>
      ),
    },
    { key: 'order', header: 'Pedido', csv: (r) => r.order_number, cell: () => null, className: 'hidden' },
    { key: 'issue', header: 'Fecha', sort: (r) => r.issue_date, csv: (r) => r.issue_date, cell: (r) => formatDate(r.issue_date) },
    { key: 'due', header: 'Vencimiento', sort: (r) => r.due_date, csv: (r) => r.due_date, cell: (r) => formatDate(r.due_date) },
    { key: 'original', header: 'Valor original', align: 'right', sort: (r) => r.original_amount, csv: (r) => r.original_amount, cell: (r) => formatCOP(r.original_amount) },
    { key: 'balance', header: 'Saldo', align: 'right', sort: (r) => r.balance, csv: (r) => r.balance, cell: (r) => <span className="font-semibold">{formatCOP(r.balance)}</span> },
    {
      key: 'days',
      header: 'Días vencidos',
      align: 'right',
      sort: (r) => r.days_overdue,
      csv: (r) => r.days_overdue,
      cell: (r) => (r.days_overdue > 0 ? <span className={r.days_overdue > 30 ? 'font-semibold text-red-700' : 'text-red-700'}>{r.days_overdue}</span> : <span className="text-muted-foreground">—</span>),
    },
    { key: 'status', header: 'Estado', sort: (r) => r.status, csv: (r) => RECEIVABLE_STATUS_LABEL[r.status], cell: (r) => <ReceivableBadge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) =>
        r.balance > 0 && r.status !== 'anulada' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setPaying(r);
            }}
          >
            <Banknote /> Registrar pago
          </Button>
        ) : null,
    },
  ];

  if (all.error) return <ErrorState error={all.error} />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Cartera pendiente" value={formatCOP(sum(pending))} sub={`${pending.length} cuentas`} onClick={() => setStatus('pendiente')} />
        <StatCard label="Cartera vencida" value={formatCOP(sum(overdue))} sub={`${overdue.length} cuentas`} tone={overdue.length ? 'danger' : 'success'} onClick={() => setStatus('vencida')} />
        <StatCard label="Por vencer" value={formatCOP(sum(soon))} sub={`${soon.length} cuentas en los próximos días`} tone={soon.length ? 'warning' : 'default'} onClick={() => setStatus('por_vencer')} />
        <StatCard label="Al día" value={formatCOP(sum(pending.filter((r) => r.status === 'al_dia')))} onClick={() => setStatus('al_dia')} />
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        loading={all.isLoading}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.client_name} ${r.document_number} ${r.order_number ?? ''} ${r.dispatch_number ?? ''}`}
        searchPlaceholder="Cliente, factura o remisión…"
        exportName="cartera"
        onRowClick={(r) => setDetail(r.id)}
        rowClassName={(r) => (r.status === 'vencida' ? 'bg-red-50/40' : undefined)}
        defaultSort={{ key: 'due', dir: 'asc' }}
        toolbar={
          <>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Estado">
              <option value="pendiente">Con saldo pendiente</option>
              <option value="">Todas</option>
              {(['vencida', 'por_vencer', 'al_dia', 'pagada', 'anulada'] as ReceivableStatus[]).map((s) => (
                <option key={s} value={s}>
                  {RECEIVABLE_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
            <Select value={clientId} onChange={(e) => setClientId(Number(e.target.value))} className="w-52" aria-label="Cliente">
              <option value={0}>Todos los clientes</option>
              {clients.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <PaymentDialog receivable={paying} onClose={() => setPaying(null)} />
      <ReceivableDetailDialog id={detail} onClose={() => setDetail(null)} onPay={(r) => setPaying(r)} />
    </div>
  );
}

export function PaymentDialog({ receivable, onClose }: { receivable: Pick<Receivable, 'id' | 'client_name' | 'document_number' | 'balance'> | null; onClose: () => void }) {
  const [form, setForm] = React.useState({ date: today(), amount: 0, method: 'transferencia', reference: '', notes: '' });
  React.useEffect(() => {
    if (receivable) setForm({ date: today(), amount: receivable.balance, method: 'transferencia', reference: '', notes: '' });
  }, [receivable]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useSubmit({
    request: () => api.post(`/receivables/${receivable!.id}/payments`, form),
    successMessage: (r: any) => (r.receivable.balance > 0 ? `Pago registrado. Nuevo saldo: ${formatCOP(r.receivable.balance)}` : 'Pago registrado. La cuenta quedó pagada.'),
    onSuccess: onClose,
  });
  if (!receivable) return null;
  let newBalance: number | null = null;
  let error: string | null = null;
  try {
    newBalance = applyPayment(receivable.balance, form.amount);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title="Registrar pago"
      description={`${receivable.client_name} · ${receivable.document_number}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.submit(undefined)} disabled={save.loading || !!error}>
            Registrar pago
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Saldo actual</span>
          <span className="font-semibold tabular">{formatCOP(receivable.balance)}</span>
        </div>
        <Field label="Valor del pago" required error={form.amount ? error : null} hint="Puede ser un pago parcial">
          <MoneyInput value={form.amount} onChange={(v) => set('amount', v)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Fecha">
            <Input type="date" value={form.date} max={today()} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Medio de pago">
            <Select value={form.method} onChange={(e) => set('method', e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Referencia" hint="Número de transferencia, consignación o recibo">
          <Input value={form.reference} onChange={(e) => set('reference', e.target.value)} />
        </Field>
        <Field label="Observaciones">
          <Input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {newBalance !== null && (
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span className="text-muted-foreground">Saldo después del pago</span>
            <span className={`font-semibold tabular ${newBalance === 0 ? 'text-emerald-700' : ''}`}>{formatCOP(newBalance)}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ReceivableDetailDialog({ id, onClose, onPay }: { id: number | null; onClose: () => void; onPay: (r: Receivable) => void }) {
  const { data: r, isLoading } = useQuery({ queryKey: ['receivable', id], queryFn: () => api.get(`/receivables/${id}`), enabled: !!id });
  return (
    <Dialog
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={r ? `Cuenta por cobrar ${r.document_number}` : 'Cuenta por cobrar'}
      footer={
        r && (
          <>
            {r.dispatch_id && (
              <Button variant="outline" asChild>
                <Link to={`/despachos/${r.dispatch_id}`}>Ver despacho</Link>
              </Button>
            )}
            {r.balance > 0 && !r.annulled && (
              <Button
                onClick={() => {
                  onPay(r);
                  onClose();
                }}
              >
                <Banknote /> Registrar pago
              </Button>
            )}
          </>
        )
      }
    >
      {isLoading || !r ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KeyValue label="Cliente">{r.client_name}</KeyValue>
            <KeyValue label="Pedido">{r.order_number ?? '—'}</KeyValue>
            <KeyValue label="Fecha">{formatDate(r.issue_date)}</KeyValue>
            <KeyValue label="Vencimiento">{formatDate(r.due_date)}</KeyValue>
            <KeyValue label="Valor original">{formatCOP(r.original_amount)}</KeyValue>
            <KeyValue label="Pagado">{formatCOP(r.original_amount - r.balance)}</KeyValue>
            <KeyValue label="Saldo">{formatCOP(r.balance)}</KeyValue>
            <KeyValue label="Estado">
              <span className="flex items-center gap-2">
                <ReceivableBadge status={r.status} />
                {r.days_overdue > 0 && <span className="text-xs text-red-700">{r.days_overdue} días</span>}
              </span>
            </KeyValue>
          </dl>
          <div>
            <p className="section-title mb-2">Pagos</p>
            {r.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin pagos registrados.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">Fecha</th>
                    <th className="py-2 text-left font-medium">Medio</th>
                    <th className="py-2 text-left font-medium">Referencia</th>
                    <th className="py-2 text-right font-medium">Valor</th>
                    <th className="py-2 pl-4 text-left font-medium">Registró</th>
                  </tr>
                </thead>
                <tbody>
                  {r.payments.map((p: any) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2">{formatDate(p.payment_date)}</td>
                      <td className="py-2">{PAYMENT_METHOD_LABEL[p.method as keyof typeof PAYMENT_METHOD_LABEL] ?? p.method}</td>
                      <td className="py-2 text-xs">{p.reference}</td>
                      <td className="py-2 text-right font-medium tabular">{formatCOP(p.amount)}</td>
                      <td className="py-2 pl-4 text-xs text-muted-foreground">
                        {p.created_by_name} · {formatDateTime(p.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function PaymentsTable() {
  const [from, setFrom] = React.useState(monthStart());
  const [to, setTo] = React.useState(today());
  const { data = [], isLoading } = useQuery({ queryKey: ['payments', from, to], queryFn: () => api.get<any[]>(`/payments${qs({ from, to })}`) });
  const total = data.reduce((s, p) => s + p.amount, 0);
  const columns: Column<any>[] = [
    { key: 'date', header: 'Fecha', sort: (p) => p.payment_date, csv: (p) => p.payment_date, cell: (p) => formatDate(p.payment_date) },
    { key: 'client', header: 'Cliente', sort: (p) => p.client_name, csv: (p) => p.client_name, cell: (p) => <span className="font-medium">{p.client_name}</span> },
    { key: 'doc', header: 'Documento', csv: (p) => p.document_number, cell: (p) => p.document_number },
    { key: 'method', header: 'Medio', csv: (p) => p.method, cell: (p) => PAYMENT_METHOD_LABEL[p.method as keyof typeof PAYMENT_METHOD_LABEL] ?? p.method },
    { key: 'ref', header: 'Referencia', csv: (p) => p.reference, cell: (p) => <span className="text-xs">{p.reference}</span> },
    { key: 'amount', header: 'Valor', align: 'right', sort: (p) => p.amount, csv: (p) => p.amount, cell: (p) => <span className="font-medium">{formatCOP(p.amount)}</span> },
  ];
  return (
    <div className="space-y-4">
      <StatCard label="Total recaudado en el periodo" value={formatCOP(total)} sub={`${data.length} pagos`} />
      <DataTable
        rows={data}
        columns={columns}
        loading={isLoading}
        rowKey={(p) => p.id}
        searchText={(p) => `${p.client_name} ${p.document_number} ${p.reference ?? ''}`}
        exportName="pagos-recibidos"
        toolbar={
          <DateRange
            from={from}
            to={to}
            onChange={(f, t) => {
              setFrom(f);
              setTo(t);
            }}
          />
        }
      />
    </div>
  );
}
