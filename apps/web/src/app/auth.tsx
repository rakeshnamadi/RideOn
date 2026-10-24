import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshAccessToken, tokenStore } from '@/services/api';
import { connectSocket, disconnectSocket } from '@/services/socket';
import type { Me, SystemRole } from '@/types';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthValue {
  status: Status;
  me: Me | null;
  login: (identifier: string, password: string) => Promise<Me>;
  register: (input: Record<string, unknown>) => Promise<Me>;
  logout: () => Promise<void>;
  reload: () => Promise<Me | null>;
  hasRole: (role: SystemRole) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const qc = useQueryClient();

  const loadMe = useCallback(async () => {
    const res = await api.get<Me>('/auth/me');
    setMe(res.data);
    setStatus('authenticated');
    connectSocket();
    return res.data;
  }, []);

  const clear = useCallback(() => {
    tokenStore.set(null);
    disconnectSocket();
    setMe(null);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  useEffect(() => {
    tokenStore.onLost(clear);
    // Restore a session from the http-only refresh cookie, if there is one.
    refreshAccessToken().then((ok) => (ok ? loadMe().catch(clear) : clear()));
  }, [clear, loadMe]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      async login(identifier, password) {
        const res = await api.post<{ accessToken: string }>('/auth/login', { identifier, password });
        tokenStore.set(res.data.accessToken);
        return loadMe();
      },
      async register(input) {
        const res = await api.post<{ accessToken: string }>('/auth/register', input);
        tokenStore.set(res.data.accessToken);
        return loadMe();
      },
      async logout() {
        await api.post('/auth/logout').catch(() => undefined);
        clear();
      },
      reload: () => loadMe().catch(() => null),
      hasRole: (role) => !!me?.roles.includes(role),
    }),
    [status, me, loadMe, clear],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Where a user lands after login, based on their most operational role. */
export function homeFor(me: Me): string {
  if (me.roles.includes('SUPER_ADMIN')) return '/admin';
  if (me.roles.includes('COMMUNITY_ADMIN') && me.communities.length) return `/community/${me.communities[0]!.id}`;
  if (me.roles.includes('DRIVER')) return '/driver';
  return '/app';
}
