import replayJson from '../fixtures/2026-wk1/replay.json';
import type { JsonObject } from '../src/shared/json';
import type { Game, SlateResponse, TeamLine } from '../src/shared/types';

export interface Replay {
  scoreboard: JsonObject & { events: JsonObject[] };
  summaries: Record<string, JsonObject>;
}

export const loadReplay = (): Replay => structuredClone(replayJson) as unknown as Replay;

/** Hand-checked TD/FG counts for every 1 PM team, Sunday 2026-09-13 (all 32 legs hit). */
export const GOLDEN: Record<string, { abbr: string; td: number; fg: number }> = {
  '27': { abbr: 'TB', td: 3, fg: 2 },
  '4': { abbr: 'CIN', td: 3, fg: 4 },
  '18': { abbr: 'NO', td: 4, fg: 1 },
  '8': { abbr: 'DET', td: 4, fg: 1 },
  '20': { abbr: 'NYJ', td: 2, fg: 3 },
  '10': { abbr: 'TEN', td: 1, fg: 1 },
  '33': { abbr: 'BAL', td: 5, fg: 2 },
  '11': { abbr: 'IND', td: 3, fg: 1 },
  '1': { abbr: 'ATL', td: 1, fg: 2 },
  '23': { abbr: 'PIT', td: 2, fg: 2 },
  '3': { abbr: 'CHI', td: 8, fg: 1 },
  '29': { abbr: 'CAR', td: 5, fg: 1 },
  '5': { abbr: 'CLE', td: 1, fg: 1 },
  '30': { abbr: 'JAX', td: 4, fg: 2 },
  '2': { abbr: 'BUF', td: 4, fg: 3 },
  '34': { abbr: 'HOU', td: 4, fg: 1 },
};

export const ONE_PM_EVENT_IDS = [
  '401872658',
  '401872659',
  '401872660',
  '401872661',
  '401872922',
  '401872923',
  '401872924',
  '401872925',
];

export function team(overrides: Partial<TeamLine> = {}): TeamLine {
  return {
    id: '1',
    abbr: 'AWY',
    name: 'Away Team',
    logo: null,
    color: null,
    homeAway: 'away',
    score: 0,
    tdCount: 0,
    fgCount: 0,
    ...overrides,
  };
}

type GameOverrides = Partial<Omit<Game, 'teams'>> & { away?: Partial<TeamLine>; home?: Partial<TeamLine> };

export function game(overrides: GameOverrides = {}): Game {
  const { away, home, ...rest } = overrides;
  return {
    id: 'g1',
    kickoff: '2026-09-13T17:00Z',
    state: 'in',
    statusDetail: 'Q1 15:00',
    period: 1,
    clockSeconds: 900,
    isHalftime: false,
    possessionTeamId: null,
    isRedZone: false,
    downDistance: null,
    down: null,
    distance: null,
    yardLine: null,
    homeTimeouts: null,
    awayTimeouts: null,
    legsVerified: true,
    ...rest,
    teams: [
      team({ id: '1', abbr: 'AWY', homeAway: 'away', ...away }),
      team({ id: '2', abbr: 'HOM', name: 'Home Team', homeAway: 'home', ...home }),
    ],
  };
}

export const DONE = { tdCount: 1, fgCount: 1 };

export function slate(games: Game[], overrides: Partial<SlateResponse> = {}): SlateResponse {
  return {
    generatedAt: '2026-09-13T17:30:00Z',
    source: 'espn',
    stale: false,
    season: 2026,
    seasonType: 2,
    week: 1,
    slateDate: '2026-09-13',
    games,
    odds: null,
    oddsEditable: false,
    ...overrides,
  };
}

interface RawTeam {
  id: string;
  abbr: string;
  score?: string | number;
  logo?: string;
  color?: string;
}

/** ESPN-shaped scoreboard event for parser tests. */
export function rawEvent(opts: {
  id?: string;
  date?: string;
  status?: JsonObject;
  situation?: JsonObject;
  away?: RawTeam | null;
  home?: RawTeam | null;
}): JsonObject {
  const competitor = (t: RawTeam, homeAway: string) => ({
    id: t.id,
    homeAway,
    score: t.score,
    team: { id: t.id, abbreviation: t.abbr, displayName: `${t.abbr} Team`, logo: t.logo, color: t.color },
  });
  const competitors = [];
  if (opts.home !== null) competitors.push(competitor(opts.home ?? { id: '2', abbr: 'HOM', score: '0' }, 'home'));
  if (opts.away !== null) competitors.push(competitor(opts.away ?? { id: '1', abbr: 'AWY', score: '0' }, 'away'));
  return {
    id: opts.id ?? 'e1',
    date: opts.date ?? '2026-09-13T17:00Z',
    competitions: [
      {
        date: opts.date ?? '2026-09-13T17:00Z',
        competitors,
        status: opts.status ?? {
          clock: 0,
          displayClock: '0:00',
          period: 0,
          type: { name: 'STATUS_SCHEDULED', state: 'pre', shortDetail: '9/13 - 1:00 PM EDT' },
        },
        ...(opts.situation ? { situation: opts.situation } : {}),
      },
    ],
  };
}

export const liveStatus = (period: number, clock: number, name = 'STATUS_IN_PROGRESS'): JsonObject => ({
  clock,
  displayClock: `${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, '0')}`,
  period,
  type: { name, state: 'in' },
});
