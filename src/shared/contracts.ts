import type { HistoryEntry } from '../lib/domain.js';
import type { Video } from '../data/videos.js';
import { FOOD_GROUPS, type FoodGroup } from '../lib/foodGroups.js';

export const USERNAME_MAX_LENGTH = 24;
export interface AuthIdentity {
  userId: string;
  username: string;
}

export const TOPICS = ['美食', '搞笑', '影视动画', '知识', '生活', '旅行', '游戏'] as const;
export type Topic = typeof TOPICS[number];
export const STYLES = ['轻松', '安静', '热闹', '沉浸', '治愈'] as const;
export const DURATIONS = ['10分钟以内', '10—30分钟', '30分钟以上'] as const;
export const RECOMMENDATION_EXCLUDE_LIMIT = 150;
export const RECOMMENDATION_EXCLUDE_LENGTH = 4000;
export const RECOMMENDATION_BATCH_SIZE = 6;
export const PREFERENCE_OPTIONS: readonly string[] = [...TOPICS, ...FOOD_GROUPS, ...STYLES, ...DURATIONS];
export const normalizePreferenceTag = (tag: string) => tag === '影视' ? '影视动画' : tag;
export const selectDurationPreferences = (tags: readonly string[]) => DURATIONS.filter(tag => tags.includes(tag));
export type CatalogVideo = Video & { tags: string[]; sourceTags?: string[]; contentGroup?: FoodGroup; coverUrl?: string; published: boolean; revision?: number };
export interface Favorite { key: string; url: string; title: string; at: number; videoId?: string; author?: string; durationSeconds?: number; coverUrl?: string; availability?: 'published' | 'unpublished' | 'unknown' }
export interface Draw extends HistoryEntry { id: string; items?: string[] }
export interface WheelData { items: string[]; history: Draw[]; revision: number }
export interface Submission { id: string; userId: string; url: string; reason: string; status: 'pending' | 'approved' | 'rejected'; reply: string; at: number; reviewedBy?: string; reviewedAt?: number; videoId?: string; video?: Pick<Favorite, 'title' | 'author' | 'durationSeconds' | 'coverUrl'> }
export interface Feedback { id: string; userId: string | null; kind: '问题' | '建议' | '功能' | '视频失效'; text: string; videoId?: string; status: 'open' | 'processing' | 'resolved'; reply: string; at: number; handledBy?: string; handledAt?: number }
export interface Account {
  userId: string;
  wheel: WheelData;
  favorites: Favorite[];
  preferences: string[];
  interests: Record<string, 'like' | 'hide'>;
  interestVideos?: Pick<CatalogVideo, 'id' | 'url' | 'title' | 'author' | 'durationSeconds' | 'coverUrl'>[];
  submissions: Submission[];
  feedback: Feedback[];
  isAdmin: boolean;
}
export interface Recommendation extends CatalogVideo { recommendationReason: string }
export interface RecommendationResult { videos: Recommendation[]; requestId: string; strategy: string; fallback?: boolean; hasMore?: boolean }
export interface PreferenceUpdate { preferences: string[] }
export interface AdminData { videos: CatalogVideo[]; submissions: Submission[]; feedback: Feedback[] }
export interface ApiErrorBody { error: string; code?: string }
export type Command =
  | { action: 'favorite'; url: string; title?: string; remove?: boolean }
  | { action: 'preferences'; tags: string[] }
  | { action: 'interest'; videoId: string; value: 'like' | 'hide' | null; eventId?: string; requestId?: string }
  | { action: 'wheel'; wheel: { items: string[]; history: Draw[] }; revision: number }
  | { action: 'submit'; url: string; reason: string; operationId: string }
  | { action: 'feedback'; kind: Feedback['kind']; text: string; videoId?: string; operationId: string }
  | { action: 'review'; id: string; decision: 'approved' | 'rejected'; reply: string; video?: { title: string; author: string; tags: string[]; reason: string } }
  | { action: 'video'; id: string; published: boolean; revision: number; title?: string; author?: string; reason?: string; tags?: string[] }
  | { action: 'createVideo'; url: string; title: string; author: string; reason: string; tags: string[]; operationId: string }
  | { action: 'deleteAccountData' }
  | { action: 'handleFeedback'; id: string; status: Feedback['status']; reply: string }
  | { action: 'event'; eventId: string; requestId: string; videoId?: string; kind: 'impression' | 'click' | 'next' };
