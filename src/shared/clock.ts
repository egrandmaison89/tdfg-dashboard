import type { Game } from './types';

export const QUARTER_SECONDS = 15 * 60;
export const REGULATION_SECONDS = 4 * QUARTER_SECONDS;
export const OT_SECONDS = 10 * 60;

/** Game seconds elapsed at a given period/clock. OT periods (5+) continue past regulation. */
export function elapsedSeconds(period: number, clockSeconds: number): number {
  const p = Math.max(period, 1);
  if (p <= 4) return (p - 1) * QUARTER_SECONDS + (QUARTER_SECONDS - clockSeconds);
  return REGULATION_SECONDS + (p - 5) * OT_SECONDS + (OT_SECONDS - clockSeconds);
}

/** Regulation seconds remaining (SPEC F6). Halftime = 30:00, OT/final = 0, pregame = 60:00. */
export function regulationRemaining(game: Pick<Game, 'state' | 'period' | 'clockSeconds' | 'isHalftime'>): number {
  if (game.state === 'pre') return REGULATION_SECONDS;
  if (game.state !== 'in') return 0;
  if (game.isHalftime) return 2 * QUARTER_SECONDS;
  const p = Math.max(game.period, 1);
  if (p >= 5) return 0;
  return (4 - p) * QUARTER_SECONDS + Math.min(game.clockSeconds, QUARTER_SECONDS);
}
