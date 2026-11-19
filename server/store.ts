import { AppError } from '../src/lib/accountRules.js';
export interface DocumentStore { get(key: string): Promise<string | null>; compareAndSet(key: string, previous: string | null, next: string): Promise<boolean>; setExpiring?(key: string, value: string, seconds: number): Promise<void>; delete?(key: string): Promise<void>; rateLimit(key: string, limit: number, seconds: number): Promise<boolean> }
const unavailable = () => new AppError(503, 'STORAGE_UNAVAILABLE', '账户存储暂不可用，请稍后重试。');
export class RedisStore implements DocumentStore {
  constructor(private url: string, private token: string) { if (!url || !token || !/^https:\/\/[a-zA-Z0-9.-]+\.upstash\.io\/?$/.test(url)) throw unavailable(); }
  private async command(args: unknown[]): Promise<unknown> {
    try { const response = await fetch(this.url, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(5000) }); if (!response.ok) throw unavailable(); const body = await response.json() as { result?: unknown; error?: string }; if (body.error || !('result' in body)) throw unavailable(); return body.result; } catch { throw unavailable(); }
  }
  async get(key: string) { const value = await this.command(['GET', key]); if (value !== null && typeof value !== 'string') throw unavailable(); return value as string | null; }
  async compareAndSet(key: string, previous: string | null, next: string) {
    return await this.command(['EVAL', "local old=redis.call('GET',KEYS[1]); if (ARGV[1]=='absent' and not old) or (ARGV[1]=='present' and old==ARGV[2]) then redis.call('SET',KEYS[1],ARGV[3]); return 1 end; return 0", 1, key, previous === null ? 'absent' : 'present', previous ?? '', next]) === 1;
  }
  async setExpiring(key: string, value: string, seconds: number) { await this.command(['SET', key, value, 'EX', seconds]); }
  async delete(key: string) { await this.command(['DEL', key]); }
  async rateLimit(key: string, limit: number, seconds: number) { const count = await this.command(['EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, key, seconds]); if (typeof count !== 'number') throw unavailable(); return count <= limit; }
}
