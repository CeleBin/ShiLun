import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { AppError } from '../src/lib/accountRules.js';
import { USERNAME_MAX_LENGTH, type AuthIdentity } from '../src/shared/contracts.js';
import type { DocumentStore } from './store.js';

const deriveKey = (password: string, salt: string, length: number) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, length, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
const PREFIX = 'shilun:auth:v2:';
const SESSION_COOKIE_NAME = 'shilun_session_v2';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type User = AuthIdentity & { passwordHash: string };

function publicIdentity({ userId, username }: AuthIdentity): AuthIdentity {
  return { userId, username };
}

export function normalizeUsername(value: unknown) {
  const username = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (!username) throw new AppError(400, 'INVALID_INPUT', '请输入用户名。');
  if (username.length > USERNAME_MAX_LENGTH || !/^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]*$/u.test(username)) {
    throw new AppError(400, 'INVALID_INPUT', `用户名最多 ${USERNAME_MAX_LENGTH} 个字符，以文字或数字开头，可包含下划线和连字符。`);
  }
  return username;
}

export class Accounts {
  constructor(private store: DocumentStore) {}

  private requireSessionStorage() {
    if (!this.store.setExpiring || !this.store.delete) throw new AppError(503, 'AUTH_NOT_CONFIGURED', '账号服务暂不可用，请检查数据存储配置。');
  }

  private async hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
    const key = await deriveKey(password, salt, 64);
    return `scrypt$16384$8$1$${salt}$${key.toString('hex')}`;
  }

  private async verifyPassword(password: string, encoded: string) {
    const [, n, r, p, salt, hash] = encoded.split('$');
    if (n !== '16384' || r !== '8' || p !== '1' || !/^[a-f\d]{32}$/.test(salt ?? '') || !/^[a-f\d]{128}$/.test(hash ?? '')) return false;
    const expected = Buffer.from(hash, 'hex');
    const actual = await deriveKey(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  }

  private validatePassword(value: unknown) {
    if (typeof value !== 'string' || value.length === 0) throw new AppError(400, 'INVALID_INPUT', '请输入密码。');
    return value;
  }

  private usernameKey(username: string) { return PREFIX + 'username:' + digest(username.toLowerCase()); }
  private sessionKey(session: string) { return PREFIX + 'session:' + digest(session); }

  async register(usernameValue: unknown, passwordValue: unknown) {
    const username = normalizeUsername(usernameValue);
    const password = this.validatePassword(passwordValue);
    const user: User = { userId: randomUUID(), username, passwordHash: await this.hashPassword(password) };
    if (!await this.store.compareAndSet(this.usernameKey(username), null, JSON.stringify(user))) {
      throw new AppError(409, 'USERNAME_EXISTS', '这个用户名已被使用，请换一个。');
    }
    return publicIdentity(user);
  }

  async login(usernameValue: unknown, passwordValue: unknown) {
    const username = normalizeUsername(usernameValue);
    const password = this.validatePassword(passwordValue);
    const raw = await this.store.get(this.usernameKey(username));
    let user: User | null = null;
    try { if (raw) user = JSON.parse(raw) as User; } catch { throw new AppError(503, 'CORRUPT_STORAGE', '账号记录暂时无法读取。'); }
    if (!user || !(await this.verifyPassword(password, user.passwordHash))) throw new AppError(401, 'INVALID_CREDENTIALS', '用户名或密码不正确。');
    return publicIdentity(user);
  }

  async createSession(identity: AuthIdentity, now = Date.now()) {
    this.requireSessionStorage();
    const session = randomBytes(32).toString('base64url');
    const record = JSON.stringify({ ...publicIdentity(identity), expiresAt: now + SESSION_SECONDS * 1000 });
    await this.store.setExpiring!(this.sessionKey(session), record, SESSION_SECONDS);
    return session;
  }

  async sessionIdentity(session: string | undefined, now = Date.now()): Promise<AuthIdentity | null> {
    if (!session || !/^[A-Za-z0-9_-]{40,50}$/.test(session)) return null;
    this.requireSessionStorage();
    const raw = await this.store.get(this.sessionKey(session));
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as { userId?: unknown; username?: unknown; expiresAt?: unknown };
      if (typeof value.userId !== 'string' || typeof value.username !== 'string' || !value.username || typeof value.expiresAt !== 'number' || value.expiresAt <= now) return null;
      return { userId: value.userId, username: value.username };
    }
    catch { throw new AppError(503, 'CORRUPT_STORAGE', '登录状态暂时无法读取。'); }
  }

  async sessionUser(session: string | undefined, now = Date.now()) { return (await this.sessionIdentity(session, now))?.userId ?? null; }

  async revokeSession(session: string | undefined) {
    if (!session || !/^[A-Za-z0-9_-]{40,50}$/.test(session)) return;
    this.requireSessionStorage();
    await this.store.delete!(this.sessionKey(session));
  }

  async allowAttempt(subject: string, limit = 12) { return this.store.rateLimit(PREFIX + 'attempt:' + digest(subject), limit, 900); }
}

export function sessionCookie(session: string | null, production: boolean) {
  return `${SESSION_COOKIE_NAME}=${session ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${session ? SESSION_SECONDS : 0}${production ? '; Secure' : ''}`;
}

export function readSessionCookie(cookie: string | undefined) {
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE_NAME) return value.join('=') || undefined;
  }
  return undefined;
}
