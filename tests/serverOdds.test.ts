import { describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '../src/server/cache';
import { handleOddsRequest, handleSlateRequest, ODDS_FAILURE_LIMIT, ODDS_READ_TTL } from '../src/server/handler';
import { oddsKey, parseOddsRequest, readOdds } from '../src/server/odds';
import type { WeekOdds } from '../src/shared/types';
import { fakeEspnFetch, FakeSeasonSource } from './fakeSeason';

const now = () => new Date('2026-09-20T17:30:00Z');
const REF = { season: 2026, seasonType: 2, week: 3 };
const validBody = { ...REF, american: '+2500', stake: 20, note: 'DK parlay', key: 'secret' };

const post = (body: unknown) =>
  new Request('https://tdfg.test/api/odds', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('parseOddsRequest (§5c)', () => {
  it('accepts a valid body', () => {
    const parsed = parseOddsRequest(validBody, 'secret', now());
    expect(parsed).toMatchObject({ ok: true, ref: REF, odds: { american: 2500, stake: 20, note: 'DK parlay' } });
  });

  it.each([
    ['no passphrase configured', validBody, undefined, 503],
    ['wrong passphrase', { ...validBody, key: 'nope' }, 'secret', 401],
    ['missing passphrase', { ...validBody, key: undefined }, 'secret', 401],
    ['not an object', 'hello', 'secret', 400],
    ['bad week', { ...validBody, week: 99 }, 'secret', 400],
    ['bad season type', { ...validBody, seasonType: 9 }, 'secret', 400],
    ['bad odds', { ...validBody, american: 12 }, 'secret', 400],
    ['bad stake', { ...validBody, stake: -5 }, 'secret', 400],
  ])('rejects %s', (_label, body, passphrase, status) => {
    expect(parseOddsRequest(body, passphrase, now())).toMatchObject({ ok: false, status });
  });
});

describe('handleOddsRequest', () => {
  it('stores the odds and reports them back', async () => {
    const cache = new MemoryCache();
    const res = await handleOddsRequest(post(validBody), { cache, passphrase: 'secret', now, log: () => {} });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).odds).toMatchObject({ american: 2500, stake: 20, updatedAt: now().toISOString() });
    expect(await readOdds(cache, REF)).toMatchObject({ american: 2500 });
    expect(oddsKey(REF)).toBe('odds/2026-2-3');
  });

  it('rejects other methods and unreadable bodies', async () => {
    const deps = { cache: new MemoryCache(), passphrase: 'secret', now, log: () => {} };
    const put = new Request('https://tdfg.test/api/odds', { method: 'PUT', body: '{}' });
    expect((await handleOddsRequest(put, deps)).status).toBe(405);
    const bad = new Request('https://tdfg.test/api/odds', { method: 'POST', body: 'not json' });
    expect((await handleOddsRequest(bad, deps)).status).toBe(400);
  });

  it('reads the week odds from its own endpoint, cached briefly rather than with the slate (QA F-02)', async () => {
    const cache = new MemoryCache();
    await handleOddsRequest(post(validBody), { cache, passphrase: 'secret', now, log: () => {} });

    const res = await handleOddsRequest(
      new Request('https://tdfg.test/api/odds?season=2026&seasontype=2&week=3'),
      { cache, passphrase: 'secret', now, log: () => {} },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ odds: { american: 2500 }, editable: true });
    expect(res.headers.get('netlify-cdn-cache-control')).toContain(`s-maxage=${ODDS_READ_TTL}`);
    expect(res.headers.get('netlify-vary')).toBe('query=season|seasontype|week');

    const readOnly = await handleOddsRequest(new Request('https://tdfg.test/api/odds?season=2026&seasontype=2&week=3'), {
      cache,
      now,
      log: () => {},
    });
    expect((await readOnly.json()).editable).toBe(false);
  });

  it('requires a complete week on reads', async () => {
    const deps = { cache: new MemoryCache(), passphrase: 'secret', now, log: () => {} };
    expect((await handleOddsRequest(new Request('https://tdfg.test/api/odds'), deps)).status).toBe(400);
    expect((await handleOddsRequest(new Request('https://tdfg.test/api/odds?season=2026&week=3'), deps)).status).toBe(400);
    expect((await handleOddsRequest(new Request('https://tdfg.test/api/odds?season=2026&seasontype=2&week=99'), deps)).status).toBe(400);
  });

  it('stops answering after repeated wrong passphrases (QA F-08)', async () => {
    const cache = new MemoryCache();
    const deps = { cache, passphrase: 'secret', now, log: () => {} };
    const attempt = () => {
      const req = new Request('https://tdfg.test/api/odds', {
        method: 'POST',
        body: JSON.stringify({ ...validBody, key: 'guess' }),
        headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.9' },
      });
      return handleOddsRequest(req, deps);
    };
    const statuses: number[] = [];
    for (let i = 0; i < ODDS_FAILURE_LIMIT + 2; i += 1) statuses.push((await attempt()).status);
    expect(statuses.slice(0, ODDS_FAILURE_LIMIT)).toEqual(Array(ODDS_FAILURE_LIMIT).fill(401));
    expect(statuses.at(-1)).toBe(429);
  });

  it('reports a failed write instead of a false success (QA F-01)', async () => {
    const cache = new MemoryCache();
    vi.spyOn(cache, 'set').mockRejectedValue(new Error('blobs unavailable'));
    const res = await handleOddsRequest(post(validBody), { cache, passphrase: 'secret', now, log: () => {} });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/Could not save/);
  });

  it('reports storage failures instead of pretending to save', async () => {
    const cache = new MemoryCache();
    vi.spyOn(cache, 'set').mockRejectedValueOnce(new Error('blobs down'));
    const res = await handleOddsRequest(post(validBody), { cache, passphrase: 'secret', now, log: () => {} });
    expect(res.status).toBe(503);
  });
});

describe('odds on the slate (AC16.1)', () => {
  it('serves the stored odds for that week and flags whether editing is possible', async () => {
    const source = new FakeSeasonSource(2026, 3);
    const cache = new MemoryCache();
    const odds: WeekOdds = { american: 1800, stake: 25, note: null, updatedAt: now().toISOString() };
    await cache.set(oddsKey(REF), odds);

    const deps = { cache, fetchImpl: fakeEspnFetch(source), now: () => source.duringGames(3), log: () => {} };
    const withEditor = await handleSlateRequest(new Request('https://tdfg.test/api/slate'), { ...deps, oddsEditable: true });
    const body = await withEditor.json();
    expect(body.odds).toEqual(odds);
    expect(body.oddsEditable).toBe(true);

    const readOnly = await handleSlateRequest(new Request('https://tdfg.test/api/slate'), deps);
    expect((await readOnly.json()).oddsEditable).toBe(false);
  });

  it('never attaches odds to demo data', async () => {
    const res = await handleSlateRequest(new Request('https://tdfg.test/api/slate?demo=1&progress=50'), {
      cache: new MemoryCache(),
      oddsEditable: true,
      now,
      log: () => {},
    });
    const body = await res.json();
    expect(body.odds).toBeNull();
  });
});
