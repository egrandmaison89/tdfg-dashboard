/**
 * Demo/replay data source (SPEC F8). Rewinds the real 2026 Week 1 ESPN data to a point in
 * game time and emits ESPN-shaped JSON, so the full server pipeline runs unchanged.
 */

import replayJson from '../../fixtures/2026-wk1/replay.json';
import { elapsedSeconds, QUARTER_SECONDS, REGULATION_SECONDS } from '../shared/clock';
import { arr, num, obj, str, type JsonObject } from '../shared/json';
import type { DataSource } from './source';

interface Replay {
  scoreboard: JsonObject;
  summaries: Record<string, JsonObject>;
}

const replay = replayJson as unknown as Replay;

/** A red-zone flag is shown when the possessing team's next score is this close (game seconds). */
const RED_ZONE_WINDOW_SECONDS = 90;

const playElapsed = (play: unknown) => {
  const p = obj(play);
  return elapsedSeconds(num(obj(p.period).number), num(obj(p.clock).value));
};

const formatClock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function clampProgress(progress: number): number {
  return Math.min(100, Math.max(0, progress));
}

function rewindEvent(rawEvent: unknown, progress: number): unknown {
  const event = structuredClone(obj(rawEvent));
  const summary = replay.summaries[str(event.id)];
  if (!summary || progress >= 100) return event;

  const comp = obj(arr(event.competitions)[0]);
  const plays = arr(summary.scoringPlays);
  const elapsed = (progress / 100) * REGULATION_SECONDS;
  const visible = plays.filter((p) => playElapsed(p) <= elapsed);
  const upcoming = plays.find((p) => playElapsed(p) > elapsed);
  const last = obj(visible.at(-1));

  let status: JsonObject;
  if (progress <= 0) {
    status = {
      clock: 0,
      displayClock: '0:00',
      period: 0,
      type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false, shortDetail: 'Sun 1:00 PM ET' },
    };
  } else if (elapsed === 2 * QUARTER_SECONDS) {
    status = {
      clock: 0,
      displayClock: '0:00',
      period: 2,
      type: { name: 'STATUS_HALFTIME', state: 'in', completed: false, shortDetail: 'Halftime' },
    };
  } else {
    const period = Math.min(4, Math.floor(elapsed / QUARTER_SECONDS) + 1);
    const clock = Math.round(QUARTER_SECONDS - (elapsed - (period - 1) * QUARTER_SECONDS));
    status = {
      clock,
      displayClock: formatClock(clock),
      period,
      type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false, shortDetail: 'In Progress' },
    };
  }
  comp.status = status;
  event.status = status;

  for (const competitor of arr(comp.competitors)) {
    const c = obj(competitor);
    c.score = String(num(c.homeAway === 'home' ? last.homeScore : last.awayScore));
  }

  if (progress > 0 && upcoming) {
    // A plausible drive toward the next score, so the drive strip has something real-shaped to draw.
    const secondsToScore = playElapsed(upcoming) - elapsed;
    const isRedZone = secondsToScore <= RED_ZONE_WINDOW_SECONDS;
    const possessionId = str(obj(obj(upcoming).team).id);
    const home = arr(comp.competitors)
      .map(obj)
      .find((c) => c.homeAway === 'home');
    const possessionIsHome = str(obj(home?.team).id) === possessionId;
    const yardsToGoal = Math.max(2, Math.min(95, Math.round(secondsToScore / 8) + 5));
    const yardLine = possessionIsHome ? 100 - yardsToGoal : yardsToGoal;
    const abbrOf = (side: 'home' | 'away') =>
      str(obj(obj(arr(comp.competitors).map(obj).find((c) => c.homeAway === side)).team).abbreviation, side === 'home' ? 'HOME' : 'AWAY');
    const possessionAbbr = possessionIsHome ? abbrOf('home') : abbrOf('away');
    const defendingAbbr = possessionIsHome ? abbrOf('away') : abbrOf('home');
    // Own half when more than 50 to go, otherwise the defence's half.
    const spotAbbr = yardsToGoal > 50 ? possessionAbbr : defendingAbbr;
    const spotYard = yardsToGoal > 50 ? 100 - yardsToGoal : yardsToGoal;
    comp.situation = {
      possession: possessionId,
      isRedZone,
      down: (Math.floor(elapsed / 37) % 4) + 1,
      distance: isRedZone ? 4 : 10,
      yardLine,
      downDistanceText: `${['1st', '2nd', '3rd', '4th'][Math.floor(elapsed / 37) % 4]} & ${isRedZone ? 4 : 10} at ${spotAbbr} ${spotYard}`,
      homeTimeouts: 3,
      awayTimeouts: 2,
    };
  } else {
    delete comp.situation;
  }
  return event;
}

export class DemoSource implements DataSource {
  readonly name = 'demo' as const;
  private readonly progress: number;

  constructor(progress: number) {
    this.progress = clampProgress(progress);
  }

  async scoreboard(): Promise<unknown> {
    const board = obj(replay.scoreboard);
    return { ...board, events: arr(board.events).map((e) => rewindEvent(e, this.progress)) };
  }

  async summary(eventId: string): Promise<unknown> {
    const summary = replay.summaries[eventId];
    if (!summary) throw new Error(`No demo summary for ${eventId}`);
    if (this.progress >= 100) return summary;
    const elapsed = (this.progress / 100) * REGULATION_SECONDS;
    return { ...summary, scoringPlays: arr(summary.scoringPlays).filter((p) => playElapsed(p) <= elapsed) };
  }
}
