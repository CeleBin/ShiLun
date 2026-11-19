import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedisStore } from './store';
import { authenticate, sameOrigin } from './auth';
afterEach(() => vi.unstubAllGlobals());
describe('production configuration and Redis boundary', () => {
  it('fails closed on missing auth or storage configuration', async () => {
    expect(() => new RedisStore('', '')).toThrow();
    expect(await authenticate(undefined, {})).toBeUndefined();
    expect(await authenticate('shilun_session=legacy', {})).toBeUndefined();
    await expect(authenticate('shilun_session_v2=abc', {})).rejects.toMatchObject({ status: 503 });
    expect(sameOrigin('https://evil.example', 'shilun.cbnb.online', 'https')).toBe(false);
    expect(sameOrigin('http://127.0.0.1:5173', '127.0.0.1:5173', undefined)).toBe(true);
  });
  it('sends CAS as a single Lua operation and uses atomic expiring rate limits', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: 1 }) }); vi.stubGlobal('fetch', fetcher);
    const store = new RedisStore('https://example.upstash.io', 'secret');
    expect(await store.compareAndSet('key', null, '{"x":1}')).toBe(true);
    const command = JSON.parse(fetcher.mock.calls[0][1].body); expect(command[0]).toBe('EVAL'); expect(command.slice(-3)).toEqual(['absent', '', '{"x":1}']);
    expect(await store.rateLimit('rate', 60, 60)).toBe(true); expect(JSON.parse(fetcher.mock.calls[1][1].body)[1]).toContain('EXPIRE');
    await store.setExpiring('session', 'value', 3600); expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual(['SET', 'session', 'value', 'EX', 3600]);
    await store.delete('session'); expect(JSON.parse(fetcher.mock.calls[3][1].body)).toEqual(['DEL', 'session']);
  });
  it('accepts environment values pasted with surrounding whitespace or quotes', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: null }) });
    vi.stubGlobal('fetch', fetcher);
    const store = new RedisStore('  "https://example.upstash.io/"\r\n', " 'secret'\n");

    expect(await store.get('key')).toBeNull();
    expect(fetcher).toHaveBeenCalledWith('https://example.upstash.io/', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
    }));
    expect(() => new RedisStore('https://example.upstash.io/path', 'secret')).toThrow();
  });
  it('converts remote errors into an explicit storage unavailable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(new RedisStore('https://example.upstash.io', 'secret').get('key')).rejects.toMatchObject({ status: 503 });
  });
});
