/** American-odds math and validation for the week's parlay price (SPEC F16). */

import type { WeekOdds } from './types';

export const MIN_AMERICAN = 100;
export const MAX_AMERICAN = 1_000_000;
export const MAX_STAKE = 1_000_000;
export const MAX_NOTE_LENGTH = 80;

export function isValidAmerican(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) >= MIN_AMERICAN && Math.abs(value) <= MAX_AMERICAN;
}

/** Profit on a winning bet (stake is returned on top). */
export function profitFor(american: number, stake: number): number {
  const multiplier = american > 0 ? american / 100 : 100 / Math.abs(american);
  return stake * multiplier;
}

export const returnFor = (american: number, stake: number) => stake + profitFor(american, stake);

export function formatAmerican(american: number): string {
  // ASCII minus on purpose: it matches sportsbooks and survives copy-paste back into the editor.
  return `${american > 0 ? '+' : '-'}${Math.abs(american)}`;
}

/** Length-independent-content comparison, so a wrong passphrase leaks no timing signal. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function impliedProbability(american: number): number {
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}

/** Fair American price for a probability (0 < p < 1). */
export function probabilityToAmerican(probability: number): number {
  const p = Math.min(0.999_999, Math.max(0.000_001, probability));
  return p > 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

export interface OddsInput {
  american: unknown;
  stake: unknown;
  note?: unknown;
}

export type OddsValidation = { ok: true; value: Omit<WeekOdds, 'updatedAt'> } | { ok: false; error: string };

/** Accepts "+2500", "2500", -110, "20.50" for stake. */
export function validateOdds(input: OddsInput): OddsValidation {
  const americanRaw = typeof input.american === 'string' ? input.american.trim().replace(/^\+/, '') : input.american;
  const american = Number(americanRaw);
  if (typeof americanRaw !== 'number' && typeof americanRaw !== 'string') return { ok: false, error: 'Odds are required' };
  if (!isValidAmerican(american)) return { ok: false, error: 'Odds must be a whole number of at least +100 or -100' };

  const stakeRaw = input.stake;
  const stakeIsTyped = typeof stakeRaw === 'number' || (typeof stakeRaw === 'string' && stakeRaw.trim() !== '');
  const stake = stakeIsTyped ? Number(typeof stakeRaw === 'string' ? stakeRaw.trim().replace(/^\$/, '') : stakeRaw) : Number.NaN;
  if (!Number.isFinite(stake) || stake < 0 || stake > MAX_STAKE) return { ok: false, error: 'Stake must be a number between 0 and 1,000,000' };

  const noteRaw = input.note;
  if (noteRaw !== undefined && noteRaw !== null && typeof noteRaw !== 'string') return { ok: false, error: 'Note must be text' };
  const note = typeof noteRaw === 'string' ? noteRaw.trim().slice(0, MAX_NOTE_LENGTH) : '';

  return { ok: true, value: { american, stake: Math.round(stake * 100) / 100, note: note || null } };
}
