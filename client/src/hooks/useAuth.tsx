import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { canAccess, type Module, type Role } from '@alpe/shared';
import { api } from '@/services/api';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (module: Module) => boolean;
}

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    api
      .get<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    const onExpired = () => {
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener('alpe:session-expired', onExpired);
    return () => window.removeEventListener('alpe:session-expired', onExpired);
  }, [queryClient]);

  const value: AuthState = {
    user,
    loading,
    login: async (email, password) => {
      const r = await api.post<{ user: User }>('/auth/login', { email, password });
      setUser(r.user);
    },
    logout: async () => {
      await api.post('/auth/logout').catch(() => undefined);
      queryClient.clear();
      setUser(null);
    },
    can: (module) => !!user && canAccess(user.role, module),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
