import { beforeEach, describe, expect, it } from 'vitest';
import { buildHistory, CURRENT_SEASON_KEY, gradeKey, MAX_GRADES_PER_RUN, type HistoryDeps } from '../src/server/buildHistory';
import { MemoryCache } from '../src/server/cache';
import { cacheHeaders, historyTtlSeconds, TTL } from '../src/server/cacheHeaders';
import { handleHistoryRequest } from '../src/server/handler';
import type { SeasonHistory, WeekGrade } from '../src/shared/history';
import { fakeEspnFetch, FakeSeasonSource, GAMES_PER_WEEK } from './fakeSeason';

const lostWeek = (season: number, week: number): WeekGrade => ({
  season,
  week,
  slateDate: null,
  status: 'lost',
  games: 8,
  voidGames: 0,
  totalLegs: 32,
  hitLegs: 31,
  missedLegs: [{ abbr: 'CLE', type: 'FG' }],
  shortSlate: false,
});

const bundle2025: SeasonHistory = {
  season: 2025,
  complete: true,
  weeks: Array.from({ length: 18 }, (_, i) => lostWeek(2025, i + 1)),
};

let source: FakeSeasonSource;
let cache: MemoryCache;
let now: Date;

const deps = (extra: Partial<HistoryDeps> = {}): HistoryDeps => ({
  source,
  cache,
  now: () => now,
  bundle: { 2025: bundle2025 },
  startSeason: 2025,
  log: () => {},
  ...extra,
});

const statuses = (s: SeasonHistory | undefined) => s?.weeks.map((w) => w.status) ?? [];
const upstreamWeeks = () => source.scoreboardCalls.filter((c) => c !== 'current');

beforeEach(() => {
  source = new FakeSeasonSource(2026, 3);
  cache = new MemoryCache();
  now = source.duringGames(3);
});

describe('buildHistory (ADR-006)', () => {
  it('serves bundled seasons verbatim and grades the current season around the live week', async () => {
    const history = await buildHistory(deps());
    expect(history).toMatchObject({ startSeason: 2025, currentSeason: 2026, incomplete: false });
    expect(history.seasons.map((s) => s.season)).toEqual([2026, 2025]);
    expect(history.seasons[1]).toBe(bundle2025);

    const current = history.seasons[0];
    expect(current?.complete).toBe(false);
    expect(statuses(current)).toEqual(['won', 'won', 'live', ...Array(15).fill('upcoming')]);
    expect(current?.weeks[0]).toMatchObject({ games: GAMES_PER_WEEK, totalLegs: 16, hitLegs: 16, slateDate: expect.any(String) });

    // Never asks ESPN about bundled seasons or weeks that haven't started.
    expect(source.scoreboardCalls.some((c) => c.startsWith('2025'))).toBe(false);
    expect(upstreamWeeks().sort()).toEqual(['2026-1', '2026-1', '2026-2']); // calendar + weeks 1 and 2
  });

  it('stores final grades so later runs only refresh the live week', async () => {
    await buildHistory(deps());
    const summariesAfterFirst = source.summaryCalls.length;
    const weeksAfterFirst = upstreamWeeks().length;

    const again = await buildHistory(deps());
    expect(statuses(again.seasons[0]).slice(0, 3)).toEqual(['won', 'won', 'live']);
    expect(upstreamWeeks().length).toBe(weeksAfterFirst); // calendar and weeks 1–2 came from cache
    expect(source.summaryCalls.length).toBe(summariesAfterFirst); // live scores unchanged → no summaries
    expect(await cache.get(gradeKey(2026, 1))).toMatchObject({ status: 'won' });
    expect(await cache.get(gradeKey(2026, 3))).toBeNull(); // live weeks are never stored
  });

  it('regrades the live week as scores change', async () => {
    const before = await buildHistory(deps());
    expect(before.seasons[0]?.weeks[2]).toMatchObject({ status: 'live', hitLegs: 16 });

    source.misses.add(`3|${source.teamId(3, 0, 'h')}|FG`);
    const after = await buildHistory(deps());
    expect(after.seasons[0]?.weeks[2]).toMatchObject({ status: 'live', hitLegs: 15 });
    expect(historyTtlSeconds(after)).toBe(TTL.historyLive);
  });

  it('grades lost weeks with the legs that missed', async () => {
    source.misses.add(`1|${source.teamId(1, 2, 'a')}|TD`);
    const history = await buildHistory(deps());
    expect(history.seasons[0]?.weeks[0]).toMatchObject({ status: 'lost', hitLegs: 15, missedLegs: [{ abbr: 'A2', type: 'TD' }] });
  });

  it('respects the per-run grading budget and finishes over later runs', async () => {
    source = new FakeSeasonSource(2026, 10);
    now = source.duringGames(10);

    const first = await buildHistory(deps());
    expect(first.incomplete).toBe(true);
    expect(historyTtlSeconds(first)).toBe(TTL.historyIncomplete);
    const firstStatuses = statuses(first.seasons[0]).slice(0, 9);
    expect(firstStatuses.filter((s) => s === 'won')).toHaveLength(MAX_GRADES_PER_RUN);
    expect(firstStatuses.filter((s) => s === 'pending')).toHaveLength(9 - MAX_GRADES_PER_RUN);
    expect(first.seasons[0]?.weeks[9]?.status).toBe('live');

    const second = await buildHistory(deps());
    expect(second.incomplete).toBe(true);
    const third = await buildHistory(deps());
    expect(third.incomplete).toBe(false);
    expect(statuses(third.seasons[0]).slice(0, 10)).toEqual([...Array(9).fill('won'), 'live']);
  });

  it('marks a week with a postponed game as no bet and stores it', async () => {
    source.voids.add('2|1');
    const history = await buildHistory(deps());
    expect(history.seasons[0]?.weeks[1]).toMatchObject({ status: 'no_bet', games: GAMES_PER_WEEK - 1, voidGames: 1 });
    expect(await cache.get(gradeKey(2026, 2))).toMatchObject({ status: 'no_bet' });
  });

  it('grades an empty week as no_games once it is over', async () => {
    source.emptyWeeks.add(1);
    const history = await buildHistory(deps());
    expect(history.seasons[0]?.weeks[0]).toMatchObject({ status: 'no_games', games: 0 });
    expect(await cache.get(gradeKey(2026, 1))).toMatchObject({ status: 'no_games' });
  });

  it('omits a season that has not started (offseason)', async () => {
    now = new Date(Date.parse(source.times(1).start) - 60_000);
    source.currentWeek = 1;
    const history = await buildHistory(deps());
    expect(history.seasons.map((s) => s.season)).toEqual([2025]);
    expect(history.currentSeason).toBe(2025);
  });

  it('keeps serving what it knows when ESPN goes down', async () => {
    await buildHistory(deps());
    source.fail = true;
    const history = await buildHistory(deps());
    expect(history.incomplete).toBe(true);
    expect(history.seasons.map((s) => s.season)).toEqual([2026, 2025]);
    expect(statuses(history.seasons[0]).slice(0, 3)).toEqual(['won', 'won', 'pending']);
  });

  it('with ESPN down on a cold cache, remembers the current season but still serves bundled history', async () => {
    source.fail = true;
    const cold = await buildHistory(deps());
    expect(cold.seasons.map((s) => s.season)).toEqual([2025]);
    expect(cold.incomplete).toBe(true);

    await cache.set(CURRENT_SEASON_KEY, 2026);
    const remembered = await buildHistory(deps());
    expect(remembered.seasons.map((s) => s.season)).toEqual([2026, 2025]);
    expect(statuses(remembered.seasons[0]).every((s) => s === 'pending')).toBe(true);
  });

  it('marks a season complete once every week is final and the season is over', async () => {
    source = new FakeSeasonSource(2026, 19);
    now = new Date(Date.parse(source.times(18).end) + 60_000);
    let history = await buildHistory(deps({ maxGradesPerRun: 100 }));
    expect(history.seasons[0]).toMatchObject({ season: 2026, complete: true });
    expect(statuses(history.seasons[0]).every((s) => s === 'won')).toBe(true);
    history = await buildHistory(deps({ maxGradesPerRun: 0 }));
    expect(history.incomplete).toBe(false); // everything came from stored grades
  });
});

describe('handleHistoryRequest (SPEC §5b)', () => {
  const handlerDeps = () => ({
    cache,
    fetchImpl: fakeEspnFetch(source),
    now: () => now,
    bundle: { 2025: bundle2025 },
    startSeason: 2025,
    log: () => {},
  });

  it('returns the history with a TTL matching its state', async () => {
    const res = await handleHistoryRequest(new Request('https://tdfg.test/api/history'), handlerDeps());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ currentSeason: 2026, incomplete: false });
    expect(body.seasons.map((s: SeasonHistory) => s.season)).toEqual([2026, 2025]);
    expect(historyTtlSeconds(body)).toBe(TTL.historyLive);
    expect(res.headers.get('netlify-cdn-cache-control')).toBe(cacheHeaders(TTL.historyLive)['Netlify-CDN-Cache-Control']);
  });

  it('rejects query parameters and non-GET methods', async () => {
    expect((await handleHistoryRequest(new Request('https://tdfg.test/api/history?season=2024'), handlerDeps())).status).toBe(400);
    expect((await handleHistoryRequest(new Request('https://tdfg.test/api/history?'), handlerDeps())).status).toBe(200);
    expect(
      (await handleHistoryRequest(new Request('https://tdfg.test/api/history', { method: 'POST' }), handlerDeps())).status,
    ).toBe(405);
  });
});
