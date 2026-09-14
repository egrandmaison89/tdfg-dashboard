import { describe, expect, it } from 'vitest';
import { gradeWeek, placeholderWeek, SHORT_SLATE_MIN_GAMES } from '../src/shared/history';
import type { Game } from '../src/shared/types';
import { DONE, game } from './helpers';

const finalGame = (i: number, over: Parameters<typeof game>[0] = {}): Game =>
  game({
    id: `g${i}`,
    state: 'post',
    ...over,
    away: { id: `a${i}`, abbr: `A${i}`, ...DONE, ...over.away },
    home: { id: `h${i}`, abbr: `H${i}`, ...DONE, ...over.home },
  });

const slateOf = (n: number) => Array.from({ length: n }, (_, i) => finalGame(i));

describe('gradeWeek (R10–R12, AC13.8)', () => {
  it('grades a week where every leg hit as won', () => {
    const { grade, settled } = gradeWeek(2024, 18, slateOf(4), '2025-01-05');
    expect(settled).toBe(true);
    expect(grade).toEqual({
      season: 2024,
      week: 18,
      slateDate: '2025-01-05',
      status: 'won',
      games: 4,
      voidGames: 0,
      totalLegs: 16,
      hitLegs: 16,
      missedLegs: [],
      shortSlate: false,
    });
  });

  it('grades a missed leg as lost and lists it', () => {
    const games = [...slateOf(3), finalGame(3, { home: { fgCount: 0 } }), finalGame(4, { away: { tdCount: 0, fgCount: 0 } })];
    const { grade } = gradeWeek(2023, 2, games, '2023-09-17');
    expect(grade).toMatchObject({ status: 'lost', totalLegs: 20, hitLegs: 17 });
    expect(grade.missedLegs).toEqual([
      { abbr: 'H3', type: 'FG' },
      { abbr: 'A4', type: 'TD' },
      { abbr: 'A4', type: 'FG' },
    ]);
  });

  it(`flags fewer than ${SHORT_SLATE_MIN_GAMES} games as a short slate (R12)`, () => {
    expect(gradeWeek(2022, 16, slateOf(1), null).grade.shortSlate).toBe(true);
    expect(gradeWeek(2022, 16, slateOf(SHORT_SLATE_MIN_GAMES - 1), null).grade.shortSlate).toBe(true);
    expect(gradeWeek(2022, 16, slateOf(SHORT_SLATE_MIN_GAMES), null).grade.shortSlate).toBe(false);
  });

  it('marks a week with a postponed game as no bet, excluding its legs (R10)', () => {
    const games = [...slateOf(3), finalGame(9, { state: 'void', away: { tdCount: 0 } })];
    const { grade, settled } = gradeWeek(2026, 5, games, '2026-10-11');
    expect(settled).toBe(true);
    expect(grade).toMatchObject({ status: 'no_bet', games: 3, voidGames: 1, totalLegs: 12, hitLegs: 12, shortSlate: true });
  });

  it('is no bet but not settled while the other games are still live', () => {
    const games = [finalGame(0, { state: 'in' }), finalGame(1, { state: 'void' })];
    expect(gradeWeek(2026, 5, games, null)).toMatchObject({ grade: { status: 'no_bet' }, settled: false });
  });

  it('grades a week with no Sunday 1 PM games as no_games', () => {
    expect(gradeWeek(2026, 5, [], null)).toMatchObject({
      grade: { status: 'no_games', games: 0, totalLegs: 0, shortSlate: false },
      settled: true,
    });
  });

  it('stays live while any game is in progress, even when every leg has already hit', () => {
    const games = [...slateOf(3), finalGame(3, { state: 'in' })];
    expect(gradeWeek(2026, 3, games, null)).toMatchObject({ grade: { status: 'live', hitLegs: 16 }, settled: false });
  });

  it('stays live (never lost) while a final game is unverified', () => {
    const games = [...slateOf(3), finalGame(3, { legsVerified: false, home: { fgCount: 0 } })];
    expect(gradeWeek(2026, 3, games, null)).toMatchObject({ grade: { status: 'live' }, settled: false });
  });

  it('is upcoming when every game is pregame, and live when some have finished', () => {
    const pre = [finalGame(0, { state: 'pre' }), finalGame(1, { state: 'pre' })];
    expect(gradeWeek(2026, 4, pre, null).grade.status).toBe('upcoming');
    expect(gradeWeek(2026, 4, [finalGame(0), finalGame(1, { state: 'pre' })], null).grade.status).toBe('live');
  });

  it('builds placeholders', () => {
    expect(placeholderWeek(2026, 9, 'pending')).toEqual({
      season: 2026,
      week: 9,
      slateDate: null,
      status: 'pending',
      games: 0,
      voidGames: 0,
      totalLegs: 0,
      hitLegs: 0,
      missedLegs: [],
      shortSlate: false,
    });
  });
});
