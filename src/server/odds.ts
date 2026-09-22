/** Week odds storage (SPEC F16, §5c): one small record per week in the same cache as everything else. */

import { safeEqual, validateOdds } from '../shared/odds';
import type { WeekOdds } from '../shared/types';
import type { KeyValueCache } from './cache';

export interface WeekRef {
  season: number;
  seasonType: number;
  week: number;
}

export const oddsKey = (ref: WeekRef) => `odds/${ref.season}-${ref.seasonType}-${ref.week}`;

/** Odds are entered by hand and must not vanish, so they get more patience than cache reads. */
export const ODDS_READ_TIMEOUT_MS = 4_000;
export const ODDS_WRITE_TIMEOUT_MS = 6_000;

export function readOdds(cache: KeyValueCache, ref: WeekRef): Promise<WeekOdds | null> {
  return cache.get<WeekOdds>(oddsKey(ref), { timeoutMs: ODDS_READ_TIMEOUT_MS });
}

export type OddsRequest =
  | { ok: true; ref: WeekRef; odds: WeekOdds }
  | { ok: false; status: 400 | 401 | 503; error: string };

const isWeekNumber = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Validates a POST /api/odds body. `passphrase` undefined means writes are disabled. */
export function parseOddsRequest(body: unknown, passphrase: string | undefined, now: Date): OddsRequest {
  if (!passphrase) return { ok: false, status: 503, error: 'Setting odds is not configured for this site' };
  if (body === null || typeof body !== 'object') return { ok: false, status: 400, error: 'Expected a JSON body' };
  const b = body as Record<string, unknown>;

  if (typeof b.key !== 'string' || !safeEqual(b.key, passphrase)) return { ok: false, status: 401, error: 'Wrong passphrase' };
  if (!isWeekNumber(b.season, 2000, 2100) || !isWeekNumber(b.seasonType, 1, 3) || !isWeekNumber(b.week, 1, 25)) {
    return { ok: false, status: 400, error: 'season, seasonType and week must be valid numbers' };
  }

  const validated = validateOdds({ american: b.american, stake: b.stake, note: b.note });
  if (!validated.ok) return { ok: false, status: 400, error: validated.error };

  return {
    ok: true,
    ref: { season: b.season as number, seasonType: b.seasonType as number, week: b.week as number },
    odds: { ...validated.value, updatedAt: now.toISOString() },
  };
}

/** Throws when the store can't confirm the write, so the caller reports a failure instead of a false "saved". */
export async function writeOdds(cache: KeyValueCache, ref: WeekRef, odds: WeekOdds): Promise<void> {
  await cache.set(oddsKey(ref), odds, { strict: true, timeoutMs: ODDS_WRITE_TIMEOUT_MS });
}
