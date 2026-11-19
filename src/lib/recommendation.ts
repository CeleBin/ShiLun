import { RECOMMENDATION_BATCH_SIZE, selectDurationPreferences, type CatalogVideo, type Recommendation } from '../shared/contracts';
import { durationTag, foodGroupFor } from './videoPreferences';

export const STRATEGY = 'behavior-tag-matches-v7';
const DURATION_MATCH_BONUS = 2;

const aliases = new Map([
  ['美食探店', '探店'], ['探店小吃', '探店'], ['餐厅探店', '探店'],
  ['街边小吃', '街头小吃'], ['街头美食', '街头小吃'], ['虾仁动漫', '虾仁动画'],
  ['美食制作', '烹饪'], ['料理制作', '烹饪'], ['做菜', '烹饪'], ['厨艺', '烹饪'],
  ['美食vlog', '美食'], ['原创动画', '动画'],
]);
const ignored = new Set(['b站', 'bilibili', '哔哩哔哩', '原创', '自制', '必剪创作', '下饭视频', '下饭', '翻滚吧美食假期', '城市美食随手拍', '跟着up主去探店']);
const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/^#+|#+$/g, '').trim();

function contentTags(video: CatalogVideo) {
  const author = normalized(video.author);
  const tags = (video.sourceTags ?? []).map(normalized)
    .filter(tag => tag && tag !== author && !ignored.has(tag)
      && !/^(?:bilibili|哔哩哔哩|up主交流日)|活动$|打卡挑战|投稿活动|计划$|求三连|一键三连/.test(tag));
  return [...new Set(tags.map(tag => aliases.get(tag) ?? tag))];
}

function buildInterests(videos: CatalogVideo[], interests: Record<string, 'like' | 'hide'>, favorites: ReadonlySet<string>, foodGroups: Map<string, ReturnType<typeof foodGroupFor>>) {
  const sourceByVideo = new Map(videos.map(video => [video.id, contentTags(video)]));
  const groupsByVideo = new Map(videos.map(video => {
    const group = foodGroups.get(video.id);
    const groups = group ? ['美食', group] : video.tags.includes('美食') ? ['美食'] : [];
    return [video.id, groups];
  }));
  const tagsByVideo = new Map<string, string[]>();
  const frequencies = new Map<string, number>();
  const firstAuthor = new Map<string, string>();
  const sharedTags = new Set<string>();
  for (const video of videos) {
    const groups = groupsByVideo.get(video.id) ?? [];
    const tags = sourceByVideo.get(video.id) ?? [];
    tagsByVideo.set(video.id, [...new Set([...groups, ...tags])]);
    for (const tag of tags) {
      frequencies.set(tag, (frequencies.get(tag) ?? 0) + 1);
      if (!firstAuthor.has(tag)) firstAuthor.set(tag, video.author);
      else if (firstAuthor.get(tag) !== video.author) sharedTags.add(tag);
    }
  }
  const totals = new Map<string, number>();
  for (const [id, tags] of tagsByVideo) {
    if (interests[id] === 'hide') continue;
    const liked = interests[id] === 'like';
    const weight = favorites.has(id) ? (liked ? 2 : 1.5) : (liked ? 1 : 0);
    if (!weight) continue;
    const groups = groupsByVideo.get(id) ?? [];
    const weighted = tags.flatMap(tag => {
      const frequency = frequencies.get(tag) ?? 0;
      return !groups.includes(tag) && sharedTags.has(tag) ? [{ tag, weight: 1 / Math.sqrt(frequency) }] : [];
    });
    const groupWeight = groups.length ? (weighted.length ? weight / 2 : weight) : 0;
    for (const group of groups) totals.set(group, (totals.get(group) ?? 0) + groupWeight / groups.length);
    const totalWeight = weighted.reduce((total, tag) => total + tag.weight, 0);
    for (const entry of weighted) {
      totals.set(entry.tag, (totals.get(entry.tag) ?? 0) + (weight - groupWeight) * entry.weight / totalWeight);
    }
  }
  const scores = new Map([...totals].map(([tag, value]) => [tag, Math.log2(1 + value)]));
  return { tagsByVideo, scores };
}

export function recommend(
  videos: CatalogVideo[], preferences: string[] = [], interests: Record<string, 'like' | 'hide'> = {},
  exclude: string[] = [], count = RECOMMENDATION_BATCH_SIZE, favorites: ReadonlySet<string> = new Set(),
): Recommendation[] {
  const published = videos.filter(video => video.published);
  const excluded = new Set(exclude);
  const foodGroups = new Map(published.map(video => [video.id, foodGroupFor(video)]));
  const { tagsByVideo, scores } = buildInterests(published, interests, favorites, foodGroups);
  const durationPreferences = new Set(selectDurationPreferences(preferences));
  const candidates = published.filter(video => interests[video.id] !== 'hide' && !excluded.has(video.id)).map(video => {
    const related = (tagsByVideo.get(video.id) ?? []).flatMap(tag => {
      const score = scores.get(tag);
      return score ? [{ tag, score }] : [];
    }).sort((a, b) => b.score - a.score).slice(0, 2);
    const behaviorScore = (related[0]?.score ?? 0) + (related[1]?.score ?? 0) * 0.5;
    const duration = durationPreferences.size ? durationTag(video) : undefined;
    const durationMatch = duration !== undefined && durationPreferences.has(duration) ? duration : undefined;
    const score = behaviorScore + (durationMatch ? DURATION_MATCH_BONUS : 0);
    return { video, related, behaviorScore, score, duration, durationMatch };
  });
  candidates.sort((a, b) => b.score - a.score || a.video.id.localeCompare(b.video.id));

  const result: Recommendation[] = [];
  const authors = new Set<string>();
  const explorationCount = candidates.some(candidate => candidate.behaviorScore > 0) ? Math.floor(count / 3) : 0;
  let diversifyDuration = count >= 3 && durationPreferences.size === 1;
  while (candidates.length && result.length < count) {
    const exploring = result.length >= count - explorationCount;
    const differentDurations = diversifyDuration && result.length === count - 1
      ? candidates.filter(candidate => candidate.duration && !candidate.durationMatch) : [];
    const preferred = differentDurations.length ? differentDurations : candidates.filter(candidate => exploring ? candidate.behaviorScore === 0 : candidate.score > 0);
    const pool = preferred.length ? preferred : candidates;
    const selected = pool.find(candidate => !authors.has(candidate.video.author)) ?? pool[0];
    candidates.splice(candidates.indexOf(selected), 1);
    const { video, related, durationMatch } = selected;
    diversifyDuration &&= !!durationMatch;
    authors.add(video.author);
    const recommendationReason = durationMatch ? `符合你的时长偏好：${durationMatch}`
      : related.length ? `与你喜欢或收藏的视频共享标签：${related.map(entry => entry.tag).join('、')}` : '编辑精选，尝试不同内容';
    result.push({ ...video, recommendationReason });
  }
  return result;
}
