import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthIdentity } from '../shared/contracts';

export interface Identity {
  userId: string | null;
  ready: boolean;
  configured: boolean;
  displayName: string;
  username?: string;
  getToken: () => Promise<string | null>;
  login: () => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const guest: Identity = { userId: null, ready: true, configured: true, displayName: '', getToken: async () => null, login: () => undefined, logout: async () => undefined, refresh: async () => undefined };
export const IdentityContext = createContext<Identity>(guest);
export const useIdentity = () => useContext(IdentityContext);

function Bridge({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthIdentity | null>(null);
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const getToken = useCallback(async () => null, []);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth?action=me', { credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json() as { identity?: AuthIdentity | null; code?: string };
      if (!response.ok) { setSession(null); setConfigured(body.code !== 'AUTH_NOT_CONFIGURED'); return; }
      setConfigured(true); setSession(body.identity ?? null);
    } catch { setSession(null); setConfigured(false); }
    finally { setReady(true); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const logout = useCallback(async () => {
    const response = await fetch('/api/auth?action=logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('退出暂未成功，请重试。');
    setSession(null);
  }, []);
  return <IdentityContext.Provider value={{ userId: session?.userId ?? null, ready, configured, displayName: session?.username || '我的账号', username: session?.username, getToken, login: () => undefined, logout, refresh }}>{children}</IdentityContext.Provider>;
}

export function AuthRoot({ children }: { children: ReactNode }) { return <Bridge>{children}</Bridge>; }
