import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildSlate,
  snapshotKey,
  UNVERIFIED_FINAL_FAST_WINDOW_MS,
  UNVERIFIED_FINAL_RECHECK_MS,
  UpstreamUnavailableError,
  type BuildDeps,
} from '../src/server/buildSlate';
import { MemoryCache } from '../src/server/cache';
import type { DataSource } from '../src/server/source';
import { summarizeBet } from '../src/shared/bet';
import { obj, type JsonObject } from '../src/shared/json';
import { GOLDEN, liveStatus, loadReplay, ONE_PM_EVENT_IDS, type Replay } from './helpers';

class RecordingSource implements DataSource {
  readonly name = 'espn' as const;
  scoreboardCalls = 0;
  summaryCalls: string[] = [];
  failScoreboard = false;
  failSummaries = new Set<string>();
  overrideScoreboard: unknown = null;
  readonly data: Replay = loadReplay();

  async scoreboard(): Promise<unknown> {
    this.scoreboardCalls += 1;
    if (this.failScoreboard) throw new Error('ESPN down');
    if (this.overrideScoreboard !== null) return structuredClone(this.overrideScoreboard);
    return structuredClone(this.data.scoreboard);
  }

  async summary(id: string): Promise<unknown> {
    this.summaryCalls.push(id);
    if (this.failSummaries.has(id)) throw new Error(`summary ${id} down`);
    return structuredClone(this.data.summaries[id]);
  }

  competition(id: string): JsonObject {
    const event = this.data.scoreboard.events.find((e) => e.id === id);
    return obj((event?.competitions as unknown[])[0]);
  }

  setScore(id: string, homeAway: 'home' | 'away', score: number) {
    const competitors = this.competition(id).competitors as JsonObject[];
    const c = competitors.find((x) => x.homeAway === homeAway);
    if (c) c.score = String(score);
  }
}

/** Removes TEN's only field goal from NYJ @ TEN's scoring plays, adjusting later running scores. */
function removeTenFieldGoal(src: RecordingSource) {
  const plays = src.data.summaries['401872924']?.scoringPlays as JsonObject[];
  const idx = plays.findIndex((p) => obj(p.team).id === '10' && obj(p.scoringType).name === 'field-goal');
  expect(idx).toBeGreaterThanOrEqual(0);
  plays.splice(idx, 1);
  for (const p of plays.slice(idx)) p.homeScore = Number(p.homeScore) - 3;
}

let source: RecordingSource;
let cache: MemoryCache;
let nowMs: number;
let deps: BuildDeps;

beforeEach(() => {
  source = new RecordingSource();
  cache = new MemoryCache();
  nowMs = Date.parse('2026-09-14T15:00:00Z');
  deps = { source, cache, now: () => new Date(nowMs) };
});

describe('buildSlate over real Week 1 data', () => {
  it('returns exactly the 8 Sunday 1 PM games with golden leg counts', async () => {
    const slate = await buildSlate({}, deps);
    expect(slate).toMatchObject({ source: 'espn', stale: false, season: 2026, seasonType: 2, week: 1, slateDate: '2026-09-13' });
    expect(slate.games.map((g) => g.id).sort()).toEqual([...ONE_PM_EVENT_IDS].sort());
    for (const g of slate.games) {
      expect(g.state).toBe('post');
      expect(g.legsVerified).toBe(true);
      for (const t of g.teams) {
        expect({ abbr: t.abbr, td: t.tdCount, fg: t.fgCount }).toEqual(GOLDEN[t.id]);
      }
    }
    expect(slate.games.map((g) => g.kickoff)).toEqual([...slate.games.map((g) => g.kickoff)].sort());
  });

  it('never includes 4 PM, SNF, or other windows (AC1.2)', async () => {
    const slate = await buildSlate({}, deps);
    const abbrs = slate.games.flatMap((g) => g.teams.map((t) => t.abbr));
    for (const lateTeam of ['MIA', 'LV', 'GB', 'MIN', 'WSH', 'PHI', 'ARI', 'LAC', 'DAL', 'NYG']) {
      expect(abbrs).not.toContain(lateTeam);
    }
  });
});

describe('upstream budget (ARCHITECTURE §3, AC9.3)', () => {
  it('fetches summaries once, then only for games whose score changed', async () => {
    await buildSlate({}, deps);
    expect(source.scoreboardCalls).toBe(1);
    expect(source.summaryCalls).toHaveLength(8);

    await buildSlate({}, deps);
    expect(source.scoreboardCalls).toBe(2);
    expect(source.summaryCalls).toHaveLength(8);

    source.setScore('401872661', 'home', 44);
    const slate = await buildSlate({}, deps);
    expect(source.summaryCalls.slice(8)).toEqual(['401872661']);
    expect(slate.games.find((g) => g.id === '401872661')?.legsVerified).toBe(false);
  });

  it('does not fetch summaries for pregame games', async () => {
    for (const id of ONE_PM_EVENT_IDS) {
      const comp = source.competition(id);
      comp.status = { period: 0, clock: 0, type: { name: 'STATUS_SCHEDULED', state: 'pre' } };
      for (const c of comp.competitors as JsonObject[]) c.score = '0';
    }
    const slate = await buildSlate({}, deps);
    expect(source.summaryCalls).toEqual([]);
    expect(slate.games.every((g) => g.legsVerified && g.teams.every((t) => t.tdCount === 0 && t.fgCount === 0))).toBe(true);
  });

  it('re-fetches unverified live games every run (AC3.4)', async () => {
    const comp = source.competition('401872661');
    comp.status = liveStatus(4, 200);
    source.setScore('401872661', 'home', 44);
    await buildSlate({}, deps);
    await buildSlate({}, deps);
    expect(source.summaryCalls.filter((id) => id === '401872661')).toHaveLength(2);
  });

  it('re-checks an unverified final every run for 15 min, then throttles', async () => {
    const start = nowMs;
    const calls = () => source.summaryCalls.filter((id) => id === '401872661').length;
    source.setScore('401872661', 'home', 44);
    await buildSlate({}, deps);
    expect(calls()).toBe(1);
    nowMs = start + 20_000;
    await buildSlate({}, deps);
    expect(calls()).toBe(2);
    nowMs = start + UNVERIFIED_FINAL_FAST_WINDOW_MS;
    await buildSlate({}, deps);
    expect(calls()).toBe(3);
    nowMs += 20_000;
    await buildSlate({}, deps);
    expect(calls()).toBe(3);
    nowMs += UNVERIFIED_FINAL_RECHECK_MS;
    await buildSlate({}, deps);
    expect(calls()).toBe(4);
  });

  it('a final game whose summary lags a last-minute score never busts and recovers next run (QA F1)', async () => {
    const original = structuredClone(source.data.summaries['401872924']);
    removeTenFieldGoal(source);
    source.setScore('401872924', 'home', 10); // scoreboard already shows the FG
    let slate = await buildSlate({}, deps);
    expect(slate.games.find((g) => g.id === '401872924')?.legsVerified).toBe(false);
    expect(summarizeBet(slate.games)).toMatchObject({ status: 'ALIVE', bustedLegs: [] });

    source.data.summaries['401872924'] = original as JsonObject;
    nowMs += 20_000;
    slate = await buildSlate({}, deps);
    expect(summarizeBet(slate.games).status).toBe('WON');
  });

  it('does not bust when a final game summary fails on a cold cache (QA F2)', async () => {
    source.failSummaries.add('401872661');
    const slate = await buildSlate({}, deps);
    expect(summarizeBet(slate.games)).toMatchObject({ status: 'ALIVE', bustedLegs: [] });
  });

  it('keeps confirmed legs when a newer summary is behind (QA F3, AC3.4)', async () => {
    await buildSlate({}, deps);
    const comp = source.competition('401872661');
    comp.status = liveStatus(4, 200);
    source.setScore('401872661', 'home', 44);
    const summary = source.data.summaries['401872661'] as JsonObject;
    summary.scoringPlays = (summary.scoringPlays as unknown[]).slice(0, 3);
    const slate = await buildSlate({}, deps);
    const g = slate.games.find((x) => x.id === '401872661');
    expect(g?.legsVerified).toBe(false);
    expect(g?.teams.map((t) => [t.tdCount, t.fgCount])).toEqual([
      [8, 1],
      [5, 1],
    ]);
  });

  it('un-hits a leg when ESPN removes a scoring play (AC3.5)', async () => {
    await buildSlate({}, deps);
    // NYJ 23 @ TEN 10: ESPN reverses TEN's only field goal (home score drops to 7).
    removeTenFieldGoal(source);
    source.setScore('401872924', 'home', 7);
    const slate = await buildSlate({}, deps);
    expect(slate.games.find((g) => g.id === '401872924')?.legsVerified).toBe(true);
    const ten = slate.games.find((g) => g.id === '401872924')?.teams.find((t) => t.abbr === 'TEN');
    expect(ten?.fgCount).toBe(0);
  });
});

describe('failure handling (ARCHITECTURE §5)', () => {
  it('serves the last good snapshot marked stale when the scoreboard fails', async () => {
    const fresh = await buildSlate({}, deps);
    source.failScoreboard = true;
    const stale = await buildSlate({}, deps);
    expect(stale.stale).toBe(true);
    expect(stale.games).toEqual(fresh.games);
  });

  it('throws UpstreamUnavailableError with no snapshot', async () => {
    source.failScoreboard = true;
    await expect(buildSlate({}, deps)).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it('isolates a single failing summary', async () => {
    source.failSummaries.add('401872661');
    const slate = await buildSlate({}, deps);
    const failed = slate.games.find((g) => g.id === '401872661');
    expect(failed?.legsVerified).toBe(false);
    expect(failed?.teams.every((t) => t.tdCount === 0)).toBe(true);
    expect(slate.games.filter((g) => g.legsVerified)).toHaveLength(7);
  });

  it('keeps previously cached legs when a later summary fetch fails', async () => {
    await buildSlate({}, deps);
    source.setScore('401872661', 'home', 44);
    source.failSummaries.add('401872661');
    const slate = await buildSlate({}, deps);
    const g = slate.games.find((x) => x.id === '401872661');
    expect(g?.legsVerified).toBe(false);
    expect(g?.teams.map((t) => t.tdCount)).toEqual([8, 5]);
  });

  it('treats a malformed 200 scoreboard as an outage, not as an empty week (QA F4)', async () => {
    await buildSlate({}, deps);
    source.overrideScoreboard = {};
    const slate = await buildSlate({}, deps);
    expect(slate).toMatchObject({ stale: true, week: 1 });
    expect(slate.games).toHaveLength(8);
  });

  it('does not let an empty slate overwrite a week that had games (QA F4)', async () => {
    await buildSlate({}, deps);
    source.overrideScoreboard = { season: { year: 2026, type: 2 }, week: { number: 1 }, events: [] };
    const glitch = await buildSlate({}, deps);
    expect(glitch.stale).toBe(true);
    expect(glitch.games).toHaveLength(8);

    source.overrideScoreboard = { season: { year: 2026, type: 2 }, week: { number: 2 }, events: [] };
    const rollover = await buildSlate({}, deps);
    expect(rollover).toMatchObject({ stale: false, week: 2, games: [] });
  });

  it('keys snapshots by requested week', () => {
    expect(snapshotKey({})).toBe('snapshot/current-current-current');
    expect(snapshotKey({ year: 2026, seasonType: 2, week: 3 })).toBe('snapshot/2026-2-3');
  });
});
