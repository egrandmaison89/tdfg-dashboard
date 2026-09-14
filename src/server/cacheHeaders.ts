/** CDN cache policy (ARCHITECTURE §3, layer 1). */

import type { HistoryResponse } from '../shared/history';
import type { SlateResponse } from '../shared/types';

export const TTL = {
  live: 20,
  nearKickoff: 60,
  allFinal: 600,
  /** A specific past week (explicit params) whose games are long settled. */
  archived: 86_400,
  idle: 300,
  stale: 15,
  error: 10,
  demo: 3600,
  historyIncomplete: 10,
  historyLive: 30,
  history: 600,
} as const;

/** Kickoff this long ago with every game settled means the week can't change any more. */
const ARCHIVE_AFTER_MS = 36 * 60 * 60_000;

/** Short-TTL responses may be served this stale while revalidating, keeping live data ≤ ~25 s old at the CDN. */
export const SHORT_SWR_SECONDS = 5;

const MINUTE_MS = 60_000;

/** Query params that change the response; everything else shares one cache entry. */
export const VARY_QUERY = 'year|seasontype|week|demo|progress';

export interface TtlOptions {
  /** The request named a specific week (not "current"), so a settled week can be cached long. */
  pinnedWeek?: boolean;
}

export function cdnTtlSeconds(slate: SlateResponse, nowMs: number, options: TtlOptions = {}): number {
  if (slate.source === 'demo') return TTL.demo;
  if (slate.stale) return TTL.stale;
  const games = slate.games.filter((g) => g.state !== 'void');
  if (games.length === 0) return TTL.idle;
  if (games.some((g) => g.state === 'in' || !g.legsVerified)) return TTL.live;

  const pending = games.filter((g) => g.state === 'pre');
  if (pending.length === 0) {
    // Never for the default (current-week) URL: it must roll over to the next week promptly.
    const newestKickoff = Math.max(...games.map((g) => Date.parse(g.kickoff)));
    if (options.pinnedWeek && nowMs - newestKickoff > ARCHIVE_AFTER_MS) return TTL.archived;
    return TTL.allFinal;
  }
  const untilKickoff = Math.min(...pending.map((g) => Date.parse(g.kickoff) - nowMs));
  if (untilKickoff <= 15 * MINUTE_MS) return TTL.live;
  if (untilKickoff <= 3 * 60 * MINUTE_MS) return TTL.nearKickoff;
  return TTL.idle;
}

export function historyTtlSeconds(history: HistoryResponse): number {
  if (history.incomplete) return TTL.historyIncomplete;
  if (history.seasons.some((s) => s.weeks.some((w) => w.status === 'live'))) return TTL.historyLive;
  return TTL.history;
}

export function cacheHeaders(ttlSeconds: number): Record<string, string> {
  const swr = ttlSeconds <= TTL.live ? SHORT_SWR_SECONDS : ttlSeconds;
  return {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${ttlSeconds}, stale-while-revalidate=${swr}`,
    'Netlify-Vary': `query=${VARY_QUERY}`,
  };
}
