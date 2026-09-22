import { describe, expect, it } from 'vitest';
import { HISTORY_BUNDLE } from '../src/server/historyBundle';
import { isGraded } from '../src/shared/historyStats';
import { calibrationFactor, estimateSlate, legRatesFromHistory, modelProbability } from '../src/shared/oddsEstimate';

const seasons = Object.values(HISTORY_BUNDLE);
const gamesOf = (n: number) => Array.from({ length: n }, () => ({ state: 'pre' as const }));

describe('leg rates from history (AC16.4)', () => {
  const rates = legRatesFromHistory(seasons);

  it('derives per-leg hit rates from every graded week', () => {
    const expectedTeamWeeks = seasons.flatMap((s) => s.weeks.filter(isGraded)).reduce((sum, w) => sum + w.totalLegs / 2, 0);
    expect(rates.teamWeeks).toBe(expectedTeamWeeks);
    expect(rates.td).toBeGreaterThan(rates.fg); // teams miss field goals far more often than touchdowns
    expect(rates.td).toBeGreaterThan(0.85);
    expect(rates.fg).toBeLessThan(0.95);
  });

  it('falls back to sane rates with no history', () => {
    expect(legRatesFromHistory([])).toMatchObject({ teamWeeks: 0 });
  });
});

describe('calibration', () => {
  it('lines the model up with how often the bet actually landed', () => {
    const rates = legRatesFromHistory(seasons);
    const factor = calibrationFactor(seasons, rates);
    const graded = seasons.flatMap((s) => s.weeks.filter(isGraded));
    const observed = graded.filter((w) => w.status === 'won').length / graded.length;
    const calibratedMean = graded.reduce((sum, w) => sum + modelProbability(w.totalLegs / 2, rates, factor), 0) / graded.length;
    expect(calibratedMean).toBeCloseTo(observed, 3);
  });

  it('never prices a slate above what a single team manages (QA F-07)', () => {
    const rates = legRatesFromHistory(seasons);
    const factor = calibrationFactor(seasons, rates);
    const perTeam = rates.td * rates.fg;
    for (const teams of [2, 4, 8, 12, 16, 20]) {
      expect(modelProbability(teams, rates, factor)).toBeLessThanOrEqual(perTeam);
    }
    expect(modelProbability(2, rates, factor)).toBeGreaterThan(modelProbability(4, rates, factor));
    expect(estimateSlate(gamesOf(1), seasons)!.american).toBeLessThan(0); // a 1-game week is odds-on
  });

  it('stays 1 with no graded weeks', () => {
    expect(calibrationFactor([], { td: 0.9, fg: 0.8, teamWeeks: 0 })).toBe(1);
  });
});

describe('estimateSlate', () => {
  it('prices a normal 8-game slate in a believable range', () => {
    const estimate = estimateSlate(gamesOf(8), seasons);
    expect(estimate).not.toBeNull();
    expect(estimate?.teams).toBe(16);
    expect(estimate?.probability).toBeGreaterThan(0.001);
    expect(estimate?.probability).toBeLessThan(0.15);
    expect(estimate?.american).toBeGreaterThan(500);
    expect(estimate?.basedOn).toEqual({ weeks: 90, wins: 3 });
  });

  it('gets longer with more teams and shorter with fewer', () => {
    const small = estimateSlate(gamesOf(2), seasons);
    const big = estimateSlate(gamesOf(10), seasons);
    expect(small!.probability).toBeGreaterThan(big!.probability);
    expect(small!.american).toBeLessThan(big!.american);
  });

  it('ignores void games and returns nothing without data', () => {
    expect(estimateSlate([{ state: 'void' }, { state: 'pre' }], seasons)?.teams).toBe(2);
    expect(estimateSlate([], seasons)).toBeNull();
    expect(estimateSlate(gamesOf(8), [])).toBeNull();
  });
});
