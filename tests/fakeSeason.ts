/**
 * A synthetic ESPN for history tests: a full 18-week season whose weeks are final, live or upcoming
 * relative to a chosen "current" week, with configurable missed legs, postponements and empty weeks.
 */

import type { DataSource, SlateParams } from '../src/server/source';
import type { JsonObject } from '../src/shared/json';
import { isSundayOnePmET } from '../src/shared/slate';
import { liveStatus, rawEvent } from './helpers';

const DAY_MS = 24 * 60 * 60_000;
export const GAMES_PER_WEEK = 4;

export interface WeekTimes {
  start: string;
  end: string;
  kickoff: string;
}

export class FakeSeasonSource implements DataSource {
  readonly name = 'espn' as const;
  /** "week|teamId|TD" or "week|teamId|FG" legs that weren't scored. */
  misses = new Set<string>();
  /** "week|gameIndex" games that were postponed. */
  voids = new Set<number | string>();
  emptyWeeks = new Set<number>();
  fail = false;
  scoreboardCalls: string[] = [];
  summaryCalls: string[] = [];

  constructor(
    readonly season: number,
    public currentWeek: number,
    readonly weekCount = 18,
    /** Thursday 07:00Z of week 1. */
    readonly seasonStartMs = Date.UTC(season, 8, 10, 7),
  ) {}

  times(week: number): WeekTimes {
    const startMs = this.seasonStartMs + (week - 1) * 7 * DAY_MS;
    const sunday = new Date(startMs + 3 * DAY_MS);
    const day = sunday.toISOString().slice(0, 10);
    const kickoff = isSundayOnePmET(`${day}T17:00Z`) ? `${day}T17:00Z` : `${day}T18:00Z`;
    return { start: new Date(startMs).toISOString(), end: new Date(startMs + 7 * DAY_MS - 60_000).toISOString(), kickoff };
  }

  /** A moment during the current week's 1 PM games. */
  duringGames(week = this.currentWeek): Date {
    return new Date(Date.parse(this.times(week).kickoff) + 90 * 60_000);
  }

  teamId(week: number, game: number, side: 'a' | 'h') {
    return `${this.season}w${week}g${game}${side}`;
  }

  private state(week: number, game: number): 'pre' | 'in' | 'post' | 'void' {
    if (this.voids.has(`${week}|${game}`)) return 'void';
    if (week < this.currentWeek) return 'post';
    if (week === this.currentWeek) return 'in';
    return 'pre';
  }

  private scored(week: number, teamId: string, leg: 'TD' | 'FG') {
    return !this.misses.has(`${week}|${teamId}|${leg}`);
  }

  private teamScore(week: number, teamId: string, state: string) {
    if (state === 'pre' || state === 'void') return 0;
    return (this.scored(week, teamId, 'TD') ? 7 : 0) + (this.scored(week, teamId, 'FG') ? 3 : 0);
  }

  eventId(week: number, game: number) {
    return `${this.season}-${week}-${game}`;
  }

  async scoreboard(params: SlateParams): Promise<unknown> {
    const week = params.week ?? this.currentWeek;
    this.scoreboardCalls.push(params.week === undefined ? 'current' : `${params.year}-${week}`);
    if (this.fail) throw new Error('ESPN down');
    if (params.year !== undefined && params.year !== this.season) throw new Error(`fake ESPN only knows ${this.season}`);

    const { kickoff } = this.times(week);
    const events: JsonObject[] = [];
    if (!this.emptyWeeks.has(week)) {
      for (let g = 0; g < GAMES_PER_WEEK; g++) {
        const state = this.state(week, g);
        const away = this.teamId(week, g, 'a');
        const home = this.teamId(week, g, 'h');
        const status =
          state === 'pre'
            ? { type: { name: 'STATUS_SCHEDULED', state: 'pre' } }
            : state === 'in'
              ? liveStatus(3, 300)
              : state === 'void'
                ? { type: { name: 'STATUS_POSTPONED', state: 'post', shortDetail: 'Postponed' } }
                : { type: { name: 'STATUS_FINAL', state: 'post', completed: true, shortDetail: 'Final' } };
        events.push(
          rawEvent({
            id: this.eventId(week, g),
            date: kickoff,
            status,
            away: { id: away, abbr: `A${g}`, score: String(this.teamScore(week, away, state)) },
            home: { id: home, abbr: `H${g}`, score: String(this.teamScore(week, home, state)) },
          }),
        );
      }
    }

    return {
      season: { year: this.season, type: 2 },
      week: { number: week },
      leagues: [
        {
          calendar: [
            {
              label: 'Regular Season',
              value: '2',
              entries: Array.from({ length: this.weekCount }, (_, i) => {
                const t = this.times(i + 1);
                return { label: `Week ${i + 1}`, value: String(i + 1), startDate: t.start, endDate: t.end };
              }),
            },
          ],
        },
      ],
      events,
    };
  }

  async summary(eventId: string): Promise<unknown> {
    this.summaryCalls.push(eventId);
    if (this.fail) throw new Error('ESPN down');
    const [, weekRaw, gameRaw] = eventId.split('-');
    const week = Number(weekRaw);
    const game = Number(gameRaw);
    const away = this.teamId(week, game, 'a');
    const home = this.teamId(week, game, 'h');
    const plays: JsonObject[] = [];
    let awayScore = 0;
    let homeScore = 0;
    for (const leg of ['TD', 'FG'] as const) {
      for (const teamId of [away, home]) {
        if (!this.scored(week, teamId, leg)) continue;
        const points = leg === 'TD' ? 7 : 3;
        if (teamId === away) awayScore += points;
        else homeScore += points;
        plays.push({
          team: { id: teamId },
          scoringType: { name: leg === 'TD' ? 'touchdown' : 'field-goal' },
          period: { number: 1 },
          clock: { value: 600 },
          awayScore,
          homeScore,
        });
      }
    }
    return { scoringPlays: plays };
  }
}

/** A fetch implementation that serves a FakeSeasonSource through ESPN's URLs. */
export function fakeEspnFetch(source: FakeSeasonSource): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    try {
      if (url.pathname.endsWith('/scoreboard')) {
        const week = url.searchParams.get('week');
        const year = url.searchParams.get('dates');
        const params: SlateParams = {};
        if (week) params.week = Number(week);
        if (year) params.year = Number(year);
        return Response.json(await source.scoreboard(params));
      }
      return Response.json(await source.summary(url.searchParams.get('event') ?? ''));
    } catch {
      return new Response('down', { status: 503 });
    }
  }) as typeof fetch;
}
