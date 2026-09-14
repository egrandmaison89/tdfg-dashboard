import { describe, expect, it } from 'vitest';
import { etParts, isSundayOnePmET, slateDateOf } from '../src/shared/slate';

describe('isSundayOnePmET (R6, AC1.2, AC1.3)', () => {
  it.each([
    ['2026-09-13T17:00Z', true, 'Sun 1:00 PM EDT'],
    ['2026-09-13T17:05Z', true, 'Sun 1:05 PM EDT'],
    ['2026-12-13T18:00Z', true, 'Sun 1:00 PM EST'],
    ['2026-11-01T18:00Z', true, 'Sun 1:00 PM EST on the DST-end Sunday'],
    ['2026-11-01T17:00Z', false, 'Sun noon EST on the DST-end Sunday'],
    ['2026-12-13T17:00Z', false, 'Sun noon EST'],
    ['2026-09-13T13:30Z', false, 'Sun 9:30 AM international game'],
    ['2026-09-13T18:00Z', false, 'Sun 2:00 PM EDT'],
    ['2026-09-13T20:25Z', false, 'Sun 4:25 PM late window'],
    ['2026-09-14T00:20Z', false, 'Sun 8:20 PM SNF (Monday in UTC)'],
    ['2026-12-19T18:00Z', false, 'Saturday 1:00 PM EST'],
    ['2026-09-14T17:00Z', false, 'Monday 1:00 PM'],
    ['not a date', false, 'garbage input'],
  ])('%s → %s (%s)', (iso, expected) => {
    expect(isSundayOnePmET(iso)).toBe(expected);
  });
});

describe('etParts', () => {
  it('uses Eastern date, not UTC date', () => {
    expect(etParts('2026-09-14T00:20Z')).toEqual({ dateKey: '2026-09-13', weekday: 'Sun', hour: 20, minute: 20 });
  });
  it('returns null for invalid input', () => {
    expect(etParts('nope')).toBeNull();
  });
});

describe('slateDateOf', () => {
  it('returns the ET date of the first 1 PM kickoff', () => {
    expect(slateDateOf(['2026-09-14T00:20Z', '2026-09-13T17:00Z'])).toBe('2026-09-13');
  });
  it('returns null when no 1 PM games exist (AC1.4)', () => {
    expect(slateDateOf(['2026-09-14T00:20Z'])).toBeNull();
  });
});
