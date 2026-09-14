import { describe, expect, it } from 'vitest';
import { adjacentWeek, apiUrl, DEFAULT_DEMO_PROGRESS, isSlateResponse, readQuery, toSearch, weekBounds } from '../src/client/query';
import { slate } from './helpers';

describe('client query helpers', () => {
  it('reads an empty query as the current live week', () => {
    expect(readQuery('')).toEqual({ demo: false, progress: 100, week: undefined, seasonType: undefined, year: undefined });
    expect(apiUrl(readQuery(''))).toBe('/api/slate');
  });

  it('reads demo mode with a default progress', () => {
    expect(readQuery('?demo=1')).toMatchObject({ demo: true, progress: DEFAULT_DEMO_PROGRESS });
    expect(readQuery('?demo=1&progress=250').progress).toBe(100);
    expect(readQuery('?demo=1&progress=-3').progress).toBe(DEFAULT_DEMO_PROGRESS);
  });

  it('round-trips week selection and ignores junk', () => {
    const q = readQuery('?week=3&seasontype=2&year=2026&foo=bar');
    expect(toSearch(q)).toBe('week=3&seasontype=2&year=2026');
    expect(apiUrl(q)).toBe('/api/slate?week=3&seasontype=2&year=2026');
  });

  it.each(['?week=abc', '?week=0', '?week=26', '?week=1.5'])('drops invalid week %s (QA F15)', (search) => {
    expect(readQuery(search).week).toBeUndefined();
  });

  it('drops invalid season types', () => {
    expect(readQuery('?seasontype=4').seasonType).toBeUndefined();
  });

  it('omits week params in demo mode', () => {
    expect(toSearch({ demo: true, progress: 40, week: 3 })).toBe('demo=1&progress=40');
  });

  it('knows week bounds per season type', () => {
    expect(weekBounds(1)).toEqual([1, 4]);
    expect(weekBounds(2)).toEqual([1, 18]);
    expect(weekBounds(3)).toEqual([1, 5]);
  });
});

describe('adjacentWeek (AC1.5, QA F15)', () => {
  it.each([
    [2, 5, 1, { seasonType: 2, week: 6 }],
    [2, 5, -1, { seasonType: 2, week: 4 }],
    [2, 18, 1, { seasonType: 3, week: 1 }],
    [3, 1, -1, { seasonType: 2, week: 18 }],
    [2, 1, -1, { seasonType: 1, week: 4 }],
    [1, 4, 1, { seasonType: 2, week: 1 }],
    [1, 1, -1, null],
    [3, 5, 1, null],
  ] as const)('seasonType %i week %i %+i → %o', (seasonType, week, delta, expected) => {
    expect(adjacentWeek(seasonType, week, delta)).toEqual(expected);
  });
});

describe('isSlateResponse (QA F7)', () => {
  it('accepts a slate', () => {
    expect(isSlateResponse(slate([]))).toBe(true);
  });
  it.each([null, 'hello', {}, { games: 'x', week: 1, generatedAt: 'x' }, { games: [], generatedAt: 'x' }])('rejects %o', (v) => {
    expect(isSlateResponse(v)).toBe(false);
  });
});
