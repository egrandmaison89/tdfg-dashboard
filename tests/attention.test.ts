import { describe, expect, it } from 'vitest';
import { attentionItems, ATTENTION_VISIBLE_LIMIT } from '../src/shared/attention';
import { DONE, game } from './helpers';

const NEEDS_FG = { tdCount: 2, fgCount: 0 };
const NEEDS_TD = { tdCount: 0, fgCount: 1 };
const NEEDS_BOTH = { tdCount: 0, fgCount: 0 };

describe('attentionItems (AC14.5)', () => {
  it('includes danger, last chance and live chances only', () => {
    const games = [
      game({ id: 'danger', period: 4, clockSeconds: 200, away: NEEDS_BOTH, home: DONE }),
      game({ id: 'watch', period: 3, clockSeconds: 800, away: NEEDS_BOTH, home: DONE }),
      game({ id: 'ok', period: 1, clockSeconds: 800, away: NEEDS_BOTH, home: DONE }),
      game({ id: 'chance', period: 1, clockSeconds: 800, possessionTeamId: '2', yardLine: 85, away: DONE, home: NEEDS_TD }),
      game({ id: 'settled', state: 'post', away: DONE, home: DONE }),
    ];
    expect(attentionItems(games).map((i) => i.game.id)).toEqual(['danger', 'chance']);
  });

  it('puts the worst level first and a chance ahead of an equal level (QA F-11)', () => {
    const games = [
      game({ id: 'chance-watch', period: 3, clockSeconds: 890, possessionTeamId: '1', yardLine: 30, away: { ...NEEDS_FG, abbr: 'CHW' }, home: DONE }),
      game({ id: 'last', period: 4, clockSeconds: 60, away: { ...NEEDS_BOTH, abbr: 'LST' }, home: DONE }),
      game({ id: 'danger', period: 4, clockSeconds: 400, away: { ...NEEDS_BOTH, abbr: 'DNG' }, home: DONE }),
    ];
    expect(attentionItems(games).map((i) => i.team.abbr)).toEqual(['LST', 'DNG', 'CHW']);
  });

  it('keeps both teams of one game when both qualify, ordered by severity', () => {
    const items = attentionItems([
      game({ period: 4, clockSeconds: 100, away: { ...NEEDS_BOTH, abbr: 'AAA' }, home: { ...NEEDS_FG, abbr: 'BBB' } }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]?.assessment.level).toBe('last_chance');
  });

  it('caps at a sensible number of visible rows', () => {
    expect(ATTENTION_VISIBLE_LIMIT).toBeGreaterThanOrEqual(4);
    expect(ATTENTION_VISIBLE_LIMIT).toBeLessThanOrEqual(10);
  });
});
