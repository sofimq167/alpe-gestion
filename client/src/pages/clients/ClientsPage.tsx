import { Pencil, Plus } from 'lucide-react';
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatCOP, formatDate, formatPct } from '@alpe/shared';
import { ErrorState, PageHeader } from '@/components/common';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { useClients, useProfiles } from '@/hooks/useData';
import type { Client, Profile } from '@/types';
import { ClientFormDialog, ProfileDialog } from './ClientDialogs';

export function ClientsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'clientes';
  return (
    <>
      <PageHeader title="Clientes" description="Clientes, condiciones comerciales y perfiles de precio." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList>
          <TabsTrigger value="clientes">Clientes</TabsTrigger>
          <TabsTrigger value="perfiles">Perfiles de cliente</TabsTrigger>
        </TabsList>
        <TabsContent value="clientes">
          <ClientsTable />
        </TabsContent>
        <TabsContent value="perfiles">
          <ProfilesManager />
        </TabsContent>
      </Tabs>
    </>
  );
}

const statusVariant = { activo: 'success', inactivo: 'neutral', bloqueado: 'danger' } as const;

function ClientsTable() {
  const { data = [], isLoading, error } = useClients();
  const profiles = useProfiles();
  const navigate = useNavigate();
  const [profileFilter, setProfileFilter] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const rows = profileFilter ? data.filter((c) => c.profile_id === profileFilter) : data;

  const columns: Column<Client>[] = [
    {
      key: 'name',
      header: 'Cliente',
      sort: (c) => c.name,
      csv: (c) => c.name,
      cell: (c) => (
        <div>
          <div className="font-medium">{c.name}</div>
          <div className="text-xs text-muted-foreground">{c.document ?? 'Sin documento'}</div>
        </div>
      ),
    },
    { key: 'doc', header: 'NIT / documento', csv: (c) => c.document, cell: () => null, className: 'hidden' },
    { key: 'profile', header: 'Perfil', sort: (c) => c.profile_name, csv: (c) => c.profile_name, cell: (c) => <Badge variant={c.is_maquila ? 'info' : 'neutral'}>{c.profile_name}</Badge> },
    {
      key: 'contact',
      header: 'Contacto',
      csv: (c) => c.contact_name,
      cell: (c) => (
        <div className="text-xs">
          <div>{c.contact_name}</div>
          <div className="text-muted-foreground">{c.phone}</div>
        </div>
      ),
    },
    { key: 'phone', header: 'Teléfono', csv: (c) => c.phone, cell: () => null, className: 'hidden' },
    { key: 'email', header: 'Correo', csv: (c) => c.email, cell: () => null, className: 'hidden' },
    { key: 'address', header: 'Dirección', csv: (c) => c.address, cell: () => null, className: 'hidden' },
    { key: 'city', header: 'Ciudad', sort: (c) => c.city, csv: (c) => c.city, cell: (c) => c.city },
    { key: 'term', header: 'Plazo', align: 'right', sort: (c) => c.payment_term_days, csv: (c) => c.payment_term_days, cell: (c) => (c.payment_term_days ? `${c.payment_term_days} días` : 'Contado') },
    { key: 'freight', header: 'Flete', csv: (c) => (c.freight_included ? 'Incluido' : 'Cobrado'), cell: (c) => <span className="text-xs">{c.freight_included ? 'Incluido' : 'Se cobra'}</span> },
    {
      key: 'balance',
      header: 'Saldo cartera',
      align: 'right',
      sort: (c) => c.balance,
      csv: (c) => c.balance,
      cell: (c) => (
        <div>
          <div className={c.balance > 0 ? 'font-medium' : 'text-muted-foreground'}>{formatCOP(c.balance)}</div>
          {c.overdue > 0 && <div className="text-xs text-red-700">Vencido {formatCOP(c.overdue)}</div>}
        </div>
      ),
    },
    { key: 'credit', header: 'Límite crédito', csv: (c) => c.credit_limit, cell: () => null, className: 'hidden' },
    { key: 'last', header: 'Último despacho', sort: (c) => c.last_dispatch, csv: (c) => c.last_dispatch, cell: (c) => <span className="text-muted-foreground">{formatDate(c.last_dispatch)}</span> },
    { key: 'status', header: 'Estado', sort: (c) => c.status, csv: (c) => c.status, cell: (c) => <Badge variant={statusVariant[c.status]}>{c.status}</Badge> },
  ];

  if (error) return <ErrorState error={error} />;
  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        loading={isLoading}
        rowKey={(c) => c.id}
        searchText={(c) => `${c.name} ${c.document ?? ''} ${c.city ?? ''} ${c.contact_name ?? ''}`}
        searchPlaceholder="Buscar por nombre, NIT, ciudad…"
        exportName="clientes"
        onRowClick={(c) => navigate(`/clientes/${c.id}`)}
        rowClassName={(c) => (c.status === 'activo' ? undefined : 'opacity-60')}
        toolbar={
          <>
            <Select value={profileFilter} onChange={(e) => setProfileFilter(Number(e.target.value))} className="w-52" aria-label="Perfil">
              <option value={0}>Todos los perfiles</option>
              {profiles.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Button onClick={() => setOpen(true)}>
              <Plus /> Nuevo cliente
            </Button>
          </>
        }
      />
      <ClientFormDialog client={null} open={open} onClose={() => setOpen(false)} onSaved={(c) => navigate(`/clientes/${c.id}`)} />
    </>
  );
}

export function ProfilesManager() {
  const { data = [] } = useProfiles();
  const [editing, setEditing] = React.useState<Profile | null>(null);
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus /> Nuevo perfil
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.map((p) => (
          <Card key={p.id} className={`p-5 ${p.active ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{p.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setEditing(p);
                  setOpen(true);
                }}
                aria-label="Editar perfil"
              >
                <Pencil />
              </Button>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Descuento base</dt>
                <dd className="font-medium tabular">{formatPct(p.base_discount_pct, 0)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Pedido mínimo</dt>
                <dd className="font-medium tabular">{p.min_order_packs} pacas</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Plazo</dt>
                <dd className="font-medium tabular">{p.payment_term_days ? `${p.payment_term_days} días` : 'Contado'}</dd>
              </div>
            </dl>
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              {p.is_maquila && <Badge variant="info">Maquila</Badge>}
              {p.clients} cliente(s)
            </div>
          </Card>
        ))}
      </div>
      <ProfileDialog profile={editing} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
