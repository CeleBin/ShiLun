import { describe, expect, it } from 'vitest';
import {
  addItem, DEFAULT_ITEMS, recoverState, serializeState, readState, saveState,
  uniformIndex, targetRotation, indexAtPointer, isBilibiliUrl, nextBatch,
  type SavedState,
} from './domain';

describe('custom menu', () => {
  it('trims names and rejects empty and duplicate names', () => {
    expect(addItem([], '  牛肉面  ')).toEqual({ ok: true, items: ['牛肉面'] });
    expect(addItem([], '　 ')).toMatchObject({ ok: false });
    expect(addItem(['牛肉面'], ' 牛肉面 ')).toMatchObject({ ok: false });
  });
  it('accepts 16 graphemes including emoji but rejects 17', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(addItem([], family.repeat(16))).toMatchObject({ ok: true });
    expect(addItem([], '面'.repeat(17))).toMatchObject({ ok: false });
  });
  it('caps the menu at 16 choices and does not mutate the original', () => {
    const items = Array.from({ length: 16 }, (_, i) => `菜${i}`);
    expect(addItem(items, '新菜')).toMatchObject({ ok: false });
    expect(items).toHaveLength(16);
  });
});

describe('remember choices in this browser', () => {
  it('round trips an explicitly empty menu rather than restoring defaults', () => {
    const state: SavedState = { version: 1, items: [], history: [] };
    expect(recoverState(serializeState(state)).state).toEqual(state);
  });
  it('recovers valid history when the menu is corrupt, and vice versa', () => {
    const history = [{ name: '面', at: 1730000000000 }];
    const first = recoverState(JSON.stringify({ version: 1, items: ['面', '面'], history }));
    expect(first.state.items).toEqual(DEFAULT_ITEMS);
    expect(first.state.history).toEqual(history);
    expect(first.warning).toBeTruthy();
    const second = recoverState(JSON.stringify({ version: 1, items: ['饭'], history: 'oops' }));
    expect(second.state.items).toEqual(['饭']);
    expect(second.state.history).toEqual([]);
  });
  it('handles broken JSON and future versions without crashing or overwriting future data', () => {
    expect(recoverState('{')).toMatchObject({ warning: expect.any(String) });
    expect(recoverState('{"version":2,"items":["饭"]}')).toMatchObject({ canSave: false });
  });
  it('limits history to eight valid dates including rejecting invalid ISO ranges', () => {
    const history = [{ name: '坏时间', at: 1e100 }, ...Array.from({ length: 10 }, (_, i) => ({ name: `菜${i}`, at: 1730000000000 + i }))];
    const recovered = recoverState(JSON.stringify({ version: 1, items: ['饭'], history }));
    expect(recovered.state.history).toHaveLength(8);
    expect(recovered.state.history[0].name).toBe('菜0');
  });
  it('allows blocked storage without disabling the app', () => {
    const blocked = { getItem: () => { throw new Error('denied'); } };
    expect(readState(blocked).state.items).toEqual(DEFAULT_ITEMS);
    expect(readState(blocked).warning).toBeTruthy();
    expect(saveState({ setItem: () => { throw new Error('quota'); } }, { version: 1, items: ['饭'], history: [] })).toBe(false);
  });
});

describe('fair selection and pointer geometry', () => {
  it('rejects the biased remainder of the crypto range', () => {
    const values = [4294967295, 8];
    expect(uniformIndex(3, () => values.shift()!)).toBe(2);
    expect(values).toHaveLength(0);
  });
  it('rejects invalid choice counts', () => {
    expect(() => uniformIndex(0)).toThrow();
  });
  it('lands on the selected segment at every menu size and previous angle', () => {
    for (let count = 1; count <= 16; count++) {
      for (let index = 0; index < count; index++) {
        for (const previous of [0, 123.5, 359, 3000]) {
          const end = targetRotation(index, count, previous);
          expect(end).toBeGreaterThan(previous + 360 * 4);
          expect(indexAtPointer(end, count)).toBe(index);
        }
      }
    }
  });
});

describe('curated external recommendations', () => {
  it('only accepts exact HTTPS Bilibili video and programme URLs', () => {
    expect(isBilibiliUrl('https://www.bilibili.com/video/BV14YTn6dEpE')).toBe(true);
    expect(isBilibiliUrl('https://www.bilibili.com/bangumi/play/ss24439')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'https://www.bilibili.com.evil.test/video/BV14YTn6dEpE', 'https://evil@www.bilibili.com/video/BV14YTn6dEpE', 'http://www.bilibili.com/video/BV14YTn6dEpE', 'https://b23.tv/abc', 'https://www.bilibili.com:444/video/BV14YTn6dEpE', 'https://www.bilibili.com/read/123']) {
      expect(isBilibiliUrl(bad)).toBe(false);
    }
  });
  it('changes a batch without duplicates and wraps a partial batch', () => {
    expect(nextBatch(6, 0, 3)).toEqual([0, 1, 2]);
    expect(nextBatch(6, 3, 3)).toEqual([3, 4, 5]);
    expect(nextBatch(4, 3, 3)).toEqual([3, 0, 1]);
    expect(nextBatch(2, 0, 3)).toEqual([0, 1]);
    expect(nextBatch(0, 0, 3)).toEqual([]);
  });
});
