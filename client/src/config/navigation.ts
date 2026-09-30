import {
  Boxes,
  Calculator,
  ClipboardList,
  Factory,
  Handshake,
  LayoutDashboard,
  Receipt,
  Settings,
  TrendingUp,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Module } from '@alpe/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  module: Module;
  children?: { label: string; to: string }[];
}

export const NAVIGATION: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, module: 'dashboard' },
  {
    label: 'Precios',
    to: '/precios',
    icon: Calculator,
    module: 'precios',
    children: [
      { label: 'Insumos y costos', to: '/precios/insumos' },
      { label: 'Calculador general', to: '/precios/calculador' },
      { label: 'Presentaciones', to: '/precios/presentaciones' },
      { label: 'Listas de precios', to: '/precios/listas' },
      { label: 'Simulador de costos', to: '/precios/simulador' },
    ],
  },
  { label: 'Clientes', to: '/clientes', icon: Users, module: 'clientes' },
  { label: 'Pedidos', to: '/pedidos', icon: ClipboardList, module: 'pedidos' },
  { label: 'Despachos', to: '/despachos', icon: Truck, module: 'despachos' },
  { label: 'Inventario', to: '/inventario', icon: Boxes, module: 'inventario' },
  { label: 'Producción', to: '/produccion', icon: Factory, module: 'produccion' },
  { label: 'Maquila', to: '/maquila', icon: Handshake, module: 'maquila' },
  { label: 'Cartera', to: '/cartera', icon: Receipt, module: 'cartera' },
  { label: 'Finanzas', to: '/finanzas', icon: TrendingUp, module: 'finanzas' },
  { label: 'Configuración', to: '/configuracion', icon: Settings, module: 'configuracion' },
];

