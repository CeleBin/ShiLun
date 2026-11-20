import { useCallback, useEffect, useRef, useState } from 'react';
import { videos } from '../data/videos';
import { isBilibiliUrl } from '../lib/domain';
import { api, type TokenGetter } from '../lib/api';
import { durationTag } from '../lib/videoPreferences';
import { RECOMMENDATION_BATCH_SIZE, RECOMMENDATION_EXCLUDE_LENGTH, RECOMMENDATION_EXCLUDE_LIMIT, type Account, type Command, type Recommendation, type RecommendationResult } from '../shared/contracts';
import { coverSource, durationLabel, VideoCover } from './VideoCover';
import { Icon } from './Icons';

const curated = videos.filter(video => isBilibiliUrl(video.url));
const PREFETCH_TTL_MS = 30_000;
interface Props { account: Account | null; getToken: TokenGetter; command: (command: Command) => Promise<unknown>; onLogin: () => void; onAccount: () => void; onSubmitVideo: () => void }
type VideoWrite = Extract<Command, { action: 'favorite' | 'interest' }>;
type PreparedBatch = { value: RecommendationResult; excluded: string };

function addToExclusions(excluded: string, batch: Recommendation[]) {
  const ids = new Set(excluded ? excluded.split(',') : []);
  for (const video of batch) ids.add(video.id);
  const recent = [...ids].slice(-RECOMMENDATION_EXCLUDE_LIMIT);
  while (recent.join(',').length > RECOMMENDATION_EXCLUDE_LENGTH) recent.shift();
  return recent.join(',');
}

export function Videos({ account, getToken, command, onLogin, onAccount, onSubmitVideo }: Props) {
  const [result, setResult] = useState<RecommendationResult>({ videos: [], requestId: '', strategy: 'static' });
  const [roundExclusion, setRoundExclusion] = useState('');
  const [pending, setPending] = useState(false);
  const latestWrites = useRef<ReadonlyMap<string, VideoWrite>>(new Map());
  const [writes, setWrites] = useState(latestWrites.current);
  const [writeError, setWriteError] = useState('');
  const [notice, setNotice] = useState('');
  const run = useRef(0);
  const nextBatch = useRef<{ key: string; startedAt: number; response: Promise<PreparedBatch | undefined> } | null>(null);
  const pendingFeedback = useRef<Promise<unknown> | null>(null);
  const accountRef = useRef(account);
  accountRef.current = account;
  const preferenceSignature = JSON.stringify(account?.preferences ?? []);
  const canChangeBatch = result.hasMore ?? curated.length > RECOMMENDATION_BATCH_SIZE;
  const favoriteKeys = account?.favorites.map(favorite => favorite.key).sort();
  const batchKey = JSON.stringify([result.requestId, roundExclusion, preferenceSignature, account?.userId, account?.interests, favoriteKeys]);
  const currentBatchIds = result.videos.map(video => video.id).join(',');
  const cards = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());
  const fetchBatch = useCallback((exclude = '', signal?: AbortSignal) =>
    api<RecommendationResult>('recommendations', getToken, undefined, signal, { exclude }), [getToken]);
  const fetchNext = useCallback(async (excluded: string, lastBatch: string, signal?: AbortSignal): Promise<PreparedBatch> => {
    const value = await fetchBatch(excluded, signal);
    if (!value.videos.length && value.hasMore && lastBatch && lastBatch !== excluded) {
      // Start a fresh round while keeping the batch on screen out of the next draw.
      return { value: await fetchBatch(lastBatch, signal), excluded: lastBatch };
    }
    return { value, excluded };
  }, [fetchBatch]);

  async function load(exclude = '', lastBatch = '', prepared?: Promise<PreparedBatch | undefined>, feedback?: Promise<unknown> | null) {
    const sequence = ++run.current;
    setPending(true);
    try {
      if (feedback) await feedback.catch(() => undefined);
      const cached = !feedback && prepared ? await prepared : undefined;
      if (sequence !== run.current) return;
      const { value, excluded } = cached ?? await fetchNext(exclude, lastBatch);
      if (sequence !== run.current) return;
      setRoundExclusion(addToExclusions(excluded, value.videos));
      setResult(value); setNotice(value.fallback ? (value.videos.length ? '先看看这几份精选，慢慢挑一个。' : '片单暂时无法读取，请稍后重试。') : '');
    } catch {
      if (sequence !== run.current) return;
      setResult({ videos: [], requestId: '', strategy: 'unavailable', fallback: true, hasMore: false });
      setNotice('片单暂时无法读取，请稍后重试。');
    } finally { if (sequence === run.current) setPending(false); }
  }
  useEffect(() => { void load(); return () => { run.current++; }; }, [getToken, preferenceSignature]);
  useEffect(() => {
    if (!canChangeBatch || result.fallback || !currentBatchIds) return;
    const controller = new AbortController();
    const response = fetchNext(roundExclusion, currentBatchIds, controller.signal).then(prepared => {
      const { value } = prepared;
      if (controller.signal.aborted || value.fallback) return undefined;
      for (const video of value.videos) {
        if (!video.published || !isBilibiliUrl(video.url)) continue;
        const source = coverSource(video.url) ?? video.coverUrl;
        if (source) new Image().src = source;
      }
      return prepared;
    }).catch(() => undefined);
    nextBatch.current = { key: batchKey, startedAt: Date.now(), response };
    return () => {
      controller.abort();
      nextBatch.current = null;
    };
  }, [batchKey, canChangeBatch, currentBatchIds, fetchNext, result.fallback, roundExclusion]);
  function record(kind: 'impression' | 'click' | 'next', videoId?: string) {
    if (!accountRef.current || !result.requestId) return;
    void command({ action: 'event', kind, videoId, requestId: result.requestId, eventId: crypto.randomUUID() }).catch(() => undefined);
  }
  useEffect(() => {
    if (!account || !result.requestId || !cards.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      const id = (entry.target as HTMLElement).dataset.videoId;
      const key = `${result.requestId}:${id}`;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5 && id && !seen.current.has(key)) { seen.current.add(key); record('impression', id); observer.unobserve(entry.target); }
    }), { threshold: 0.5 });
    cards.current.querySelectorAll('[data-video-id]').forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [result, account?.userId]);
  async function interact(videoId: string, input: VideoWrite) {
    if (!account) { onAccount(); return; }
    const writeKey = `${videoId}:${input.action}`;
    const previous = latestWrites.current.get(writeKey);
    const togglesLike = input.action === 'interest' && input.value !== 'hide';
    if (previous && !(togglesLike && previous.action === 'interest' && previous.value !== 'hide')) return;
    latestWrites.current = new Map(latestWrites.current).set(writeKey, input);
    setWrites(latestWrites.current);
    setWriteError('');
    nextBatch.current = null;
    // The account command queue saves these intents in click order.
    const write = command(input);
    pendingFeedback.current = write;
    try {
      await write;
    } catch (cause) {
      if (latestWrites.current.get(writeKey) === input) {
        const reason = cause instanceof Error ? cause.message : '请重试。';
        setWriteError('操作未保存，已恢复原状态。' + reason);
      }
    } finally {
      if (pendingFeedback.current === write) pendingFeedback.current = null;
      if (latestWrites.current.get(writeKey) === input) {
        const next = new Map(latestWrites.current);
        next.delete(writeKey);
        latestWrites.current = next;
        setWrites(next);
      }
    }
  }
  function interestFor(videoId: string) {
    const write = writes.get(`${videoId}:interest`);
    return write?.action === 'interest' ? write.value : account?.interests[videoId];
  }
  const visible = result.videos.filter(video => isBilibiliUrl(video.url) && video.published && interestFor(video.id) !== 'hide');
  const batchHidden = result.videos.length > 0 && result.videos.every(video => interestFor(video.id) === 'hide');
  return <section className="videos-section" aria-labelledby="videos-title" id="videos">
    <div className="section-heading">
      <div><h2 id="videos-title">
        <span className="video-heading-desktop">饭有了，配点<span>好看的。</span></span>
        <span className="video-heading-mobile">下饭视频</span>
      </h2></div>
      <div className="video-heading-actions">
        <button type="button" className="text-button video-submit-button" onClick={onSubmitVideo}>投稿</button>
        <button className="batch-button" onClick={() => onAccount()}>我的收藏</button>
        {canChangeBatch && <button className="batch-button batch-button-primary" disabled={pending} onClick={() => {
          record('next');
          const prepared = nextBatch.current;
          const fresh = prepared?.key === batchKey && Date.now() - prepared.startedAt < PREFETCH_TTL_MS;
          void load(roundExclusion, currentBatchIds, fresh ? prepared.response : undefined, pendingFeedback.current);
        }}><Icon name="refresh" size={16} />{pending ? '加载中…' : '换一批'}</button>}
      </div>
    </div>
    {notice && <p className="video-action-notice" role="status">{notice}</p>}
    {writeError && <p className="video-action-notice" role="status">{writeError}</p>}
    <div className="video-grid" ref={cards}>
      {visible.map(video => {
        const favoriteWrite = writes.get(`${video.id}:favorite`);
        const interestWrite = writes.get(`${video.id}:interest`);
        const favorite = favoriteWrite?.action === 'favorite'
          ? !favoriteWrite.remove
          : account?.favorites.some(item => item.videoId === video.id || item.url.replace(/\/$/, '') === video.url.replace(/\/$/, ''));
        const liked = interestFor(video.id) === 'like';
        const duration = durationLabel(video);
        const videoDuration = durationTag(video);
        const matchesDuration = videoDuration && account?.preferences.includes(videoDuration);
        const requestContext = result.requestId && !result.fallback ? { requestId: result.requestId } : {};
        const openVideo = () => record('click', video.id);
        return <article className="video-card" key={video.id} data-video-id={video.id}>
          <a href={video.url} target="_blank" rel="noopener noreferrer" className="video-cover" tabIndex={-1} aria-hidden="true" onClick={openVideo}>
            <VideoCover url={video.url} artwork={video.artwork} remoteCover={video.coverUrl} />
            {duration && <span className="video-duration">{duration}</span>}
          </a>
          <div className="video-body">
            <h3><a href={video.url} title={video.title} target="_blank" rel="noopener noreferrer" onClick={openVideo}>{video.title}<span className="sr-only">（在新标签页打开 B 站）</span></a></h3>
            <p className="video-source">
              <span className="video-platform">B站</span>
              <span className="source-line" aria-hidden="true" />
              <span>{video.author}</span>
              {video.label && <span className="video-category">{video.label}</span>}
              {duration && <span className="sr-only">时长 {duration}</span>}
            </p>
            {matchesDuration && <p className="recommendation-why">符合你的时长偏好：{videoDuration}</p>}
            <div className="video-personal-actions" aria-busy={!!(favoriteWrite || interestWrite)}>
              <button disabled={!!favoriteWrite} aria-pressed={!!favorite} onClick={() => void interact(video.id, { action: 'favorite', url: video.url, title: video.title, remove: !!favorite })}>{favorite ? '已收藏' : '收藏'}</button>
              <button aria-pressed={liked} onClick={() => void interact(video.id, { action: 'interest', videoId: video.id, value: liked ? null : 'like', eventId: crypto.randomUUID(), ...requestContext })}>{liked ? '已喜欢' : '喜欢'}</button>
              <button disabled={!!interestWrite} onClick={() => void interact(video.id, { action: 'interest', videoId: video.id, value: 'hide', eventId: crypto.randomUUID(), ...requestContext })}>不感兴趣</button>
            </div>
          </div>
        </article>;
      })}
    </div>
    {!visible.length && <p className="empty-videos">{pending ? '片单正在准备中…' : result.fallback ? '稍后再试，转盘仍可继续使用。' : batchHidden ? (result.hasMore ? '这批视频已隐藏，点「换一批」继续挑。' : '这批视频已隐藏。') : '暂时没有匹配的片子，试试调整偏好。'}{!batchHidden && <button className="text-button" disabled={pending} onClick={() => result.fallback ? void load() : account ? onAccount() : onLogin()}>{result.fallback ? '重新读取片单' : '调整偏好'}</button>}</p>}
  </section>;
}
