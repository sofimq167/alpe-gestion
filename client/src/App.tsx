import { Navigate, Route, Routes } from 'react-router-dom';
import type { Module } from '@alpe/shared';
import { Loading } from '@/components/common';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/hooks/useAuth';
import { ClientDetailPage } from '@/pages/clients/ClientDetailPage';
import { ClientsPage } from '@/pages/clients/ClientsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DispatchDetailPage } from '@/pages/dispatches/DispatchDetailPage';
import { DispatchesPage } from '@/pages/dispatches/DispatchesPage';
import { NewDispatchPage } from '@/pages/dispatches/NewDispatchPage';
import { FinancePage } from '@/pages/finance/FinancePage';
import { InventoryPage } from '@/pages/inventory/InventoryPage';
import { LoginPage } from '@/pages/LoginPage';
import { MaquilaPage } from '@/pages/maquila/MaquilaPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { NewOrderPage } from '@/pages/orders/NewOrderPage';
import { OrderDetailPage } from '@/pages/orders/OrderDetailPage';
import { OrdersPage } from '@/pages/orders/OrdersPage';
import { CalculatorPage } from '@/pages/pricing/CalculatorPage';
import { PriceListsPage } from '@/pages/pricing/PriceListsPage';
import { ProductsPage } from '@/pages/pricing/ProductsPage';
import { SimulatorPage } from '@/pages/pricing/SimulatorPage';
import { SuppliesPage } from '@/pages/pricing/SuppliesPage';
import { LotDetailPage } from '@/pages/production/LotDetailPage';
import { NewProductionPage } from '@/pages/production/NewProductionPage';
import { ProductionPage } from '@/pages/production/ProductionPage';
import { ReceivablesPage } from '@/pages/receivables/ReceivablesPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';

function Guard({ module, children }: { module: Module; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(module)) {
    return <p className="text-sm text-muted-foreground">No tiene permisos para acceder a esta sección.</p>;
  }
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Iniciando…" />;
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="precios" element={<Navigate to="/precios/calculador" replace />} />
        <Route path="precios/insumos" element={<Guard module="precios"><SuppliesPage /></Guard>} />
        <Route path="precios/calculador" element={<Guard module="precios"><CalculatorPage /></Guard>} />
        <Route path="precios/presentaciones" element={<Guard module="precios"><ProductsPage /></Guard>} />
        <Route path="precios/listas" element={<Guard module="precios"><PriceListsPage /></Guard>} />
        <Route path="precios/simulador" element={<Guard module="precios"><SimulatorPage /></Guard>} />
        <Route path="clientes" element={<Guard module="clientes"><ClientsPage /></Guard>} />
        <Route path="clientes/:id" element={<Guard module="clientes"><ClientDetailPage /></Guard>} />
        <Route path="pedidos" element={<Guard module="pedidos"><OrdersPage /></Guard>} />
        <Route path="pedidos/nuevo" element={<Guard module="pedidos"><NewOrderPage /></Guard>} />
        <Route path="pedidos/:id" element={<Guard module="pedidos"><OrderDetailPage /></Guard>} />
        <Route path="despachos" element={<Guard module="despachos"><DispatchesPage /></Guard>} />
        <Route path="despachos/nuevo" element={<Guard module="despachos"><NewDispatchPage /></Guard>} />
        <Route path="despachos/:id" element={<Guard module="despachos"><DispatchDetailPage /></Guard>} />
        <Route path="inventario" element={<Guard module="inventario"><InventoryPage /></Guard>} />
        <Route path="produccion" element={<Guard module="produccion"><ProductionPage /></Guard>} />
        <Route path="produccion/nueva" element={<Guard module="produccion"><NewProductionPage /></Guard>} />
        <Route path="produccion/lotes/:id" element={<Guard module="produccion"><LotDetailPage /></Guard>} />
        <Route path="maquila" element={<Guard module="maquila"><MaquilaPage /></Guard>} />
        <Route path="cartera" element={<Guard module="cartera"><ReceivablesPage /></Guard>} />
        <Route path="finanzas" element={<Guard module="finanzas"><FinancePage /></Guard>} />
        <Route path="configuracion" element={<Guard module="configuracion"><SettingsPage /></Guard>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
