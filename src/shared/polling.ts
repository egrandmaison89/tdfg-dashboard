/** Adaptive client polling cadence (SPEC F9). */

import type { SlateResponse } from './types';

export const POLL_LIVE_MS = 20_000;
export const POLL_PREGAME_MS = 60_000;
export const POLL_IDLE_MS = 5 * 60_000;
export const POLL_FINAL_MS = 10 * 60_000;

const HOUR_MS = 60 * 60_000;

export function nextPollMs(slate: SlateResponse | null, nowMs: number): number {
  if (!slate) return POLL_LIVE_MS;
  const games = slate.games.filter((g) => g.state !== 'void');
  if (games.length === 0) return POLL_IDLE_MS;
  // Unverified finals may still flip (late score landing), so keep the live cadence until they settle.
  if (games.some((g) => g.state === 'in' || !g.legsVerified)) return POLL_LIVE_MS;

  const pending = games.filter((g) => g.state === 'pre');
  if (pending.length === 0) return POLL_FINAL_MS;

  const untilKickoff = Math.min(...pending.map((g) => Date.parse(g.kickoff) - nowMs));
  if (untilKickoff <= 0) return POLL_LIVE_MS; // scheduled kickoff passed, waiting for ESPN to flip to live
  if (untilKickoff <= HOUR_MS) return POLL_PREGAME_MS;
  return POLL_IDLE_MS;
}
