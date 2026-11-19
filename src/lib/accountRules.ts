import { characters } from './domain.js';
import { normalizePreferenceTag, PREFERENCE_OPTIONS } from '../shared/contracts.js';
import type { Command } from '../shared/contracts.js';
export class AppError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export const invalid = (message = '提交的数据不符合要求。'): never => { throw new AppError(400, 'INVALID_INPUT', message); };
export function normalizeVideoUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !['www.bilibili.com', 'bilibili.com'].includes(url.hostname) || url.username || url.password || url.port) return invalid('仅支持 B 站完整视频或番剧链接，不支持短链。');
    const match = /^\/(video\/(BV[1-9A-Za-z]{10})|bangumi\/play\/((?:ss|ep)[1-9]\d{0,14}))\/?$/.exec(url.pathname);
    if (!match) return invalid('无法识别视频链接。');
    return { key: `bilibili:${match[2] ?? match[3]}`, url: `https://www.bilibili.com/${match[1]}` };
  } catch (e) { if (e instanceof AppError) throw e; return invalid('无法识别视频链接。'); }
}
const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) return invalid(); return v as Record<string, unknown>; };
const text = (v: unknown, max: number, empty = false) => { if (typeof v !== 'string' || v.trim() !== v || (!empty && !v) || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) invalid(); };
const id = (v: unknown) => { text(v, 100); if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(v as string)) invalid(); };
const tags = (v: unknown) => { if (!Array.isArray(v) || v.length > PREFERENCE_OPTIONS.length || new Set(v).size !== v.length || !v.every(t => typeof t === 'string' && PREFERENCE_OPTIONS.includes(normalizePreferenceTag(t)))) invalid(); };
function keys(v: Record<string, unknown>, allowed: string[]) { if (Object.keys(v).some(k => !allowed.includes(k))) invalid('包含不支持的字段。'); }
function menu(v: unknown) { if (!Array.isArray(v) || v.length > 16 || new Set(v).size !== v.length) invalid(); for (const name of v as unknown[]) { text(name, 256); if (characters(name as string).length > 16) invalid(); } }
export function validateCommand(raw: unknown): Command {
  const c = obj(raw); const optional = (key: string, check: (v: unknown) => void) => { if (c[key] !== undefined) check(c[key]); };
  switch (c.action) {
    case 'favorite': keys(c, ['action', 'url', 'title', 'remove']); text(c.url, 2000); normalizeVideoUrl(c.url as string); optional('title', v => text(v, 160, true)); optional('remove', v => { if (typeof v !== 'boolean') invalid(); }); break;
    case 'preferences': keys(c, ['action', 'tags']); tags(c.tags); break;
    case 'interest': keys(c, ['action', 'videoId', 'value', 'eventId', 'requestId']); id(c.videoId); optional('eventId', id); optional('requestId', id); if (c.requestId !== undefined && c.eventId === undefined) invalid('推荐兴趣事件需要重试标识。'); if (![null, 'like', 'hide'].includes(c.value as never)) invalid(); break;
    case 'wheel': {
      keys(c, ['action', 'wheel', 'revision']); if (!Number.isSafeInteger(c.revision) || (c.revision as number) < 0) invalid();
      const w = obj(c.wheel); keys(w, ['items', 'history']); menu(w.items);
      if (!Array.isArray(w.history) || w.history.length > 8) invalid();
      const seen = new Set();
      for (const entry of w.history as unknown[]) { const d = obj(entry); keys(d, ['id', 'name', 'at', 'items']); id(d.id); if (seen.has(d.id)) invalid(); seen.add(d.id); text(d.name, 256); if (characters(d.name as string).length > 16 || !Number.isSafeInteger(d.at) || (d.at as number) < 0 || (d.at as number) > Date.now() + 300000) invalid(); if (d.items !== undefined) { menu(d.items); if (!(d.items as string[]).includes(d.name as string)) invalid(); } }
      break;
    }
    case 'submit': keys(c, ['action', 'url', 'reason', 'operationId']); text(c.url, 2000); normalizeVideoUrl(c.url as string); text(c.reason, 1000); id(c.operationId); break;
    case 'feedback': keys(c, ['action', 'kind', 'text', 'videoId', 'operationId']); if (!['问题', '建议', '功能', '视频失效'].includes(c.kind as string)) invalid(); text(c.text, 2000); optional('videoId', id); id(c.operationId); break;
    case 'review': {
      keys(c, ['action', 'id', 'decision', 'reply', 'video']); id(c.id); if (!['approved', 'rejected'].includes(c.decision as string)) invalid(); text(c.reply, 1000);
      if (c.decision === 'approved') { const v = obj(c.video); keys(v, ['title', 'author', 'tags', 'reason']); text(v.title, 160); text(v.author, 120); text(v.reason, 1000); tags(v.tags); } else if (c.video !== undefined) invalid(); break;
    }
    case 'video': keys(c, ['action', 'id', 'published', 'title', 'author', 'reason', 'tags', 'revision']); id(c.id); if (typeof c.published !== 'boolean' || !Number.isSafeInteger(c.revision) || (c.revision as number) < 0) invalid(); optional('title', v => text(v, 160)); optional('author', v => text(v, 120)); optional('reason', v => text(v, 1000)); optional('tags', tags); break;
    case 'createVideo': keys(c, ['action', 'url', 'title', 'author', 'reason', 'tags', 'operationId']); text(c.url, 2000); normalizeVideoUrl(c.url as string); text(c.title, 160); text(c.author, 120); text(c.reason, 1000); tags(c.tags); id(c.operationId); break;
    case 'deleteAccountData': keys(c, ['action']); break;
    case 'handleFeedback': keys(c, ['action', 'id', 'status', 'reply']); id(c.id); if (!['open', 'processing', 'resolved'].includes(c.status as string)) invalid(); text(c.reply, 1000); break;
    case 'event': keys(c, ['action', 'eventId', 'requestId', 'videoId', 'kind']); id(c.eventId); id(c.requestId); optional('videoId', id); if (!['impression', 'click', 'next'].includes(c.kind as string) || (c.kind !== 'next' && c.videoId === undefined)) invalid(); break;
    default: invalid('不支持的操作。');
  }
  return c as unknown as Command;
}
