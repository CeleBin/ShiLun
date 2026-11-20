import { describe, it, expect, vi } from 'vitest';
import { getBilibiliMetadata, getBilibiliTags } from './bilibili';
import { Service } from './service';
import type { DocumentStore } from './store';
import { normalizeVideoUrl, validateCommand } from '../src/lib/accountRules';
import { recommend, STRATEGY } from '../src/lib/recommendation';
import { classifyFoodVideo } from '../src/lib/foodGroups';
class MemoryStore implements DocumentStore {
  values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async compareAndSet(key: string, old: string | null, next: string) { if ((this.values.get(key) ?? null) !== old) return false; this.values.set(key, next); return true; }
  async rateLimit() { return true; }
}
const url = 'https://www.bilibili.com/video/BV1qE2MBKEDR?share_source=copy';
describe('account boundaries', () => {
  it('normalizes supported links without fetching arbitrary hosts', () => {
    expect(normalizeVideoUrl(url).url).toBe('https://www.bilibili.com/video/BV1qE2MBKEDR');
    for (const value of ['https://evil.com/video/BV1qE2MBKEDR', 'https://b23.tv/abc', 'https://user@bilibili.com/video/BV1qE2MBKEDR']) expect(() => normalizeVideoUrl(value)).toThrow();
  });
  it('rejects client ownership and malformed boolean values', () => {
    expect(() => validateCommand({ action: 'favorite', url, userId: 'victim' })).toThrow();
    expect(() => validateCommand({ action: 'favorite', url, remove: 'true' })).toThrow();
  });
  it('keeps favorites private and separate from submissions', async () => {
    const service = new Service(new MemoryStore(), []);
    await service.command('alice', { action: 'favorite', url });
    await service.command('alice', { action: 'favorite', url: url.replace('?share_source=copy', '/') });
    expect((await service.account('alice')).favorites).toHaveLength(1);
    const bob = await service.account('bob');
    expect(bob.favorites).toHaveLength(0);
    expect(bob.wheel).toEqual({ items: [], history: [], revision: 0 });
    expect((await service.account('alice')).submissions).toHaveLength(0);
    await expect(service.admin('alice')).rejects.toMatchObject({ status: 403 });
  });
  it('enriches a pasted Bilibili link once and keeps manual notes private', async () => {
    const bvid = 'BV1pLsS6kE4R';
    const coverUrl = 'https://i0.hdslb.com/bfs/archive/example.jpg';
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      code: 0,
      data: { bvid, title: '视频标题', owner: { name: 'UP 主' }, duration: 219, pic: coverUrl },
    })));
    try {
      const service = new Service(new MemoryStore(), [], getBilibiliMetadata);
      const canonical = 'https://www.bilibili.com/video/' + bvid;
      await service.command('alice', { action: 'favorite', url: canonical + '/?trackid=test&spm_id_from=test', title: '我的备注' });
      await service.command('alice', { action: 'favorite', url: canonical });
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [endpoint, init] = fetcher.mock.calls[0];
      expect(String(endpoint)).toBe('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
      expect(init?.redirect).toBe('error');
      expect((await service.account('alice')).favorites).toEqual([expect.objectContaining({
        url: canonical, title: '我的备注', author: 'UP 主', durationSeconds: 219, coverUrl,
      })]);
      expect((await service.account('bob')).favorites).toEqual([]);
    } finally {
      fetcher.mockRestore();
    }
  });

  it('keeps a canonical favorite link if Bilibili metadata cannot be read', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 }));
    try {
      const service = new Service(new MemoryStore(), [], getBilibiliMetadata);
      const canonical = 'https://www.bilibili.com/video/BV1pLsS6kE4R';
      await service.command('alice', { action: 'favorite', url: canonical + '?trackid=test' });
      expect((await service.account('alice')).favorites[0]).toMatchObject({ url: canonical, title: 'bilibili:BV1pLsS6kE4R' });
    } finally {
      fetcher.mockRestore();
    }
  });
  it('deduplicates submissions and persists moderation back to owner', async () => {
    const metadata = { title: 'B 站标题', author: 'UP 主', durationSeconds: 219, coverUrl: 'https://i0.hdslb.com/bfs/archive/example.jpg' };
    const lookup = vi.fn(async () => metadata);
    const lookupTags = vi.fn(async () => ['街头小吃', '探店']);
    const service = new Service(new MemoryStore(), ['admin'], lookup, lookupTags);
    const submittedUrl = 'https://www.bilibili.com/video/BV1qE2MBKEDQ';
    const command = { action: 'submit', url: submittedUrl, reason: '好看', operationId: 'submission-123' } as const;
    await service.command('alice', command); await service.command('alice', command);
    expect(lookup).toHaveBeenCalledExactlyOnceWith('BV1qE2MBKEDQ');
    expect((await service.account('alice')).submissions[0]).toMatchObject({ status: 'pending', video: metadata });
    expect((await service.account('bob')).submissions).toEqual([]);
    const admin = await service.admin('admin'); expect(admin.submissions).toHaveLength(1);
    await service.command('admin', { action: 'review', id: admin.submissions[0].id, decision: 'approved', reply: '已核实', video: { title: '节目', author: '作者', tags: ['生活'], reason: '轻松陪伴' } });
    expect((await service.account('alice')).submissions[0]).toMatchObject({ status: 'approved', video: { ...metadata, title: '节目', author: '作者' } });
    expect(lookupTags).toHaveBeenCalledExactlyOnceWith('BV1qE2MBKEDQ');
    expect((await service.admin('admin')).videos.filter(v => v.url === submittedUrl)).toEqual([expect.objectContaining({ sourceTags: ['街头小吃', '探店'] })]);
  });
  it('keeps feedback owner-only and records admin handling', async () => {
    const service = new Service(new MemoryStore(), ['admin']);
    await service.command('alice', { action: 'feedback', kind: '建议', text: '更多旅行', operationId: 'feedback1' });
    expect((await service.account('bob')).feedback).toEqual([]);
    const feedback = (await service.admin('admin')).feedback[0];
    await expect(service.command('bob', { action: 'handleFeedback', id: feedback.id, status: 'resolved', reply: 'x' })).rejects.toMatchObject({ status: 403 });
    await service.command('admin', { action: 'handleFeedback', id: feedback.id, status: 'resolved', reply: '已记录' });
    expect((await service.account('alice')).feedback[0]).toMatchObject({ status: 'resolved', handledBy: 'admin' });
  });
  it('creates content manually and retains private favorites when unpublished', async () => {
    const store = new MemoryStore(); const service = new Service(store, ['admin']);
    const newUrl = 'https://www.bilibili.com/video/BV1qE2MBKEDQ';
    await service.command('alice', { action: 'favorite', url: newUrl });
    await expect(service.command('alice', { action: 'createVideo', url: newUrl, title: '旅行', author: 'A', reason: '慢慢走', tags: ['旅行'], operationId: 'create1' })).rejects.toMatchObject({ status: 403 });
    await service.command('admin', { action: 'createVideo', url: newUrl, title: '旅行', author: 'A', reason: '慢慢走', tags: ['旅行'], operationId: 'create1' });
    await service.command('admin', { action: 'video', id: 'bilibili:BV1qE2MBKEDQ', published: false, revision: 0 });
    expect((await service.account('alice')).favorites[0].availability).toBe('unpublished');
    expect((await service.recommendations('alice')).videos.some(v => v.id === 'bilibili:BV1qE2MBKEDQ')).toBe(false);
    expect(JSON.parse(store.values.get('shilun:v2:moderation')!).audit).toHaveLength(2);
  });
  it('allows rejected resubmissions and protects operation identifiers', async () => {
    const service = new Service(new MemoryStore(), ['admin']); const newUrl = 'https://www.bilibili.com/video/BV1qE2MBKEDQ';
    await service.command('a', { action: 'submit', url: newUrl, reason: '好', operationId: 'op1' });
    await expect(service.command('a', { action: 'submit', url: newUrl, reason: '改', operationId: 'op1' })).rejects.toMatchObject({ status: 409 });
    const submission = (await service.admin('admin')).submissions[0];
    await service.command('admin', { action: 'review', id: submission.id, decision: 'rejected', reply: '补充资料' });
    await service.command('a', { action: 'submit', url: newUrl, reason: '已补', operationId: 'op2' });
    expect((await service.account('a')).submissions).toHaveLength(2);
  });
  it('deletes only the requesting users private data', async () => {
    const service = new Service(new MemoryStore(), []);
    for (const user of ['a', 'b']) { await service.command(user, { action: 'favorite', url }); await service.command(user, { action: 'feedback', text: '建议', kind: '建议', operationId: 'f1' }); }
    await service.command('a', { action: 'deleteAccountData' });
    expect((await service.account('a')).favorites).toHaveLength(0); expect((await service.account('a')).feedback).toHaveLength(0);
    expect((await service.account('b')).favorites).toHaveLength(1); expect((await service.account('b')).feedback).toHaveLength(1);
  });
  it('rejects unavailable persistence and never returns false success', async () => {
    const store = new MemoryStore(); store.compareAndSet = async () => false;
    const service = new Service(store, []);
    await expect(service.command('a', { action: 'preferences', tags: ['10分钟以内'] })).rejects.toMatchObject({ status: 409 });
  });
  it('clears duration preferences even if reading the catalog is unavailable', async () => {
    const store = new MemoryStore();
    const service = new Service(store, []);
    await service.command('a', { action: 'preferences', tags: ['30分钟以上'] });
    const get = store.get.bind(store);
    const reads = vi.spyOn(store, 'get').mockImplementation(async key => {
      if (key === 'shilun:v2:moderation') throw new Error('Catalog read timed out');
      return get(key);
    });
    const result = await service.command('a', { action: 'preferences', tags: [] });
    expect(result).toEqual({ preferences: [] });
    expect(reads).not.toHaveBeenCalledWith('shilun:v2:moderation');
    reads.mockRestore();
    expect((await service.account('a')).preferences).toEqual([]);
  });
  it('replays wheel saves with unsorted history without duplicate revisions', async () => {
    const service = new Service(new MemoryStore(), []);
    const command = { action: 'wheel', revision: 0, wheel: { items: ['面'], history: [{ id: 'old', name: '面', at: 1, items: ['面'] }, { id: 'new', name: '面', at: 2, items: ['面'] }] } };
    await service.command('a', command);
    expect((await service.command('a', command) as any).wheel.revision).toBe(1);
  });
  it('does not silently move feedback backwards after processing', async () => {
    const service = new Service(new MemoryStore(), ['admin']);
    await service.command('a', { action: 'feedback', text: '建议', kind: '建议', operationId: 'f1' });
    const { id } = (await service.admin('admin')).feedback[0];
    await service.command('admin', { action: 'handleFeedback', id, status: 'processing', reply: '处理中' });
    await expect(service.command('admin', { action: 'handleFeedback', id, status: 'open', reply: '退回' })).rejects.toMatchObject({ status: 409 });
  });
  it('preserves simultaneous account mutations using CAS', async () => {
    const service = new Service(new MemoryStore(), []);
    await Promise.all([service.command('a', { action: 'favorite', url }), service.command('a', { action: 'preferences', tags: ['旅行', '10分钟以内'] })]);
    const account = await service.account('a'); expect(account.favorites).toHaveLength(1); expect(account.preferences).toEqual(['10分钟以内']);
  });
  it('cannot replace a stored draw result using the same draw identifier', async () => {
    const service = new Service(new MemoryStore(), []);
    await service.command('a', { action: 'wheel', revision: 0, wheel: { items: ['面'], history: [{ id: 'draw', name: '面', at: 100, items: ['面'] }] } });
    await expect(service.command('a', { action: 'wheel', revision: 1, wheel: { items: ['饭'], history: [{ id: 'draw', name: '饭', at: 100, items: ['饭'] }] } })).rejects.toMatchObject({ status: 409 });
  });
  it('treats equivalent JSON property ordering as the same idempotent operation', async () => {
    const service = new Service(new MemoryStore(), []);
    await service.command('a', { action: 'feedback', text: '建议', kind: '建议', operationId: 'f1' });
    await service.command('a', { operationId: 'f1', kind: '建议', text: '建议', action: 'feedback' });
    expect((await service.account('a')).feedback).toHaveLength(1);
  });
  it('deduplicates pending normalized submissions globally without exposing ownership', async () => {
    const service = new Service(new MemoryStore(), []); const newUrl = 'https://www.bilibili.com/video/BV1qE2MBKEDQ';
    await service.command('a', { action: 'submit', url: newUrl, reason: '好', operationId: 'op1' });
    await expect(service.command('b', { action: 'submit', url: newUrl + '/?tracking=x', reason: '好', operationId: 'op2' })).rejects.toMatchObject({ status: 409, message: '这个视频已有待审核投稿，请等待审核。' });
    expect((await service.account('b')).submissions).toEqual([]);
  });
  it('records interest changes atomically with recommendation context and retry deduplication', async () => {
    const store = new MemoryStore(); const service = new Service(store, []); const feed = await service.recommendations('a'); const videoId = feed.videos[0].id;
    const like = { action: 'interest', videoId, value: 'like', eventId: 'like1', requestId: feed.requestId };
    await service.command('a', like); await service.command('a', like);
    let doc = [...store.values.values()].map(v => JSON.parse(v)).find(d => d.events)!;
    expect(doc.events).toHaveLength(1); expect(doc.events[0]).toMatchObject({ kind: 'like', requestId: feed.requestId, strategy: STRATEGY });
    await service.command('a', { ...like, eventId: 'hide1', value: 'hide' });
    await service.command('a', like); // late retry cannot overwrite the more recent hide
    expect((await service.account('a')).interests[videoId]).toBe('hide');
    await expect(service.command('b', like)).rejects.toMatchObject({ status: 400 });
    await expect(service.command('a', { ...like, value: null })).rejects.toMatchObject({ status: 409 });
    await service.command('a', { action: 'interest', videoId, value: null });
    doc = [...store.values.values()].map(v => JSON.parse(v)).find(d => d.events)!;
    expect(doc.events.map((e: any) => e.kind)).toEqual(['like', 'hide', 'revoke']);
    expect((await service.account('a')).interests[videoId]).toBeUndefined();
  });
  it('rejects stale metadata saves after another admin withdraws a video', async () => {
    const service = new Service(new MemoryStore(), ['adminA', 'adminB']);
    const stale = (await service.admin('adminA')).videos.find(v => v.id === 'chuaner')!;
    await service.command('adminB', { action: 'video', id: stale.id, revision: stale.revision ?? 0, published: false });
    await expect(service.command('adminA', { action: 'video', id: stale.id, revision: stale.revision ?? 0, title: '更正标题', published: true })).rejects.toMatchObject({ status: 409 });
    expect((await service.admin('adminA')).videos.find(v => v.id === stale.id)).toMatchObject({ published: false, revision: 1, title: stale.title });
    expect(() => validateCommand({ action: 'video', id: stale.id, published: true })).toThrow();
    expect(() => validateCommand({ action: 'video', id: stale.id, published: true, revision: -1 })).toThrow();
  });
  it('deduplicates events and rejects unrelated recommendation requests', async () => {
    const store = new MemoryStore(); const service = new Service(store, []); const feed = await service.recommendations('a');
    const event = { action: 'event', eventId: 'ev1', requestId: feed.requestId, videoId: feed.videos[0].id, kind: 'impression' };
    await service.command('a', event); await service.command('a', event);
    expect([...store.values.values()].map(v => JSON.parse(v)).find(d => d.events)?.events).toHaveLength(1);
    await expect(service.command('b', event)).rejects.toMatchObject({ status: 400 });
  });
  it('checks wheel revisions and permits exactly matching retries', async () => {
    const service = new Service(new MemoryStore(), []);
    const command = { action: 'wheel', revision: 0, wheel: { items: ['面'], history: [{ id: 'draw-123456', name: '面', at: 100, items: ['面'] }] } } as const;
    await service.command('a', structuredClone(command) as never);
    expect((await service.command('a', structuredClone(command) as never) as any).wheel.history).toHaveLength(1);
    await expect(service.command('a', { action: 'wheel', revision: 0, wheel: { items: [], history: [] } })).rejects.toMatchObject({ status: 409 });
  });
  it('hides explicit negative feedback and uses only published candidates', () => {
    const base = { url, title: 'x', author: 'a', reason: 'r', artwork: 'pot' as const, label: 'l', source: url, verifiedAt: '2026-11-11', tags: ['生活'], published: true };
    const result = recommend([{ ...base, id: 'hidden' }, { ...base, id: 'draft', published: false }, { ...base, id: 'ok' }], ['生活'], { hidden: 'hide' });
    expect(result.map(v => v.id)).toEqual(['ok']); expect(result[0].recommendationReason).toContain('编辑精选');
  });

  it('uses saved likes and canonical favorites to rank related videos, while leaving room for exploration', async () => {
    const store = new MemoryStore();
    const service = new Service(store, []);
    const base = { title: 'x', author: '一号', reason: 'r', artwork: 'pot', label: '探店小吃', source: url, verifiedAt: '2026-11-11', tags: ['美食', '轻松'], sourceTags: ['探店', '街头小吃'], published: true };
    const catalog = [
      { id: 'a', author: '一号', label: '趣味实验', tags: ['知识', '轻松'], sourceTags: ['搞笑'] },
      { id: 'b', author: '二号', label: '剧情动画', tags: ['影视', '轻松'], sourceTags: ['动画'] },
      { id: 'c', author: '三号', label: '厨房料理', sourceTags: ['料理'] },
      { id: 'd', author: '四号' },
      { id: 'e', author: '五号' },
      { id: 'source', sourceTags: ['美食探店', '街头小吃'] },
    ].map((video, index) => ({ ...base, ...video, url: `https://www.bilibili.com/video/BV1qE2MBKED${String.fromCharCode(65 + index)}` }));
    store.values.set('shilun:v2:moderation', JSON.stringify({ videos: catalog, submissions: [], feedback: [] }));
    const source = catalog[5];
    const next = async (userId = 'alice') => (await service.recommendations(userId, [source.id])).videos.map(video => video.id);
    expect(await next()).toEqual(['a', 'b', 'c', 'd', 'e']);
    await service.command('alice', { action: 'interest', videoId: source.id, value: 'like' });
    expect(await next()).toEqual(['d', 'e', 'c', 'a', 'b']);
    await service.command('alice', { action: 'favorite', url: source.url + '/?trackid=test' });
    await service.command('alice', { action: 'interest', videoId: source.id, value: null });
    expect(await next()).toEqual(['d', 'e', 'c', 'a', 'b']);
    expect(await next('bob')).toEqual(['a', 'b', 'c', 'd', 'e']);
    await service.command('alice', { action: 'favorite', url: source.url, remove: true });
    expect(await next()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('accumulates distinct videos and scores liking plus favoriting one video as two likes', () => {
    const base = { url, title: 'x', reason: 'r', artwork: 'pot' as const, label: 'l', source: url, verifiedAt: '2026-11-11', tags: [], published: true };
    const catalog = [
      ['a', '历史穿越'], ['b', '自然风景'], ['food-one', '自然风景'], ['food-two', '自然风景'], ['history-one', '历史穿越'], ['history-two', '历史穿越'],
    ].map(([id, tag]) => ({ ...base, id, author: id, sourceTags: [tag] }));
    const likes = { 'food-one': 'like', 'history-one': 'like', 'history-two': 'like' } as const;
    const first = (interests: Record<string, 'like' | 'hide'>, favorites = new Set<string>()) =>
      recommend(catalog, [], interests, catalog.slice(2).map(video => video.id), 1, favorites)[0].id;
    expect(first(likes)).toBe('a');
    expect(first(likes, new Set(['food-one']))).toBe('a');
    expect(first({ ...likes, 'food-two': 'like' })).toBe('a');
    expect(first({ ...likes, 'food-two': 'like' }, new Set(['food-one']))).toBe('b');
    expect(first({ ...likes, 'food-one': 'hide' }, new Set(['food-one', 'food-two']))).toBe('a');
  });

  it('learns a common food interest from videos with sparse or different Bilibili tags', () => {
    const base = { url, reason: 'r', artwork: 'pot' as const, label: '精选', source: url, verifiedAt: '2026-11-11', tags: [], published: true };
    const videos = [
      { id: 'snack', title: '路边摊10元小面', sourceTags: ['城市美食随手拍'] },
      { id: 'cooking', title: '有鸡の火鸡面', tags: ['美食'], sourceTags: ['Vlog'] },
      { id: 'recipe', title: '没啥肉咋这么好吃', sourceTags: ['厨艺'] },
      { id: 'restaurant', title: '直播预录片段', sourceTags: ['美食探店'] },
      { id: 'other-snack', title: '这家街头小吃真不错', sourceTags: ['外景'] },
      { id: 'other-recipe', title: '一道简单家常菜', sourceTags: ['菜谱'] },
      { id: 'animation', title: '傲慢魔女', sourceTags: ['原创动画'] },
      { id: 'other-animation', title: '虾仁动画', sourceTags: ['原创动画'] },
    ].map(video => ({ ...base, ...video, author: video.id }));
    const liked = { snack: 'like', cooking: 'like', recipe: 'like', restaurant: 'like' } as const;
    const picks = recommend(videos, [], liked, [...Object.keys(liked), 'animation'], 3, new Set(['animation']));
    expect(picks.slice(0, 2).map(video => video.id).sort()).toEqual(['other-recipe', 'other-snack']);
    expect(picks[0].recommendationReason).toMatch(/探店试吃|烹饪制作|美食/);
  });

  it('demotes shared tags and specific food groups until the hide mark is removed', () => {
    const base = { url, reason: 'r', artwork: 'pot' as const, label: '精选', source: url, verifiedAt: '2026-11-11', tags: ['美食'], published: true };
    const catalog = [
      { id: 'a', title: '逛夜市吃小吃', sourceTags: ['街头小吃'] },
      { id: 'b', title: '探店试吃', sourceTags: ['街头小吃'] },
      { id: 'c', title: '一道简单家常菜', sourceTags: ['菜谱'] },
      { id: 'hidden', title: '路边摊10元小面', sourceTags: ['街边小吃'] },
    ].map(video => ({ ...base, ...video, author: video.id }));
    const next = (interests: Record<string, 'like' | 'hide'>) => recommend(catalog, [], interests, [], 4);

    expect(next({}).map(video => video.id)).toEqual(['a', 'b', 'c', 'hidden']);
    const picks = next({ hidden: 'hide' });
    expect(picks.map(video => video.id)).toEqual(['c', 'a', 'b']);
    expect(picks[1].recommendationReason).toBe('编辑精选，尝试不同内容');
    expect(next({}).map(video => video.id)).toEqual(['a', 'b', 'c', 'hidden']);
  });

  it('leaves ambiguous search matches out of the food groups', () => {
    expect(classifyFoodVideo('沉浸式摆摊卖一元烤肠', ['街头美食'])).toBeUndefined();
    expect(classifyFoodVideo('逛吃夜市，家常菜菜谱', [])).toBeUndefined();
    expect(classifyFoodVideo('简单一餐', ['＃美食制作'])).toBe('烹饪制作');
  });

  it('returns six videos and uses duration as a strong boost that behavior can outweigh', () => {
    const base = { url: 'https://www.bilibili.com/video/BV1qE2MBKEZZ', title: 'x', reason: 'r', artwork: 'pot' as const, label: 'l', source: url, verifiedAt: '2026-11-11', tags: [], published: true };
    const shorts = Array.from({ length: 6 }, (_, i) => ({ ...base, id: `short-${i}`, author: `up-${i}`, durationSeconds: 600 }));
    const medium = { ...base, id: 'medium', author: 'mid', durationSeconds: 1800 };
    const long = { ...base, id: 'long', author: 'long', durationSeconds: 1801, tags: ['10分钟以内'], sourceTags: ['动画'] };
    const loved = { ...long, id: 'loved', author: 'loved' };
    const catalog = [medium, long, loved, ...shorts];
    expect(recommend(catalog, ['10分钟以内'], { loved: 'like' }, ['loved']).map(video => video.id)).toEqual([...shorts.slice(0, 5).map(video => video.id), 'long']);
    const likedVideos = Array.from({ length: 4 }, (_, i) => ({ ...loved, id: `liked-${i}`, author: `liked-${i}` }));
    const likes = Object.fromEntries(likedVideos.map(video => [video.id, 'like' as const]));
    const mixedBatch = recommend([...catalog, ...likedVideos], ['10分钟以内'], likes, ['loved', ...Object.keys(likes)]);
    expect(mixedBatch.map(video => video.id)).toEqual(['long', ...shorts.slice(0, 5).map(video => video.id)]);
    expect(recommend(catalog, ['10—30分钟'])[0].id).toBe('medium');
    expect(recommend(catalog, ['30分钟以上'])[0].id).toBe('long');
    expect(recommend([long, ...shorts.slice(0, 1)], ['10分钟以内'])).toHaveLength(2);
    const longCatalog = Array.from({ length: 6 }, (_, i) => ({ ...long, id: `long-${i}`, author: `long-up-${i}` }));
    const unknown = { ...base, id: 'a-unknown', author: 'unknown' };
    const varied = recommend([...longCatalog, unknown, shorts[0]], ['30分钟以上']);
    expect(varied.map(video => video.id)).toEqual([...longCatalog.slice(0, 5).map(video => video.id), 'short-0']);
    expect(recommend(longCatalog, ['30分钟以上'])).toHaveLength(6);
    const mixed = [{ ...medium, id: 'a' }, { ...shorts[0], id: 'z', tags: ['生活', '治愈', '探店试吃'] }];
    expect(recommend(mixed, ['生活', '治愈', '探店试吃']).map(video => video.id)).toEqual(['a', 'z']);
  });

  it('reads Bilibili source tags from the fixed public endpoint and tolerates failures', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: [{ tag_name: ' 探店 ' }, { tag_name: '探店' }, null] })))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    try {
      expect(await getBilibiliTags('BV1pLsS6kE4R')).toEqual(['探店']);
      expect(String(fetcher.mock.calls[0][0])).toBe('https://api.bilibili.com/x/tag/archive/tags?bvid=BV1pLsS6kE4R');
      expect(await getBilibiliTags('BV1pLsS6kE4R')).toBeUndefined();
      expect(await getBilibiliTags('https://example.com')).toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      fetcher.mockRestore();
    }
  });
});
