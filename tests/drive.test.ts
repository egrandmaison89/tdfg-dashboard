import { describe, expect, it } from 'vitest';
import { describeDrive } from '../src/shared/drive';
import { FIELD } from '../src/shared/risk';
import { DONE, game } from './helpers';

const NEEDS_FG = { tdCount: 2, fgCount: 0 };
const NEEDS_TD = { tdCount: 0, fgCount: 1 };
const live = (over = {}) => game({ period: 3, clockSeconds: 400, possessionTeamId: '2', yardLine: 70, ...over });

describe('describeDrive (F15)', () => {
  it('returns nothing for games that are not live', () => {
    expect(describeDrive(game({ state: 'pre' }))).toBeNull();
    expect(describeDrive(game({ state: 'post' }))).toBeNull();
  });

  it('reports field position from the possessing team’s point of view', () => {
    const drive = describeDrive(live({ yardLine: 70, downDistance: '2nd & 6 at AWY 30' }));
    expect(drive).toMatchObject({ yardsToGoal: 30, progressPct: 70, inFgRange: true, inRedZone: false, downDistance: '2nd & 6 at AWY 30' });
    expect(drive?.possessing?.abbr).toBe('HOM');
    expect(drive?.defending?.abbr).toBe('AWY');
  });

  it.each([
    ['needs both', { home: { tdCount: 0, fgCount: 0 } }, /Any score helps/],
    ['needs a TD, mid-field', { yardLine: 50, home: NEEDS_TD }, /needs a TD — a field goal here doesn’t help/],
    ['needs a TD in the red zone', { yardLine: 88, home: NEEDS_TD }, /red zone/],
    ['needs a TD on 4th in range', { yardLine: 100 - 30, down: 4, home: NEEDS_TD }, /going for it beats a field goal/],
    ['needs a FG in range', { yardLine: 100 - FIELD.fgRange, home: NEEDS_FG }, /in range right now/],
    ['needs a FG, too far', { yardLine: 40, home: NEEDS_FG }, new RegExp(`get inside the ${FIELD.fgRange}`)],
    ['possessing team done', { home: DONE, away: NEEDS_FG }, /quick stop so AWY gets the ball back/],
    ['everyone done', { home: DONE, away: DONE }, /enjoy the football/],
  ])('says what we want: %s', (_label, over, expected) => {
    expect(describeDrive(live(over))?.want).toMatch(expected);
  });

  it('handles no possession between drives and at halftime', () => {
    const between = describeDrive(live({ possessionTeamId: null, home: NEEDS_FG }));
    expect(between).toMatchObject({ possessing: null, yardsToGoal: null, progressPct: null, wantTone: 'watch' });
    expect(between?.want).toMatch(/HOM needs FG/);
    expect(between?.summary).toMatch(/Between drives/);
    expect(describeDrive(live({ possessionTeamId: null, isHalftime: true }))?.summary).toMatch(/Halftime/);
  });

  it.each([
    ['red zone', { yardLine: 88, home: NEEDS_FG }, 'red-zone'],
    ['FG range for a team that needs a FG', { yardLine: 100 - 30, home: NEEDS_FG }, 'fg-range'],
    ['long FG range', { yardLine: 100 - 42, home: NEEDS_FG }, 'long-fg'],
    ['no chip when only a TD helps (QA F-09)', { yardLine: 100 - 30, home: NEEDS_TD }, null],
    ['no chip out of range', { yardLine: 30, home: NEEDS_FG }, null],
  ])('picks the range chip by what is needed: %s', (_label, over, chip) => {
    expect(describeDrive(live(over))?.rangeChip).toBe(chip);
  });

  it('ignores possession at halftime (QA F-10)', () => {
    const drive = describeDrive(live({ isHalftime: true, possessionTeamId: '2', home: NEEDS_FG }));
    expect(drive).toMatchObject({ possessing: null, rangeChip: null, yardsToGoal: null });
    expect(drive?.summary).toMatch(/Halftime/);
  });

  it('writes a screen-reader summary', () => {
    const drive = describeDrive(live({ yardLine: 85, downDistance: '1st & Goal at AWY 15', home: NEEDS_TD }));
    expect(drive?.summary).toMatch(/HOM has the ball, 1st & Goal at AWY 15, 15 yards from the end zone/);
  });
});
