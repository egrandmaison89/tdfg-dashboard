/** GET /api/history pipeline: bundled past seasons + incrementally graded current season (ADR-006). */

import { parseRegularSeasonCalendar, type CalendarWeek } from '../shared/calendar';
import {
  DEFAULT_REGULAR_SEASON_WEEKS,
  FINAL_WEEK_STATUSES,
  gradeWeek,
  HISTORY_START_SEASON,
  placeholderWeek,
  REGULAR_SEASON_TYPE,
  type HistoryResponse,
  type SeasonHistory,
  type WeekGrade,
} from '../shared/history';
import type { SlateResponse } from '../shared/types';
import { buildSlate, type BuildDeps } from './buildSlate';

/** Ungraded past weeks computed per invocation (~9 ESPN calls each, fewer with warm leg caches). */
export const MAX_GRADES_PER_RUN = 4;
export const GRADE_CONCURRENCY = 3;
export const CALENDAR_TTL_MS = 24 * 60 * 60_000;

export const gradeKey = (season: number, week: number) => `grade/${season}-${week}`;
export const calendarKey = (season: number) => `calendar/${season}`;
export const CURRENT_SEASON_KEY = 'history/current-season';

interface CalendarEntry {
  fetchedAt: string;
  weeks: CalendarWeek[];
}

export interface HistoryDeps extends BuildDeps {
  /** Completed seasons shipped with the app. */
  bundle: Record<number, SeasonHistory>;
  startSeason?: number;
  maxGradesPerRun?: number;
}

interface RunState {
  budget: number;
  incomplete: boolean;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

async function loadCalendar(season: number, deps: HistoryDeps): Promise<CalendarWeek[] | null> {
  const { cache, source, now, log = () => {} } = deps;
  const cached = await cache.get<CalendarEntry>(calendarKey(season));
  if (cached && cached.weeks.length > 0 && now().getTime() - Date.parse(cached.fetchedAt) < CALENDAR_TTL_MS) {
    return cached.weeks;
  }
  try {
    const weeks = parseRegularSeasonCalendar(await source.scoreboard({ year: season, seasonType: REGULAR_SEASON_TYPE, week: 1 }));
    if (weeks.length === 0) throw new Error(`no regular-season calendar for ${season}`);
    await cache.set(calendarKey(season), { fetchedAt: now().toISOString(), weeks } satisfies CalendarEntry);
    return weeks;
  } catch (err) {
    log(`calendar fetch failed for ${season}`, err);
    return cached?.weeks ?? null;
  }
}

async function gradeSeason(season: number, current: SlateResponse | null, deps: HistoryDeps, run: RunState): Promise<SeasonHistory> {
  const { cache, now, log = () => {} } = deps;
  const nowMs = now().getTime();
  const calendar = await loadCalendar(season, deps);
  if (!calendar) run.incomplete = true;
  const entries: CalendarWeek[] =
    calendar ?? Array.from({ length: DEFAULT_REGULAR_SEASON_WEEKS }, (_, i) => ({ week: i + 1, start: '', end: '' }));

  const weeks = await mapLimit(entries, GRADE_CONCURRENCY, async (entry): Promise<WeekGrade> => {
    const stored = await cache.get<WeekGrade>(gradeKey(season, entry.week));
    if (stored) return stored;

    const startMs = Date.parse(entry.start);
    if (!Number.isNaN(startMs) && nowMs < startMs) return placeholderWeek(season, entry.week, 'upcoming');
    if (!calendar) return placeholderWeek(season, entry.week, 'pending');

    const isCurrentWeek =
      current !== null &&
      !current.stale &&
      current.season === season &&
      current.seasonType === REGULAR_SEASON_TYPE &&
      current.week === entry.week;

    let slate: SlateResponse;
    if (isCurrentWeek) {
      slate = current;
    } else {
      if (run.budget <= 0) {
        run.incomplete = true;
        return placeholderWeek(season, entry.week, 'pending');
      }
      run.budget -= 1;
      try {
        slate = await buildSlate({ year: season, seasonType: REGULAR_SEASON_TYPE, week: entry.week }, deps);
      } catch (err) {
        log(`could not grade ${season} week ${entry.week}`, err);
        run.incomplete = true;
        return placeholderWeek(season, entry.week, 'pending');
      }
    }

    const { grade, settled } = gradeWeek(season, entry.week, slate.games, slate.slateDate);
    const weekOver = nowMs > Date.parse(entry.end);
    // Only immutable grades are stored: every game settled, fresh data, and an empty week only once it's over.
    if (settled && !slate.stale && (grade.status !== 'no_games' || weekOver)) {
      await cache.set(gradeKey(season, entry.week), grade);
    }
    return grade;
  });

  const lastEnd = Date.parse(entries.at(-1)?.end ?? '');
  const complete =
    calendar !== null && weeks.every((w) => FINAL_WEEK_STATUSES.has(w.status)) && !Number.isNaN(lastEnd) && nowMs > lastEnd;
  return { season, complete, weeks };
}

export async function buildHistory(deps: HistoryDeps): Promise<HistoryResponse> {
  const { bundle, cache, now, log = () => {} } = deps;
  const startSeason = deps.startSeason ?? HISTORY_START_SEASON;
  const run: RunState = { budget: deps.maxGradesPerRun ?? MAX_GRADES_PER_RUN, incomplete: false };

  let current: SlateResponse | null = null;
  try {
    current = await buildSlate({}, deps);
  } catch (err) {
    log('current week unavailable for history', err);
    run.incomplete = true;
  }

  const latestBundled = Math.max(startSeason, ...Object.keys(bundle).map(Number));
  let currentSeason: number;
  if (current) {
    currentSeason = Math.max(current.season, latestBundled);
    await cache.set(CURRENT_SEASON_KEY, currentSeason);
  } else {
    currentSeason = Math.max((await cache.get<number>(CURRENT_SEASON_KEY)) ?? 0, latestBundled);
  }

  const seasons: SeasonHistory[] = [];
  for (let season = currentSeason; season >= startSeason; season--) {
    const bundled = bundle[season];
    const history = bundled?.complete ? bundled : await gradeSeason(season, current, deps, run);
    // A season that hasn't started (e.g. next season during the offseason) isn't listed.
    if (history.weeks.some((w) => w.status !== 'upcoming')) seasons.push(history);
  }

  return {
    generatedAt: now().toISOString(),
    startSeason,
    currentSeason: seasons[0]?.season ?? currentSeason,
    incomplete: run.incomplete,
    seasons,
  };
}
