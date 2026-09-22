/** HTTP layer for GET /api/slate: params, source selection, headers, errors. */

import type { SeasonHistory } from '../shared/history';
import { parseOddsRequest, readOdds, writeOdds } from './odds';
import { buildHistory } from './buildHistory';
import { buildSlate } from './buildSlate';
import { MemoryCache, type KeyValueCache } from './cache';
import { cacheHeaders, cdnTtlSeconds, historyTtlSeconds, TTL } from './cacheHeaders';
import { DemoSource } from './demo';
import { EspnSource, type SlateParams } from './source';

export interface HandlerDeps {
  cache: KeyValueCache;
  /** A passphrase is configured, so the UI may offer the odds editor (F16). */
  oddsEditable?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (message: string, err?: unknown) => void;
}

export interface ParsedQuery {
  params: SlateParams;
  demo: boolean;
  progress: number;
}

/** Canonical integers only ("1", not "01", "1.0", "1e0" or "+1"): every accepted spelling is a CDN cache key. */
const CANONICAL_INT = /^(0|[1-9]\d{0,3})$/;

function singleParam(search: URLSearchParams, name: string): string | undefined | Error {
  const values = search.getAll(name);
  if (values.length > 1) return new Error(`"${name}" may only appear once`);
  return values[0];
}

function intParam(search: URLSearchParams, name: string, min: number, max: number): number | undefined | Error {
  const raw = singleParam(search, name);
  if (raw === undefined || raw instanceof Error) return raw;
  const n = Number(raw);
  if (!CANONICAL_INT.test(raw) || n < min || n > max) return new Error(`"${name}" must be an integer from ${min} to ${max}`);
  return n;
}

/**
 * Strict parsing keeps the CDN cache small (AC9.3): anything that would produce a distinct cache key
 * without a distinct, meaningful response is rejected rather than forwarded to ESPN.
 */
export function parseQuery(search: URLSearchParams): ParsedQuery | Error {
  const year = intParam(search, 'year', 2000, 2100);
  const seasonType = intParam(search, 'seasontype', 1, 3);
  const week = intParam(search, 'week', 1, 25);
  const progress = intParam(search, 'progress', 0, 100);
  const demoRaw = singleParam(search, 'demo');
  for (const v of [year, seasonType, week, progress, demoRaw]) if (v instanceof Error) return v;

  if (demoRaw !== undefined && demoRaw !== '1') return new Error('"demo" must be 1');
  const demo = demoRaw === '1';
  if (!demo && progress !== undefined) return new Error('"progress" is only valid with demo=1');

  const params: SlateParams = {};
  if (year !== undefined) params.year = year as number;
  if (seasonType !== undefined) params.seasonType = seasonType as number;
  if (week !== undefined) params.week = week as number;

  return { params, demo, progress: (progress as number | undefined) ?? 100 };
}

const json = (status: number, body: unknown, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });

export async function handleSlateRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((message, err) => console.error(`[slate] ${message}`, err ?? ''));

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
  }

  const query = parseQuery(new URL(req.url).searchParams);
  if (query instanceof Error) return json(400, { error: query.message }, cacheHeaders(TTL.idle));

  const source = query.demo ? new DemoSource(query.progress) : new EspnSource(deps.fetchImpl);
  const cache = query.demo ? new MemoryCache() : deps.cache;

  try {
    const slate = await buildSlate(query.params, { source, cache, now, log, oddsEditable: deps.oddsEditable === true });
    const ttl = cdnTtlSeconds(slate, now().getTime(), { pinnedWeek: query.params.week !== undefined });
    return json(200, slate, cacheHeaders(ttl));
  } catch (err) {
    log('failed to build slate', err);
    return json(503, { error: 'Scores are temporarily unavailable. Retrying shortly.' }, cacheHeaders(TTL.error));
  }
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Wrong-passphrase attempts tolerated per client per minute before the endpoint stops answering. */
export const ODDS_FAILURE_LIMIT = 8;
export const ODDS_FAILURE_WINDOW_MS = 60_000;
const oddsFailures = new Map<string, { count: number; resetAt: number }>();

const clientKey = (req: Request) =>
  req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

function isThrottled(key: string, nowMs: number): boolean {
  const entry = oddsFailures.get(key);
  return entry !== undefined && entry.resetAt > nowMs && entry.count >= ODDS_FAILURE_LIMIT;
}

function recordFailure(key: string, nowMs: number): void {
  const entry = oddsFailures.get(key);
  if (!entry || entry.resetAt <= nowMs) oddsFailures.set(key, { count: 1, resetAt: nowMs + ODDS_FAILURE_WINDOW_MS });
  else entry.count += 1;
}

/** Odds are read from their own endpoint so a long-cached slate can't pin a stale price (AC16.1). */
export const ODDS_READ_TTL = 15;

function oddsWeekFromQuery(search: URLSearchParams): { season: number; seasonType: number; week: number } | Error {
  const season = intParam(search, 'season', 2000, 2100);
  const seasonType = intParam(search, 'seasontype', 1, 3);
  const week = intParam(search, 'week', 1, 25);
  for (const v of [season, seasonType, week]) if (v instanceof Error) return v;
  if (season === undefined || seasonType === undefined || week === undefined) {
    return new Error('season, seasontype and week are required');
  }
  return { season: season as number, seasonType: seasonType as number, week: week as number };
}

export interface OddsHandlerDeps extends HandlerDeps {
  /** Undefined disables writes entirely (AC16.2). */
  passphrase?: string | undefined;
}

/** POST /api/odds (SPEC §5c): set this week's price. Never cached. */
export async function handleOddsRequest(req: Request, deps: OddsHandlerDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((message, err) => console.error(`[odds] ${message}`, err ?? ''));

  if (req.method === 'GET' || req.method === 'HEAD') {
    const ref = oddsWeekFromQuery(new URL(req.url).searchParams);
    if (ref instanceof Error) return json(400, { error: ref.message }, NO_STORE);
    try {
      return json(
        200,
        { odds: await readOdds(deps.cache, ref), editable: Boolean(deps.passphrase) },
        {
          'Cache-Control': 'public, max-age=0, must-revalidate',
          'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${ODDS_READ_TTL}, stale-while-revalidate=${ODDS_READ_TTL}`,
          'Netlify-Vary': 'query=season|seasontype|week',
        },
      );
    } catch (err) {
      log('failed to read odds', err);
      return json(503, { error: 'Could not read the odds.' }, NO_STORE);
    }
  }
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });

  const nowMs = now().getTime();
  const client = clientKey(req);
  if (isThrottled(client, nowMs)) {
    log(`odds write throttled for ${client}`);
    return json(429, { error: 'Too many attempts. Wait a minute and try again.' }, NO_STORE);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Expected a JSON body' }, NO_STORE);
  }

  const parsed = parseOddsRequest(body, deps.passphrase, now());
  if (!parsed.ok) {
    if (parsed.status === 401) recordFailure(client, nowMs);
    return json(parsed.status, { error: parsed.error }, NO_STORE);
  }

  try {
    await writeOdds(deps.cache, parsed.ref, parsed.odds);
    return json(200, { odds: parsed.odds }, NO_STORE);
  } catch (err) {
    log('failed to store odds', err);
    return json(503, { error: 'Could not save the odds. Try again.' }, NO_STORE);
  }
}

export interface HistoryHandlerDeps extends HandlerDeps {
  bundle: Record<number, SeasonHistory>;
  startSeason?: number;
}

/** GET /api/history (SPEC §5b). Takes no parameters, so the CDN holds exactly one entry. */
export async function handleHistoryRequest(req: Request, deps: HistoryHandlerDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((message, err) => console.error(`[history] ${message}`, err ?? ''));

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
  }
  if (new URL(req.url).search !== '') {
    return json(400, { error: '/api/history does not take query parameters' }, cacheHeaders(TTL.idle));
  }

  try {
    const history = await buildHistory({
      source: new EspnSource(deps.fetchImpl),
      cache: deps.cache,
      now,
      log,
      bundle: deps.bundle,
      ...(deps.startSeason !== undefined ? { startSeason: deps.startSeason } : {}),
    });
    return json(200, history, cacheHeaders(historyTtlSeconds(history)));
  } catch (err) {
    log('failed to build history', err);
    return json(503, { error: 'History is temporarily unavailable. Retrying shortly.' }, cacheHeaders(TTL.error));
  }
}
