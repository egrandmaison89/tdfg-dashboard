import { describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '../src/server/cache';
import { handleSlateRequest, parseQuery } from '../src/server/handler';
import { loadReplay } from './helpers';

describe('parseQuery', () => {
  it('defaults to the current week, live data', () => {
    expect(parseQuery(new URLSearchParams(''))).toEqual({ params: {}, demo: false, progress: 100 });
  });

  it('reads week params', () => {
    expect(parseQuery(new URLSearchParams('week=2&seasontype=2&year=2026'))).toEqual({
      params: { week: 2, seasonType: 2, year: 2026 },
      demo: false,
      progress: 100,
    });
  });

  it('reads demo params', () => {
    expect(parseQuery(new URLSearchParams('demo=1&progress=40'))).toMatchObject({ demo: true, progress: 40 });
  });

  it('accepts canonical multi-digit values', () => {
    expect(parseQuery(new URLSearchParams('week=10'))).toMatchObject({ params: { week: 10 } });
    expect(parseQuery(new URLSearchParams('demo=1&progress=0'))).toMatchObject({ demo: true, progress: 0 });
  });

  it.each([
    'week=0',
    'week=26',
    'week=abc',
    'week=1.5',
    'week=',
    'progress=101',
    'seasontype=4',
    'seasontype=9',
    'year=1999',
    // Non-canonical spellings would each create a separate CDN cache key → extra ESPN calls (QA F5).
    'week=01',
    'week=1e0',
    'week=+1',
    'week=1.0',
    'week=1&week=2',
    'demo=zzz',
    'demo=true',
    'progress=7',
  ])(
    'rejects %s',
    (q) => {
      expect(parseQuery(new URLSearchParams(q))).toBeInstanceOf(Error);
    },
  );
});

const replay = loadReplay();
const now = () => new Date('2026-09-14T15:00:00Z');
const silent = () => {};

function espnFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/scoreboard')) return Response.json(replay.scoreboard);
    const id = new URL(url).searchParams.get('event') ?? '';
    return Response.json(replay.summaries[id]);
  });
}

describe('handleSlateRequest', () => {
  it('serves ESPN data with correct headers and upstream calls', async () => {
    const fetchImpl = espnFetch();
    const res = await handleSlateRequest(new Request('https://tdfg.test/api/slate'), {
      cache: new MemoryCache(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
      log: silent,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('netlify-cdn-cache-control')).toBe('public, durable, s-maxage=600, stale-while-revalidate=600');
    expect(res.headers.get('netlify-vary')).toBe('query=year|seasontype|week|demo|progress');
    const body = await res.json();
    expect(body.source).toBe('espn');
    expect(body.games).toHaveLength(8);
    expect(fetchImpl).toHaveBeenCalledTimes(9);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
  });

  it('passes week selection upstream', async () => {
    const fetchImpl = espnFetch();
    await handleSlateRequest(new Request('https://tdfg.test/api/slate?week=2&seasontype=2&year=2026'), {
      cache: new MemoryCache(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
      log: silent,
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=2&seasontype=2&dates=2026',
    );
  });

  it('serves demo data without touching ESPN (AC8.3)', async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error('should not fetch');
    });
    const res = await handleSlateRequest(new Request('https://tdfg.test/api/slate?demo=1&progress=50'), {
      cache: new MemoryCache(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
      log: silent,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe('demo');
    expect(res.headers.get('netlify-cdn-cache-control')).toContain('s-maxage=3600');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects invalid params with 400', async () => {
    const res = await handleSlateRequest(new Request('https://tdfg.test/api/slate?week=99'), { cache: new MemoryCache(), log: silent });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/week/);
  });

  it('rejects non-GET methods with 405', async () => {
    const res = await handleSlateRequest(new Request('https://tdfg.test/api/slate', { method: 'POST' }), {
      cache: new MemoryCache(),
      log: silent,
    });
    expect(res.status).toBe(405);
  });

  it('returns 503 with a short cache when ESPN is down and nothing is cached', async () => {
    const fetchImpl = vi.fn(async () => new Response('oops', { status: 500 }));
    const res = await handleSlateRequest(new Request('https://tdfg.test/api/slate'), {
      cache: new MemoryCache(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
      log: silent,
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/unavailable/i);
    expect(res.headers.get('netlify-cdn-cache-control')).toContain('s-maxage=10');
  });
});
