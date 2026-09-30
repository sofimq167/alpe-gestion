// Consultas compartidas entre pantallas (con caché de react-query).
import { useQuery } from '@tanstack/react-query';
import type { ResolvedAdmin } from '@alpe/shared';
import { api } from '@/services/api';
import type { Client, MaquilaService, ProductSummary, Profile, Settings, Supply } from '@/types';

export const useProducts = () =>
  useQuery({ queryKey: ['products'], queryFn: () => api.get<{ admin: ResolvedAdmin; products: ProductSummary[] }>('/products') });

export const useSupplies = () => useQuery({ queryKey: ['supplies'], queryFn: () => api.get<Supply[]>('/supplies') });

export const useClients = () => useQuery({ queryKey: ['clients'], queryFn: () => api.get<Client[]>('/clients') });

export const useProfiles = () => useQuery({ queryKey: ['profiles'], queryFn: () => api.get<Profile[]>('/pricing/profiles') });

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });

export const useMaquilaServices = () => useQuery({ queryKey: ['maquila'], queryFn: () => api.get<MaquilaService[]>('/maquila/services') });
