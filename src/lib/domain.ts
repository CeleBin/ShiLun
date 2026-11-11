export const STORAGE_KEY = 'shilun.wheel.v1';
export const MAX_ITEMS = 16;
export const MAX_NAME_LENGTH = 16;
export const DEFAULT_ITEMS = ['番茄炒蛋', '牛肉面', '饺子', '咖喱饭', '麻辣烫', '寿司', '小炒肉', '汉堡'];

export interface HistoryEntry { name: string; at: number }
export interface SavedState { version: 1; items: string[]; history: HistoryEntry[] }
export interface Recovery { state: SavedState; warning: string; canSave: boolean }
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
export const characters = (name: string) => Array.from(segmenter.segment(name), (part) => part.segment);
const validName = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && characters(value).length <= MAX_NAME_LENGTH;
export const defaultState = (): SavedState => ({ version: 1, items: [...DEFAULT_ITEMS], history: [] });

export function addItem(items: string[], input: string): { ok: true; items: string[] } | { ok: false; error: string } {
  const name = input.trim();
  if (!name) return { ok: false, error: '先写一个想吃的吧。' };
  if (characters(name).length > MAX_NAME_LENGTH) return { ok: false, error: '名字有点长，控制在 16 个字以内吧。' };
  if (items.includes(name)) return { ok: false, error: '这个已经在转盘里啦，换一个吧。' };
  if (items.length >= MAX_ITEMS) return { ok: false, error: '转盘装满了，先删一个再添加吧。' };
  return { ok: true, items: [...items, name] };
}

export function recoverState(raw: string | null): Recovery {
  const fallback = { state: defaultState(), warning: '', canSave: true };
  if (raw === null) return fallback;
  try {
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') throw new Error('invalid');
    const data = saved as Record<string, unknown>;
    if (data.version !== 1) return { ...fallback, warning: '这份浏览器记录来自其他版本，暂不覆盖；当前页面仍可使用。', canSave: false };
    const itemsValid = Array.isArray(data.items) && data.items.length <= MAX_ITEMS && data.items.every(validName) && new Set(data.items).size === data.items.length;
    const historyRecords: unknown[] | null = Array.isArray(data.history) ? data.history : null;
    const history: HistoryEntry[] = historyRecords ? historyRecords.filter((entry: unknown): entry is HistoryEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const item = entry as Record<string, unknown>;
      return validName(item.name) && typeof item.at === 'number' && Number.isFinite(item.at) && item.at >= 0 && item.at <= 8640000000000000;
    }).slice(0, 8) : [];
    return {
      state: { version: 1, items: itemsValid ? [...data.items as string[]] : [...DEFAULT_ITEMS], history },
      warning: !itemsValid || !historyRecords || history.length < Math.min(historyRecords.length, 8) ? '部分浏览器记录无法读取，已恢复可用内容。' : '',
      canSave: true,
    };
  } catch {
    return { ...fallback, warning: '之前的浏览器记录无法读取，已恢复默认选项。' };
  }
}

export const serializeState = (state: SavedState) => JSON.stringify(state);
export function readState(storage: Pick<Storage, 'getItem'>): Recovery {
  try { return recoverState(storage.getItem(STORAGE_KEY)); }
  catch { return { state: defaultState(), warning: '这个浏览器暂时无法记住选项，刷新后可能丢失；当前页面仍可使用。', canSave: false }; }
}
export function saveState(storage: Pick<Storage, 'setItem'>, state: SavedState): boolean {
  try { storage.setItem(STORAGE_KEY, serializeState(state)); return true; } catch { return false; }
}

export function uniformIndex(count: number, draw = () => crypto.getRandomValues(new Uint32Array(1))[0]): number {
  if (!Number.isInteger(count) || count < 1 || count > MAX_ITEMS) throw new Error('Invalid menu size');
  const limit = Math.floor(4294967296 / count) * count;
  let value: number;
  do { value = draw(); } while (value >= limit);
  return value % count;
}

const normalize = (angle: number) => ((angle % 360) + 360) % 360;
export function targetRotation(index: number, count: number, previous: number): number {
  const target = normalize(-(index + 0.5) * 360 / count);
  return previous + 360 * 5 + normalize(target - normalize(previous));
}
export function indexAtPointer(rotation: number, count: number): number {
  return Math.min(count - 1, Math.floor(normalize(-rotation) / (360 / count)));
}

export function isBilibiliUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ['www.bilibili.com', 'bilibili.com'].includes(url.hostname)
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && /^\/(?:video\/BV[1-9A-Za-z]{10}|bangumi\/play\/(?:ss|ep)\d+)\/?$/.test(url.pathname);
  } catch { return false; }
}
export function nextBatch(total: number, offset: number, size: number): number[] {
  return Array.from({ length: Math.min(total, size) }, (_, i) => (offset + i) % total);
}
