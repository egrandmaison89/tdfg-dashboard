/** Defensive parsing of ESPN's public scoreboard JSON (ADR-001). */

import { arr, num, obj, str, type JsonObject } from './json';
import type { GameState } from './types';

export interface EspnTeam {
  id: string;
  abbr: string;
  name: string;
  logo: string | null;
  color: string | null;
  homeAway: 'home' | 'away';
  score: number;
}

export interface EspnEvent {
  id: string;
  kickoff: string;
  state: GameState;
  statusDetail: string;
  period: number;
  clockSeconds: number;
  isHalftime: boolean;
  possessionTeamId: string | null;
  isRedZone: boolean;
  downDistance: string | null;
  /** [away, home] */
  teams: [EspnTeam, EspnTeam];
}

export interface ParsedScoreboard {
  season: number;
  seasonType: number;
  week: number;
  events: EspnEvent[];
}

const VOID_STATUSES = new Set(['STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_CANCELLED']);

function parseTeam(raw: unknown): EspnTeam {
  const c = obj(raw);
  const t = obj(c.team);
  const color = str(t.color).replace(/^#/, '');
  return {
    id: str(t.id) || str(c.id),
    abbr: str(t.abbreviation, '???'),
    name: str(t.displayName) || str(t.abbreviation, 'Unknown'),
    logo: str(t.logo) || null,
    color: /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : null,
    homeAway: str(c.homeAway) === 'home' ? 'home' : 'away',
    score: num(c.score),
  };
}

/** Live statuses whose meaning is fully captured by quarter + clock. Others (delays etc.) use ESPN's text. */
const CLOCK_STATUSES = new Set(['STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD']);

function describeStatus(state: GameState, statusName: string, type: JsonObject, period: number, clock: string): string {
  const espnText = str(type.shortDetail) || str(type.detail) || str(type.description);
  if (state !== 'in') return espnText;
  if (statusName === 'STATUS_HALFTIME') return 'Halftime';
  if (statusName && !CLOCK_STATUSES.has(statusName) && espnText) return espnText;
  const label = period >= 5 ? 'OT' : `Q${Math.max(period, 1)}`;
  if (statusName === 'STATUS_END_PERIOD') return `End ${label}`;
  return `${label} ${clock}`;
}

export function parseEvent(raw: unknown): EspnEvent | null {
  const e = obj(raw);
  const comp = obj(arr(e.competitions)[0]);
  const competitors = arr(comp.competitors).map(parseTeam);
  const away = competitors.find((t) => t.homeAway === 'away');
  const home = competitors.find((t) => t.homeAway === 'home');
  const id = str(e.id);
  if (!id || !away || !home) return null;

  const status = obj(comp.status ?? e.status);
  const type = obj(status.type);
  const statusName = str(type.name);
  const rawState = str(type.state);
  // A game reported over but not completed (abandoned) is voided like a postponement (R10).
  const abandoned = rawState === 'post' && type.completed === false;
  const state: GameState = VOID_STATUSES.has(statusName) || abandoned
    ? 'void'
    : rawState === 'in'
      ? 'in'
      : rawState === 'post'
        ? 'post'
        : 'pre';
  const period = num(status.period);
  const situation = state === 'in' ? obj(comp.situation) : {};

  return {
    id,
    kickoff: str(comp.date) || str(e.date),
    state,
    statusDetail: describeStatus(state, statusName, type, period, str(status.displayClock, '0:00')),
    period,
    clockSeconds: Math.max(0, num(status.clock)),
    isHalftime: statusName === 'STATUS_HALFTIME',
    possessionTeamId: str(situation.possession) || null,
    isRedZone: situation.isRedZone === true,
    downDistance: str(situation.downDistanceText) || str(situation.shortDownDistanceText) || null,
    teams: [away, home],
  };
}

export function parseScoreboard(json: unknown): ParsedScoreboard {
  const root = obj(json);
  const rawEvents = arr(root.events);
  const first = obj(rawEvents[0]);
  return {
    season: num(obj(root.season).year, num(obj(first.season).year)),
    seasonType: num(obj(root.season).type, num(obj(first.season).type, 2)),
    week: num(obj(root.week).number, num(obj(first.week).number)),
    events: rawEvents.map(parseEvent).filter((ev): ev is EspnEvent => ev !== null),
  };
}
