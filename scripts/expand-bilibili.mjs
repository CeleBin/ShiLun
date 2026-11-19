import { readFile } from 'node:fs/promises';
import { createServer, loadEnv } from 'vite';

const starter = JSON.parse(await readFile(new URL('../src/data/bilibili-starter.json', import.meta.url), 'utf8'));
const authors = [
  { name: '小紧张的虫虫', uid: '6087825', quota: 12 },
  { name: '布墨迹动画', uid: '1263688319', quota: 12 },
  { name: '三国虾_', uid: '3546577377430053', quota: 12 },
  { name: '魔鬼厨房Neo', uid: '174890586', quota: 12 },
  { name: '-超级小能猫-', uid: '1379165407', quota: 12 },
  { name: '圆桌动漫', uid: '654552', quota: 12 },
  { name: '真探唐仁杰', uid: '544336675', quota: 5 },
  { name: '丹妮妮妮妮2098', uid: '1110156033', quota: 5 },
];

const apply = process.argv.includes('--apply');
const tagsOnly = process.argv.includes('--tags-only');
const searchFood = process.argv.includes('--search-food');
if (tagsOnly && searchFood) throw new Error('Choose --tags-only or --search-food');
const target = Number(process.argv.find(arg => arg.startsWith('--target='))?.slice(9) ?? 100);
if (!Number.isInteger(target) || target < 1 || target > 500) throw new Error('--target must be an integer from 1 to 500');
const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
const vite = await createServer({
  configFile: false, envFile: false, appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});

const idPattern = /^BV[A-Za-z0-9]{10}$/;
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const key = 'shilun:v2:moderation';

async function publicPage(url) {
  const address = new URL(url);
  if (address.origin !== 'https://www.bilibili.com') throw new Error('Unexpected source host');
  const response = await fetch(address, { redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const html = await response.text();
  const script = html.match(/__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Public page has no video metadata');
  const chunk = script.split(';(function')[0];
  return JSON.parse(chunk.slice(0, chunk.lastIndexOf('}') + 1));
}

async function collect(author, known) {
  const anchors = starter.filter(video => video.author === author.name);
  const pages = anchors.flatMap(video => [...new Set([video.source, video.url])]);
  const candidates = new Map();
  for (const url of new Set(pages)) {
    if (candidates.size >= author.quota * 2) break;
    const source = new URL(url);
    try {
      const state = await publicPage(url);
      const uidList = source.pathname.replace(/\/$/, '') === '/list/' + author.uid;
      const items = uidList
        ? (Array.isArray(state.resourceList) ? state.resourceList : [])
        : (Array.isArray(state.related) ? state.related : []).filter(row => String(row.owner?.mid) === author.uid);
      for (const row of items) {
        if (!idPattern.test(row.bvid) || known.has('bilibili:' + row.bvid) || candidates.has(row.bvid)) continue;
        const title = typeof row.title === 'string' ? row.title.trim() : '';
        if (!title || title.length > 160 || /充电专属|试看|花絮|招募|停更|预告/.test(title) || row.redirect_url || row.redirected_url || row.season_type) continue;
        const duration = row.duration ?? row.pages?.reduce((sum, page) => sum + (Number(page.duration) || 0), 0);
        if (!Number.isFinite(duration) || duration < 60 || duration > 5400) continue;
        const anchor = anchors[0];
        const durationTag = duration <= 600 ? '10分钟以内' : duration <= 1800 ? '10—30分钟' : '30分钟以上';
        candidates.set(row.bvid, {
          id: 'bilibili:' + row.bvid, url: 'https://www.bilibili.com/video/' + row.bvid,
          title, author: author.name, reason: '来自你关注的下饭片单类型：' + anchor.label + '。', durationSeconds: duration,
          artwork: anchor.artwork, label: anchor.label, source: url, verifiedAt: day,
          tags: [...anchor.tags, durationTag], published: true, revision: 0,
        });
      }
    } catch (error) {
      console.warn(author.name + ' ' + source.pathname + ' skipped: ' + error.message);
    }
    await new Promise(resolve => setTimeout(resolve, 450));
  }
  return [...candidates.values()].slice(0, author.quota);
}

async function collectFood(rule, quota, known, getMetadata, getTags, classify) {
  const candidates = [];
  const usedAuthors = new Set();
  let checked = 0;
  for (const term of rule.terms) {
    if (candidates.length >= quota) break;
    const search = new URL('https://search.bilibili.com/all');
    search.searchParams.set('keyword', term);
    const response = await fetch(search, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Public Bilibili search returned HTTP ' + response.status);
    const html = await response.text();
    const ids = new Set([...html.matchAll(/\/video\/(BV[1-9A-Za-z]{10})\b/g)].map(match => match[1]));
    let attempts = 0;
    for (const bvid of ids) {
      if (candidates.length >= quota || attempts >= 12) break;
      const id = `bilibili:${bvid}`;
      if (known.has(id)) continue;
      known.add(id);
      attempts++;
      if (checked++) await new Promise(resolve => setTimeout(resolve, 650));
      const metadata = await getMetadata(bvid);
      if (!metadata?.author || !metadata.durationSeconds || usedAuthors.has(metadata.author)
        || /充电专属|试看|花絮|招募|停更|预告/.test(metadata.title)
        || metadata.durationSeconds < 60 || metadata.durationSeconds > 5400) continue;
      const sourceTags = await getTags(bvid);
      if (!sourceTags || classify(metadata.title, sourceTags) !== rule.group) continue;
      const durationTag = metadata.durationSeconds <= 600 ? '10分钟以内' : metadata.durationSeconds <= 1800 ? '10—30分钟' : '30分钟以上';
      candidates.push({
        ...metadata, id, url: `https://www.bilibili.com/video/${bvid}`,
        label: rule.group, contentGroup: rule.group, reason: rule.group,
        artwork: rule.group === '探店试吃' ? 'town' : 'pot', tags: ['美食', durationTag],
        sourceTags, source: search.href, verifiedAt: day, published: true, revision: 0,
      });
      usedAuthors.add(metadata.author);
    }
  }
  return candidates;
}

try {
  const [{ RedisStore }, { seedCatalog }, { normalizeVideoUrl }, { getBilibiliTags, getBilibiliMetadata }, { FOOD_SEARCHES, classifyFoodVideo }] = await Promise.all([
    vite.ssrLoadModule('/server/store.ts'),
    vite.ssrLoadModule('/server/service.ts'),
    vite.ssrLoadModule('/src/lib/accountRules.ts'),
    vite.ssrLoadModule('/server/bilibili.ts'),
    vite.ssrLoadModule('/src/lib/foodGroups.ts'),
  ]);
  const redis = new RedisStore(env.UPSTASH_REDIS_REST_URL ?? '', env.UPSTASH_REDIS_REST_TOKEN ?? '');
  const emptyCatalog = () => ({ videos: seedCatalog(), submissions: [], feedback: [], audit: [], operations: {} });
  const original = await redis.get(key);
  const baseline = original === null ? emptyCatalog() : JSON.parse(original);
  const knownIds = doc => new Set(doc.videos.map(video => normalizeVideoUrl(video.url).key));
  const known = knownIds(baseline);
  const published = doc => doc.videos.filter(video => video.published).length;
  const candidates = [];
  if (!tagsOnly && published(baseline) < target) {
    const groups = [];
    if (searchFood) {
      const quota = Math.ceil((target - published(baseline)) / FOOD_SEARCHES.length);
      for (const rule of FOOD_SEARCHES) {
        groups.push(await collectFood(rule, quota, known, getBilibiliMetadata, getBilibiliTags, classifyFoodVideo));
      }
      console.log(JSON.stringify(groups.flat().map(({ title, author, url, contentGroup }) => ({ title, author, url, contentGroup }))));
    } else {
      for (const author of authors) {
        const group = await collect(author, known);
        groups.push(group);
        console.log(author.name + ': ' + group.length + ' candidates');
      }
    }
    // Take one item per author each round so the last author still gets a fair share.
    while (groups.some(group => group.length)) {
      for (const group of groups) if (group.length) candidates.push(group.shift());
    }
  }

  const tagsByKey = new Map();
  const tagCandidates = tagsOnly ? baseline.videos : candidates.slice(0, Math.max(0, target - published(baseline)));
  let consecutiveFailures = 0;
  let tagAttempts = 0;
  for (const video of tagCandidates) {
    if (!video.published || Array.isArray(video.sourceTags)) continue;
    const tagKey = normalizeVideoUrl(video.url).key;
    const bvid = tagKey.slice('bilibili:'.length);
    if (!idPattern.test(bvid)) continue;
    if (tagAttempts++) await new Promise(resolve => setTimeout(resolve, 650));
    const tags = await getBilibiliTags(bvid);
    if (tags === undefined) {
      if (++consecutiveFailures >= 4) {
        console.warn('Stopped label requests after consecutive failures. Re-run to resume.');
        break;
      }
      continue;
    }
    consecutiveFailures = 0;
    tagsByKey.set(tagKey, tags);
  }
  console.log(JSON.stringify({ tagAttempts, tagResponses: tagsByKey.size, withTags: [...tagsByKey.values()].filter(tags => tags.length).length }));

  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = attempt === 0 ? original : await redis.get(key);
    const doc = previous === null ? emptyCatalog() : JSON.parse(previous);
    const existing = knownIds(doc);
    const room = Math.min(500 - doc.videos.length, Math.max(0, target - published(doc)));
    const added = [];
    for (const candidate of candidates) {
      if (added.length >= room) break;
      if (existing.has(candidate.id)) continue;
      existing.add(candidate.id);
      added.push(candidate);
    }
    const expected = published(doc) + added.length;
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', currentPublished: published(doc), toAdd: added.length, expectedPublished: expected, target }));
    if (!tagsOnly && expected < target) process.exitCode = 2;
    const updated = [...doc.videos, ...added].filter(video => {
      if (!video.published || Array.isArray(video.sourceTags)) return false;
      const sourceTags = tagsByKey.get(normalizeVideoUrl(video.url).key);
      if (!sourceTags) return false;
      video.sourceTags = sourceTags;
      return true;
    });
    if (!apply || (!added.length && !updated.length && (tagsOnly || previous !== null))) break;
    if (doc.audit.length >= 5000) throw new Error('Catalog audit limit reached');
    doc.videos.push(...added);
    doc.audit.push({ actor: 'operator:catalog-import', action: tagsOnly ? 'publicBilibiliTagBackfill' : 'publicBilibiliImport', id: day, at: Date.now() });
    const next = JSON.stringify(doc);
    if (Buffer.byteLength(next) > 1_500_000) throw new Error('Catalog document limit reached');
    if (await redis.compareAndSet(key, previous, next)) {
      const saved = JSON.parse(await redis.get(key));
      const savedIds = knownIds(saved);
      if (!added.every(video => savedIds.has(video.id))) throw new Error('Import could not be verified');
      const savedTaggedIds = new Set(saved.videos.filter(video => Array.isArray(video.sourceTags)).map(video => video.id));
      if (!updated.every(video => savedTaggedIds.has(video.id))) throw new Error('Label import could not be verified');
      console.log(JSON.stringify({ added: added.length, updatedTags: updated.length, verifiedPublished: published(saved), publishedWithTags: saved.videos.filter(video => video.published && video.sourceTags?.length).length }));
      break;
    }
    if (attempt === 4) throw new Error('Catalog changed concurrently; retry the import');
  }
} finally {
  await vite.close();
}
