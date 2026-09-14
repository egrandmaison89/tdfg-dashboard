/** Routing, season/week navigation and week-chip presentation (SPEC F11, F12). */

import { DEFAULT_REGULAR_SEASON_WEEKS, HISTORY_START_SEASON, type HistoryResponse, type SeasonHistory, type WeekGrade } from '../shared/history';
import { isNearMiss } from '../shared/historyStats';

export type Route = 'live' | 'history';
export type Navigate = (href: string, options?: { replace?: boolean }) => void;

export const HISTORY_PATH = '/history';

export function routeFromPath(pathname: string): Route {
  return pathname.replace(/\/+$/, '') === HISTORY_PATH ? 'history' : 'live';
}

export function boardHref(season: number, week: number): string {
  return `/?week=${week}&seasontype=2&year=${season}`;
}

/** Seasons for the picker, newest first. Includes `extra` (e.g. an older season opened via URL). */
export function seasonOptions(currentSeason: number, startSeason = HISTORY_START_SEASON, extra?: number): number[] {
  const seasons = new Set<number>();
  for (let s = Math.max(currentSeason, startSeason); s >= startSeason; s--) seasons.add(s);
  if (extra !== undefined) seasons.add(extra);
  return [...seasons].sort((a, b) => b - a);
}

export function findSeason(history: HistoryResponse | null, season: number): SeasonHistory | undefined {
  return history?.seasons.find((s) => s.season === season);
}

export function weeksInSeason(history: HistoryResponse | null, season: number): number {
  return findSeason(history, season)?.weeks.length || DEFAULT_REGULAR_SEASON_WEEKS;
}

export type SeasonTarget = { kind: 'current' } | { kind: 'week'; season: number; week: number };

/** Where picking a season lands (AC12.1): the current week for the current season, else the same week number. */
export function landingForSeason(season: number, currentSeason: number, viewingWeek: number | null, weeksInTarget: number): SeasonTarget {
  if (season === currentSeason) return { kind: 'current' };
  return { kind: 'week', season, week: Math.min(Math.max(viewingWeek ?? 1, 1), weeksInTarget) };
}

export type ChipTone = 'won' | 'lost' | 'near' | 'no_bet' | 'no_games' | 'live' | 'upcoming' | 'pending' | 'unknown';

export function chipTone(grade: WeekGrade | undefined): ChipTone {
  if (!grade) return 'unknown';
  if (grade.status === 'lost') return isNearMiss(grade) ? 'near' : 'lost';
  return grade.status;
}

const TONE_WORDS: Record<ChipTone, string> = {
  won: 'won',
  lost: 'lost',
  near: 'lost (near miss)',
  no_bet: 'no bet',
  no_games: 'no 1 PM games',
  live: 'in progress',
  upcoming: 'upcoming',
  pending: 'still being graded',
  unknown: '',
};

export const CHIP_GLYPH: Record<ChipTone, string> = {
  won: '✓',
  lost: '✗',
  near: '✗',
  no_bet: '–',
  no_games: '–',
  live: '•',
  upcoming: '',
  pending: '…',
  unknown: '',
};

/** e.g. "Week 5: lost (near miss), 30 of 32 legs" */
export function chipLabel(week: number, grade: WeekGrade | undefined): string {
  const tone = chipTone(grade);
  const parts: string[] = [];
  if (tone !== 'unknown') parts.push(TONE_WORDS[tone]);
  if (grade && grade.totalLegs > 0 && tone !== 'upcoming' && tone !== 'pending') {
    parts.push(`${grade.hitLegs} of ${grade.totalLegs} legs`);
  }
  if (grade?.shortSlate) parts.push(`short slate (${grade.games} ${grade.games === 1 ? 'game' : 'games'})`);
  return parts.length ? `Week ${week}: ${parts.join(', ')}` : `Week ${week}`;
}

export const HISTORY_RETRY_MS = 4_000;
export const HISTORY_LIVE_MS = 60_000;
export const HISTORY_IDLE_MS = 10 * 60_000;
export const HISTORY_ERROR_RETRY_MS = 30_000;

/** How soon to refetch history (AC13.8): quickly while grading is incomplete, often while a week is live. */
export function historyPollMs(history: HistoryResponse | null): number {
  if (!history || history.incomplete) return HISTORY_RETRY_MS;
  if (history.seasons.some((s) => s.weeks.some((w) => w.status === 'live'))) return HISTORY_LIVE_MS;
  return HISTORY_IDLE_MS;
}

export function isHistoryResponse(value: unknown): value is HistoryResponse {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<HistoryResponse>;
  return (
    Array.isArray(v.seasons) &&
    typeof v.currentSeason === 'number' &&
    typeof v.startSeason === 'number' &&
    v.seasons.every((s) => s !== null && typeof s === 'object' && Array.isArray(s.weeks))
  );
}
