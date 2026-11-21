import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, onUnauthorized, tabSession } from './api/client';
import type { Role, User } from './api/types';
import { Landmark } from 'lucide-react';

export const homeFor = (u: User) =>
  u.role === 'officer' ? `/dept/${encodeURIComponent(u.department || '')}` : u.role === 'admin' ? '/admin' : '/home';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  register: (username: string, password: string, displayName?: string) => Promise<User>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside <AuthProvider>');
  return c;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me()
      .then(({ token, ...u }) => { if (token) tabSession.set(token); setUser(u); }) // pin this tab to its account
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    return onUnauthorized(() => setUser(null)); // session expired: guards send the user to /login
  }, []);

  // Signing in or out only affects this tab (per-tab sign-in, see api/client.ts).
  const login = useCallback(async (u: string, p: string) => { const r = await api.login(u, p); tabSession.set(r.token); setUser(r.user); return r.user; }, []);
  const register = useCallback(async (u: string, p: string, n?: string) => { const r = await api.register(u, p, n); tabSession.set(r.token); setUser(r.user); return r.user; }, []);
  const logout = useCallback(async () => { try { await api.logout(); } finally { tabSession.signOut(); setUser(null); } }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading, login, register, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function Splash() {
  return <div className="fade-in" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', color: 'var(--ink-tertiary)' }}><Landmark width={28} height={28} aria-label="Loading" /></div>;
}

/** Only renders children for a signed-in user with one of `roles`; everyone else is redirected. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}
