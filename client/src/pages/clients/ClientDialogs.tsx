import * as React from 'react';
import { formatCOP, formatPct } from '@alpe/shared';
import { MarginText } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, NumberInput, PercentInput, Select, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/misc';
import { useProducts, useProfiles } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api } from '@/services/api';
import type { Client, Profile } from '@/types';
import { today } from '@/utils/dates';

const emptyClient = {
  name: '',
  document: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  profileId: 0,
  paymentTermDays: 0,
  freightIncluded: true,
  freightRatePack: 0,
  creditLimit: 0,
  status: 'activo' as Client['status'],
  notes: '',
};

export function ClientFormDialog({ client, open, onClose, onSaved }: { client: Client | null; open: boolean; onClose: () => void; onSaved?: (c: any) => void }) {
  const profiles = useProfiles();
  const [form, setForm] = React.useState(emptyClient);
  React.useEffect(() => {
    if (!open) return;
    setForm(
      client
        ? {
            name: client.name,
            document: client.document ?? '',
            contactName: client.contact_name ?? '',
            phone: client.phone ?? '',
            email: client.email ?? '',
            address: client.address ?? '',
            city: client.city ?? '',
            profileId: client.profile_id,
            paymentTermDays: client.payment_term_days,
            freightIncluded: client.freight_included,
            freightRatePack: client.freight_rate_pack,
            creditLimit: client.credit_limit ?? 0,
            status: client.status,
            notes: client.notes ?? '',
          }
        : emptyClient,
    );
  }, [client, open]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const onProfile = (id: number) => {
    const p = profiles.data?.find((x) => x.id === id);
    setForm((f) => ({ ...f, profileId: id, paymentTermDays: client ? f.paymentTermDays : (p?.payment_term_days ?? f.paymentTermDays) }));
  };
  const { submit, loading } = useSubmit({
    request: () => {
      const body = { ...form, creditLimit: form.creditLimit || null };
      return client ? api.put(`/clients/${client.id}`, body) : api.post('/clients', body);
    },
    successMessage: client ? 'Cliente actualizado.' : 'Cliente creado.',
    onSuccess: (r) => {
      onSaved?.(r);
      onClose();
    },
  });
  const profile = profiles.data?.find((p) => p.id === form.profileId);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={client ? 'Editar cliente' : 'Nuevo cliente'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => submit(undefined)} disabled={loading || !form.name.trim() || !form.profileId}>
            {loading ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre o razón social" required className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="NIT / documento">
          <Input value={form.document} onChange={(e) => set('document', e.target.value)} />
        </Field>
        <Field label="Perfil" required hint={profile ? `Descuento ${formatPct(profile.base_discount_pct, 0)} · pedido mínimo ${profile.min_order_packs} pacas` : undefined}>
          <Select value={form.profileId || ''} onChange={(e) => onProfile(Number(e.target.value))}>
            <option value="">Seleccione…</option>
            {profiles.data
              ?.filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Persona de contacto">
          <Input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} />
        </Field>
        <Field label="Teléfono">
          <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Correo electrónico">
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Ciudad">
          <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Dirección" className="sm:col-span-2">
          <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Plazo de pago (días)" hint="0 = contado">
          <NumberInput value={form.paymentTermDays} onChange={(v) => set('paymentTermDays', Math.max(0, Math.round(v)))} />
        </Field>
        <Field label="Límite de crédito (opcional)" hint="0 = sin límite">
          <MoneyInput value={form.creditLimit} onChange={(v) => set('creditLimit', v)} />
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={form.freightIncluded} onCheckedChange={(v) => set('freightIncluded', v)} />
            Flete incluido en el precio
          </label>
          <p className="text-xs text-muted-foreground">
            {form.freightIncluded
              ? 'La empresa asume el flete: se suma al costo de la venta y reduce el margen.'
              : 'El flete se cobra al cliente como un valor adicional en el pedido.'}
          </p>
        </div>
        <Field label={form.freightIncluded ? 'Costo de flete por paca (asumido)' : 'Valor de flete por paca (cobrado)'}>
          <MoneyInput value={form.freightRatePack} onChange={(v) => set('freightRatePack', v)} />
        </Field>
        <Field label="Estado">
          <Select value={form.status} onChange={(e) => set('status', e.target.value as Client['status'])}>
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
            <option value="bloqueado">Bloqueado</option>
          </Select>
        </Field>
        <Field label="Observaciones" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

export interface SpecialPriceRow {
  id: number;
  product_id: number;
  product_name: string;
  price_pack: number;
  start_date: string;
  end_date: string | null;
  allow_volume_discount: boolean;
  active: boolean;
  notes: string | null;
  vigente: boolean;
  vencido: boolean;
}

export function SpecialPriceDialog({ clientId, row, open, onClose }: { clientId: number; row: SpecialPriceRow | null; open: boolean; onClose: () => void }) {
  const products = useProducts();
  const [form, setForm] = React.useState({ productId: 0, pricePack: 0, startDate: today(), endDate: '', allowVolumeDiscount: false, active: true, notes: '' });
  React.useEffect(() => {
    if (!open) return;
    setForm(
      row
        ? {
            productId: row.product_id,
            pricePack: row.price_pack,
            startDate: row.start_date,
            endDate: row.end_date ?? '',
            allowVolumeDiscount: row.allow_volume_discount,
            active: row.active,
            notes: row.notes ?? '',
          }
        : { productId: 0, pricePack: 0, startDate: today(), endDate: '', allowVolumeDiscount: false, active: true, notes: '' },
    );
  }, [row, open]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useSubmit({
    request: () => (row ? api.put(`/clients/${clientId}/special-prices/${row.id}`, form) : api.post(`/clients/${clientId}/special-prices`, form)),
    successMessage: 'Precio especial guardado.',
    onSuccess: onClose,
  });
  const del = useSubmit({ request: () => api.del(`/clients/${clientId}/special-prices/${row!.id}`), successMessage: 'Precio especial eliminado.', onSuccess: onClose });
  const product = products.data?.products.find((p) => p.id === form.productId);
  const margin = product && form.pricePack > 0 ? (form.pricePack - product.costPerPack) / form.pricePack : null;
  const dateError = form.endDate && form.endDate < form.startDate ? 'Debe ser posterior a la fecha de inicio' : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={row ? 'Editar precio especial' : 'Nuevo precio especial'}
      description="Mientras esté vigente, este precio reemplaza las reglas del perfil. Al vencer, el cliente vuelve al precio normal automáticamente."
      footer={
        <>
          {row && (
            <Button variant="ghost" className="mr-auto text-destructive" onClick={() => del.submit(undefined)} disabled={del.loading}>
              Eliminar
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.submit(undefined)} disabled={save.loading || !form.productId || form.pricePack <= 0 || !!dateError}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Presentación" required className="sm:col-span-2">
          <Select value={form.productId || ''} onChange={(e) => set('productId', Number(e.target.value))}>
            <option value="">Seleccione…</option>
            {products.data?.products
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (lista {formatCOP(p.listPricePack)})
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Precio especial por paca" required>
          <MoneyInput value={form.pricePack} onChange={(v) => set('pricePack', v)} />
        </Field>
        <Field label="Margen resultante">
          <div className="flex h-9 items-center text-sm">
            {margin !== null && product ? <MarginText value={margin} min={product.minMargin} target={product.targetMargin} /> : '—'}
          </div>
        </Field>
        <Field label="Fecha de inicio" required>
          <Input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </Field>
        <Field label="Fecha de vencimiento" hint="Vacío = sin vencimiento" error={dateError}>
          <Input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </Field>
        <label className="flex items-center gap-3 text-sm sm:col-span-2">
          <Switch checked={form.allowVolumeDiscount} onCheckedChange={(v) => set('allowVolumeDiscount', v)} />
          Permitir además descuento por volumen
        </label>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={form.active} onCheckedChange={(v) => set('active', v)} /> Activo
        </label>
        <Field label="Observaciones" className="sm:col-span-2">
          <Input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

export function ProfileDialog({ profile, open, onClose }: { profile: Profile | null; open: boolean; onClose: () => void }) {
  const [form, setForm] = React.useState({ name: '', description: '', baseDiscountPct: 0, minOrderPacks: 0, paymentTermDays: 0, isMaquila: false, active: true });
  React.useEffect(() => {
    if (!open) return;
    setForm(
      profile
        ? {
            name: profile.name,
            description: profile.description ?? '',
            baseDiscountPct: profile.base_discount_pct,
            minOrderPacks: profile.min_order_packs,
            paymentTermDays: profile.payment_term_days,
            isMaquila: profile.is_maquila,
            active: profile.active,
          }
        : { name: '', description: '', baseDiscountPct: 0, minOrderPacks: 0, paymentTermDays: 0, isMaquila: false, active: true },
    );
  }, [profile, open]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useSubmit({
    request: () => (profile ? api.put(`/pricing/profiles/${profile.id}`, form) : api.post('/pricing/profiles', form)),
    successMessage: 'Perfil guardado.',
    onSuccess: onClose,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={profile ? `Perfil: ${profile.name}` : 'Nuevo perfil de cliente'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.submit(undefined)} disabled={save.loading || !form.name.trim()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nombre" required className="sm:col-span-3">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Descuento base" tip="Se aplica sobre el precio de lista a todos los clientes del perfil.">
          <PercentInput value={form.baseDiscountPct} onChange={(v) => set('baseDiscountPct', v)} />
        </Field>
        <Field label="Pedido mínimo (pacas)">
          <NumberInput value={form.minOrderPacks} onChange={(v) => set('minOrderPacks', Math.max(0, Math.round(v)))} />
        </Field>
        <Field label="Plazo (días)">
          <NumberInput value={form.paymentTermDays} onChange={(v) => set('paymentTermDays', Math.max(0, Math.round(v)))} />
        </Field>
        <Field label="Descripción" className="sm:col-span-3">
          <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <label className="flex items-center gap-3 text-sm sm:col-span-2">
          <Switch checked={form.isMaquila} onCheckedChange={(v) => set('isMaquila', v)} /> Perfil de maquila (servicio de envasado)
        </label>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={form.active} onCheckedChange={(v) => set('active', v)} /> Activo
        </label>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">El plazo del perfil se sugiere al crear clientes nuevos; cada cliente puede tener su propio plazo.</p>
    </Dialog>
  );
}
