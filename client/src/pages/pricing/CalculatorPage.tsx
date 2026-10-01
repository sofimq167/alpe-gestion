import { useQuery } from '@tanstack/react-query';
import { Calculator, Factory, Info } from 'lucide-react';
import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  COMPONENT_ROLE_LABEL,
  formatCOP,
  formatNumber,
  formatPct,
  formatUnitCOP,
  marginOnSales,
  marginStatus,
  markupOnCost,
  type ComponentRole,
} from '@alpe/shared';
import { Alert, EmptyState, ErrorState, Loading, MarginStatusBadge, MarginText, PageHeader, StatCard } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field, MoneyInput, Select } from '@/components/ui/form';
import { Switch } from '@/components/ui/misc';
import { InfoTip } from '@/components/ui/tooltip';
import { useProducts } from '@/hooks/useData';
import { useSubmit } from '@/hooks/useSubmit';
import { api } from '@/services/api';
import type { ProductDetail } from '@/types';

export function MarginFormulaHelp() {
  return (
    <InfoTip>
      <strong>Margen sobre ventas</strong> = (precio − costo) ÷ precio. Es la métrica principal.
      <br />
      <strong>Precio objetivo</strong> = costo ÷ (1 − margen). Ej.: costo $10.000 y margen 20% → $10.000 ÷ 0,80 = $12.500.
      <br />
      No es costo × 1,20 ($12.000): eso sería <em>markup</em> sobre costo.
    </InfoTip>
  );
}

export function CalculatorPage() {
  const [params, setParams] = useSearchParams();
  const products = useProducts();
  const list = products.data?.products.filter((p) => p.active) ?? [];
  const productId = Number(params.get('p')) || list[0]?.id;
  const detail = useQuery({
    queryKey: ['product', productId],
    queryFn: () => api.get<ProductDetail>(`/products/${productId}`),
    enabled: !!productId,
  });
  const [blownView, setBlownView] = React.useState<boolean | null>(null);
  const [testPrice, setTestPrice] = React.useState<number | null>(null);
  React.useEffect(() => {
    setBlownView(null);
    setTestPrice(null);
  }, [productId]);

  const applyBlown = useSubmit({
    request: (useBlown: boolean) => api.put(`/products/${productId}/use-blown`, { useBlown }),
    successMessage: 'Configuración de envase actualizada. Los costos de todo el sistema se recalcularon.',
  });

  if (products.isLoading) return <Loading />;
  if (products.error) return <ErrorState error={products.error} />;
  if (list.length === 0) {
    return (
      <>
        <PageHeader title="Calculador de precios" />
        <EmptyState
          icon={<Calculator />}
          title="Aún no hay presentaciones activas"
          description="Para calcular costos y precios, primero registre los insumos y luego cree una presentación con su estructura de costos."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" asChild>
                <Link to="/precios/insumos">Ir a Insumos</Link>
              </Button>
              <Button asChild>
                <Link to="/precios/presentaciones">Crear presentación</Link>
              </Button>
            </div>
          }
        />
      </>
    );
  }

  const d = detail.data;
  const saved = d?.summary.useBlown ?? false;
  const showBlown = blownView ?? saved;
  const scenario = d ? (showBlown && d.blown ? d.blown : d.bought) : null;
  const s = d?.summary;
  const upp = s?.unitsPerPack ?? 1;
  const price = testPrice ?? s?.listPricePack ?? 0;
  const margin = scenario ? marginOnSales(price, scenario.cost.costPerPack, scenario.cost.adminPct) : 0;

  return (
    <>
      <PageHeader
        title="Calculador de precios"
        description="Cómo se construye el costo de cada presentación a partir de sus insumos, la mano de obra y la energía reales, y qué margen deja el precio de venta."
        actions={
          <div className="w-64">
            <Select value={productId ?? ''} onChange={(e) => setParams({ p: e.target.value })} aria-label="Presentación">
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      {detail.error ? (
        <ErrorState error={detail.error} />
      ) : detail.isLoading || !d || !scenario || !s ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {s.unitsPerPack} botellas por paca · {s.packsPerPallet} pacas por estiba ({formatNumber(s.unitsPerPack * s.packsPerPallet)} botellas)
            </span>
            <span>·</span>
            {d.admin.included ? (
              <Badge variant="info">Gastos administrativos incluidos: {d.admin.description}</Badge>
            ) : (
              <Badge variant="neutral">Gastos administrativos no incluidos</Badge>
            )}
            <Link to="/configuracion?tab=costos" className="text-xs text-primary hover:underline">
              Configurar
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Costo por botella" value={formatUnitCOP(scenario.cost.costPerUnit)} sub={`Envase ${showBlown ? 'soplado' : 'comprado'}`} />
            <StatCard label="Costo por paca" value={formatCOP(scenario.cost.costPerPack)} sub={`${s.unitsPerPack} botellas`} />
            <StatCard label="Costo por estiba" value={formatCOP(scenario.cost.costPerPallet)} sub={`${s.packsPerPallet} pacas`} />
            <StatCard
              label="Margen sobre ventas"
              tip={<MarginFormulaHelpText />}
              value={<MarginText value={margin} min={s.minMargin} target={s.targetMargin} />}
              sub={`Objetivo ${formatPct(s.targetMargin)} · Mínimo ${formatPct(s.minMargin)}`}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
            <Card>
              <CardHeader title="Estructura de costo" description="Cada componente se calcula como cantidad × costo del insumo ÷ botellas que cubre." />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2 text-left font-medium">Componente</th>
                      <th className="px-3 py-2 text-left font-medium">Cálculo</th>
                      <th className="px-3 py-2 text-right font-medium">Por botella</th>
                      <th className="px-3 py-2 text-right font-medium">Por paca</th>
                      <th className="px-5 py-2 text-right font-medium">% del costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenario.cost.lines.map((l) => (
                      <tr key={l.key} className="border-t">
                        <td className="px-5 py-2.5">
                          <div className="font-medium">{l.label}</div>
                          <div className="text-xs text-muted-foreground">{COMPONENT_ROLE_LABEL[l.role as ComponentRole] ?? (l.role === 'energia' ? 'Energía' : 'Mano de obra')}</div>
                        </td>
                        <td className="max-w-[280px] px-3 py-2.5 text-xs text-muted-foreground">{l.detail}</td>
                        <td className="px-3 py-2.5 text-right tabular">{formatUnitCOP(l.perUnit)}</td>
                        <td className="px-3 py-2.5 text-right tabular">{formatCOP(l.perUnit * upp)}</td>
                        <td className="px-5 py-2.5 text-right tabular text-muted-foreground">{formatPct(l.perUnit / scenario.cost.costPerUnit)}</td>
                      </tr>
                    ))}
                    {scenario.cost.adminPerUnit > 0 && (
                      <tr className="border-t">
                        <td className="px-5 py-2.5 font-medium">Gastos administrativos</td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{d.admin.description}</td>
                        <td className="px-3 py-2.5 text-right tabular">{formatUnitCOP(scenario.cost.adminPerUnit)}</td>
                        <td className="px-3 py-2.5 text-right tabular">{formatCOP(scenario.cost.adminPerUnit * upp)}</td>
                        <td className="px-5 py-2.5 text-right tabular text-muted-foreground">{formatPct(scenario.cost.adminPerUnit / scenario.cost.costPerUnit)}</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="border-t-2 bg-muted/30 font-semibold">
                    <tr>
                      <td className="px-5 py-2.5" colSpan={2}>
                        Costo total
                      </td>
                      <td className="px-3 py-2.5 text-right tabular">{formatUnitCOP(scenario.cost.costPerUnit)}</td>
                      <td className="px-3 py-2.5 text-right tabular">{formatCOP(scenario.cost.costPerPack)}</td>
                      <td className="px-5 py-2.5 text-right tabular">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {d.admin.included && d.admin.pct > 0 && (
                <p className="border-t px-5 py-3 text-xs text-muted-foreground">
                  El gasto administrativo de {formatPct(d.admin.pct)} sobre ventas se descuenta directamente del margen.
                </p>
              )}
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader title="Precio y margen" actions={<MarginFormulaHelp />} />
                <CardContent className="space-y-4">
                  <Field label="Precio por paca" hint={testPrice !== null ? 'Precio de prueba (no se guarda)' : 'Precio de lista actual. Escriba otro valor para probar.'}>
                    <MoneyInput value={price} onChange={setTestPrice} />
                  </Field>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <Row label="Precio por botella" value={formatUnitCOP(price / upp)} />
                    <Row label="Costo por paca" value={formatCOP(scenario.cost.costPerPack)} />
                    <Row label="Margen por paca" value={formatCOP(price - scenario.cost.costPerPack - price * scenario.cost.adminPct)} />
                    <Row label="Margen por botella" value={formatUnitCOP((price - scenario.cost.costPerPack - price * scenario.cost.adminPct) / upp)} />
                    <Row label="Margen sobre ventas" value={<MarginText value={margin} min={s.minMargin} target={s.targetMargin} />} />
                    <Row
                      label={
                        <span className="inline-flex items-center gap-1">
                          Markup sobre costo <InfoTip>(precio − costo) ÷ costo. Solo como referencia.</InfoTip>
                        </span>
                      }
                      value={formatPct(markupOnCost(price, scenario.cost.costPerPack))}
                    />
                  </dl>
                  <div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2">
                    <span className="text-sm">Estado</span>
                    <MarginStatusBadge status={marginStatus(margin, s.minMargin, s.targetMargin)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 border-t pt-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Precio sugerido (objetivo {formatPct(s.targetMargin)})</p>
                      <p className="text-base font-semibold tabular">{formatCOP(scenario.pricing.suggestedPricePack)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Precio mínimo (margen {formatPct(s.minMargin)})</p>
                      <p className="text-base font-semibold tabular">{formatCOP(scenario.pricing.minPricePack)}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" asChild className="w-full">
                    <Link to={`/precios/presentaciones?editar=${s.id}`}>Cambiar precio de lista</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Factory className="h-4 w-4" /> Escenario de soplado
                </span>
              }
              description="Compare comprar el envase listo contra soplarlo internamente a partir de preforma."
              actions={
                d.blown ? (
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Switch checked={showBlown} onCheckedChange={(v) => setBlownView(v)} />
                    Usar envase soplado internamente
                  </label>
                ) : null
              }
            />
            <CardContent>
              {!d.blown || !d.comparison ? (
                <p className="text-sm text-muted-foreground">
                  Esta presentación no tiene configurado el escenario de soplado.{' '}
                  <Link to={`/precios/presentaciones?editar=${s.id}`} className="text-primary hover:underline">
                    Configurarlo
                  </Link>
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Compare label="Costo por botella" a={formatUnitCOP(d.bought.cost.costPerUnit)} b={formatUnitCOP(d.blown.cost.costPerUnit)} />
                    <Compare
                      label="Margen"
                      a={<MarginText value={d.bought.pricing.marginPct} min={s.minMargin} target={s.targetMargin} />}
                      b={<MarginText value={d.blown.pricing.marginPct} min={s.minMargin} target={s.targetMargin} />}
                    />
                    <Saving label="Ahorro por botella" value={d.comparison.savingPerUnit} unit />
                    <Saving label="Ahorro por paca" value={d.comparison.savingPerPack} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Ahorro mensual estimado: </span>
                      <span className={`font-semibold tabular ${d.comparison.monthlySaving >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {formatCOP(d.comparison.monthlySaving)}
                      </span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        (según {formatNumber(d.monthlyPacks)} pacas despachadas en los últimos {d.monthlyPacksDays} días)
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Envase soplado: {d.blowConfig?.preformName} + energía {formatUnitCOP(d.blowConfig?.energyPerUnit)} + mano de obra{' '}
                      {formatUnitCOP(d.blowConfig?.laborPerUnit)} + costo operativo {formatUnitCOP(d.blowConfig?.overheadPerUnit)} · desperdicio{' '}
                      {formatPct(d.blowConfig?.wastePct ?? 0)}
                    </div>
                  </div>
                  {showBlown !== saved && (
                    <Alert tone="info" title={`Está viendo el escenario ${showBlown ? 'con soplado' : 'con envase comprado'}, que no es la configuración actual.`}>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <span>Si lo aplica, todos los costos, márgenes y pedidos nuevos usarán este escenario.</span>
                        <Button size="sm" onClick={() => applyBlown.submit(showBlown).then(() => setBlownView(null))} disabled={applyBlown.loading}>
                          {showBlown ? 'Aplicar envase soplado' : 'Volver a envase comprado'}
                        </Button>
                      </div>
                    </Alert>
                  )}
                  {showBlown === saved && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Info className="h-3.5 w-3.5" /> Configuración actual de la presentación: envase {saved ? 'soplado internamente' : 'comprado'}.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function MarginFormulaHelpText() {
  return (
    <>
      (precio − costo) ÷ precio. El precio objetivo es costo ÷ (1 − margen), no costo × (1 + margen).
    </>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular">{value}</dd>
    </div>
  );
}

function Compare({ label, a, b }: { label: string; a: React.ReactNode; b: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground">Comprado</p>
          <p className="font-semibold tabular">{a}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Soplado</p>
          <p className="font-semibold tabular">{b}</p>
        </div>
      </div>
    </div>
  );
}

function Saving({ label, value, unit }: { label: string; value: number; unit?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-2 text-lg font-semibold tabular ${value >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
        {unit ? formatUnitCOP(value) : formatCOP(value)}
      </p>
      <p className="text-[11px] text-muted-foreground">{value >= 0 ? 'Soplar es más económico' : 'Comprar es más económico'}</p>
    </div>
  );
}
