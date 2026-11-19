import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { AppError } from '../src/lib/accountRules';
import { recommend, STRATEGY } from '../src/lib/recommendation';
import { authenticateIdentity, sameOrigin } from '../server/auth';
import { RedisStore } from '../server/store';
import { getBilibiliMetadata, getBilibiliTags } from '../server/bilibili';
import { seedCatalog, Service } from '../server/service';
import { RECOMMENDATION_EXCLUDE_LENGTH, RECOMMENDATION_EXCLUDE_LIMIT } from '../src/shared/contracts';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Cookie'); res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (!['GET', 'POST'].includes(req.method ?? '')) { res.setHeader('Allow', 'GET, POST'); throw new AppError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方式。'); }
    const action = req.query.action;
    if (action !== undefined && typeof action !== 'string') throw new AppError(400, 'INVALID_INPUT', '请求参数无效。');
    const env = process.env;
    const cookie = Array.isArray(req.headers.cookie) ? req.headers.cookie.join('; ') : req.headers.cookie;
    const identity = await authenticateIdentity(cookie, env);
    const userId = identity?.userId;
    if (req.method === 'POST') {
      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.toLowerCase().startsWith('application/json')) throw new AppError(400, 'INVALID_INPUT', '请使用 JSON 提交。');
      if (Number(req.headers['content-length'] ?? 0) > 32768 || Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null)) > 32768) throw new AppError(413, 'TOO_LARGE', '提交内容过大。');
      if (!sameOrigin(req.headers.origin, req.headers['x-forwarded-host'] ?? req.headers.host, req.headers['x-forwarded-proto'])) throw new AppError(403, 'ORIGIN_FORBIDDEN', '请求来源不受信任。');
    }
    if (!userId && !(req.method === 'GET' && action === 'recommendations')) {
      if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) throw new AppError(503, 'AUTH_NOT_CONFIGURED', '账号服务尚未配置，请联系维护者。');
      throw new AppError(401, 'UNAUTHORIZED', '请先登录。');
    }
    const excludeRaw = req.query.exclude;
    if (excludeRaw !== undefined && excludeRaw !== '' && (typeof excludeRaw !== 'string' || excludeRaw.length > RECOMMENDATION_EXCLUDE_LENGTH || excludeRaw.split(',').length > RECOMMENDATION_EXCLUDE_LIMIT || !excludeRaw.split(',').every(s => /^[a-zA-Z0-9:_-]{1,100}$/.test(s)))) throw new AppError(400, 'INVALID_INPUT', '排除列表无效。');
    const exclude = typeof excludeRaw === 'string' && excludeRaw ? excludeRaw.split(',') : [];
    // Seeds are safe only before any durable content service has been configured.
    // During an outage we cannot know which seeded records have since been unpublished.
    const publicFallback = () => {
      const catalog = !env.UPSTASH_REDIS_REST_URL && !env.UPSTASH_REDIS_REST_TOKEN ? seedCatalog() : [];
      const videos = recommend(catalog, [], {}, exclude);
      return { videos, requestId: randomUUID(), strategy: STRATEGY, fallback: true, hasMore: catalog.length > videos.length };
    };
    let service: Service;
    const adminIds = (env.SHILUN_ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    try { service = new Service(new RedisStore(env.UPSTASH_REDIS_REST_URL ?? '', env.UPSTASH_REDIS_REST_TOKEN ?? ''), adminIds, getBilibiliMetadata, getBilibiliTags); }
    catch (error) { if (!userId && req.method === 'GET' && action === 'recommendations') return res.status(200).json(publicFallback()); throw error; }
    try {
      if (userId) await service.limit(userId);
      else await service.limit('public:' + (req.socket?.remoteAddress ?? 'unknown'), 120);
    } catch (error) {
      if (!userId && action === 'recommendations' && error instanceof AppError && error.status === 503) return res.status(200).json(publicFallback());
      throw error;
    }
    if (req.method === 'GET') {
      if (action === 'account') return res.status(200).json(await service.account(userId!));
      if (action === 'admin') return res.status(200).json(await service.admin(userId!));
      if (action === 'recommendations') {
        try { return res.status(200).json(await service.recommendations(userId, exclude)); }
        catch (error) { if (!userId && error instanceof AppError && error.status === 503) return res.status(200).json(publicFallback()); throw error; }
      }
      throw new AppError(400, 'INVALID_ACTION', '不支持的请求。');
    }
    let body: unknown = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw new AppError(400, 'INVALID_JSON', '提交内容无法解析。'); } }
    return res.status(200).json(await service.command(userId!, body));
  } catch (error) {
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error('ShiLun API failed', error instanceof Error ? error.name : 'unknown');
    return res.status(503).json({ error: '服务暂时不可用，请稍后重试。', code: 'UNAVAILABLE' });
  }
}
