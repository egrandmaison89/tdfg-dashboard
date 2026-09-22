/** Deterministic API data for browser tests: the real 2021–2025 bundle plus a synthetic 2026 in progress. */

import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { HistoryResponse, SeasonHistory, WeekGrade } from '../src/shared/history';

const bundled: SeasonHistory[] = [2025, 2024, 2023, 2022, 2021].map(
  (year) => JSON.parse(readFileSync(new URL(`../src/server/historyBundle/seasons/${year}.json`, import.meta.url), 'utf8')) as SeasonHistory,
);

const week2026 = (week: number, over: Partial<WeekGrade> = {}): WeekGrade => ({
  season: 2026,
  week,
  slateDate: null,
  status: 'upcoming',
  games: 0,
  voidGames: 0,
  totalLegs: 0,
  hitLegs: 0,
  missedLegs: [],
  shortSlate: false,
  ...over,
});

export const season2026: SeasonHistory = {
  season: 2026,
  complete: false,
  weeks: [
    week2026(1, { status: 'won', slateDate: '2026-09-13', games: 8, totalLegs: 32, hitLegs: 32 }),
    week2026(2, {
      status: 'live',
      slateDate: '2026-09-20',
      games: 8,
      totalLegs: 32,
      hitLegs: 20,
      missedLegs: [{ abbr: 'CLE', type: 'FG' }],
    }),
    ...Array.from({ length: 16 }, (_, i) => week2026(i + 3)),
  ],
};

export function mockHistory(over: Partial<HistoryResponse> = {}): HistoryResponse {
  return {
    generatedAt: '2026-09-20T18:30:00Z',
    startSeason: 2021,
    currentSeason: 2026,
    incomplete: false,
    seasons: [season2026, ...bundled],
    ...over,
  };
}

export const allWeeks = () => [season2026, ...bundled].flatMap((s) => s.weeks);

export function finalGame(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    kickoff: '2026-09-20T17:00Z',
    state: 'post',
    statusDetail: 'Final',
    period: 4,
    clockSeconds: 0,
    isHalftime: false,
    possessionTeamId: null,
    isRedZone: false,
    downDistance: null,
    down: null,
    distance: null,
    yardLine: null,
    homeTimeouts: null,
    awayTimeouts: null,
    legsVerified: true,
    teams: [
      { id: `${id}a`, abbr: 'AWY', name: 'Away', logo: null, color: null, homeAway: 'away', score: 10, tdCount: 1, fgCount: 1 },
      { id: `${id}h`, abbr: 'HOM', name: 'Home', logo: null, color: null, homeAway: 'home', score: 10, tdCount: 1, fgCount: 1 },
    ],
    ...over,
  };
}

/** A live game: home team (HOM) has the ball needing a field goal, in range, late. */
export function liveGame(id: string, over: Record<string, unknown> = {}) {
  return finalGame(id, {
    state: 'in',
    statusDetail: 'Q4 3:12',
    period: 4,
    clockSeconds: 192,
    possessionTeamId: `${id}h`,
    isRedZone: false,
    downDistance: '2nd & 6 at AWY 30',
    down: 2,
    distance: 6,
    yardLine: 70,
    homeTimeouts: 2,
    awayTimeouts: 1,
    teams: [
      { id: `${id}a`, abbr: 'AWY', name: 'Away', logo: null, color: null, homeAway: 'away', score: 17, tdCount: 2, fgCount: 1 },
      { id: `${id}h`, abbr: 'HOM', name: 'Home', logo: null, color: null, homeAway: 'home', score: 14, tdCount: 2, fgCount: 0 },
    ],
    ...over,
  });
}

/** A slate echoing whatever week/year was requested (current = 2026 week 2). */
export function slateFor(url: URL, games: unknown[] = [finalGame('g1')], extra: Record<string, unknown> = {}) {
  return {
    generatedAt: new Date().toISOString(),
    source: 'espn',
    stale: false,
    season: Number(url.searchParams.get('year') ?? 2026),
    seasonType: Number(url.searchParams.get('seasontype') ?? 2),
    week: Number(url.searchParams.get('week') ?? 2),
    slateDate: null,
    games,
    odds: null,
    oddsEditable: false,
    ...extra,
  };
}

export async function mockApis(
  page: Page,
  options: {
    history?: () => { status: number; body: unknown };
    games?: unknown[];
    slateExtra?: Record<string, unknown>;
    /** Serves GET /api/odds too, so the panel's own fetch agrees with the slate. */
    odds?: unknown;
    oddsEditable?: boolean;
  } = {},
) {
  await page.route('**/api/odds**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ odds: options.odds ?? null, editable: options.oddsEditable ?? false }),
    });
  });
  const history = options.history ?? (() => ({ status: 200, body: mockHistory() }));
  await page.route('**/api/history**', (route) => {
    const { status, body } = history();
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/slate**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        slateFor(new URL(route.request().url()), options.games, {
          ...(options.odds === undefined ? {} : { odds: options.odds }),
          ...(options.oddsEditable === undefined ? {} : { oddsEditable: options.oddsEditable }),
          ...options.slateExtra,
        }),
      ),
    }),
  );
}
