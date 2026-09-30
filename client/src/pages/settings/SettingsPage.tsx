import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ADMIN_MODE_LABEL, ROLE_LABEL, ROLES, type Role } from '@alpe/shared';
import { Alert, Loading, PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, NumberInput, PercentInput, Select } from '@/components/ui/form';
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api } from '@/services/api';
import type { Settings } from '@/types';
import { formatDateTime } from '@/utils/dates';
import { ProfilesManager } from '../clients/ClientsPage';

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'empresa';
  const { data, isLoading } = useSettings();
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Configuración" description="Parámetros del negocio. Los cambios aplican de inmediato a costos, precios y reportes." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="empresa">Empresa</TabsTrigger>
          <TabsTrigger value="costos">Costos y gastos</TabsTrigger>
          <TabsTrigger value="produccion">Producción</TabsTrigger>
          <TabsTrigger value="operacion">Operación</TabsTrigger>
          <TabsTrigger value="perfiles">Perfiles de cliente</TabsTrigger>
          {user?.role === 'admin' && <TabsTrigger value="usuarios">Usuarios</TabsTrigger>}
          <TabsTrigger value="catalogos">Catálogos</TabsTrigger>
        </TabsList>
        {isLoading || !data ? (
          <Loading />
        ) : (
          <>
            <TabsContent value="empresa">
              <CompanyForm settings={data} />
            </TabsContent>
            <TabsContent value="costos">
              <CostsForm settings={data} />
            </TabsContent>
            <TabsContent value="produccion">
              <ProductionForm settings={data} />
            </TabsContent>
            <TabsContent value="operacion">
              <OperationsForm settings={data} />
            </TabsContent>
          </>
        )}
        <TabsContent value="perfiles">
          <ProfilesManager />
        </TabsContent>
        <TabsContent value="usuarios">
          <Users />
        </TabsContent>
        <TabsContent value="catalogos">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              ['Presentaciones', 'Unidades por paca, pacas por estiba, márgenes y estructura de costos.', '/precios/presentaciones'],
              ['Insumos', 'Costos, proveedores, historial y existencias mínimas.', '/precios/insumos'],
              ['Descuentos por volumen', 'Rangos por pacas y estibas.', '/precios/listas'],
              ['Maquila', 'Servicios y materiales aportados por clientes.', '/maquila'],
            ].map(([title, desc, to]) => (
              <Card key={to} className="p-5">
                <p className="font-semibold">{title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                <Button variant="outline" size="sm" className="mt-4" asChild>
                  <Link to={to}>Administrar</Link>
                </Button>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

function useSettingForm<K extends keyof Settings>(key: K, initial: Settings[K]) {
  const [value, setValue] = React.useState(initial);
  React.useEffect(() => setValue(initial), [initial]);
  const save = useSubmit({ request: () => api.put(`/settings/${key}`, value), successMessage: 'Configuración guardada.' });
  const set = <F extends keyof Settings[K]>(field: F, v: Settings[K][F]) => setValue((s) => ({ ...s, [field]: v }));
  return { value, set, save };
}

function SaveBar({ onSave, loading }: { onSave: () => void; loading: boolean }) {
  return (
    <div className="flex justify-end border-t px-5 py-3">
      <Button onClick={onSave} disabled={loading}>
        {loading ? 'Guardando…' : 'Guardar cambios'}
      </Button>
    </div>
  );
}

function CompanyForm({ settings }: { settings: Settings }) {
  const { value, set, save } = useSettingForm('company', settings.company);
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Datos de la empresa" />
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Razón social" required className="sm:col-span-2">
          <Input value={value.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="NIT">
          <Input value={value.nit} onChange={(e) => set('nit', e.target.value)} />
        </Field>
        <Field label="Teléfono">
          <Input value={value.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Dirección">
          <Input value={value.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Ciudad">
          <Input value={value.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Correo" className="sm:col-span-2">
          <Input value={value.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
      </CardContent>
      <SaveBar onSave={() => save.submit(undefined)} loading={save.loading} />
    </Card>
  );
}

function CostsForm({ settings }: { settings: Settings }) {
  const admin = useSettingForm('admin_expenses', settings.admin_expenses);
  const pricing = useSettingForm('pricing', settings.pricing);
  const a = admin.value;
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Gastos administrativos en el costo" description="Opcional. Si se incluyen, afectan el costo, el margen y el precio sugerido de todas las presentaciones." />
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 text-sm font-medium">
            <Switch checked={a.enabled} onCheckedChange={(v) => admin.set('enabled', v)} /> Incluir gastos administrativos en el cálculo
          </label>
          <Field label="Forma de cálculo">
            <Select value={a.mode} onChange={(e) => admin.set('mode', e.target.value as typeof a.mode)} disabled={!a.enabled}>
              {Object.entries(ADMIN_MODE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          {a.mode === 'pct_ventas' && (
            <Field label="Porcentaje sobre ventas" hint="Precio = costo ÷ (1 − margen − % administrativo)">
              <PercentInput value={a.pct} onChange={(v) => admin.set('pct', v)} disabled={!a.enabled} />
            </Field>
          )}
          {a.mode === 'por_unidad' && (
            <Field label="Costo por botella">
              <MoneyInput value={a.perUnit} onChange={(v) => admin.set('perUnit', v)} decimals={2} disabled={!a.enabled} />
            </Field>
          )}
          {a.mode === 'mensual' && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Gasto mensual" hint="Se divide entre las botellas producidas en los últimos 30 días">
                <MoneyInput value={a.monthlyAmount} onChange={(v) => admin.set('monthlyAmount', v)} disabled={!a.enabled} />
              </Field>
              <Field label="Botellas/mes si no hay producción">
                <NumberInput value={a.fallbackMonthlyUnits} onChange={(v) => admin.set('fallbackMonthlyUnits', Math.round(v))} disabled={!a.enabled} />
              </Field>
            </div>
          )}
          <Alert tone={a.enabled ? 'info' : 'warning'}>{a.enabled ? 'Los gastos administrativos están incluidos en los costos y márgenes.' : 'Actualmente los costos NO incluyen gastos administrativos.'}</Alert>
        </CardContent>
        <SaveBar onSave={() => admin.save.submit(undefined)} loading={admin.save.loading} />
      </Card>
      <Card>
        <CardHeader title="Precios" />
        <CardContent className="space-y-4">
          <Field label="Redondear precios sugeridos al múltiplo de" hint="Ej.: 100 → $15.437 se sugiere como $15.500">
            <MoneyInput value={pricing.value.roundingStep} onChange={(v) => pricing.set('roundingStep', Math.max(1, Math.round(v)))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Margen objetivo por defecto" hint="Para presentaciones nuevas">
              <PercentInput value={pricing.value.defaultTargetMargin} onChange={(v) => pricing.set('defaultTargetMargin', v)} />
            </Field>
            <Field label="Margen mínimo por defecto">
              <PercentInput value={pricing.value.defaultMinMargin} onChange={(v) => pricing.set('defaultMinMargin', v)} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">El margen objetivo y mínimo de cada presentación se edita en Precios → Presentaciones.</p>
        </CardContent>
        <SaveBar onSave={() => pricing.save.submit(undefined)} loading={pricing.save.loading} />
      </Card>
    </div>
  );
}

function ProductionForm({ settings }: { settings: Settings }) {
  const { value, set, save } = useSettingForm('production', settings.production);
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Variables de producción" description="Se usan para sugerir costos al registrar producción y para calcular la mano de obra y energía reales." />
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Costo hora de mano de obra" hint="Trabajadores × horas × este valor = costo sugerido del turno">
          <MoneyInput value={value.laborHourCost} onChange={(v) => set('laborHourCost', v)} />
        </Field>
        <Field label="Tarifa de energía (kWh)">
          <MoneyInput value={value.energyKwhCost} onChange={(v) => set('energyKwhCost', v)} decimals={2} />
        </Field>
        <Field label="Días de producción para costo real" hint="Mano de obra y energía por botella = promedio de este periodo">
          <NumberInput value={value.lookbackDays} onChange={(v) => set('lookbackDays', Math.round(v))} />
        </Field>
        <Field label="Vida útil del producto (días)" hint="Para calcular el vencimiento del lote">
          <NumberInput value={value.shelfLifeDays} onChange={(v) => set('shelfLifeDays', Math.round(v))} />
        </Field>
        <Field label="Turnos (separados por coma)" className="sm:col-span-2">
          <Input
            value={value.shifts.join(', ')}
            onChange={(e) =>
              set(
                'shifts',
                e.target.value.split(',').map((s) => s.trim()),
              )
            }
            onBlur={() => set('shifts', value.shifts.filter(Boolean))}
          />
        </Field>
      </CardContent>
      <SaveBar onSave={() => save.submit(undefined)} loading={save.loading} />
    </Card>
  );
}

function OperationsForm({ settings }: { settings: Settings }) {
  const { value, set, save } = useSettingForm('operations', settings.operations);
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Cartera e inventario" />
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Días para “Por vencer”" hint="Cuentas que vencen dentro de estos días">
          <NumberInput value={value.dueSoonDays} onChange={(v) => set('dueSoonDays', Math.round(v))} />
        </Field>
        <Field label="Diferencia relevante en conteo físico" hint="Se resaltan diferencias mayores a este porcentaje">
          <PercentInput value={value.countDiffThresholdPct} onChange={(v) => set('countDiffThresholdPct', v)} />
        </Field>
        <Field label="Días para estimar ventas mensuales" hint="Usado en el ahorro mensual estimado del soplado">
          <NumberInput value={value.monthlyPacksLookbackDays} onChange={(v) => set('monthlyPacksLookbackDays', Math.round(v))} />
        </Field>
      </CardContent>
      <SaveBar onSave={() => save.submit(undefined)} loading={save.loading} />
    </Card>
  );
}

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  last_login_at: string | null;
}

function Users() {
  const { data = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/users') });
  const [editing, setEditing] = React.useState<UserRow | 'new' | null>(null);
  if (isLoading) return <Loading />;
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          El administrador accede a todo. Los roles Ventas, Producción, Despachos y Administración limitan las secciones visibles.
        </p>
        <Button onClick={() => setEditing('new')}>
          <Plus /> Nuevo usuario
        </Button>
      </div>
      <Card>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-2 text-left font-medium">Nombre</th>
              <th className="px-3 py-2 text-left font-medium">Correo</th>
              <th className="px-3 py-2 text-left font-medium">Rol</th>
              <th className="px-3 py-2 text-left font-medium">Último ingreso</th>
              <th className="px-3 py-2 text-left font-medium">Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-5 py-2.5 font-medium">{u.name}</td>
                <td className="px-3 py-2.5">{u.email}</td>
                <td className="px-3 py-2.5">
                  <Badge variant={u.role === 'admin' ? 'default' : 'neutral'}>{ROLE_LABEL[u.role]}</Badge>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{formatDateTime(u.last_login_at)}</td>
                <td className="px-3 py-2.5">{u.active ? <Badge variant="success">Activo</Badge> : <Badge variant="neutral">Inactivo</Badge>}</td>
                <td className="px-5 py-2 text-right">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(u)} aria-label="Editar">
                    <Pencil />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <UserDialog user={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function UserDialog({ user, onClose }: { user: UserRow | 'new' | null; onClose: () => void }) {
  const [form, setForm] = React.useState({ name: '', email: '', role: 'ventas' as Role, active: true, password: '' });
  React.useEffect(() => {
    if (user && user !== 'new') setForm({ name: user.name, email: user.email, role: user.role, active: user.active, password: '' });
    else if (user === 'new') setForm({ name: '', email: '', role: 'ventas', active: true, password: '' });
  }, [user]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const isNew = user === 'new';
  const save = useSubmit({
    request: () => (isNew ? api.post('/users', form) : api.put(`/users/${(user as UserRow).id}`, form)),
    successMessage: 'Usuario guardado.',
    onSuccess: onClose,
  });
  const pwdError = form.password && form.password.length < 8 ? 'Mínimo 8 caracteres' : null;
  return (
    <Dialog
      open={!!user}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title={isNew ? 'Nuevo usuario' : 'Editar usuario'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.submit(undefined)} disabled={save.loading || !form.name || !form.email || !!pwdError || (isNew && !form.password)}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre" required>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Correo" required>
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Rol">
          <Select value={form.role} onChange={(e) => set('role', e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={isNew ? 'Contraseña' : 'Nueva contraseña (opcional)'} error={pwdError} hint={isNew ? 'Mínimo 8 caracteres' : 'Déjela vacía para no cambiarla'}>
          <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
        </Field>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={form.active} onCheckedChange={(v) => set('active', v)} /> Usuario activo
        </label>
      </div>
    </Dialog>
  );
}

