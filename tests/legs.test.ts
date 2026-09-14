import { describe, expect, it } from 'vitest';
import { parseScoringPlays, playsMatchScore, tallyLegs } from '../src/shared/legs';
import { loadReplay } from './helpers';

const replay = loadReplay();
const play = (teamId: string, scoringType: string | null, extra: Record<string, unknown> = {}) => ({
  team: { id: teamId },
  ...(scoringType ? { scoringType: { name: scoringType } } : {}),
  period: { number: 1 },
  clock: { value: 600 },
  awayScore: 0,
  homeScore: 0,
  ...extra,
});

describe('tallyLegs with real data (AC3.3)', () => {
  it('counts CHI @ CAR correctly and reconciles with the final score', () => {
    const plays = parseScoringPlays(replay.summaries['401872661']);
    expect(tallyLegs(plays, ['3', '29'])).toEqual({ '3': { td: 8, fg: 1 }, '29': { td: 5, fg: 1 } });
    expect(playsMatchScore(plays, 59, 37)).toBe(true);
    expect(playsMatchScore(plays, 59, 30)).toBe(false);
  });

  it('credits interception-return touchdowns to the defense (R2)', () => {
    const raw = replay.summaries['401872925']?.scoringPlays as { type: { text: string }; team: { id: string } }[];
    const pickSix = raw.find((p) => p.type.text === 'Interception Return Touchdown');
    expect(pickSix?.team.id).toBe('27');
    const plays = parseScoringPlays(replay.summaries['401872925']);
    expect(tallyLegs(plays, ['27', '4'])['27']).toEqual({ td: 3, fg: 2 });
  });

  it('counts overtime touchdowns (R4)', () => {
    const plays = parseScoringPlays(replay.summaries['401872923']);
    const otTds = plays.filter((p) => p.period === 5 && p.kind === 'TD');
    expect(otTds.length).toBeGreaterThan(0);
    expect(tallyLegs(plays, ['18', '8'])).toEqual({ '18': { td: 4, fg: 1 }, '8': { td: 4, fg: 1 } });
  });
});

describe('tallyLegs with synthetic plays (R3, R5)', () => {
  it('ignores safeties and other scoring types', () => {
    const plays = parseScoringPlays({ scoringPlays: [play('1', 'safety'), play('1', 'extra-point')] });
    expect(tallyLegs(plays, ['1', '2'])).toEqual({ '1': { td: 0, fg: 0 }, '2': { td: 0, fg: 0 } });
  });

  it('counts defensive fumble-recovery TD for the scoring team', () => {
    const plays = parseScoringPlays({
      scoringPlays: [play('2', 'touchdown', { type: { text: 'Fumble Return Touchdown', abbreviation: 'TD' } })],
    });
    expect(tallyLegs(plays, ['1', '2'])['2']).toEqual({ td: 1, fg: 0 });
  });

  it('falls back to type abbreviation when scoringType is missing', () => {
    const plays = parseScoringPlays({
      scoringPlays: [play('1', null, { type: { abbreviation: 'FG' } }), play('1', null, { type: { abbreviation: 'TD' } })],
    });
    expect(tallyLegs(plays, ['1'])['1']).toEqual({ td: 1, fg: 1 });
  });

  it('drops plays without a team and ignores unknown teams', () => {
    const plays = parseScoringPlays({ scoringPlays: [{ scoringType: { name: 'touchdown' } }, play('99', 'touchdown')] });
    expect(plays).toHaveLength(1);
    expect(tallyLegs(plays, ['1', '2'])).toEqual({ '1': { td: 0, fg: 0 }, '2': { td: 0, fg: 0 } });
  });

  it('returns no plays for malformed summaries', () => {
    expect(parseScoringPlays(undefined)).toEqual([]);
    expect(parseScoringPlays({ scoringPlays: {} })).toEqual([]);
  });
});

describe('playsMatchScore (AC3.4, ADR-003)', () => {
  it('treats 0-0 with no plays as verified', () => {
    expect(playsMatchScore([], 0, 0)).toBe(true);
  });
  it('flags feed lag when the scoreboard is ahead of the plays', () => {
    expect(playsMatchScore([], 7, 0)).toBe(false);
    const plays = parseScoringPlays({ scoringPlays: [play('1', 'touchdown', { awayScore: 7, homeScore: 0 })] });
    expect(playsMatchScore(plays, 7, 3)).toBe(false);
    expect(playsMatchScore(plays, 7, 0)).toBe(true);
  });
});
