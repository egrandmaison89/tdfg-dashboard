/** Weekly bet grading and history contract (SPEC R10–R13, F13, §5b). */

import { isSettled, summarizeBet } from './bet';
import { missingLegs } from './risk';
import type { Game, LegType } from './types';

export const HISTORY_START_SEASON = 2021;
export const REGULAR_SEASON_TYPE = 2;
export const DEFAULT_REGULAR_SEASON_WEEKS = 18;
/** Weeks with fewer non-void 1 PM games than this are flagged as a short slate (R12). */
export const SHORT_SLATE_MIN_GAMES = 4;
/** A lost week missing at most this many legs is a near miss (R13). */
export const NEAR_MISS_MAX_LEGS = 2;

export type WeekStatus = 'won' | 'lost' | 'no_bet' | 'no_games' | 'live' | 'upcoming' | 'pending';

/** Statuses that can never change once reached. */
export const FINAL_WEEK_STATUSES: ReadonlySet<WeekStatus> = new Set<WeekStatus>(['won', 'lost', 'no_bet', 'no_games']);

export interface MissedLeg {
  abbr: string;
  type: LegType;
}

export interface WeekGrade {
  season: number;
  week: number;
  slateDate: string | null;
  status: WeekStatus;
  /** Non-void Sunday 1 PM games. */
  games: number;
  voidGames: number;
  totalLegs: number;
  hitLegs: number;
  /** Legs not hit (for final weeks: the legs that lost it). */
  missedLegs: MissedLeg[];
  shortSlate: boolean;
}

export interface SeasonHistory {
  season: number;
  /** Every regular-season week has a final grade. */
  complete: boolean;
  weeks: WeekGrade[];
}

export interface HistoryResponse {
  generatedAt: string;
  startSeason: number;
  currentSeason: number;
  /** Some past weeks weren't graded this request; the client should retry shortly. */
  incomplete: boolean;
  /** Newest first. */
  seasons: SeasonHistory[];
}

export function placeholderWeek(season: number, week: number, status: 'upcoming' | 'pending'): WeekGrade {
  return { season, week, slateDate: null, status, games: 0, voidGames: 0, totalLegs: 0, hitLegs: 0, missedLegs: [], shortSlate: false };
}

export interface GradeResult {
  grade: WeekGrade;
  /** Every non-void game is final with verified legs, so the grade can't change. */
  settled: boolean;
}

export function gradeWeek(season: number, week: number, games: Game[], slateDate: string | null): GradeResult {
  const active = games.filter((g) => g.state !== 'void');
  const { totalLegs, hitLegs } = summarizeBet(games);
  const settled = active.every(isSettled);

  let status: WeekStatus;
  if (games.length === 0) status = 'no_games';
  else if (active.length < games.length) status = 'no_bet';
  else if (settled) status = hitLegs === totalLegs ? 'won' : 'lost';
  else if (active.every((g) => g.state === 'pre')) status = 'upcoming';
  else status = 'live';

  const missedLegs = active.flatMap((g) => g.teams.flatMap((t) => missingLegs(t).map((type) => ({ abbr: t.abbr, type }))));

  return {
    grade: {
      season,
      week,
      slateDate,
      status,
      games: active.length,
      voidGames: games.length - active.length,
      totalLegs,
      hitLegs,
      missedLegs,
      shortSlate: active.length > 0 && active.length < SHORT_SLATE_MIN_GAMES,
    },
    settled,
  };
}
