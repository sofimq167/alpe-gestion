import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatCOP, formatDate, formatNumber, formatPct, formatUnitCOP } from '@alpe/shared';
import { ErrorState, KeyValue, Loading, PageHeader } from '@/components/common';
import { SimpleTable } from '@/components/common/SimpleTable';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { api } from '@/services/api';

export function LotDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: lot, isLoading, error } = useQuery({ queryKey: ['lot', id], queryFn: () => api.get(`/lots/${id}`) });
  if (isLoading) return <Loading />;
  if (error || !lot) return <ErrorState error={error} />;
  const run = lot.production[0];

  return (
    <>
      <PageHeader
        back={
          <Link to="/produccion?tab=lotes" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Lotes
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            Lote {lot.code}
            {lot.is_maquila && <Badge variant="info">Maquila · {lot.client_name}</Badge>}
            {run?.status === 'anulada' && <Badge variant="neutral">Anulado</Badge>}
          </span>
        }
        description={`${lot.item_name} · producido el ${formatDate(lot.production_date)}`}
      />
      <div className="space-y-6">
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
            <KeyValue label="Producto">{lot.item_name}</KeyValue>
            <KeyValue label="Fecha de producción">{formatDate(lot.production_date)}</KeyValue>
            <KeyValue label="Vencimiento">{formatDate(lot.expiry_date)}</KeyValue>
            <KeyValue label="Pacas producidas">{formatNumber(lot.packs_produced)}</KeyValue>
            <KeyValue label="Pacas despachadas">{formatNumber(lot.packs_produced - lot.packs_remaining)}</KeyValue>
            <KeyValue label="Pacas en bodega">{formatNumber(lot.packs_remaining)}</KeyValue>
            {run && (
              <>
                <KeyValue label="Turno">{run.shift}</KeyValue>
                <KeyValue label="Responsable">{run.responsible}</KeyValue>
                <KeyValue label="Botellas buenas">{formatNumber(run.good_units)}</KeyValue>
                <KeyValue label="Rendimiento">{formatPct(run.yield_pct)}</KeyValue>
                <KeyValue label="Costo real botella">{formatUnitCOP(run.cost_per_unit)}</KeyValue>
                <KeyValue label="Costo real paca">{formatCOP(run.cost_per_pack)}</KeyValue>
              </>
            )}
          </CardContent>
        </Card>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Insumos utilizados" />
            <CardContent>
              <SimpleTable
                empty="Sin consumos registrados."
                head={['Insumo', 'Cantidad', 'Costo']}
                rows={lot.consumptions.map((c: any) => ({ key: c.id, cells: [c.supply_name, `${formatNumber(c.quantity, 2)} ${c.unit}`, formatCOP(c.total_cost)] }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Clientes que recibieron este lote" />
            <CardContent>
              <SimpleTable
                empty="Este lote aún no se ha despachado."
                head={['Cliente', 'Ciudad', 'Teléfono', 'Pacas']}
                rows={lot.clients.map((c: any) => ({ key: c.id, onClick: () => navigate(`/clientes/${c.id}`), cells: [c.name, c.city, c.phone, formatNumber(c.packs)] }))}
              />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader title="Despachos asociados" />
          <CardContent>
            <SimpleTable
              empty="Sin despachos."
              head={['Despacho', 'Remisión', 'Fecha', 'Cliente', 'Destino', 'Vehículo / conductor', 'Pacas del lote', 'Estado']}
              rows={lot.dispatches.map((d: any) => ({
                key: d.id * 100000 + d.packs,
                onClick: () => navigate(`/despachos/${d.id}`),
                cells: [
                  d.number,
                  d.remission_number,
                  formatDate(d.dispatch_date),
                  d.client_name,
                  d.destination,
                  `${d.vehicle ?? ''} ${d.driver ? `· ${d.driver}` : ''}`,
                  formatNumber(d.packs),
                  d.status === 'anulado' ? <Badge variant="neutral">Anulado</Badge> : <Badge variant="success">Confirmado</Badge>,
                ],
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
