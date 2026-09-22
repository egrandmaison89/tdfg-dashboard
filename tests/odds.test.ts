import { describe, expect, it } from 'vitest';
import {
  formatAmerican,
  impliedProbability,
  isValidAmerican,
  probabilityToAmerican,
  profitFor,
  returnFor,
  validateOdds,
} from '../src/shared/odds';

describe('payout math (AC16.3)', () => {
  it('computes profit and total return', () => {
    expect(profitFor(2500, 20)).toBe(500);
    expect(returnFor(2500, 20)).toBe(520);
    expect(profitFor(-110, 110)).toBe(100);
    expect(returnFor(-110, 110)).toBe(210);
    expect(profitFor(2500, 0)).toBe(0);
  });

  it('formats and inverts American odds', () => {
    expect(formatAmerican(2500)).toBe('+2500');
    expect(formatAmerican(-110)).toBe('-110'); // ASCII, so it pastes back into the editor
    expect(impliedProbability(100)).toBeCloseTo(0.5);
    expect(impliedProbability(-200)).toBeCloseTo(2 / 3);
    expect(probabilityToAmerican(0.5)).toBe(100);
    expect(probabilityToAmerican(2 / 3)).toBe(-200);
    expect(probabilityToAmerican(0.0107)).toBe(9246); // 100 × (1 − p) / p
  });

  it.each([100, -100, 2500, -110])('accepts %i', (v) => expect(isValidAmerican(v)).toBe(true));
  it.each([99, -99, 0, 100.5, Number.NaN])('rejects %s', (v) => expect(isValidAmerican(v)).toBe(false));
});

describe('validateOdds', () => {
  it('accepts the shapes people actually type', () => {
    expect(validateOdds({ american: '+2500', stake: '$20' })).toEqual({ ok: true, value: { american: 2500, stake: 20, note: null } });
    expect(validateOdds({ american: -110, stake: 12.345, note: '  DK slip ' })).toEqual({
      ok: true,
      value: { american: -110, stake: 12.35, note: 'DK slip' },
    });
  });

  it('rejects bad values with a readable message', () => {
    expect(validateOdds({ american: 50, stake: 10 })).toMatchObject({ ok: false, error: expect.stringContaining('Odds') });
    expect(validateOdds({ american: 2500, stake: -1 })).toMatchObject({ ok: false, error: expect.stringContaining('Stake') });
    expect(validateOdds({ american: 2500, stake: 'abc' })).toMatchObject({ ok: false });
    expect(validateOdds({ american: 2500, stake: 10, note: 42 })).toMatchObject({ ok: false, error: expect.stringContaining('Note') });
  });

  it.each([null, [], '', true, {}])('rejects a stake of %s instead of coercing it (QA F-15)', (stake) => {
    expect(validateOdds({ american: 2500, stake })).toMatchObject({ ok: false });
  });

  it('truncates long notes', () => {
    const result = validateOdds({ american: 2500, stake: 10, note: 'x'.repeat(200) });
    expect(result.ok && result.value.note).toHaveLength(80);
  });
});
