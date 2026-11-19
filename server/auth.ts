import { AppError } from '../src/lib/accountRules.js';
import { Accounts, readSessionCookie } from './accounts.js';
import { RedisStore } from './store.js';
import type { AuthIdentity } from '../src/shared/contracts.js';

export async function authenticateIdentity(cookieHeader: string | undefined, env: NodeJS.ProcessEnv): Promise<AuthIdentity | undefined> {
  const session = readSessionCookie(cookieHeader);
  if (!session) return undefined;
  const store = new RedisStore(env.UPSTASH_REDIS_REST_URL ?? '', env.UPSTASH_REDIS_REST_TOKEN ?? '');
  const identity = await new Accounts(store).sessionIdentity(session);
  if (!identity) throw new AppError(401, 'UNAUTHORIZED', '登录已失效，请重新登录。');
  return identity;
}

export async function authenticate(cookieHeader: string | undefined, env: NodeJS.ProcessEnv) { return (await authenticateIdentity(cookieHeader, env))?.userId; }

export function sameOrigin(origin: string | undefined, hostHeader: string | string[] | undefined, protoHeader: string | string[] | undefined) {
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  const suppliedProto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  if (!origin || !host) return false;
  let proto = suppliedProto;
  if (!proto) { try { const parsed = new URL(origin); proto = parsed.protocol.slice(0, -1); if (proto === 'http' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) return false; } catch { return false; } }
  return origin === `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`;
}
