import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { formatCOP, formatPct, marginOnSales } from '@alpe/shared';
import { ErrorState, Loading, MarginText, PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, MoneyInput, NumberInput, PercentInput, Select } from '@/components/ui/form';
import { Switch } from '@/components/ui/misc';
import { useProfiles } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api } from '@/services/api';
import type { ProductSummary, Profile } from '@/types';

interface Matrix {
  profiles: Profile[];
  rows: { product: ProductSummary; prices: { profileId: number; pricePack: number; isOverride: boolean; marginPct: number; belowMin: boolean }[] }[];
}

interface Tier {
  id: number;
  profile_id: number | null;
  profile_name: string | null;
  basis: 'pacas' | 'estibas';
  min_qty: number;
  max_qty: number | null;
  discount_pct: number;
  active: boolean;
}

export function PriceListsPage() {
  const matrix = useQuery({ queryKey: ['price-matrix'], queryFn: () => api.get<Matrix>('/pricing/matrix') });
  const tiers = useQuery({ queryKey: ['volume-discounts'], queryFn: () => api.get<Tier[]>('/pricing/volume-discounts') });
  const [cell, setCell] = React.useState<{ product: ProductSummary; profile: Profile; price: number; isOverride: boolean } | null>(null);
  const [tier, setTier] = React.useState<Tier | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Listas de precios"
        description="Precio por paca que obtiene cada perfil de cliente y el margen resultante. Los precios especiales por cliente se configuran en la ficha de cada cliente."
      />
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Precio por paca según perfil"
            description={
              <>
                Precio del perfil = precio de lista × (1 − descuento del perfil), salvo que tenga un precio fijo. Clic en un precio para fijarlo. Los descuentos por volumen se aplican
                después en el pedido.
              </>
            }
            actions={
              <Link to="/clientes?tab=perfiles" className="text-xs text-primary hover:underline">
                Editar perfiles
              </Link>
            }
          />
          {matrix.isLoading ? (
            <Loading />
          ) : matrix.error ? (
            <div className="p-5">
              <ErrorState error={matrix.error} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-medium">Presentación</th>
                    <th className="px-3 py-2.5 text-right font-medium">Costo paca</th>
                    <th className="px-3 py-2.5 text-right font-medium">Precio de lista</th>
                    {matrix.data!.profiles.map((p) => (
                      <th key={p.id} className="px-3 py-2.5 text-right font-medium">
                        <div>{p.name}</div>
                        <div className="font-normal">−{formatPct(p.base_discount_pct, 0)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.data!.rows.map((r) => (
                    <tr key={r.product.id} className="border-t">
                      <td className="px-5 py-2.5 font-medium">{r.product.name}</td>
                      <td className="px-3 py-2.5 text-right tabular text-muted-foreground">{formatCOP(r.product.costPerPack)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="font-medium tabular">{formatCOP(r.product.listPricePack)}</div>
                        <MarginText value={r.product.marginPct} min={r.product.minMargin} target={r.product.targetMargin} />
                      </td>
                      {r.prices.map((c) => {
                        const profile = matrix.data!.profiles.find((p) => p.id === c.profileId)!;
                        return (
                          <td key={c.profileId} className="px-3 py-2.5 text-right">
                            <button
                              className="rounded px-1.5 py-0.5 text-right hover:bg-muted"
                              onClick={() => setCell({ product: r.product, profile, price: c.pricePack, isOverride: c.isOverride })}
                            >
                              <div className="flex items-center justify-end gap-1 font-medium tabular">
                                {c.isOverride && <Badge variant="info">Fijo</Badge>}
                                {formatCOP(c.pricePack)}
                              </div>
                              <MarginText value={c.marginPct} min={r.product.minMargin} target={r.product.targetMargin} />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Descuentos por volumen"
            description="Se aplica el mayor descuento que corresponda a cada línea del pedido, según pacas o estibas completas."
            actions={
              <Button size="sm" onClick={() => setTier('new')}>
                <Plus /> Agregar rango
              </Button>
            }
          />
          {tiers.isLoading ? (
            <Loading />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">Aplica a</th>
                  <th className="px-3 py-2.5 text-left font-medium">Base</th>
                  <th className="px-3 py-2.5 text-right font-medium">Rango</th>
                  <th className="px-3 py-2.5 text-right font-medium">Descuento</th>
                  <th className="px-3 py-2.5 text-left font-medium">Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tiers.data?.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="px-5 py-2.5">{t.profile_name ?? 'Todos los perfiles'}</td>
                    <td className="px-3 py-2.5 capitalize">{t.basis}</td>
                    <td className="px-3 py-2.5 text-right tabular">
                      {t.max_qty ? `${t.min_qty} – ${t.max_qty}` : `${t.min_qty} o más`} {t.basis}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular">{formatPct(t.discount_pct)}</td>
                    <td className="px-3 py-2.5">{t.active ? <Badge variant="success">Activo</Badge> : <Badge variant="neutral">Inactivo</Badge>}</td>
                    <td className="px-5 py-2 text-right">
                      <Button variant="ghost" size="icon" onClick={() => setTier(t)} aria-label="Editar">
                        <Pencil />
                      </Button>
                    </td>
                  </tr>
                ))}
                {tiers.data?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                      No hay rangos de descuento configurados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      <ProfilePriceDialog cell={cell} onClose={() => setCell(null)} />
      <TierDialog tier={tier} onClose={() => setTier(null)} />
    </>
  );
}

function ProfilePriceDialog({
  cell,
  onClose,
}: {
  cell: { product: ProductSummary; profile: Profile; price: number; isOverride: boolean } | null;
  onClose: () => void;
}) {
  const [price, setPrice] = React.useState(0);
  React.useEffect(() => setPrice(cell?.price ?? 0), [cell]);
  const save = useSubmit({
    request: (value: number | null) => api.put('/pricing/profile-prices', { profileId: cell!.profile.id, productId: cell!.product.id, pricePack: value }),
    successMessage: 'Lista de precios actualizada.',
    onSuccess: onClose,
  });
  if (!cell) return null;
  const rulePrice = Math.round(cell.product.listPricePack * (1 - cell.profile.base_discount_pct));
  const margin = marginOnSales(price, cell.product.costPerPack);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title={`${cell.product.name} · ${cell.profile.name}`}
      description={`Por regla del perfil: ${formatCOP(rulePrice)} (lista − ${formatPct(cell.profile.base_discount_pct, 0)}).`}
      footer={
        <>
          {cell.isOverride && (
            <Button variant="outline" onClick={() => save.submit(null)} disabled={save.loading}>
              Quitar precio fijo
            </Button>
          )}
          <Button onClick={() => save.submit(price)} disabled={save.loading || price <= 0}>
            Guardar precio fijo
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Precio fijo por paca para este perfil">
          <MoneyInput value={price} onChange={setPrice} />
        </Field>
        <p className="text-sm">
          Margen resultante: <MarginText value={margin} min={cell.product.minMargin} target={cell.product.targetMargin} />
        </p>
      </div>
    </Dialog>
  );
}

function TierDialog({ tier, onClose }: { tier: Tier | 'new' | null; onClose: () => void }) {
  const profiles = useProfiles();
  const [form, setForm] = React.useState({ profileId: 0, basis: 'pacas' as 'pacas' | 'estibas', minQty: 1, maxQty: 0, discountPct: 0.03, active: true });
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  React.useEffect(() => {
    if (tier && tier !== 'new') {
      setForm({ profileId: tier.profile_id ?? 0, basis: tier.basis, minQty: tier.min_qty, maxQty: tier.max_qty ?? 0, discountPct: tier.discount_pct, active: tier.active });
    } else if (tier === 'new') {
      setForm({ profileId: 0, basis: 'pacas', minQty: 1, maxQty: 0, discountPct: 0.03, active: true });
    }
  }, [tier]);
  const payload = { ...form, profileId: form.profileId || null, maxQty: form.maxQty || null };
  const save = useSubmit({
    request: () => (tier === 'new' ? api.post('/pricing/volume-discounts', payload) : api.put(`/pricing/volume-discounts/${(tier as Tier).id}`, payload)),
    successMessage: 'Descuento guardado.',
    onSuccess: onClose,
  });
  const del = useSubmit({
    request: () => api.del(`/pricing/volume-discounts/${(tier as Tier).id}`),
    successMessage: 'Rango eliminado.',
    onSuccess: () => {
      setConfirmDelete(false);
      onClose();
    },
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const error = form.maxQty && form.maxQty < form.minQty ? 'El máximo debe ser mayor o igual al mínimo' : null;
  return (
    <Dialog
      open={!!tier}
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title={tier === 'new' ? 'Nuevo rango de descuento' : 'Editar rango de descuento'}
      footer={
        <>
          {tier !== 'new' && (
            <Button variant="ghost" className="mr-auto text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Eliminar
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.submit(undefined)} disabled={save.loading || !!error || form.minQty < 1}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Aplica a" className="sm:col-span-2">
          <Select value={form.profileId} onChange={(e) => set('profileId', Number(e.target.value))}>
            <option value={0}>Todos los perfiles</option>
            {profiles.data
              ?.filter((p) => !p.is_maquila)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Base" tip="Pacas: se compara con la cantidad de pacas de la línea. Estibas: con las estibas completas.">
          <Select value={form.basis} onChange={(e) => set('basis', e.target.value as 'pacas' | 'estibas')}>
            <option value="pacas">Pacas</option>
            <option value="estibas">Estibas</option>
          </Select>
        </Field>
        <Field label="Descuento">
          <PercentInput value={form.discountPct} onChange={(v) => set('discountPct', v)} />
        </Field>
        <Field label="Desde">
          <NumberInput value={form.minQty} onChange={(v) => set('minQty', Math.round(v))} />
        </Field>
        <Field label="Hasta" hint="Vacío o 0 = sin límite" error={error}>
          <NumberInput value={form.maxQty} onChange={(v) => set('maxQty', Math.round(v))} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={form.active} onCheckedChange={(v) => set('active', v)} /> Activo
        </label>
      </div>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="¿Eliminar este rango?" destructive confirmLabel="Eliminar" onConfirm={() => del.submit(undefined)} loading={del.loading}>
        Los pedidos ya creados no cambian.
      </ConfirmDialog>
      {save.dialog}
    </Dialog>
  );
}

