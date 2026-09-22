/**
 * Live-game fields verified against real ESPN data recorded during Monday Night Football,
 * DEN @ KC on 2026-09-14 (TEST_PLAN §1). Snapshots are keyed by ET capture time (HHMM).
 */

import { describe, expect, it } from 'vitest';
import live from '../fixtures/live-mnf/den-kc-2026-09-14.json';
import { parseEvent } from '../src/shared/espn';
import { parseScoringPlays, playsMatchScore, tallyLegs } from '../src/shared/legs';
import { yardsToGoal } from '../src/shared/risk';

const recording = live as unknown as {
  scoreboardEvents: Record<string, unknown>;
  scoringPlays: Record<string, unknown[]>;
};

function eventAt(hhmm: string) {
  const event = parseEvent(recording.scoreboardEvents[hhmm]);
  if (!event) throw new Error(`no event recorded at ${hhmm}`);
  return event;
}

describe('live ESPN data (recorded MNF DEN @ KC)', () => {
  it('parses in-progress status, clock, possession and down & distance', () => {
    expect(eventAt('2022')).toMatchObject({
      state: 'in',
      statusDetail: 'Q1 11:02',
      period: 1,
      possessionTeamId: '12',
      isRedZone: false,
      downDistance: '2nd & 10 at DEN 35',
    });
    expect(eventAt('2022').teams.map((t) => [t.abbr, t.homeAway, t.score])).toEqual([
      ['DEN', 'away', 0],
      ['KC', 'home', 0],
    ]);
    expect(eventAt('2116')).toMatchObject({ statusDetail: 'Q2 6:34', possessionTeamId: '12', downDistance: '4th & 13 at KC 33' });
  });

  it('reads down, distance, yard line and timeouts from the real feed (AC14.1, R15)', () => {
    // 21:16 capture: KC (home, id 12) 4th & 13 at their own 33, both sides with timeouts.
    expect(eventAt('2116')).toMatchObject({ down: 4, distance: 13, yardLine: 33, homeTimeouts: 3, awayTimeouts: 3 });
    // 21:34: DEN burned two timeouts before the half.
    expect(eventAt('2134')).toMatchObject({ homeTimeouts: 3, awayTimeouts: 1 });
    // Every live capture carries the fields the escalation logic depends on.
    for (const hhmm of Object.keys(recording.scoreboardEvents)) {
      const event = eventAt(hhmm);
      expect(typeof event.homeTimeouts, `capture ${hhmm}`).toBe('number');
      expect(typeof event.awayTimeouts, `capture ${hhmm}`).toBe('number');
      expect(event.yardLine, `capture ${hhmm}`).not.toBeNull();
    }
  });

  it('agrees with the yards-to-goal math in both directions (R15)', () => {
    const kcDriving = eventAt('2022'); // KC (home) has the ball at "DEN 35" → yardLine 65
    expect(yardsToGoal(kcDriving, kcDriving.teams[1])).toBe(35);
    const denDriving = eventAt('2049'); // DEN (away) at "DEN 8" → yardLine 92
    expect(yardsToGoal(denDriving, denDriving.teams[0])).toBe(92);
  });

  it('handles ESPN flagging the red zone with no possession (right after a score)', () => {
    expect(eventAt('2040')).toMatchObject({ state: 'in', possessionTeamId: null, isRedZone: true, downDistance: null });
  });

  it('reconciles scoring plays with the live score in every capture', () => {
    const captures = Object.keys(recording.scoreboardEvents);
    expect(captures.length).toBeGreaterThanOrEqual(9);
    for (const hhmm of captures) {
      const [away, home] = eventAt(hhmm).teams;
      const plays = parseScoringPlays({ scoringPlays: recording.scoringPlays[hhmm] });
      expect(playsMatchScore(plays, away.score, home.score), `capture ${hhmm}`).toBe(true);
    }
  });

  it('tallies live legs from the recorded scoring plays', () => {
    const plays = parseScoringPlays({ scoringPlays: recording.scoringPlays['2134'] });
    expect(tallyLegs(plays, ['7', '12'])).toEqual({ '7': { td: 1, fg: 0 }, '12': { td: 2, fg: 0 } });
  });
});
