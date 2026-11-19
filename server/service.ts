import { randomUUID, createHash } from 'node:crypto';
import { DEFAULT_ITEMS } from '../src/lib/domain';
import { videos as seeds } from '../src/data/videos';
import starterVideos from '../src/data/bilibili-starter.json';
import { selectDurationPreferences, RECOMMENDATION_BATCH_SIZE, type Account, type AdminData, type CatalogVideo, type Command, type PreferenceUpdate, type RecommendationResult } from '../src/shared/contracts';
import { AppError, normalizeVideoUrl, validateCommand } from '../src/lib/accountRules';
import { recommend, STRATEGY } from '../src/lib/recommendation';
import type { DocumentStore } from './store';
import type { BilibiliMetadata } from './bilibili';

const PREFIX = 'shilun:v2:';
const GLOBAL = PREFIX + 'moderation';
const MAX_DOCUMENT_BYTES = 1500000;
type Event = { eventId: string; requestId?: string; videoId?: string; kind: string; at: number; strategy: string };
type Request = { id: string; ids: string[]; at: number };
interface Profile { wheel: Account['wheel']; favorites: Account['favorites']; preferences: string[]; interests: Account['interests']; events: Event[]; requests: Request[]; drawIds: Record<string, string> }
interface Moderation extends AdminData { audit: { actor: string; action: string; id: string; at: number }[]; operations: Record<string, string> }
export function seedCatalog(): CatalogVideo[] {
  const original: CatalogVideo[] = seeds.map(video => ({
    ...video, tags: ['美食'], published: true, revision: 0,
  }));
  const starter: CatalogVideo[] = starterVideos.map(video => ({
    ...video, artwork: video.artwork as CatalogVideo['artwork'], published: true, revision: 0,
  }));
  return [...original, ...starter];
}
const newProfile = (): Profile => ({ wheel: { items: [...DEFAULT_ITEMS], history: [], revision: 0 }, favorites: [], preferences: [], interests: {}, events: [], requests: [], drawIds: {} });
const newModeration = (): Moderation => ({ videos: seedCatalog(), submissions: [], feedback: [], audit: [], operations: {} });
const conflict = (message = '内容已在其他设备更新，请重新加载后比较。') => new AppError(409, 'CONFLICT', message);
const capacity = () => new AppError(409, 'CAPACITY', '记录已达到容量上限，请联系维护者归档后再试。');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const canonicalId = (url: string) => normalizeVideoUrl(url).key;
const profileKey = (id: string) => PREFIX + 'account:' + digest(id);
export class Service {
  constructor(private store: DocumentStore, private admins: string[], private lookupVideo?: (bvid: string) => Promise<BilibiliMetadata | undefined>, private lookupTags?: (bvid: string) => Promise<string[] | undefined>) {}
  private isAdmin(userId: string) { return this.admins.includes(userId); }
  private requireAdmin(userId: string) { if (!this.isAdmin(userId)) throw new AppError(403, 'FORBIDDEN', '仅管理员可以执行此操作。'); }
  private async read<T>(key: string, initial: () => T) { const raw = await this.store.get(key); if (raw === null) return initial(); try { return JSON.parse(raw) as T; } catch { throw new AppError(503, 'CORRUPT_STORAGE', '存储记录暂时无法读取。'); } }
  private async update<T>(key: string, initial: () => T, change: (doc: T) => void | Promise<void>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const previous = await this.store.get(key); let doc: T;
      try { doc = previous === null ? initial() : JSON.parse(previous) as T; } catch { throw new AppError(503, 'CORRUPT_STORAGE', '存储记录暂时无法读取。'); }
      await change(doc); const next = JSON.stringify(doc); if (Buffer.byteLength(next) > MAX_DOCUMENT_BYTES) throw capacity();
      if (await this.store.compareAndSet(key, previous, next)) return doc;
    }
    throw conflict('当前操作繁忙，请重试。');
  }
  async limit(subject: string, limit = 60) { if (!await this.store.rateLimit(PREFIX + 'rate:' + digest(subject), limit, 60)) throw new AppError(429, 'RATE_LIMIT', '操作过于频繁，请稍后重试。'); }
  async account(userId: string): Promise<Account> {
    const [p, global] = await Promise.all([this.read(profileKey(userId), newProfile), this.read(GLOBAL, newModeration)]);
    const favorites = p.favorites.map<Account['favorites'][number]>(favorite => {
      const video = global.videos.find(entry => canonicalId(entry.url) === favorite.key);
      return {
        ...favorite,
        videoId: video?.id,
        author: video?.author ?? favorite.author,
        coverUrl: video?.coverUrl ?? favorite.coverUrl,
        durationSeconds: video?.durationSeconds ?? favorite.durationSeconds,
        availability: video ? (video.published ? 'published' : 'unpublished') : 'unknown',
      };
    });
    const interestVideos = global.videos
      .filter(video => Object.hasOwn(p.interests, video.id))
      .map(({ id, url, title, author, durationSeconds, coverUrl }) => ({ id, url, title, author, durationSeconds, coverUrl }));
    const submissions = global.submissions.filter(item => item.userId === userId).map(item => {
      const video = global.videos.find(entry => entry.id === item.videoId || entry.url === item.url);
      if (!video) return item;
      return { ...item, video: { ...item.video, title: video.title, author: video.author,
        durationSeconds: video.durationSeconds ?? item.video?.durationSeconds } };
    });
    return { userId, wheel: p.wheel, preferences: selectDurationPreferences(p.preferences), interests: p.interests, interestVideos, favorites, submissions, feedback: global.feedback.filter(f => f.userId === userId), isAdmin: this.isAdmin(userId) };
  }
  async admin(userId: string): Promise<AdminData> { this.requireAdmin(userId); const g = await this.read(GLOBAL, newModeration); return { videos: g.videos, submissions: g.submissions, feedback: g.feedback }; }
  private async setFavorite(userId: string, input: Extract<Command, { action: 'favorite' }>, now: number) {
    const link = normalizeVideoUrl(input.url);
    const key = profileKey(userId);
    if (input.remove) {
      await this.update(key, newProfile, profile => {
        profile.favorites = profile.favorites.filter(favorite => favorite.key !== link.key);
      });
      return this.account(userId);
    }

    const catalog = await this.read(GLOBAL, newModeration);
    const video = catalog.videos.find(entry => canonicalId(entry.url) === link.key);
    let metadata: BilibiliMetadata | undefined;
    if (!video && this.lookupVideo && link.key.startsWith('bilibili:BV')) {
      const profile = await this.read(key, newProfile);
      const existing = profile.favorites.find(favorite => favorite.key === link.key);
      if (!existing && profile.favorites.length >= 200) throw capacity();
      if (!existing?.author || !existing.coverUrl || !existing.durationSeconds) {
        metadata = await this.lookupVideo(link.key.slice('bilibili:'.length));
      }
    }

    await this.update(key, newProfile, profile => {
      const existing = profile.favorites.find(favorite => favorite.key === link.key);
      if (existing) {
        if (!metadata) return;
        if (!existing.title || existing.title === link.key || existing.title === link.url) existing.title = input.title || metadata.title;
        existing.author ??= metadata.author;
        existing.coverUrl ??= metadata.coverUrl;
        existing.durationSeconds ??= metadata.durationSeconds;
        return;
      }
      if (profile.favorites.length >= 200) throw capacity();
      profile.favorites.unshift({ ...metadata, ...link, title: input.title || video?.title || metadata?.title || link.key, at: now, videoId: video?.id });
    });
    return this.account(userId);
  }
  private audit(g: Moderation, actor: string, action: string, id: string) { if (g.audit.length >= 5000) throw capacity(); g.audit.push({ actor, action, id, at: Date.now() }); }
  async recommendations(userId?: string, exclude: string[] = []): Promise<RecommendationResult> {
    const g = await this.read(GLOBAL, newModeration); const p = userId ? await this.read(profileKey(userId), newProfile) : newProfile();
    const requestId = randomUUID();
    // Same-session exclusions are strict; recent visible impressions are soft exclusions.
    const recent = p.events.filter(e => e.kind === 'impression' && e.at > Date.now() - 86400000).slice(-12).flatMap(e => e.videoId ? [e.videoId] : []);
    const favoriteKeys = new Set(p.favorites.map(favorite => favorite.key));
    const favoriteIds = new Set(favoriteKeys.size ? g.videos.filter(video => favoriteKeys.has(canonicalId(video.url))).map(video => video.id) : []);
    let videos = recommend(g.videos, p.preferences, p.interests, [...exclude, ...recent], RECOMMENDATION_BATCH_SIZE, favoriteIds);
    if (!videos.length) videos = recommend(g.videos, p.preferences, p.interests, exclude, RECOMMENDATION_BATCH_SIZE, favoriteIds);
    if (userId) await this.update(profileKey(userId), newProfile, doc => { doc.requests = [...doc.requests.filter(r => r.at > Date.now() - 86400000), { id: requestId, ids: videos.map(v => v.id), at: Date.now() }].slice(-100); });
    const eligible = g.videos.filter(video => video.published && p.interests[video.id] !== 'hide').length;
    return { videos, requestId, strategy: STRATEGY, hasMore: eligible > videos.length };
  }
  async command(userId: string, raw: unknown): Promise<Account | AdminData | PreferenceUpdate | { ok: true }> {
    const c: Command = validateCommand(raw); const now = Date.now();
    if (c.action === 'favorite') return this.setFavorite(userId, c, now);
    if (c.action === 'preferences') {
      const preferences = selectDurationPreferences(c.tags);
      await this.update(profileKey(userId), newProfile, profile => { profile.preferences = preferences; });
      return { preferences };
    }
    if (['review', 'video', 'createVideo', 'handleFeedback'].includes(c.action)) this.requireAdmin(userId);
    if (c.action === 'deleteAccountData') {
      await this.update(GLOBAL, newModeration, g => { g.submissions = g.submissions.filter(s => s.userId !== userId); g.feedback = g.feedback.filter(f => f.userId !== userId); for (const key of Object.keys(g.operations)) if (key.startsWith(digest(userId) + ':')) delete g.operations[key]; });
      await this.update(profileKey(userId), newProfile, p => { const blank = newProfile(); blank.wheel.revision = p.wheel.revision + 1; Object.assign(p, blank); });
      return this.account(userId);
    }
    if (['submit', 'feedback', 'review', 'video', 'createVideo', 'handleFeedback'].includes(c.action)) {
      let submissionLookup: Promise<BilibiliMetadata | undefined> | undefined;
      let tagsLookup: Promise<string[] | undefined> | undefined;
      const sourceTags = (key: string) => {
        if (key.startsWith('bilibili:BV')) tagsLookup ??= this.lookupTags?.(key.slice('bilibili:'.length));
        return tagsLookup;
      };
      await this.update(GLOBAL, newModeration, async g => {
        if (c.action === 'submit' || c.action === 'feedback' || c.action === 'createVideo') {
          const key = `${digest(userId)}:${c.action}:${c.operationId}`; const hash = digest(stableJson(c));
          if (g.operations[key]) { if (g.operations[key] !== hash) throw conflict('重试标识已经用于不同内容。'); return; }
          if (Object.keys(g.operations).length >= 5000) throw capacity();
          if (c.action === 'submit') {
            const normalized = normalizeVideoUrl(c.url);
            if (g.videos.some(v => canonicalId(v.url) === normalized.key)) throw conflict('这个视频已收录，请在推荐库查看。');
            if (g.submissions.some(s => canonicalId(s.url) === normalized.key && s.status === 'pending')) throw conflict('这个视频已有待审核投稿，请等待审核。');
            if (g.submissions.length >= 1000 || g.submissions.filter(s => s.userId === userId).length >= 100) throw capacity();
            const bvid = normalized.key.slice('bilibili:'.length);
            if (bvid.startsWith('BV')) submissionLookup ??= this.lookupVideo?.(bvid);
            const video = await submissionLookup;
            g.submissions.push({ id: randomUUID(), userId, url: normalized.url, reason: c.reason, at: now, status: 'pending', reply: '', video });
          } else if (c.action === 'feedback') {
            if (c.videoId && !g.videos.some(v => v.id === c.videoId)) throw new AppError(400, 'UNKNOWN_VIDEO', '未找到这个视频。');
            if (g.feedback.length >= 2000 || g.feedback.filter(f => f.userId === userId).length >= 100) throw capacity();
            g.feedback.push({ id: randomUUID(), userId, kind: c.kind, text: c.text, videoId: c.videoId, at: now, status: 'open', reply: '' });
          } else {
            const normalized = normalizeVideoUrl(c.url); if (g.videos.some(v => canonicalId(v.url) === normalized.key)) throw conflict('这个视频已经收录。');
            if (g.videos.length >= 500) throw capacity();
            g.videos.push({ id: normalized.key, url: normalized.url, title: c.title, author: c.author, reason: c.reason, tags: c.tags, sourceTags: await sourceTags(normalized.key), published: true, revision: 0, source: normalized.url, verifiedAt: new Date(now).toISOString().slice(0, 10), artwork: 'table', label: c.tags[0] ?? '编辑精选' }); this.audit(g, userId, 'createVideo', normalized.key);
          }
          g.operations[key] = hash;
        } else if (c.action === 'review') {
          const s = g.submissions.find(s => s.id === c.id); if (!s) throw new AppError(404, 'NOT_FOUND', '投稿不存在。');
          if (s.status !== 'pending') { if (s.status === c.decision && s.reply === c.reply) return; throw conflict('这个投稿已经处理。'); }
          if (c.decision === 'approved' && c.video) {
            const key = canonicalId(s.url); const existing = g.videos.find(v => canonicalId(v.url) === key);
            if (!existing && g.videos.length >= 500) throw capacity();
            if (!existing) g.videos.push({ id: key, url: s.url, ...c.video, sourceTags: await sourceTags(key), published: true, revision: 0, source: s.url, verifiedAt: new Date(now).toISOString().slice(0, 10), artwork: 'table', label: c.video.tags[0] ?? '编辑精选' });
            s.videoId = existing?.id ?? key;
          }
          s.status = c.decision; s.reply = c.reply; s.reviewedBy = userId; s.reviewedAt = now; this.audit(g, userId, `review:${c.decision}`, s.id);
        } else if (c.action === 'video') {
          const v = g.videos.find(v => v.id === c.id); if (!v) throw new AppError(404, 'NOT_FOUND', '视频不存在。');
          if ((v.revision ?? 0) !== c.revision) throw conflict('视频已被其他管理员更新，请重新加载后比较。');
          if (c.published && !v.published && v.sourceTags === undefined) v.sourceTags = await sourceTags(canonicalId(v.url));
          for (const key of ['title', 'author', 'reason', 'tags'] as const) if (c[key] !== undefined) Object.assign(v, { [key]: c[key] }); v.published = c.published; v.revision = (v.revision ?? 0) + 1; this.audit(g, userId, 'video', v.id);
        } else if (c.action === 'handleFeedback') {
          const f = g.feedback.find(f => f.id === c.id); if (!f) throw new AppError(404, 'NOT_FOUND', '反馈不存在。');
          const order = ['open', 'processing', 'resolved'];
          if (order.indexOf(c.status) < order.indexOf(f.status)) throw conflict('已处理的反馈不能退回之前的状态。');
          f.status = c.status; f.reply = c.reply; f.handledBy = userId; f.handledAt = now; this.audit(g, userId, `feedback:${c.status}`, f.id);
        }
      });
      return ['review', 'video', 'createVideo', 'handleFeedback'].includes(c.action) ? this.admin(userId) : this.account(userId);
    }
    const g = await this.read(GLOBAL, newModeration);
    await this.update(profileKey(userId), newProfile, p => {
      if (c.action === 'interest') {
        if (!g.videos.some(v => v.id === c.videoId)) throw new AppError(400, 'UNKNOWN_VIDEO', '未找到这个视频。');
        const context = c as typeof c & { eventId?: string; requestId?: string };
        const kind = c.value ?? 'revoke';
        if (context.requestId) {
          const request = p.requests.find(r => r.id === context.requestId && r.at > now - 86400000);
          if (!request || !request.ids.includes(c.videoId)) throw new AppError(400, 'INVALID_EVENT', '推荐请求已过期或不包含该视频。');
        }
        const prior = context.eventId ? p.events.find(e => e.eventId === context.eventId) : undefined;
        if (prior) {
          if (prior.kind !== kind || prior.requestId !== context.requestId || prior.videoId !== c.videoId) throw conflict('事件标识已被使用。');
          return;
        }
        const changed = (p.interests[c.videoId] ?? null) !== c.value;
        if (c.value === null) delete p.interests[c.videoId]; else p.interests[c.videoId] = c.value;
        if (changed || context.eventId) p.events = [...p.events.filter(e => e.at > now - 30 * 86400000), { eventId: context.eventId ?? randomUUID(), requestId: context.requestId, videoId: c.videoId, kind, at: now, strategy: STRATEGY }].slice(-500);
      }
      else if (c.action === 'wheel') {
        const history = [...c.wheel.history].sort((a, b) => b.at - a.at);
        if (stableJson(p.wheel.items) === stableJson(c.wheel.items) && stableJson(p.wheel.history) === stableJson(history)) return;
        if (p.wheel.revision !== c.revision) throw conflict();
        for (const draw of c.wheel.history) { const fingerprint = digest(stableJson(draw)); if (p.drawIds[draw.id] && p.drawIds[draw.id] !== fingerprint) throw conflict('抽选标识已存在，不能修改原抽选结果。'); p.drawIds[draw.id] = fingerprint; }
        if (Object.keys(p.drawIds).length > 5000) throw capacity();
        p.wheel = { items: [...c.wheel.items], history, revision: p.wheel.revision + 1 };
      } else if (c.action === 'event') {
        const req = p.requests.find(r => r.id === c.requestId && r.at > now - 86400000);
        if (!req || (c.videoId && !req.ids.includes(c.videoId))) throw new AppError(400, 'INVALID_EVENT', '推荐请求已过期或不包含该视频。');
        const previous = p.events.find(e => e.eventId === c.eventId);
        if (previous) { if (previous.requestId !== c.requestId || previous.kind !== c.kind || previous.videoId !== c.videoId) throw conflict('事件标识已被使用。'); return; }
        if (p.events.some(e => e.requestId === c.requestId && e.kind === c.kind && e.videoId === c.videoId)) return;
        p.events = [...p.events.filter(e => e.at > now - 30 * 86400000), { ...c, at: now, strategy: STRATEGY }].slice(-500);
      }
    });
    return c.action === 'event' ? { ok: true } : this.account(userId);
  }
}
