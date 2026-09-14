import { describe, expect, it } from 'vitest';
import {
  boardHref,
  chipLabel,
  chipTone,
  HISTORY_IDLE_MS,
  HISTORY_LIVE_MS,
  HISTORY_RETRY_MS,
  historyPollMs,
  isHistoryResponse,
  landingForSeason,
  routeFromPath,
  seasonOptions,
  weeksInSeason,
} from '../src/client/nav';
import type { HistoryResponse, WeekGrade } from '../src/shared/history';

const grade = (over: Partial<WeekGrade> = {}): WeekGrade => ({
  season: 2025,
  week: 5,
  slateDate: '2025-10-05',
  status: 'lost',
  games: 8,
  voidGames: 0,
  totalLegs: 32,
  hitLegs: 28,
  missedLegs: [],
  shortSlate: false,
  ...over,
});

const history = (over: Partial<HistoryResponse> = {}): HistoryResponse => ({
  generatedAt: '2026-09-14T22:00:00Z',
  startSeason: 2021,
  currentSeason: 2026,
  incomplete: false,
  seasons: [
    {
      season: 2026,
      complete: false,
      weeks: [grade({ season: 2026, week: 1, status: 'won', hitLegs: 32 }), grade({ season: 2026, week: 2, status: 'upcoming', totalLegs: 0, hitLegs: 0 })],
    },
    { season: 2021, complete: true, weeks: Array.from({ length: 18 }, (_, i) => grade({ season: 2021, week: i + 1 })) },
  ],
  ...over,
});

describe('routing (F11)', () => {
  it.each([
    ['/', 'live'],
    ['', 'live'],
    ['/history', 'history'],
    ['/history/', 'history'],
    ['/historyx', 'live'],
    ['/some/page', 'live'],
  ] as const)('%s → %s', (path, route) => {
    expect(routeFromPath(path)).toBe(route);
  });

  it('builds board links for a season/week', () => {
    expect(boardHref(2024, 18)).toBe('/?week=18&seasontype=2&year=2024');
  });
});

describe('season picker helpers (AC12.1, AC12.6)', () => {
  it('lists seasons from the current one back to 2021, newest first', () => {
    expect(seasonOptions(2026)).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
  });

  it('includes an older season opened via URL, and never lists fewer than the start season', () => {
    expect(seasonOptions(2026, 2021, 2019)).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2019]);
    expect(seasonOptions(2020)).toEqual([2021]);
  });

  it('knows how many weeks a season has, defaulting to 18', () => {
    expect(weeksInSeason(history(), 2021)).toBe(18);
    expect(weeksInSeason(history(), 2026)).toBe(2);
    expect(weeksInSeason(null, 2024)).toBe(18);
    expect(weeksInSeason(history(), 2030)).toBe(18);
  });

  it.each([
    [2026, 5, 18, { kind: 'current' }],
    [2023, 5, 18, { kind: 'week', season: 2023, week: 5 }],
    [2023, 18, 17, { kind: 'week', season: 2023, week: 17 }],
    [2023, null, 18, { kind: 'week', season: 2023, week: 1 }],
  ] as const)('picking %i while viewing week %s lands on %o', (season, viewing, weeks, expected) => {
    expect(landingForSeason(season, 2026, viewing, weeks)).toEqual(expected);
  });
});

describe('week chips (AC12.2)', () => {
  it.each<[string, WeekGrade | undefined, string]>([
    ['no data', undefined, 'unknown'],
    ['lost by 4', grade(), 'lost'],
    ['lost by 2', grade({ hitLegs: 30 }), 'near'],
    ['won', grade({ status: 'won', hitLegs: 32 }), 'won'],
    ['no bet', grade({ status: 'no_bet' }), 'no_bet'],
    ['live', grade({ status: 'live' }), 'live'],
    ['pending', grade({ status: 'pending' }), 'pending'],
  ])('%s → %s', (_label, g, tone) => {
    expect(chipTone(g)).toBe(tone);
  });

  it('describes each chip for screen readers', () => {
    expect(chipLabel(5, grade())).toBe('Week 5: lost, 28 of 32 legs');
    expect(chipLabel(5, grade({ hitLegs: 31 }))).toBe('Week 5: lost (near miss), 31 of 32 legs');
    expect(chipLabel(16, grade({ status: 'won', games: 1, totalLegs: 4, hitLegs: 4, shortSlate: true }))).toBe(
      'Week 16: won, 4 of 4 legs, short slate (1 game)',
    );
    expect(chipLabel(2, grade({ status: 'upcoming', totalLegs: 0, hitLegs: 0 }))).toBe('Week 2: upcoming');
    expect(chipLabel(7, undefined)).toBe('Week 7');
  });
});

describe('history polling (AC13.8)', () => {
  it('retries quickly while incomplete, often while live, rarely otherwise', () => {
    expect(historyPollMs(null)).toBe(HISTORY_RETRY_MS);
    expect(historyPollMs(history({ incomplete: true }))).toBe(HISTORY_RETRY_MS);
    const live = history();
    live.seasons[0]?.weeks.push(grade({ season: 2026, week: 3, status: 'live' }));
    expect(historyPollMs(live)).toBe(HISTORY_LIVE_MS);
    expect(historyPollMs(history())).toBe(HISTORY_IDLE_MS);
  });

  it('validates the response shape', () => {
    expect(isHistoryResponse(history())).toBe(true);
    expect(isHistoryResponse(null)).toBe(false);
    expect(isHistoryResponse({ currentSeason: 2026, startSeason: 2021 })).toBe(false);
    expect(isHistoryResponse({ currentSeason: 2026, startSeason: 2021, seasons: [{ season: 2026 }] })).toBe(false);
  });
});
