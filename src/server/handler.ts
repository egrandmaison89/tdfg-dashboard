/** HTTP layer for GET /api/slate: params, source selection, headers, errors. */

import type { SeasonHistory } from '../shared/history';
import { buildHistory } from './buildHistory';
import { buildSlate } from './buildSlate';
import { MemoryCache, type KeyValueCache } from './cache';
import { cacheHeaders, cdnTtlSeconds, historyTtlSeconds, TTL } from './cacheHeaders';
import { DemoSource } from './demo';
import { EspnSource, type SlateParams } from './source';

export interface HandlerDeps {
  cache: KeyValueCache;
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
    const slate = await buildSlate(query.params, { source, cache, now, log });
    const ttl = cdnTtlSeconds(slate, now().getTime(), { pinnedWeek: query.params.week !== undefined });
    return json(200, slate, cacheHeaders(ttl));
  } catch (err) {
    log('failed to build slate', err);
    return json(503, { error: 'Scores are temporarily unavailable. Retrying shortly.' }, cacheHeaders(TTL.error));
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
