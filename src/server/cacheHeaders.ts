/** CDN cache policy (ARCHITECTURE §3, layer 1). */

import type { SlateResponse } from '../shared/types';

export const TTL = {
  live: 20,
  nearKickoff: 60,
  allFinal: 600,
  idle: 300,
  stale: 15,
  error: 10,
  demo: 3600,
} as const;

/** Short-TTL responses may be served this stale while revalidating, keeping live data ≤ ~25 s old at the CDN. */
export const SHORT_SWR_SECONDS = 5;

const MINUTE_MS = 60_000;

/** Query params that change the response; everything else shares one cache entry. */
export const VARY_QUERY = 'year|seasontype|week|demo|progress';

export function cdnTtlSeconds(slate: SlateResponse, nowMs: number): number {
  if (slate.source === 'demo') return TTL.demo;
  if (slate.stale) return TTL.stale;
  const games = slate.games.filter((g) => g.state !== 'void');
  if (games.length === 0) return TTL.idle;
  if (games.some((g) => g.state === 'in' || !g.legsVerified)) return TTL.live;

  const pending = games.filter((g) => g.state === 'pre');
  if (pending.length === 0) return TTL.allFinal;
  const untilKickoff = Math.min(...pending.map((g) => Date.parse(g.kickoff) - nowMs));
  if (untilKickoff <= 15 * MINUTE_MS) return TTL.live;
  if (untilKickoff <= 3 * 60 * MINUTE_MS) return TTL.nearKickoff;
  return TTL.idle;
}

export function cacheHeaders(ttlSeconds: number): Record<string, string> {
  const swr = ttlSeconds <= TTL.live ? SHORT_SWR_SECONDS : ttlSeconds;
  return {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${ttlSeconds}, stale-while-revalidate=${swr}`,
    'Netlify-Vary': `query=${VARY_QUERY}`,
  };
}
