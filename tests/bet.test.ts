import { describe, expect, it } from 'vitest';
import { describeRemainder, FILTERS, isSettled, matchesFilter, sortGames, summarizeBet, type FilterKey } from '../src/shared/bet';
import { DONE, game } from './helpers';

describe('summarizeBet (F4, F5)', () => {
  it('reports NO_GAMES for an empty slate', () => {
    expect(summarizeBet([])).toMatchObject({ status: 'NO_GAMES', totalLegs: 0, hitLegs: 0 });
  });

  it('reports NOT_STARTED before kickoff', () => {
    const s = summarizeBet([game({ state: 'pre' })]);
    expect(s).toMatchObject({ status: 'NOT_STARTED', totalLegs: 4, hitLegs: 0 });
    expect(s.needed.map((n) => n.risk)).toEqual(['pregame', 'pregame']);
  });

  it('counts legs, orders needed teams by urgency, and describes the remainder', () => {
    const late = game({ id: 'late', period: 4, clockSeconds: 180, away: { tdCount: 1 }, home: DONE });
    const early = game({ id: 'early', period: 2, clockSeconds: 600, away: { id: '3', abbr: 'CCC' }, home: { id: '4', abbr: 'DDD' } });
    const s = summarizeBet([early, late]);
    expect(s).toMatchObject({ status: 'ALIVE', totalLegs: 8, hitLegs: 3 });
    expect(s.needed.map((n) => [n.team.abbr, n.missing.join('+'), n.risk])).toEqual([
      ['AWY', 'FG', 'danger'],
      ['CCC', 'TD+FG', 'ok'],
      ['DDD', 'TD+FG', 'ok'],
    ]);
    expect(s.remainderText).toBe('5 legs left: 2 TDs, 3 FGs across 3 teams');
  });

  it('is WON as soon as every leg is hit, even mid-game (R8)', () => {
    const s = summarizeBet([game({ period: 2, clockSeconds: 300, away: DONE, home: DONE })]);
    expect(s).toMatchObject({ status: 'WON', hitLegs: 4, totalLegs: 4, needed: [] });
    expect(s.remainderText).toBe('Nothing left to hit.');
  });

  it('is BUSTED when a final game has a missing leg, naming it (R9, AC4.2)', () => {
    const s = summarizeBet([
      game({ id: 'a', state: 'post', away: DONE, home: { tdCount: 3, fgCount: 0 } }),
      game({ id: 'b', period: 3, clockSeconds: 100, away: { id: '5', abbr: 'EEE' }, home: { id: '6', abbr: 'FFF', ...DONE } }),
    ]);
    expect(s.status).toBe('BUSTED');
    expect(s.bustedLegs).toEqual([{ gameId: 'a', abbr: 'HOM', type: 'FG' }]);
    expect(s.needed.map((n) => n.team.abbr)).toEqual(['EEE']);
  });

  it('never busts on a final game whose legs are unverified (QA F1/F2)', () => {
    const lagging = game({ state: 'post', legsVerified: false, away: DONE, home: { tdCount: 2 } });
    const s = summarizeBet([lagging]);
    expect(s).toMatchObject({ status: 'ALIVE', bustedLegs: [] });
    expect(s.needed.map((n) => [n.team.abbr, n.missing.join('+'), n.risk])).toEqual([['HOM', 'FG', 'danger']]);
    expect(isSettled(lagging)).toBe(false);
    expect(matchesFilter(lagging, 'needs')).toBe(true);
    expect(matchesFilter(lagging, 'final')).toBe(true);
  });

  it('marks a slate with a postponed game as NO_BET but keeps tracking the rest (R10)', () => {
    const s = summarizeBet([game({ id: 'v', state: 'void' }), game({ id: 'p', state: 'pre' })]);
    expect(s.status).toBe('NO_BET');
    expect(s.totalLegs).toBe(4);
    expect(s.needed).toHaveLength(2);
  });
});

describe('describeRemainder', () => {
  it('uses singular wording', () => {
    const [entry] = summarizeBet([game({ period: 4, clockSeconds: 60, away: { tdCount: 1 }, home: DONE })]).needed;
    expect(describeRemainder(entry ? [entry] : [])).toBe('1 leg left: 1 FG across 1 team');
  });
});

describe('matchesFilter (F7, AC7.1)', () => {
  const games = {
    pregame: game({ id: 'pre', state: 'pre' }),
    liveOk: game({ id: 'liveOk', period: 1, clockSeconds: 800 }),
    liveTrouble: game({ id: 'liveTrouble', period: 4, clockSeconds: 120, away: DONE }),
    liveOffBoard: game({ id: 'liveOff', period: 3, clockSeconds: 400, away: DONE, home: DONE }),
    finalDone: game({ id: 'finalDone', state: 'post', away: DONE, home: DONE }),
    finalBusted: game({ id: 'finalBusted', state: 'post', away: DONE }),
    void: game({ id: 'void', state: 'void' }),
  };
  const all = Object.values(games);
  const ids = (key: FilterKey) => all.filter((g) => matchesFilter(g, key)).map((g) => g.id);

  it('has the six filters in order', () => {
    expect(FILTERS.map((f) => f.key)).toEqual(['all', 'live', 'needs', 'trouble', 'offboard', 'final']);
  });

  it.each<[FilterKey, string[]]>([
    ['all', ['pre', 'liveOk', 'liveTrouble', 'liveOff', 'finalDone', 'finalBusted', 'void']],
    ['live', ['liveOk', 'liveTrouble', 'liveOff']],
    ['needs', ['pre', 'liveOk', 'liveTrouble']],
    ['trouble', ['liveTrouble']],
    ['offboard', ['liveOff', 'finalDone']],
    ['final', ['finalDone', 'finalBusted']],
  ])('%s', (key, expected) => {
    expect(ids(key)).toEqual(expected);
  });
});

describe('sortGames (AC7.2)', () => {
  const done = game({ id: 'done', kickoff: '2026-09-13T17:00Z', state: 'post', away: DONE, home: DONE });
  const pre = game({ id: 'pre', kickoff: '2026-09-13T17:05Z', state: 'pre' });
  const danger = game({ id: 'danger', kickoff: '2026-09-13T17:00Z', period: 4, clockSeconds: 100 });
  const ok = game({ id: 'ok', kickoff: '2026-09-13T17:00Z', period: 1, clockSeconds: 100 });
  const input = [done, pre, ok, danger];

  it('sorts by urgency', () => {
    expect(sortGames(input, 'urgency').map((g) => g.id)).toEqual(['danger', 'ok', 'pre', 'done']);
  });
  it('sorts by kickoff then id', () => {
    expect(sortGames(input, 'kickoff').map((g) => g.id)).toEqual(['danger', 'done', 'ok', 'pre']);
  });
  it('does not mutate input', () => {
    sortGames(input, 'urgency');
    expect(input.map((g) => g.id)).toEqual(['done', 'pre', 'ok', 'danger']);
  });
});
