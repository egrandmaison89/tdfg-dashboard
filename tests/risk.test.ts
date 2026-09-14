import { describe, expect, it } from 'vitest';
import { elapsedSeconds, regulationRemaining } from '../src/shared/clock';
import { gameRisk, missingLegs, teamRisk } from '../src/shared/risk';
import type { Game } from '../src/shared/types';
import { DONE, game } from './helpers';

const TWO_MISSING = { tdCount: 0, fgCount: 0 };
const ONE_MISSING = { tdCount: 1, fgCount: 0 };

const at = (period: number, clockSeconds: number, extra: Partial<Game> = {}) => ({ period, clockSeconds, ...extra });
const risk = (g: Game) => teamRisk(g, g.teams[0]);

describe('clock helpers', () => {
  it('computes regulation remaining', () => {
    expect(regulationRemaining(game(at(1, 900)))).toBe(3600);
    expect(regulationRemaining(game(at(3, 252)))).toBe(1152);
    expect(regulationRemaining(game(at(2, 0, { isHalftime: true })))).toBe(1800);
    expect(regulationRemaining(game(at(5, 400)))).toBe(0);
    expect(regulationRemaining(game({ state: 'pre' }))).toBe(3600);
    expect(regulationRemaining(game({ state: 'post' }))).toBe(0);
  });
  it('computes elapsed seconds including OT', () => {
    expect(elapsedSeconds(1, 900)).toBe(0);
    expect(elapsedSeconds(4, 0)).toBe(3600);
    expect(elapsedSeconds(5, 600)).toBe(3600);
    expect(elapsedSeconds(5, 0)).toBe(4200);
  });
});

describe('missingLegs', () => {
  it('lists TD then FG', () => {
    expect(missingLegs({ tdCount: 0, fgCount: 0 })).toEqual(['TD', 'FG']);
    expect(missingLegs({ tdCount: 2, fgCount: 0 })).toEqual(['FG']);
    expect(missingLegs(DONE)).toEqual([]);
  });
});

describe('teamRisk table (SPEC F6)', () => {
  it.each([
    ['void game', game({ state: 'void', away: TWO_MISSING }), 'void'],
    ['pregame', game({ state: 'pre', away: TWO_MISSING }), 'pregame'],
    ['final, all hit', game({ state: 'post', away: DONE }), 'done'],
    ['final, missing', game({ state: 'post', away: ONE_MISSING }), 'busted'],
    ['final, missing, plays unverified', game({ state: 'post', legsVerified: false, away: ONE_MISSING }), 'danger'],
    ['live, all hit', game({ ...at(4, 10), away: DONE }), 'done'],
    ['2 missing, Q1 start', game({ ...at(1, 900), away: TWO_MISSING }), 'ok'],
    ['2 missing, 30:01 left', game({ ...at(2, 1), away: TWO_MISSING }), 'ok'],
    ['2 missing, halftime', game({ ...at(2, 0, { isHalftime: true }), away: TWO_MISSING }), 'watch'],
    ['2 missing, exactly 30:00', game({ ...at(3, 900), away: TWO_MISSING }), 'watch'],
    ['2 missing, 15:01 left', game({ ...at(3, 1), away: TWO_MISSING }), 'watch'],
    ['2 missing, exactly 15:00', game({ ...at(4, 900), away: TWO_MISSING }), 'danger'],
    ['1 missing, 15:01 left', game({ ...at(3, 1), away: ONE_MISSING }), 'ok'],
    ['1 missing, exactly 15:00', game({ ...at(4, 900), away: ONE_MISSING }), 'watch'],
    ['1 missing, 5:01 left', game({ ...at(4, 301), away: ONE_MISSING }), 'watch'],
    ['1 missing, exactly 5:00', game({ ...at(4, 300), away: ONE_MISSING }), 'danger'],
    ['1 missing, overtime', game({ ...at(5, 590), away: ONE_MISSING }), 'danger'],
    ['0 missing, overtime', game({ ...at(5, 590), away: DONE }), 'done'],
  ])('%s → %s', (_label, g, expected) => {
    expect(risk(g)).toBe(expected);
  });
});

describe('gameRisk (AC6.1)', () => {
  it('is the worse of the two teams', () => {
    expect(gameRisk(game({ ...at(4, 600), away: DONE, home: ONE_MISSING }))).toBe('watch');
    expect(gameRisk(game({ ...at(4, 120), away: ONE_MISSING, home: TWO_MISSING }))).toBe('danger');
    expect(gameRisk(game({ state: 'post', away: DONE, home: ONE_MISSING }))).toBe('busted');
    expect(gameRisk(game({ state: 'post', away: DONE, home: DONE }))).toBe('done');
  });
});
