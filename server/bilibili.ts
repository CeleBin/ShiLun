export interface BilibiliMetadata {
  title: string;
  author?: string;
  durationSeconds?: number;
  coverUrl?: string;
}

function label(value: unknown, limit: number) {
  if (typeof value !== 'string') return undefined;
  return [...value.replace(/\s+/g, ' ').trim()].slice(0, limit).join('') || undefined;
}

function coverAddress(value: unknown) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value, 'https://www.bilibili.com');
    if (!['http:', 'https:'].includes(url.protocol) || !/^i\d\.hdslb\.com$/.test(url.hostname)
      || !url.pathname.startsWith('/bfs/') || url.username || url.password || url.port || url.pathname.length > 400) return undefined;
    return `https://${url.hostname}${url.pathname}`;
  } catch { return undefined; }
}

export async function getBilibiliMetadata(bvid: string): Promise<BilibiliMetadata | undefined> {
  if (!/^BV[A-Za-z0-9]{10}$/.test(bvid)) return undefined;
  const url = new URL('https://api.bilibili.com/x/web-interface/view');
  url.searchParams.set('bvid', bvid);
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!response.ok) return undefined;
    const body = await response.json() as {
      code?: number;
      data?: { bvid?: string; title?: unknown; owner?: { name?: unknown }; duration?: unknown; pic?: unknown };
    };
    const entry = body.data;
    if (body.code !== 0 || entry?.bvid !== bvid) return undefined;
    const title = label(entry.title, 160);
    if (!title) return undefined;
    const duration = entry.duration;
    return {
      title,
      author: label(entry.owner?.name, 120),
      durationSeconds: typeof duration === 'number' && Number.isSafeInteger(duration) && duration > 0 ? duration : undefined,
      coverUrl: coverAddress(entry.pic),
    };
  } catch {
    return undefined;
  }
}

export async function getBilibiliTags(bvid: string): Promise<string[] | undefined> {
  if (!/^BV[A-Za-z0-9]{10}$/.test(bvid)) return undefined;
  const url = new URL('https://api.bilibili.com/x/tag/archive/tags');
  url.searchParams.set('bvid', bvid);
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!response.ok) return undefined;
    const body = await response.json() as { code?: number; data?: unknown };
    if (body.code !== 0 || !Array.isArray(body.data)) return undefined;
    const tags = body.data.flatMap(entry => {
      const name = label(entry?.tag_name, 60);
      return name ? [name] : [];
    });
    return [...new Set(tags)].slice(0, 30);
  } catch {
    return undefined;
  }
}
