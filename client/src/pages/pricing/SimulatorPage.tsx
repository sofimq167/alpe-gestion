import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import * as React from 'react';
import { formatCOP, formatPct, formatUnitCOP, SUPPLY_CATEGORY_LABEL, type MarginStatus, type SupplyCategory } from '@alpe/shared';
import { Alert, Loading, MarginText, PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field, MoneyInput, PercentInput, Select } from '@/components/ui/form';
import { useSupplies } from '@/hooks/useData';
import { api } from '@/services/api';

interface SimRow {
  productId: number;
  name: string;
  listPricePack: number;
  costPerPackBefore: number;
  costPerPackAfter: number;
  marginBefore: number;
  marginAfter: number;
  suggestedPricePack: number;
  minMargin: number;
  statusAfter: MarginStatus;
}

export function SimulatorPage() {
  const supplies = useSupplies();
  const costSupplies = (supplies.data ?? []).filter((s) => s.active && s.used_by > 0);
  const [costs, setCosts] = React.useState<Record<number, number>>({});
  const [laborPct, setLaborPct] = React.useState(0);
  const [energyPct, setEnergyPct] = React.useState(0);
  const [blown, setBlown] = React.useState<'actual' | 'todos' | 'ninguno'>('actual');
  const [params, setParams] = React.useState({ supplyCosts: {} as Record<number, number>, laborChangePct: 0, energyChangePct: 0, forceBlown: undefined as boolean | undefined });

  React.useEffect(() => {
    const t = setTimeout(
      () => setParams({ supplyCosts: costs, laborChangePct: laborPct, energyChangePct: energyPct, forceBlown: blown === 'actual' ? undefined : blown === 'todos' }),
      400,
    );
    return () => clearTimeout(t);
  }, [costs, laborPct, energyPct, blown]);

  const sim = useQuery({
    queryKey: ['simulate', params],
    queryFn: () => api.post<{ rows: SimRow[] }>('/products/simulate', params),
    placeholderData: (prev) => prev,
  });

  const changed = Object.keys(costs).length > 0 || laborPct !== 0 || energyPct !== 0 || blown !== 'actual';
  const reset = () => {
    setCosts({});
    setLaborPct(0);
    setEnergyPct(0);
    setBlown('actual');
  };
  const applyPctToCategory = (category: string, pct: number) => {
    const next = { ...costs };
    for (const s of costSupplies.filter((x) => x.category === category)) next[s.id] = Math.round(s.current_cost * (1 + pct) * 100) / 100;
    setCosts(next);
  };
  const categories = [...new Set(costSupplies.map((s) => s.category))];
  const below = sim.data?.rows.filter((r) => r.statusAfter === 'bajo_minimo') ?? [];

  return (
    <>
      <PageHeader
        title="Simulador de costos"
        description="Pruebe escenarios hipotéticos (aumentos de insumos, mano de obra, energía o soplado) y vea el efecto en costos y márgenes. Nada de lo que haga aquí se guarda."
        actions={
          changed && (
            <Button variant="outline" onClick={reset}>
              <RotateCcw /> Restablecer
            </Button>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Variables generales" />
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Variación mano de obra">
                  <PercentInput value={laborPct} onChange={setLaborPct} />
                </Field>
                <Field label="Variación energía">
                  <PercentInput value={energyPct} onChange={setEnergyPct} />
                </Field>
              </div>
              <Field label="Envase">
                <Select value={blown} onChange={(e) => setBlown(e.target.value as typeof blown)}>
                  <option value="actual">Configuración actual de cada presentación</option>
                  <option value="todos">Soplar internamente (donde esté configurado)</option>
                  <option value="ninguno">Comprar todos los envases</option>
                </Select>
              </Field>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Aplicar variación rápida a una categoría</p>
                <div className="flex flex-wrap gap-2">
                  {categories.map((c) => (
                    <div key={c} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                      <span>{SUPPLY_CATEGORY_LABEL[c as SupplyCategory]}</span>
                      <button className="rounded px-1 text-red-700 hover:bg-red-50" onClick={() => applyPctToCategory(c, 0.05)}>
                        +5%
                      </button>
                      <button className="rounded px-1 text-red-700 hover:bg-red-50" onClick={() => applyPctToCategory(c, 0.1)}>
                        +10%
                      </button>
                      <button className="rounded px-1 text-emerald-700 hover:bg-emerald-50" onClick={() => applyPctToCategory(c, -0.05)}>
                        −5%
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Costos de insumos" description="Modifique los valores para simular" />
            <div className="max-h-[520px] divide-y overflow-y-auto">
              {costSupplies.map((s) => {
                const value = costs[s.id] ?? s.current_cost;
                const diff = s.current_cost ? (value - s.current_cost) / s.current_cost : 0;
                return (
                  <div key={s.id} className="flex items-center gap-3 px-5 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Actual {formatUnitCOP(s.current_cost)} / {s.unit}
                        {Math.abs(diff) > 1e-9 && <span className={diff > 0 ? ' text-red-700' : ' text-emerald-700'}> ({diff > 0 ? '+' : ''}{formatPct(diff)})</span>}
                      </p>
                    </div>
                    <div className="w-32">
                      <MoneyInput
                        value={value}
                        decimals={2}
                        onChange={(v) =>
                          setCosts((c) => {
                            const next = { ...c };
                            if (Math.abs(v - s.current_cost) < 1e-9) delete next[s.id];
                            else next[s.id] = v;
                            return next;
                          })
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader title="Resultado por presentación" description="Costo por paca y margen con el precio de lista actual" />
          {sim.isLoading ? (
            <Loading />
          ) : (
            <>
              {below.length > 0 && (
                <div className="px-5 pt-4">
                  <Alert tone="danger" title={`En este escenario ${below.length} presentación(es) quedan por debajo del margen mínimo.`} />
                </div>
              )}
              <div className="overflow-x-auto p-5">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 text-left font-medium">Presentación</th>
                      <th className="py-2 text-right font-medium">Costo actual</th>
                      <th className="py-2 text-right font-medium">Costo simulado</th>
                      <th className="py-2 text-right font-medium">Margen actual</th>
                      <th className="py-2 text-right font-medium">Margen simulado</th>
                      <th className="py-2 text-right font-medium">Precio lista</th>
                      <th className="py-2 text-right font-medium">Precio sugerido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sim.data?.rows.map((r) => {
                      const delta = r.costPerPackAfter - r.costPerPackBefore;
                      return (
                        <tr key={r.productId} className="border-b last:border-0">
                          <td className="py-2.5 font-medium">{r.name}</td>
                          <td className="py-2.5 text-right tabular text-muted-foreground">{formatCOP(r.costPerPackBefore)}</td>
                          <td className="py-2.5 text-right tabular">
                            {formatCOP(r.costPerPackAfter)}
                            {Math.abs(delta) >= 1 && <div className={`text-xs ${delta > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{delta > 0 ? '+' : ''}{formatCOP(delta)}</div>}
                          </td>
                          <td className="py-2.5 text-right">
                            <MarginText value={r.marginBefore} min={r.minMargin} />
                          </td>
                          <td className="py-2.5 text-right">
                            <MarginText value={r.marginAfter} min={r.minMargin} />
                          </td>
                          <td className="py-2.5 text-right tabular">{formatCOP(r.listPricePack)}</td>
                          <td className="py-2.5 text-right font-medium tabular">{formatCOP(r.suggestedPricePack)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
