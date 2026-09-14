/** URL ⇄ API query mapping for the dashboard. */

import type { SlateResponse } from '../shared/types';

export interface SlateQuery {
  demo: boolean;
  progress: number;
  week?: number | undefined;
  seasonType?: number | undefined;
  year?: number | undefined;
}

export const DEFAULT_DEMO_PROGRESS = 72;

const intInRange = (raw: string | null, min: number, max: number): number | undefined => {
  if (raw === null || !/^\d{1,4}$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= min && n <= max ? n : undefined;
};

/** Reads the page URL; out-of-range or malformed values are dropped so the API never sees them. */
export function readQuery(search: string): SlateQuery {
  const p = new URLSearchParams(search);
  const demo = p.get('demo') === '1' || p.get('demo') === 'true';
  const rawProgress = p.get('progress');
  const progress = rawProgress !== null && /^\d{1,4}$/.test(rawProgress) ? Math.min(100, Number(rawProgress)) : undefined;
  return {
    demo,
    progress: progress ?? (demo ? DEFAULT_DEMO_PROGRESS : 100),
    week: intInRange(p.get('week'), 1, 25),
    seasonType: intInRange(p.get('seasontype'), 1, 3),
    year: intInRange(p.get('year'), 2000, 2100),
  };
}

export function toSearch(q: SlateQuery): string {
  const p = new URLSearchParams();
  if (q.demo) {
    p.set('demo', '1');
    p.set('progress', String(q.progress));
  } else {
    if (q.week !== undefined) p.set('week', String(q.week));
    if (q.seasonType !== undefined) p.set('seasontype', String(q.seasonType));
    if (q.year !== undefined) p.set('year', String(q.year));
  }
  return p.toString();
}

export function apiUrl(q: SlateQuery): string {
  const search = toSearch(q);
  return search ? `/api/slate?${search}` : '/api/slate';
}

/** ESPN week numbering: preseason 1–4 (incl. Hall of Fame week), regular 1–18, postseason 1–5. */
export function weekBounds(seasonType: number): [number, number] {
  if (seasonType === 1) return [1, 4];
  if (seasonType === 3) return [1, 5];
  return [1, 18];
}

export interface WeekRef {
  seasonType: number;
  week: number;
}

/** The week before/after, crossing preseason → regular season → postseason boundaries. */
export function adjacentWeek(seasonType: number, week: number, delta: 1 | -1): WeekRef | null {
  const [min, max] = weekBounds(seasonType);
  const next = week + delta;
  if (next >= min && next <= max) return { seasonType, week: next };
  if (delta === 1 && seasonType === 1) return { seasonType: 2, week: 1 };
  if (delta === 1 && seasonType === 2) return { seasonType: 3, week: 1 };
  if (delta === -1 && seasonType === 2) return { seasonType: 1, week: weekBounds(1)[1] };
  if (delta === -1 && seasonType === 3) return { seasonType: 2, week: weekBounds(2)[1] };
  return null;
}

export function isSlateResponse(value: unknown): value is SlateResponse {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<SlateResponse>;
  return Array.isArray(v.games) && typeof v.week === 'number' && typeof v.generatedAt === 'string';
}
