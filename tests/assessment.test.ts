import { describe, expect, it } from 'vitest';
import { assessTeam, FIELD, RISK_THRESHOLDS, timeoutsFor, yardsToGoal } from '../src/shared/risk';
import type { Game } from '../src/shared/types';
import { DONE, game } from './helpers';

const NEEDS_FG = { tdCount: 2, fgCount: 0 };
const NEEDS_TD = { tdCount: 0, fgCount: 1 };
const NEEDS_BOTH = { tdCount: 0, fgCount: 0 };

/** Away team = id '1', home = id '2' (see helpers). */
const away = (g: Game) => assessTeam(g, g.teams[0]);
const home = (g: Game) => assessTeam(g, g.teams[1]);

describe('field position (R15)', () => {
  it('converts ESPN home-goal yard lines into yards to the end zone', () => {
    const g = game({ yardLine: 65 });
    expect(yardsToGoal(g, g.teams[1])).toBe(35); // home attacks toward 100
    expect(yardsToGoal(g, g.teams[0])).toBe(65); // away attacks toward 0
    expect(yardsToGoal(game({ yardLine: null }), g.teams[0])).toBeNull();
    expect(yardsToGoal(game({ yardLine: 140 }), g.teams[0])).toBeNull();
  });

  it('reads each side’s timeouts', () => {
    const g = game({ homeTimeouts: 1, awayTimeouts: 3 });
    expect(timeoutsFor(g, g.teams[0])).toBe(3);
    expect(timeoutsFor(g, g.teams[1])).toBe(1);
  });
});

describe('assessTeam escalation (AC14.1, AC14.2)', () => {
  it('escalates without the ball inside 5:00 when a field goal is still missing', () => {
    const withBall = game({ period: 4, clockSeconds: 280, possessionTeamId: '1', away: NEEDS_FG });
    const withoutBall = game({ period: 4, clockSeconds: 280, possessionTeamId: '2', away: NEEDS_FG });
    expect(away(withBall).level).toBe('danger');
    expect(away(withoutBall).level).toBe('last_chance');
    expect(away(withoutBall).reasons).toContain('doesn’t have the ball');
  });

  it('escalates again with no timeouts left', () => {
    const g = game({ period: 4, clockSeconds: 450, possessionTeamId: '2', awayTimeouts: 0, away: NEEDS_FG });
    // 7:30 left: clock alone would be "watch"; no ball → danger; no timeouts → last chance.
    expect(away(g).level).toBe('last_chance');
    expect(away(g).reasons).toEqual(expect.arrayContaining(['doesn’t have the ball', 'no timeouts left']));
  });

  it('does not escalate for a missing TD, which the defense can still score (AC14.2)', () => {
    const g = game({ period: 4, clockSeconds: 180, possessionTeamId: '2', awayTimeouts: 0, away: NEEDS_TD });
    expect(away(g).level).toBe('danger');
    expect(away(g).reasons).not.toContain('doesn’t have the ball');
  });

  it('treats unknown possession as unknown, not as "the other team has it"', () => {
    const g = game({ period: 4, clockSeconds: 280, possessionTeamId: null, away: NEEDS_FG });
    expect(away(g).level).toBe('danger');
    expect(away(g).reasons).not.toContain('doesn’t have the ball');
  });

  it('marks overtime and the final two minutes as a last chance', () => {
    expect(away(game({ period: 5, clockSeconds: 500, away: NEEDS_BOTH })).reasons).toContain('overtime');
    expect(away(game({ period: 5, clockSeconds: 500, away: NEEDS_BOTH })).level).toBe('last_chance');
    const twoMinute = game({ period: 4, clockSeconds: RISK_THRESHOLDS.lastChance, away: NEEDS_TD });
    expect(away(twoMinute).level).toBe('last_chance');
    expect(away(twoMinute).reasons).toContain('final 2:00');
  });
});

describe('assessTeam opportunity (AC14.3)', () => {
  it('flags a team with the ball in range for the leg it needs', () => {
    const fgRange = game({ period: 2, clockSeconds: 300, possessionTeamId: '2', yardLine: 100 - FIELD.fgRange, home: NEEDS_FG });
    expect(home(fgRange)).toMatchObject({ opportunity: true, inFgRange: true, yardsToGoal: FIELD.fgRange });
    expect(home(fgRange).reasons).toContain('in field-goal range');

    const redZone = game({ period: 2, clockSeconds: 300, possessionTeamId: '2', yardLine: 88, isRedZone: true, home: NEEDS_TD });
    expect(home(redZone)).toMatchObject({ opportunity: true, inRedZone: true });
    expect(home(redZone).reasons).toContain('in the red zone');
  });

  it('is not an opportunity when the ball is out of range for what is needed', () => {
    const g = game({ period: 2, clockSeconds: 300, possessionTeamId: '2', yardLine: 40, home: NEEDS_FG });
    expect(home(g).opportunity).toBe(false);
    expect(home(g).reasons).toContain('has the ball');
  });

  it('never lowers the level', () => {
    const g = game({ period: 4, clockSeconds: 90, possessionTeamId: '2', yardLine: 90, home: NEEDS_TD });
    expect(home(g)).toMatchObject({ level: 'last_chance', opportunity: true });
  });
});

describe('assessTeam terminal states', () => {
  it.each([
    ['void', game({ state: 'void', away: NEEDS_BOTH }), 'void'],
    ['final verified', game({ state: 'post', away: NEEDS_FG }), 'busted'],
    ['final unverified', game({ state: 'post', legsVerified: false, away: NEEDS_FG }), 'danger'],
    ['pregame', game({ state: 'pre', away: NEEDS_BOTH }), 'pregame'],
    ['nothing missing', game({ period: 4, clockSeconds: 10, away: DONE }), 'done'],
  ])('%s → %s', (_label, g, level) => {
    expect(away(g).level).toBe(level);
  });
});

describe('reasons are always present and correctly worded (AC14.4, QA F-06/F-09/F-10)', () => {
  it('always explains the clock, even with nothing else going on', () => {
    expect(away(game({ period: 4, clockSeconds: 600, possessionTeamId: null, away: NEEDS_BOTH })).reasons).toEqual([
      '4th quarter · 10:00 left',
    ]);
    expect(away(game({ period: 3, clockSeconds: 300, possessionTeamId: null, away: NEEDS_TD })).reasons).toEqual([
      '3rd quarter · 5:00 left',
    ]);
    expect(away(game({ period: 2, clockSeconds: 0, isHalftime: true, away: NEEDS_BOTH })).reasons).toEqual(['halftime']);
  });

  it('never has an empty reason list for a live team that needs something', () => {
    for (const period of [1, 2, 3, 4, 5]) {
      for (const clockSeconds of [900, 300, 60, 0]) {
        const g = game({ period, clockSeconds, away: NEEDS_BOTH });
        expect(away(g).reasons.length, `Q${period} ${clockSeconds}s`).toBeGreaterThan(0);
      }
    }
  });

  it('ignores possession left over at halftime', () => {
    const g = game({ period: 2, clockSeconds: 0, isHalftime: true, possessionTeamId: '1', yardLine: 30, away: NEEDS_FG });
    expect(away(g)).toMatchObject({ hasBall: false, opportunity: false });
    expect(away(g).reasons).toEqual(['halftime']);
  });

  it('calls it scoring position, not field-goal range, when only a TD helps', () => {
    const tdOnly = game({ period: 2, clockSeconds: 300, possessionTeamId: '1', yardLine: 22, away: NEEDS_TD });
    expect(away(tdOnly).reasons).toContain('in scoring position');
    expect(away(tdOnly).reasons).not.toContain('in field-goal range');
  });
});
