import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type TokenGetter } from '../lib/api';
import type { Account, AdminData, Command, PreferenceUpdate } from '../shared/contracts';

export function useAccount(userId: string | null, getToken: TokenGetter) {
  const [state, setState] = useState<Account | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [admin, setAdmin] = useState<AdminData | null>(null);
  const generation = useRef(0);
  const currentId = useRef(userId);
  currentId.current = userId;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const reload = useCallback(async () => {
    if (!userId) return;
    const run = generation.current;
    setLoading(true);
    try {
      const value = await api<Account>('account', getToken);
      if (generation.current === run && currentId.current === userId && value.userId === userId) { setState(value); setError(''); return value; }
    } catch (cause) { if (generation.current === run) setError(cause instanceof Error ? cause.message : '账户读取失败'); }
    finally { if (generation.current === run) setLoading(false); }
  }, [userId, getToken]);
  useEffect(() => {
    generation.current++;
    setState(null); setAdmin(null); setError(''); queue.current = Promise.resolve();
    void reload();
    return () => { generation.current++; };
  }, [reload]);
  const command = useCallback((input: Command): Promise<unknown> => {
    const run = generation.current;
    const id = userId;
    const task = queue.current.catch(() => undefined).then(async () => {
      if (!id || currentId.current !== id || generation.current !== run) throw new Error('账号已切换，请重新操作。');
      const value = await api<Account | AdminData | PreferenceUpdate | { ok: boolean }>(input.action, getToken, input);
      if (currentId.current !== id || generation.current !== run) throw new Error('账号已切换，请重新操作。');
      if ('userId' in value) {
        if (value.userId === id) setState(value);
      } else if (input.action === 'preferences' && 'preferences' in value) {
        setState(current => current?.userId === id ? { ...current, preferences: value.preferences } : current);
      }
      if ('videos' in value && 'submissions' in value) setAdmin(value);
      return value;
    });
    queue.current = task;
    return task;
  }, [userId, getToken]);
  const loadAdmin = useCallback(async () => {
    const run = generation.current;
    const value = await api<AdminData>('admin', getToken);
    if (generation.current === run && currentId.current === userId) setAdmin(value);
  }, [userId, getToken]);
  return { account: state?.userId === userId ? state : null, error, loading, reload, command, admin, loadAdmin };
}
