import { describe, expect, it } from 'vitest';
import type { MissedLeg, SeasonHistory, WeekGrade, WeekStatus } from '../src/shared/history';
import {
  bustCulprits,
  isNearMiss,
  missShare,
  nearMisses,
  recordStats,
  scopeWeeks,
  seasonRows,
} from '../src/shared/historyStats';

function wk(season: number, week: number, status: WeekStatus, hit = 32, total = 32, missedLegs: MissedLeg[] = []): WeekGrade {
  return { season, week, slateDate: null, status, games: total / 4, voidGames: 0, totalLegs: total, hitLegs: hit, missedLegs, shortSlate: false };
}

describe('recordStats (AC13.2)', () => {
  it('counts only graded weeks toward the record', () => {
    const s = recordStats([
      wk(2025, 1, 'won'),
      wk(2025, 2, 'lost', 30),
      wk(2025, 3, 'no_bet', 20, 24),
      wk(2025, 4, 'live', 10),
      wk(2025, 5, 'upcoming', 0, 0),
      wk(2025, 6, 'pending', 0, 0),
      wk(2025, 7, 'no_games', 0, 0),
    ]);
    expect(s).toMatchObject({ wins: 1, losses: 1, graded: 2, noBets: 1, winRate: 0.5, nearMisses: 1 });
    expect(s.legHitRate).toBeCloseTo(62 / 64);
  });

  it('handles no graded weeks', () => {
    expect(recordStats([wk(2026, 1, 'upcoming', 0, 0)])).toMatchObject({
      graded: 0,
      winRate: null,
      legHitRate: null,
      weeksSinceLastWin: 0,
      hasWon: false,
    });
  });

  it('counts graded weeks since the last win across seasons, ignoring no-bet weeks and input order', () => {
    const s = recordStats([
      wk(2025, 3, 'lost', 20),
      wk(2024, 18, 'won'),
      wk(2025, 2, 'no_bet'),
      wk(2024, 17, 'lost', 20),
      wk(2025, 1, 'lost', 20),
    ]);
    expect(s).toMatchObject({ weeksSinceLastWin: 2, hasWon: true });
  });

  it('counts every graded week when there has never been a win', () => {
    expect(recordStats([wk(2023, 1, 'lost', 1), wk(2023, 2, 'lost', 1), wk(2023, 3, 'lost', 1)])).toMatchObject({
      weeksSinceLastWin: 3,
      hasWon: false,
    });
  });
});

describe('near misses (R13, AC13.6)', () => {
  it.each<[string, WeekGrade, boolean]>([
    ['lost by 1', wk(2024, 5, 'lost', 31), true],
    ['lost by 2', wk(2024, 5, 'lost', 30), true],
    ['lost by 3', wk(2024, 5, 'lost', 29), false],
    ['won', wk(2024, 5, 'won'), false],
    ['live, 1 short', wk(2024, 5, 'live', 31), false],
    ['no bet, 1 short', wk(2024, 5, 'no_bet', 31), false],
  ])('%s → %s', (_label, week, expected) => {
    expect(isNearMiss(week)).toBe(expected);
  });

  it('lists newest first', () => {
    const list = nearMisses([wk(2023, 2, 'lost', 31), wk(2025, 9, 'lost', 31), wk(2025, 2, 'lost', 30), wk(2024, 1, 'lost', 10)]);
    expect(list.map((w) => `${w.season}-${w.week}`)).toEqual(['2025-9', '2025-2', '2023-2']);
  });
});

describe('bust culprits (AC13.7)', () => {
  const weeks = [
    wk(2025, 1, 'lost', 29, 32, [
      { abbr: 'CLE', type: 'FG' },
      { abbr: 'TEN', type: 'FG' },
      { abbr: 'NYJ', type: 'TD' },
    ]),
    wk(2025, 2, 'lost', 30, 32, [
      { abbr: 'CLE', type: 'TD' },
      { abbr: 'TEN', type: 'FG' },
    ]),
    wk(2025, 3, 'live', 31, 32, [{ abbr: 'CLE', type: 'FG' }]),
    wk(2025, 4, 'won'),
  ];

  it('ranks teams by missed legs in lost weeks, splitting TD and FG, ties alphabetical', () => {
    expect(bustCulprits(weeks)).toEqual([
      { abbr: 'CLE', total: 2, td: 1, fg: 1 },
      { abbr: 'TEN', total: 2, td: 0, fg: 2 },
      { abbr: 'NYJ', total: 1, td: 1, fg: 0 },
    ]);
    expect(bustCulprits(weeks, 1).map((c) => c.abbr)).toEqual(['CLE']);
  });

  it('computes the TD vs FG share of misses', () => {
    expect(missShare(weeks)).toEqual({ td: 2, fg: 3, total: 5 });
    expect(missShare([])).toEqual({ td: 0, fg: 0, total: 0 });
  });
});

describe('scoping and season rows (AC13.1, AC13.4)', () => {
  const seasons: SeasonHistory[] = [
    { season: 2024, complete: true, weeks: [wk(2024, 2, 'won'), wk(2024, 1, 'lost', 31)] },
    { season: 2026, complete: false, weeks: [wk(2026, 1, 'won'), wk(2026, 2, 'live', 20), wk(2026, 3, 'upcoming', 0, 0)] },
    { season: 2025, complete: true, weeks: [wk(2025, 1, 'lost', 20)] },
  ];

  it('scopes to all seasons chronologically, or one season', () => {
    expect(scopeWeeks(seasons, 'all').map((w) => `${w.season}-${w.week}`)).toEqual([
      '2024-1',
      '2024-2',
      '2025-1',
      '2026-1',
      '2026-2',
      '2026-3',
    ]);
    expect(scopeWeeks(seasons, 2025).map((w) => w.week)).toEqual([1]);
    expect(scopeWeeks(seasons, 1999)).toEqual([]);
  });

  it('builds one row per season, newest first, with won weeks', () => {
    const rows = seasonRows(seasons);
    expect(rows.map((r) => [r.season, r.complete, `${r.stats.wins}-${r.stats.losses}`, r.wonWeeks])).toEqual([
      [2026, false, '1-0', [1]],
      [2025, true, '0-1', []],
      [2024, true, '1-1', [2]],
    ]);
  });
});
