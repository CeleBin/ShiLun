// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAccount } from './useAccount';
import type { Account } from '../shared/contracts';

const data = (id: string): Account => ({ userId: id, wheel: { revision: 0, items: ['饭'], history: [] }, favorites: [], preferences: [], interests: {}, submissions: [], feedback: [], isAdmin: false });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const getToken = async () => 'session-token';
afterEach(() => { vi.unstubAllGlobals(); });

it('does not let a late account A response overwrite account B', async () => {
  let resolveA!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveA = resolve; })).mockResolvedValueOnce(response(data('B'))));
  const { result, rerender } = renderHook(({ id }) => useAccount(id, getToken), { initialProps: { id: 'A' as string | null } });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  rerender({ id: 'B' });
  await waitFor(() => expect(result.current.account?.userId).toBe('B'));
  await act(async () => { resolveA(response(data('A'))); });
  expect(result.current.account?.userId).toBe('B');
  rerender({ id: null });
  expect(result.current.account).toBeNull();
});

it('a denied write rejects instead of showing a false save success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(data('A'))).mockResolvedValueOnce(response({ error: '请重新登录', code: 'unauthorized' }, 401)));
  const { result } = renderHook(() => useAccount('A', getToken));
  await waitFor(() => expect(result.current.account?.userId).toBe('A'));
  await act(async () => {
    await expect(result.current.command({ action: 'favorite', url: 'https://www.bilibili.com/video/BV14YTn6dEpE' })).rejects.toThrow('请重新登录');
  });
  expect(result.current.account?.favorites).toHaveLength(0);
});
