import { expect, it } from 'vitest';
import { importWheel, sameWheel } from './cloudWheel';
import type { WheelData } from '../shared/contracts';
import { validateCommand } from './accountRules';
import { Service } from '../../server/service';

const cloud: WheelData = { items: ['面'], history: [{ id: 'cloud-1', name: '面', at: 20 }], revision: 3 };
it('imports legacy history with stable IDs so a repeat merge never doubles history', () => {
  const guest = { version: 1 as const, items: ['饭', '面'], history: [{ name: '饭', at: 30 }] };
  const first = importWheel(guest, cloud, 'merge');
  const second = importWheel(guest, { ...first, revision: 4 }, 'merge');
  expect(first.items).toEqual(['面', '饭']);
  expect(second).toEqual(first);
  expect(() => validateCommand({ action: 'wheel', wheel: first, revision: 3 })).not.toThrow();
  const withNewer = importWheel({ ...guest, history: [{ name: '饺子', at: 40 }, ...guest.history] }, { ...first, revision: 4 }, 'merge');
  expect(withNewer.history.filter(entry => entry.name === '饭')).toHaveLength(1);
});
it('requires explicit selection when merged items exceed sixteen, preserving selected order', () => {
  const guest = { version: 1 as const, items: Array.from({ length: 16 }, (_, i) => `菜${i}`), history: [] };
  expect(() => importWheel(guest, cloud, 'merge')).toThrow('16');
  expect(importWheel(guest, cloud, 'merge', ['菜3', '面']).items).toEqual(['菜3', '面']);
  expect(() => importWheel(guest, cloud, 'merge', ['unknown'])).toThrow();
});
it('explicit replace keeps an intentionally empty guest menu and history', () => {
  expect(importWheel({ version: 1, items: [], history: [] }, cloud, 'replace')).toEqual({ items: [], history: [] });
});
it('compares drafts without confusing revision changes with content changes', () => {
  const newer = { ...cloud, revision: 9 };
  expect(sameWheel(cloud, newer)).toBe(true);
  expect(sameWheel(cloud, { ...cloud, items: [] })).toBe(false);
});

it('persists imported Chinese legacy history through the real service validator', async () => {
  const documents = new Map<string, string>();
  const service = new Service({
    get: async key => documents.get(key) ?? null,
    compareAndSet: async (key, previous, next) => { if ((documents.get(key) ?? null) !== previous) return false; documents.set(key, next); return true; },
    rateLimit: async () => true,
  }, []);
  const account = await service.account('import-user');
  const wheel = importWheel({ version: 1, items: ['饺子'], history: [{ name: '饺子', at: 1730000000000 }] }, account.wheel, 'merge');
  await service.command('import-user', { action: 'wheel', wheel, revision: account.wheel.revision });
  expect((await service.account('import-user')).wheel.history[0].name).toBe('饺子');
});
