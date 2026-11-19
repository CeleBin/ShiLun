import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sameOrigin } from '../server/auth.js';
import { findNearbyFood, validCoordinates } from '../server/nearbyFood.js';
import { AppError } from '../src/lib/accountRules.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '不支持的请求方式。' });
  }
  if (!sameOrigin(req.headers.origin, req.headers['x-forwarded-host'] ?? req.headers.host, req.headers['x-forwarded-proto'])) {
    return res.status(403).json({ error: '请求来源不受信任。' });
  }
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    return res.status(400).json({ error: '请使用 JSON 提交坐标。' });
  }
  let body: unknown = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!validCoordinates(body)) return res.status(400).json({ error: '定位坐标无效。' });
  const key = process.env.AMAP_WEB_SERVICE_KEY?.trim();
  if (!key) return res.status(503).json({ error: '附近餐饮服务尚未配置。' });

  try {
    return res.status(200).json(await findNearbyFood(body, key));
  } catch (error) {
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message, code: error.code });
    return res.status(503).json({ error: '附近餐饮暂时查不到，请稍后再试。' });
  }
}
