import { describe, expect, it } from 'vitest';
import { parseEvent, parseScoreboard } from '../src/shared/espn';
import { isSundayOnePmET } from '../src/shared/slate';
import { liveStatus, loadReplay, rawEvent } from './helpers';

describe('parseScoreboard with real Week 1 data', () => {
  const board = parseScoreboard(loadReplay().scoreboard);

  it('reads season metadata from events when top-level is absent', () => {
    expect(board).toMatchObject({ season: 2026, seasonType: 2, week: 1 });
  });

  it('parses all 13 Sunday games, 8 of which are in the 1 PM window', () => {
    expect(board.events).toHaveLength(13);
    expect(board.events.filter((e) => isSundayOnePmET(e.kickoff))).toHaveLength(8);
  });

  it('orders teams [away, home] with numeric scores', () => {
    const chiCar = board.events.find((e) => e.id === '401872661');
    expect(chiCar?.teams.map((t) => [t.abbr, t.homeAway, t.score])).toEqual([
      ['CHI', 'away', 59],
      ['CAR', 'home', 37],
    ]);
    expect(chiCar?.state).toBe('post');
    expect(chiCar?.statusDetail).toBe('Final');
    expect(chiCar?.teams[0].color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(chiCar?.teams[0].logo).toMatch(/^https:\/\//);
  });
});

describe('parseEvent status mapping (AC2.1, AC2.3)', () => {
  it('maps a live game with situation', () => {
    const ev = parseEvent(
      rawEvent({
        status: liveStatus(3, 252),
        situation: { possession: '1', isRedZone: true, downDistanceText: '3rd & 4 at HOM 12' },
      }),
    );
    expect(ev).toMatchObject({
      state: 'in',
      statusDetail: 'Q3 4:12',
      period: 3,
      clockSeconds: 252,
      possessionTeamId: '1',
      isRedZone: true,
      downDistance: '3rd & 4 at HOM 12',
      isHalftime: false,
    });
  });

  it('maps halftime', () => {
    expect(parseEvent(rawEvent({ status: liveStatus(2, 0, 'STATUS_HALFTIME') }))).toMatchObject({
      state: 'in',
      isHalftime: true,
      statusDetail: 'Halftime',
    });
  });

  it('maps end of quarter and overtime', () => {
    expect(parseEvent(rawEvent({ status: liveStatus(1, 0, 'STATUS_END_PERIOD') }))?.statusDetail).toBe('End Q1');
    expect(parseEvent(rawEvent({ status: liveStatus(5, 450) }))?.statusDetail).toBe('OT 7:30');
  });

  it.each(['STATUS_POSTPONED', 'STATUS_CANCELED'])('maps %s to void (R10)', (name) => {
    const ev = parseEvent(rawEvent({ status: { type: { name, state: 'post', shortDetail: 'Postponed' } } }));
    expect(ev?.state).toBe('void');
  });

  it('voids a game reported over but not completed (R10, QA F8)', () => {
    const ev = parseEvent(rawEvent({ status: { type: { name: 'STATUS_FINAL', state: 'post', completed: false } } }));
    expect(ev?.state).toBe('void');
    const final = parseEvent(rawEvent({ status: { type: { name: 'STATUS_FINAL', state: 'post', completed: true, shortDetail: 'Final' } } }));
    expect(final?.state).toBe('post');
  });

  it("uses ESPN's text for live statuses that aren't clock-driven, like delays (QA F16)", () => {
    const ev = parseEvent(
      rawEvent({ status: { period: 2, clock: 300, displayClock: '5:00', type: { name: 'STATUS_DELAYED', state: 'in', shortDetail: 'Delayed' } } }),
    );
    expect(ev).toMatchObject({ state: 'in', statusDetail: 'Delayed' });
  });

  it('ignores situation when the game is not live', () => {
    const ev = parseEvent(rawEvent({ situation: { possession: '1', isRedZone: true } }));
    expect(ev).toMatchObject({ state: 'pre', possessionTeamId: null, isRedZone: false });
  });
});

describe('parseEvent robustness', () => {
  it('skips events missing a competitor', () => {
    expect(parseEvent(rawEvent({ home: null }))).toBeNull();
  });

  it('defaults bad or missing fields instead of throwing', () => {
    const ev = parseEvent(
      rawEvent({ away: { id: '1', abbr: 'AWY', score: undefined, color: 'not-a-color' }, home: { id: '2', abbr: 'HOM', score: '14' } }),
    );
    expect(ev?.teams[0]).toMatchObject({ score: 0, color: null, logo: null });
    expect(ev?.teams[1].score).toBe(14);
  });

  it('handles non-object input', () => {
    expect(parseScoreboard(null).events).toEqual([]);
    expect(parseScoreboard({ events: 'nope' }).events).toEqual([]);
    expect(parseEvent(42)).toBeNull();
  });
});
