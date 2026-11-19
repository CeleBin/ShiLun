import { addItem, type SavedState } from './domain';
import type { Draw, WheelData } from '../shared/contracts';

export function sameWheel(a: Pick<WheelData, 'items' | 'history'>, b: Pick<WheelData, 'items' | 'history'>) {
  return JSON.stringify({ items: a.items, history: a.history }) === JSON.stringify({ items: b.items, history: b.history });
}
export function importWheel(guest: SavedState, cloud: WheelData, mode: 'merge' | 'replace', selection?: string[]): Pick<WheelData, 'items' | 'history'> {
  const candidates = [...new Set(mode === 'merge' ? [...cloud.items, ...guest.items] : guest.items)];
  const items = selection ?? candidates;
  if (items.length > 16) throw new Error('合并后超过 16 项，请先勾选要保留的候选。');
  let checked: string[] = [];
  for (const item of items) {
    if (!candidates.includes(item)) throw new Error('请选择原菜单中的选项。');
    const added = addItem(checked, item);
    if (!added.ok) throw new Error(added.error);
    checked = added.items;
  }
  const occurrences = new Map<string, number>();
  const legacy: Draw[] = guest.history.map(entry => {
    const existing = (entry as Partial<Draw>).id;
    if (existing && /^[a-zA-Z0-9:_-]{1,100}$/.test(existing)) return { ...entry, id: existing };
    let hash = 2166136261, second = 5381;
    for (const letter of entry.name) { const code = letter.codePointAt(0)!; hash = Math.imul(hash ^ code, 16777619); second = Math.imul(second, 33) ^ code; }
    const key = `${entry.at}:${entry.name}`;
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    return { ...entry, id: `legacy-${entry.at.toString(36)}-${(hash >>> 0).toString(16)}-${(second >>> 0).toString(16)}-${occurrence}` };
  });
  const history = [...new Map([...(mode === 'merge' ? cloud.history : []), ...legacy].map(entry => [entry.id, entry])).values()].sort((a, b) => b.at - a.at).slice(0, 8);
  return { items: checked, history };
}
