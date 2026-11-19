import { describe, expect, it } from 'vitest';
import { Accounts } from './accounts';
import type { DocumentStore } from './store';

class MemoryStore implements DocumentStore {
  values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async compareAndSet(key: string, old: string | null, next: string) { if ((this.values.get(key) ?? null) !== old) return false; this.values.set(key, next); return true; }
  async setExpiring(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
  async rateLimit() { return true; }
}

describe('first-party accounts', () => {
  it('registers, logs in case-insensitively, and stores only password hashes', async () => {
    const store = new MemoryStore(); const accounts = new Accounts(store);
    const created = await accounts.register(' CBNB ', 'a-secure-password');
    expect(created.username).toBe('CBNB');
    const userDoc = [...store.values.values()].find(value => value.includes('passwordHash')) ?? '';
    expect(userDoc).not.toContain('a-secure-password');
    expect(userDoc).toContain('scrypt$16384$8$1$');
    await expect(accounts.login('cbnb', 'a-secure-password')).resolves.toEqual(created);
    const session = await accounts.createSession(created);
    await expect(accounts.sessionIdentity(session)).resolves.toEqual(created);
    await expect(accounts.login('CBNB', 'incorrect-password')).rejects.toMatchObject({ status: 401 });
  });

  it('requires a unique username, rejects empty credentials and accepts a short password', async () => {
    const accounts = new Accounts(new MemoryStore());
    await expect(accounts.register(' ', 'x')).rejects.toMatchObject({ status: 400 });
    await expect(accounts.register('有人@这里', 'x')).rejects.toMatchObject({ status: 400 });
    await expect(accounts.register('小麦', '')).rejects.toMatchObject({ status: 400 });
    const user = await accounts.register('小麦', 'x');
    await expect(accounts.login('小麦', 'x')).resolves.toEqual(user);
    const results = await Promise.allSettled([accounts.register('Tester', 'a'), accounts.register('ＴＥＳＴＥＲ', 'b')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 409, code: 'USERNAME_EXISTS' } });
  });

  it('revokes sessions on logout and rejects expired sessions', async () => {
    const store = new MemoryStore(); const accounts = new Accounts(store);
    const user = await accounts.register('tester', 'a-secure-password');
    const session = await accounts.createSession(user, 1000);
    expect(await accounts.sessionIdentity(session, 1001)).toEqual(user);
    expect(await accounts.sessionUser(session, 1001)).toBe(user.userId);
    await accounts.revokeSession(session);
    expect(await accounts.sessionUser(session, 1002)).toBeNull();
    const expired = await accounts.createSession(user, 2000);
    expect(await accounts.sessionUser(expired, 2000 + 31 * 86400000)).toBeNull();
  });
});
