/** Server pipeline: scoreboard → 1 PM filter → cached/fresh legs → SlateResponse (ARCHITECTURE §3). */

import { parseScoreboard, type EspnEvent, type EspnTeam, type ParsedScoreboard } from '../shared/espn';
import { parseScoringPlays, playsMatchScore, tallyLegs, type LegCounts } from '../shared/legs';
import { isSundayOnePmET, slateDateOf } from '../shared/slate';
import type { Game, SlateResponse, TeamLine } from '../shared/types';
import type { KeyValueCache } from './cache';
import type { DataSource, SlateParams } from './source';

export interface BuildDeps {
  source: DataSource;
  cache: KeyValueCache;
  now: () => Date;
  log?: (message: string, err?: unknown) => void;
}

export interface LegCacheEntry {
  /** "away-home" score the counts were computed for. */
  scoreKey: string;
  counts: Record<string, LegCounts>;
  verified: boolean;
  fetchedAt: string;
  /** When plays first failed to reconcile at this scoreKey (null once verified). */
  unverifiedSince?: string | null;
}

export class UpstreamUnavailableError extends Error {}

/** An unverified final game is re-checked every run for this long after it first mismatched… */
export const UNVERIFIED_FINAL_FAST_WINDOW_MS = 15 * 60_000;
/** …and at most this often afterwards, so a permanently inconsistent feed can't cost a call per run. */
export const UNVERIFIED_FINAL_RECHECK_MS = 10 * 60_000;

export const snapshotKey = (p: SlateParams) =>
  `snapshot/${p.year ?? 'current'}-${p.seasonType ?? 'current'}-${p.week ?? 'current'}`;
export const legsKey = (eventId: string) => `legs/${eventId}`;

const ZERO: LegCounts = { td: 0, fg: 0 };

function needsSummaryFetch(event: EspnEvent, scoreKey: string, cached: LegCacheEntry | null, nowMs: number): boolean {
  if (!cached || cached.scoreKey !== scoreKey) return true;
  if (cached.verified) return false;
  if (event.state !== 'post') return true;
  const since = Date.parse(cached.unverifiedSince ?? cached.fetchedAt);
  if (nowMs - since < UNVERIFIED_FINAL_FAST_WINDOW_MS) return true;
  return nowMs - Date.parse(cached.fetchedAt) >= UNVERIFIED_FINAL_RECHECK_MS;
}

function maxCounts(a: Record<string, LegCounts>, b: Record<string, LegCounts>): Record<string, LegCounts> {
  const out: Record<string, LegCounts> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id] ?? ZERO;
    const y = b[id] ?? ZERO;
    out[id] = { td: Math.max(x.td, y.td), fg: Math.max(x.fg, y.fg) };
  }
  return out;
}

async function resolveLegs(
  event: EspnEvent,
  { source, cache, now, log = () => {} }: BuildDeps,
): Promise<{ counts: Record<string, LegCounts>; verified: boolean }> {
  if (event.state !== 'in' && event.state !== 'post') return { counts: {}, verified: true };

  const [away, home] = event.teams;
  const scoreKey = `${away.score}-${home.score}`;
  const cached = await cache.get<LegCacheEntry>(legsKey(event.id));
  const nowMs = now().getTime();
  if (!needsSummaryFetch(event, scoreKey, cached, nowMs) && cached) {
    return { counts: cached.counts, verified: cached.verified };
  }

  try {
    const plays = parseScoringPlays(await source.summary(event.id));
    const fresh = tallyLegs(plays, [away.id, home.id]);
    const verified = playsMatchScore(plays, away.score, home.score);
    const nowIso = new Date(nowMs).toISOString();
    const stillUnverified = cached !== null && !cached.verified && cached.scoreKey === scoreKey;
    const entry: LegCacheEntry = {
      scoreKey,
      // A lagging (or older, CDN-cached) summary must not erase legs we already confirmed (AC3.4).
      // Lower counts are accepted only once they reconcile with the score (AC3.5).
      counts: verified || !cached ? fresh : maxCounts(cached.counts, fresh),
      verified,
      fetchedAt: nowIso,
      unverifiedSince: verified ? null : stillUnverified ? (cached.unverifiedSince ?? cached.fetchedAt) : nowIso,
    };
    await cache.set(legsKey(event.id), entry);
    return entry;
  } catch (err) {
    log(`summary fetch failed for event ${event.id}`, err);
    return { counts: cached?.counts ?? {}, verified: false };
  }
}

function toTeamLine(team: EspnTeam, counts: Record<string, LegCounts>): TeamLine {
  const c = counts[team.id] ?? ZERO;
  return { ...team, tdCount: c.td, fgCount: c.fg };
}

async function resolveGame(event: EspnEvent, deps: BuildDeps): Promise<Game> {
  const { counts, verified } = await resolveLegs(event, deps);
  const { teams, ...rest } = event;
  return { ...rest, legsVerified: verified, teams: [toTeamLine(teams[0], counts), toTeamLine(teams[1], counts)] };
}

const sameWeek = (a: SlateResponse, b: SlateResponse) =>
  a.season === b.season && a.seasonType === b.seasonType && a.week === b.week;

export async function buildSlate(params: SlateParams, deps: BuildDeps): Promise<SlateResponse> {
  const { source, cache, now, log = () => {} } = deps;
  const key = snapshotKey(params);

  let board: ParsedScoreboard;
  try {
    board = parseScoreboard(await source.scoreboard(params));
    if (board.season === 0 || board.week === 0) throw new Error('scoreboard response is missing season/week');
  } catch (err) {
    log('scoreboard fetch failed', err);
    const snapshot = await cache.get<SlateResponse>(key);
    if (snapshot) return { ...snapshot, stale: true };
    throw new UpstreamUnavailableError('Scores are temporarily unavailable');
  }

  const events = board.events.filter((e) => isSundayOnePmET(e.kickoff));
  const games = await Promise.all(events.map((e) => resolveGame(e, deps)));
  games.sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id));

  const slate: SlateResponse = {
    generatedAt: now().toISOString(),
    source: source.name,
    stale: false,
    season: board.season,
    seasonType: board.seasonType,
    week: board.week,
    slateDate: slateDateOf(events.map((e) => e.kickoff)),
    games,
  };

  if (source.name === 'espn') {
    const previous = await cache.get<SlateResponse>(key);
    if (slate.games.length === 0 && previous && previous.games.length > 0 && sameWeek(previous, slate)) {
      // Games don't vanish from a week; treat an empty slate for a week that had games as a feed glitch.
      log(`scoreboard returned no 1 PM games for week ${slate.week}, which previously had games; serving snapshot`);
      return { ...previous, stale: true };
    }
    await cache.set(key, slate);
  }
  return slate;
}
