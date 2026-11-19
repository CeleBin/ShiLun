import type { Command } from '../shared/contracts';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code = '') { super(message); }
}
export type TokenGetter = () => Promise<string | null>;
export async function api<T>(action: string, getToken: TokenGetter, command?: Command, signal?: AbortSignal, params: Record<string, string> = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (command) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api/app?${new URLSearchParams({ action, ...params })}`, {
    method: command ? 'POST' : 'GET', headers, signal, credentials: 'same-origin', cache: 'no-store',
    body: command ? JSON.stringify(command) : undefined,
  });
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new ApiError('服务暂时不可用，请稍后重试。', response.status || 503); }
  if (!response.ok) {
    const error = body as { error?: string; code?: string };
    throw new ApiError(error.error || '保存失败，请稍后重试。', response.status, error.code);
  }
  return body as T;
}
