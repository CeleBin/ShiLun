import { expect, it } from 'vitest';
import { videos } from './videos';
import { isBilibiliUrl } from '../lib/domain';

it('publishes only complete, uniquely identified curated Bilibili entries', () => {
  expect(videos.length).toBeGreaterThanOrEqual(3);
  expect(new Set(videos.map((video) => video.id)).size).toBe(videos.length);
  expect(new Set(videos.map((video) => video.url)).size).toBe(videos.length);
  for (const video of videos) {
    expect(isBilibiliUrl(video.url)).toBe(true);
    expect(video.title.trim()).not.toBe('');
    expect(video.author.trim()).not.toBe('');
    expect(video.reason.trim()).not.toBe('');
    expect(video.source).toMatch(/^https:\/\/www\.bilibili\.com\//);
    expect(video.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
});
