import { useState } from 'react';
import type { Video } from '../data/videos';
import { durationTag, videoDurationSeconds } from '../lib/videoPreferences';
import { Artwork } from './Artwork';
import { Icon } from './Icons';

const coverAssets = import.meta.glob<string>('../assets/video-covers/*.{jpg,png,webp}', {
  eager: true, query: '?url', import: 'default',
});
const coversById = new Map(Object.entries(coverAssets).map(([path, url]) => [
  path.split('/').pop()!.split('.')[0], url,
]));

export function durationLabel(video: Pick<Video, 'url' | 'durationSeconds'> & { tags?: string[] }) {
  const seconds = videoDurationSeconds(video);
  if (seconds === undefined) return durationTag(video);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours ? hours + ':' + String(minutes).padStart(2, '0') + ':' + remainder : minutes + ':' + remainder;
}

function videoPath(url: string) {
  try { return new URL(url).pathname; } catch { return ''; }
}

export function coverSource(url: string) {
  const path = videoPath(url);
  const id = path.match(/^\/(?:video\/(BV[A-Za-z0-9]{10})|bangumi\/play\/(ss\d+))\/?$/)?.slice(1).find(Boolean);
  return id ? coversById.get(id) : undefined;
}

export function VideoCover({ url, artwork, remoteCover }: { url: string; artwork?: Video['artwork']; remoteCover?: string }) {
  const cover = coverSource(url) ?? remoteCover;
  const [failedSource, setFailedSource] = useState<string>();

  if (cover && failedSource !== cover) {
    return <img className="video-thumbnail" src={cover} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSource(cover)} />;
  }
  if (!artwork) return <span className="favorite-cover-placeholder"><Icon name="play" size={20} /></span>;
  return <><Artwork kind={artwork} /><span className="art-credit">示意插画</span></>;
}
