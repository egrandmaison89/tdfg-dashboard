/** Bet history statistics (SPEC F13). Only graded weeks (won/lost) count toward records. */

import { NEAR_MISS_MAX_LEGS, type SeasonHistory, type WeekGrade } from './history';

export type HistoryScope = 'all' | number;

export const isGraded = (w: WeekGrade) => w.status === 'won' || w.status === 'lost';
export const legsShort = (w: WeekGrade) => w.totalLegs - w.hitLegs;
export const isNearMiss = (w: WeekGrade) => w.status === 'lost' && legsShort(w) >= 1 && legsShort(w) <= NEAR_MISS_MAX_LEGS;

const chronological = (a: WeekGrade, b: WeekGrade) => a.season - b.season || a.week - b.week;

export function scopeWeeks(seasons: SeasonHistory[], scope: HistoryScope): WeekGrade[] {
  return seasons
    .filter((s) => scope === 'all' || s.season === scope)
    .flatMap((s) => s.weeks)
    .sort(chronological);
}

export interface RecordStats {
  wins: number;
  losses: number;
  graded: number;
  noBets: number;
  /** wins / graded, or null with no graded weeks. */
  winRate: number | null;
  /** legs hit / legs over graded weeks, or null. */
  legHitRate: number | null;
  nearMisses: number;
  /** Graded weeks since the most recent win (all graded weeks if never won). */
  weeksSinceLastWin: number;
  hasWon: boolean;
}

export function recordStats(weeks: WeekGrade[]): RecordStats {
  const graded = weeks.filter(isGraded).sort(chronological);
  const wins = graded.filter((w) => w.status === 'won').length;
  const totalLegs = graded.reduce((sum, w) => sum + w.totalLegs, 0);
  const hitLegs = graded.reduce((sum, w) => sum + w.hitLegs, 0);
  const lastWin = graded.map((w) => w.status).lastIndexOf('won');
  return {
    wins,
    losses: graded.length - wins,
    graded: graded.length,
    noBets: weeks.filter((w) => w.status === 'no_bet').length,
    winRate: graded.length ? wins / graded.length : null,
    legHitRate: totalLegs ? hitLegs / totalLegs : null,
    nearMisses: graded.filter(isNearMiss).length,
    weeksSinceLastWin: lastWin === -1 ? graded.length : graded.length - 1 - lastWin,
    hasWon: lastWin !== -1,
  };
}

/** Near misses, newest first. */
export function nearMisses(weeks: WeekGrade[]): WeekGrade[] {
  return weeks.filter(isNearMiss).sort((a, b) => chronological(b, a));
}

export interface Culprit {
  abbr: string;
  total: number;
  td: number;
  fg: number;
}

/** Teams ranked by legs they missed in lost weeks. */
export function bustCulprits(weeks: WeekGrade[], limit = 10): Culprit[] {
  const byTeam = new Map<string, Culprit>();
  for (const week of weeks) {
    if (week.status !== 'lost') continue;
    for (const leg of week.missedLegs) {
      const c = byTeam.get(leg.abbr) ?? { abbr: leg.abbr, total: 0, td: 0, fg: 0 };
      c.total += 1;
      if (leg.type === 'TD') c.td += 1;
      else c.fg += 1;
      byTeam.set(leg.abbr, c);
    }
  }
  return [...byTeam.values()].sort((a, b) => b.total - a.total || a.abbr.localeCompare(b.abbr)).slice(0, limit);
}

export interface MissShare {
  td: number;
  fg: number;
  total: number;
}

export function missShare(weeks: WeekGrade[]): MissShare {
  let td = 0;
  let fg = 0;
  for (const week of weeks) {
    if (week.status !== 'lost') continue;
    for (const leg of week.missedLegs) {
      if (leg.type === 'TD') td += 1;
      else fg += 1;
    }
  }
  return { td, fg, total: td + fg };
}

export interface SeasonRow {
  season: number;
  complete: boolean;
  stats: RecordStats;
  wonWeeks: number[];
}

/** One row per season, newest first. */
export function seasonRows(seasons: SeasonHistory[]): SeasonRow[] {
  return [...seasons]
    .sort((a, b) => b.season - a.season)
    .map((s) => ({
      season: s.season,
      complete: s.complete,
      stats: recordStats(s.weeks),
      wonWeeks: s.weeks.filter((w) => w.status === 'won').map((w) => w.week),
    }));
}
