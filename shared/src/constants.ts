// Catálogos y etiquetas en español usados por servidor y aplicación.

export const ROLES = ['admin', 'ventas', 'produccion', 'despachos', 'administracion'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  ventas: 'Ventas',
  produccion: 'Producción',
  despachos: 'Despachos',
  administracion: 'Administración',
};

/** Módulos del sistema. Los permisos por rol se definen aquí para crecer luego. */
export const MODULES = [
  'dashboard',
  'precios',
  'clientes',
  'pedidos',
  'despachos',
  'inventario',
  'produccion',
  'maquila',
  'cartera',
  'finanzas',
  'configuracion',
] as const;
export type Module = (typeof MODULES)[number];

export const ROLE_PERMISSIONS: Record<Role, Module[] | '*'> = {
  admin: '*',
  ventas: ['dashboard', 'precios', 'clientes', 'pedidos', 'despachos', 'cartera'],
  produccion: ['dashboard', 'inventario', 'produccion', 'maquila'],
  despachos: ['dashboard', 'pedidos', 'despachos', 'inventario'],
  administracion: ['dashboard', 'precios', 'clientes', 'cartera', 'finanzas', 'inventario'],
};

export function canAccess(role: Role, module: Module): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return perms === '*' || perms.includes(module);
}

export const SUPPLY_CATEGORIES = [
  'preforma',
  'envase',
  'tapa',
  'etiqueta',
  'termoencogible',
  'plastico',
  'estiba',
  'agua',
  'energia',
  'mano_obra',
  'otro',
] as const;
export type SupplyCategory = (typeof SUPPLY_CATEGORIES)[number];

export const SUPPLY_CATEGORY_LABEL: Record<SupplyCategory, string> = {
  preforma: 'Preforma',
  envase: 'Envase',
  tapa: 'Tapa',
  etiqueta: 'Etiqueta',
  termoencogible: 'Termoencogible',
  plastico: 'Plástico de paca',
  estiba: 'Estiba',
  agua: 'Agua',
  energia: 'Energía',
  mano_obra: 'Mano de obra',
  otro: 'Otro',
};

export const COMPONENT_ROLES = ['envase', 'tapa', 'etiqueta', 'termoencogible', 'plastico', 'estiba', 'agua', 'otro'] as const;
export type ComponentRole = (typeof COMPONENT_ROLES)[number];

export const COMPONENT_ROLE_LABEL: Record<ComponentRole, string> = {
  envase: 'Envase',
  tapa: 'Tapa',
  etiqueta: 'Etiqueta',
  termoencogible: 'Termoencogible',
  plastico: 'Plástico de paca',
  estiba: 'Estiba',
  agua: 'Agua',
  otro: 'Otro costo variable',
};

export const UNITS = ['unidad', 'kg', 'litro', 'm3', 'kWh', 'hora', 'rollo', 'metro'] as const;

export const BASIS_LABEL = { unidad: 'por botella', paca: 'por paca', estiba: 'por estiba' } as const;

export const SUPPLY_MOVEMENT_LABEL = {
  entrada: 'Entrada',
  consumo: 'Consumo producción',
  ajuste: 'Ajuste',
  perdida: 'Pérdida / desperdicio',
  conteo: 'Inventario físico',
} as const;

export const PRODUCT_MOVEMENT_LABEL = {
  produccion: 'Producción',
  despacho: 'Despacho',
  ajuste: 'Ajuste',
  conteo: 'Inventario físico',
  perdida: 'Pérdida',
  anulacion: 'Anulación',
} as const;

export const ORDER_STATUS_LABEL = {
  confirmado: 'Confirmado',
  parcial: 'Despacho parcial',
  despachado: 'Despachado',
  cancelado: 'Cancelado',
} as const;

export const PAYMENT_METHODS = ['transferencia', 'efectivo', 'consignacion', 'cheque', 'otro'] as const;
export const PAYMENT_METHOD_LABEL: Record<(typeof PAYMENT_METHODS)[number], string> = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  consignacion: 'Consignación',
  cheque: 'Cheque',
  otro: 'Otro',
};

export const ADMIN_MODE_LABEL = {
  pct_ventas: 'Porcentaje sobre ventas',
  por_unidad: 'Costo por botella',
  mensual: 'Gasto mensual distribuido sobre la producción',
} as const;

export const EXPENSE_CATEGORIES = [
  'Nómina administrativa',
  'Arriendo',
  'Servicios públicos oficina',
  'Contabilidad',
  'Transporte',
  'Mercadeo',
  'Impuestos y seguros',
  'Mantenimiento',
  'Otros',
] as const;
