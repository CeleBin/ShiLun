import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AppError } from '../src/lib/accountRules';
import { Accounts, normalizeUsername, readSessionCookie, sessionCookie } from '../server/accounts';
import { sameOrigin } from '../server/auth';
import { RedisStore } from '../server/store';

const cookies = (value: string | string[] | undefined) => Array.isArray(value) ? value.join('; ') : value;
function bodyObject(input: unknown): Record<string, unknown> {
  let body = input;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new AppError(400, 'INVALID_JSON', '提交内容无法解析。'); } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'INVALID_INPUT', '提交内容无效。');
  return body as Record<string, unknown>;
}
function getAccounts() { return new Accounts(new RedisStore(process.env.UPSTASH_REDIS_REST_URL ?? '', process.env.UPSTASH_REDIS_REST_TOKEN ?? '')); }
function setSession(res: VercelResponse, session: string | null) { res.setHeader('Set-Cookie', sessionCookie(session, process.env.NODE_ENV === 'production')); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const action = req.query.action;
    if (req.method === 'GET' && action === 'me') {
      const accounts = getAccounts();
      const identity = await accounts.sessionIdentity(readSessionCookie(cookies(req.headers.cookie)));
      return res.status(200).json({ identity });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); throw new AppError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方式。'); }
    if (!sameOrigin(req.headers.origin, req.headers['x-forwarded-host'] ?? req.headers.host, req.headers['x-forwarded-proto'])) throw new AppError(403, 'ORIGIN_FORBIDDEN', '请求来源不受信任。');
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new AppError(400, 'INVALID_INPUT', '请使用 JSON 提交。');
    if (Number(req.headers['content-length'] ?? 0) > 4096 || Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null)) > 4096) throw new AppError(413, 'TOO_LARGE', '提交内容过大。');
    const accounts = getAccounts(); const body = bodyObject(req.body);
    if (action === 'logout') {
      await accounts.revokeSession(readSessionCookie(cookies(req.headers.cookie)));
      setSession(res, null);
      return res.status(200).json({ ok: true });
    }
    if (action !== 'register' && action !== 'login') throw new AppError(400, 'INVALID_ACTION', '不支持的请求。');
    // Vercel overwrites its own forwarded IP header; never trust arbitrary X-Forwarded-For from callers.
    const host = req.headers['x-vercel-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown';
    const username = normalizeUsername(body.username);
    const ip = String(host).split(',')[0].trim();
    if (!await accounts.allowAttempt(`ip:${ip}`, 40) || !await accounts.allowAttempt(`username:${username.toLowerCase()}`, 12)) throw new AppError(429, 'RATE_LIMIT', '尝试次数过多，请 15 分钟后再试。');
    const identity = action === 'register'
      ? await accounts.register(username, body.password)
      : await accounts.login(username, body.password);
    const session = await accounts.createSession(identity);
    setSession(res, session);
    return res.status(action === 'register' ? 201 : 200).json({ identity });
  } catch (error) {
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error('ShiLun auth failed', error instanceof Error ? error.name : 'unknown');
    return res.status(503).json({ error: '账号服务暂时不可用，请稍后重试。', code: 'UNAVAILABLE' });
  }
}
