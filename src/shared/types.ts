/** API contract for GET /api/slate. See docs/SPEC.md §5. */

export type GameState = 'pre' | 'in' | 'post' | 'void';
export type LegType = 'TD' | 'FG';
export type RiskLevel = 'void' | 'done' | 'pregame' | 'ok' | 'watch' | 'danger' | 'busted';

export interface TeamLine {
  id: string;
  abbr: string;
  name: string;
  logo: string | null;
  /** CSS hex color, e.g. "#0b1c3a". */
  color: string | null;
  homeAway: 'home' | 'away';
  score: number;
  tdCount: number;
  fgCount: number;
}

export interface Game {
  id: string;
  kickoff: string;
  state: GameState;
  statusDetail: string;
  period: number;
  /** Seconds left in the current period. */
  clockSeconds: number;
  isHalftime: boolean;
  possessionTeamId: string | null;
  isRedZone: boolean;
  downDistance: string | null;
  /** False when ESPN's scoring plays don't yet add up to the scoreboard score. */
  legsVerified: boolean;
  /** [away, home] */
  teams: [TeamLine, TeamLine];
}

export interface SlateResponse {
  generatedAt: string;
  source: 'espn' | 'demo';
  /** True when upstream failed and this is the last good snapshot. */
  stale: boolean;
  season: number;
  seasonType: number;
  week: number;
  /** Sunday of the slate as YYYY-MM-DD in America/New_York, or null if no slate games. */
  slateDate: string | null;
  games: Game[];
}
