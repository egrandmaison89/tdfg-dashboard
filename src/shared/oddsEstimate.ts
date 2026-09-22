/**
 * Fair-price estimate for a slate (SPEC F16, AC16.4).
 *
 * Per-leg hit rates come from every graded week since 2021. Legs within a week are correlated
 * (weather, blowouts, one bad kicker day), so the independent product understates how often the
 * parlay lands; a single calibration factor rescales the model so its average week probability
 * matches the observed win rate. Everything here is clearly labelled an estimate in the UI.
 */

import type { SeasonHistory } from './history';
import { isGraded } from './historyStats';
import { probabilityToAmerican } from './odds';
import type { Game } from './types';

export interface LegRates {
  td: number;
  fg: number;
  teamWeeks: number;
}

/** Effective-leg exponent: 1 = fully independent legs, < 1 = correlated (what the data shows). */
export const CALIBRATION_BOUNDS = { min: 0.2, max: 3 } as const;

export function legRatesFromHistory(seasons: SeasonHistory[]): LegRates {
  let teamWeeks = 0;
  let tdMisses = 0;
  let fgMisses = 0;
  for (const season of seasons) {
    for (const week of season.weeks) {
      if (!isGraded(week)) continue;
      teamWeeks += week.totalLegs / 2;
      for (const leg of week.missedLegs) {
        if (leg.type === 'TD') tdMisses += 1;
        else fgMisses += 1;
      }
    }
  }
  if (teamWeeks === 0) return { td: 0.95, fg: 0.8, teamWeeks: 0 };
  return { td: 1 - tdMisses / teamWeeks, fg: 1 - fgMisses / teamWeeks, teamWeeks };
}

/**
 * Probability that every team in a slate of `teams` hits both legs.
 *
 * Legs are correlated, so instead of scaling the independent product by a constant (which would
 * distort small slates — a 1-game week could price above a single team's own hit rate) the
 * correlation is folded into the exponent: `teams × calibration` behaves like an effective number
 * of independent teams. The result is always ≤ one team's own rate and monotone in slate size.
 */
export function modelProbability(teams: number, rates: LegRates, calibration = 1): number {
  if (teams <= 0) return 0;
  return Math.min(1, Math.pow(rates.td * rates.fg, teams * calibration));
}

const meanProbability = (weeks: { totalLegs: number }[], rates: LegRates, calibration: number) =>
  weeks.reduce((sum, w) => sum + modelProbability(w.totalLegs / 2, rates, calibration), 0) / weeks.length;

/** Exponent multiplier that makes the model's average week match how often the bet actually landed. */
export function calibrationFactor(seasons: SeasonHistory[], rates: LegRates): number {
  const graded = seasons.flatMap((s) => s.weeks.filter(isGraded));
  if (graded.length === 0) return 1;
  const observed = graded.filter((w) => w.status === 'won').length / graded.length;
  if (observed <= 0) return 1;

  // Mean probability falls as the exponent grows, so bisect on the exponent multiplier.
  let low: number = CALIBRATION_BOUNDS.min;
  let high: number = CALIBRATION_BOUNDS.max;
  if (meanProbability(graded, rates, low) < observed) return low;
  if (meanProbability(graded, rates, high) > observed) return high;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (meanProbability(graded, rates, mid) > observed) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export interface SlateEstimate {
  teams: number;
  probability: number;
  american: number;
  basedOn: { weeks: number; wins: number };
}

/** Pre-kickoff fair price for this slate (void games excluded). */
export function estimateSlate(games: Pick<Game, 'state'>[], seasons: SeasonHistory[]): SlateEstimate | null {
  const teams = games.filter((g) => g.state !== 'void').length * 2;
  const graded = seasons.flatMap((s) => s.weeks.filter(isGraded));
  if (teams === 0 || graded.length === 0) return null;
  const rates = legRatesFromHistory(seasons);
  const probability = modelProbability(teams, rates, calibrationFactor(seasons, rates));
  return {
    teams,
    probability,
    american: probabilityToAmerican(probability),
    basedOn: { weeks: graded.length, wins: graded.filter((w) => w.status === 'won').length },
  };
}
