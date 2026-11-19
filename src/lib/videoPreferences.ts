import durations from '../data/bilibili-durations.json' with { type: 'json' };
import type { Video } from '../data/videos.js';
import { DURATIONS, type CatalogVideo } from '../shared/contracts.js';
import { classifyFoodVideo, FOOD_GROUPS } from './foodGroups.js';

type WithDuration = Pick<Video, 'url' | 'durationSeconds'>;

export function videoDurationSeconds(video: WithDuration): number | undefined {
  if (Number.isSafeInteger(video.durationSeconds) && video.durationSeconds! > 0) return video.durationSeconds;
  try {
    const bvid = new URL(video.url).pathname.match(/^\/video\/(BV[A-Za-z0-9]{10})\/?$/)?.[1];
    return bvid ? (durations as Record<string, number>)[bvid] : undefined;
  } catch { return undefined; }
}

export function durationTag(video: WithDuration & { tags?: string[] }) {
  const seconds = videoDurationSeconds(video);
  if (seconds === undefined) return DURATIONS.find(tag => video.tags?.includes(tag));
  if (seconds <= 600) return DURATIONS[0];
  return seconds <= 1800 ? DURATIONS[1] : DURATIONS[2];
}

export function foodGroupFor(video: CatalogVideo) {
  return video.contentGroup ?? FOOD_GROUPS.find(group => video.tags.includes(group)) ?? classifyFoodVideo(video.title, video.sourceTags ?? []);
}
