import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/app';
import { Service } from './service';
import type { DocumentStore } from './store';
import type { VercelRequest, VercelResponse } from '@vercel/node';
function response() { const value = { statusCode: 0, body: undefined as any, setHeader: vi.fn(), status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } }; return value; }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('API public fallback and authentication', () => {
  it('serves only static vetted public content without configured services', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', ''); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', ''); const res = response();
    await handler({ method: 'GET', query: { action: 'recommendations', exclude: '' }, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.statusCode).toBe(200); expect(res.body.fallback).toBe(true); expect(res.body.videos.every((v: any) => v.published)).toBe(true);
  });
  it('returns explicit unavailable for private data without auth config', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', ''); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', ''); const res = response();
    await handler({ method: 'GET', query: { action: 'account' }, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.statusCode).toBe(503); expect(res.body.code).toBe('AUTH_NOT_CONFIGURED');
  });
  it('rejects oversized payloads before any write', async () => {
    const res = response();
    await handler({ method: 'POST', query: {}, headers: { 'content-type': 'application/json', 'content-length': '999999' }, body: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.statusCode).toBe(413);
  });
  it('accepts only same-origin feedback from guests and keeps retries idempotent', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'secret');
    let catalog: string | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const command = JSON.parse(init.body as string);
      if (command[0] === 'GET') return Response.json({ result: catalog });
      if (command[0] === 'EVAL' && command.includes('shilun:v2:moderation')) catalog = command.at(-1);
      return Response.json({ result: 1 });
    }));
    const submit = async (body: object, origin = 'https://shilun.cbnb.online') => {
      const res = response();
      await handler({ method: 'POST', query: { action: 'feedback' }, body,
        headers: { 'content-type': 'application/json', origin, host: 'shilun.cbnb.online' },
      } as unknown as VercelRequest, res as unknown as VercelResponse);
      return res;
    };
    const body = { action: 'feedback', kind: '建议', text: '希望可以收藏菜单', operationId: 'guest-test' };
    expect((await submit(body, 'https://other.example')).statusCode).toBe(403);
    expect((await submit({ action: 'deleteAccountData' })).statusCode).toBe(401);
    expect((await submit(body)).body).toEqual({ ok: true });
    expect((await submit(body)).body).toEqual({ ok: true });
    expect(JSON.parse(catalog!).feedback).toEqual([expect.objectContaining({ userId: null, text: body.text })]);
  });
  it('returns an empty publication-safe fallback when configured Redis is offline', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'secret'); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const res = response();
    await handler({ method: 'GET', query: { action: 'recommendations' }, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.statusCode).toBe(200); expect(res.body.fallback).toBe(true); expect(res.body.videos).toEqual([]);
  });
  it('does not resurrect an unpublished seed during a later store outage', async () => {
    const docs = new Map<string, string>();
    const store: DocumentStore = { get: async key => docs.get(key) ?? null, compareAndSet: async (key, old, next) => { if ((docs.get(key) ?? null) !== old) return false; docs.set(key, next); return true; }, rateLimit: async () => true };
    const service = new Service(store, ['admin']);
    await service.command('admin', { action: 'video', id: 'chuaner', published: false, revision: 0 });
    expect((await service.admin('admin')).videos.find(v => v.id === 'chuaner')!.published).toBe(false);
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'secret'); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const res = response(); await handler({ method: 'GET', query: { action: 'recommendations' }, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.body.videos).toEqual([]);
  });
  it('uses no seeds when Redis configuration is partial or invalid', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://invalid.example'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    const res = response(); await handler({ method: 'GET', query: { action: 'recommendations' }, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res.statusCode).toBe(200); expect(res.body.videos).toEqual([]); expect(res.body.fallback).toBe(true);
  });
});
