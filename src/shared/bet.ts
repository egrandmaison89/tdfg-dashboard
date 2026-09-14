/** Parlay aggregates: counter, status, needed list, filters and sorting (SPEC F4, F5, F7). */

import { regulationRemaining } from './clock';
import { gameRisk, missingLegs, RISK_SEVERITY, teamRisk } from './risk';
import type { Game, LegType, RiskLevel, TeamLine } from './types';

export type BetStatus = 'NO_GAMES' | 'NO_BET' | 'NOT_STARTED' | 'ALIVE' | 'WON' | 'BUSTED';

export interface NeededEntry {
  game: Game;
  team: TeamLine;
  missing: LegType[];
  risk: RiskLevel;
  remaining: number;
}

export interface BustedLeg {
  gameId: string;
  abbr: string;
  type: LegType;
}

export interface BetSummary {
  totalLegs: number;
  hitLegs: number;
  status: BetStatus;
  bustedLegs: BustedLeg[];
  needed: NeededEntry[];
  remainderText: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * A game's legs are final only when ESPN says the game is over AND its scoring plays reconcile with the score.
 * An unverified final (summary lagging a last-minute score, or a failed fetch) must never bust the bet (R9).
 */
export function isSettled(game: Game): boolean {
  return game.state === 'post' && game.legsVerified;
}

export function describeRemainder(needed: NeededEntry[]): string {
  const legs = needed.reduce((sum, e) => sum + e.missing.length, 0);
  if (legs === 0) return 'Nothing left to hit.';
  const tds = needed.filter((e) => e.missing.includes('TD')).length;
  const fgs = needed.filter((e) => e.missing.includes('FG')).length;
  const kinds = [tds && plural(tds, 'TD'), fgs && plural(fgs, 'FG')].filter(Boolean).join(', ');
  return `${plural(legs, 'leg')} left: ${kinds} across ${plural(needed.length, 'team')}`;
}

export function compareNeeded(a: NeededEntry, b: NeededEntry): number {
  return (
    RISK_SEVERITY[b.risk] - RISK_SEVERITY[a.risk] ||
    a.remaining - b.remaining ||
    b.missing.length - a.missing.length ||
    a.team.abbr.localeCompare(b.team.abbr)
  );
}

export function summarizeBet(games: Game[]): BetSummary {
  const active = games.filter((g) => g.state !== 'void');
  let totalLegs = 0;
  let hitLegs = 0;
  const bustedLegs: BustedLeg[] = [];
  const needed: NeededEntry[] = [];

  for (const game of active) {
    for (const team of game.teams) {
      const missing = missingLegs(team);
      totalLegs += 2;
      hitLegs += 2 - missing.length;
      if (missing.length === 0) continue;
      if (isSettled(game)) {
        for (const type of missing) bustedLegs.push({ gameId: game.id, abbr: team.abbr, type });
      } else {
        needed.push({ game, team, missing, risk: teamRisk(game, team), remaining: regulationRemaining(game) });
      }
    }
  }
  needed.sort(compareNeeded);

  let status: BetStatus;
  if (games.length === 0) status = 'NO_GAMES';
  // Any postponed/canceled game means the week doesn't count (R10); legs keep tracking for fun.
  else if (active.length < games.length) status = 'NO_BET';
  else if (totalLegs === 0) status = 'NO_GAMES';
  else if (hitLegs === totalLegs) status = 'WON';
  else if (bustedLegs.length > 0) status = 'BUSTED';
  else if (active.every((g) => g.state === 'pre')) status = 'NOT_STARTED';
  else status = 'ALIVE';

  return { totalLegs, hitLegs, status, bustedLegs, needed, remainderText: describeRemainder(needed) };
}

export type FilterKey = 'all' | 'live' | 'needs' | 'trouble' | 'offboard' | 'final';
export type SortMode = 'urgency' | 'kickoff';

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'needs', label: 'Needs legs' },
  { key: 'trouble', label: 'In trouble' },
  { key: 'offboard', label: 'Off the board' },
  { key: 'final', label: 'Final' },
];

export function isOffTheBoard(game: Game): boolean {
  return game.state !== 'void' && game.teams.every((t) => missingLegs(t).length === 0);
}

export function matchesFilter(game: Game, key: FilterKey): boolean {
  switch (key) {
    case 'all':
      return true;
    case 'live':
      return game.state === 'in';
    case 'needs':
      return game.state !== 'void' && !isSettled(game) && !isOffTheBoard(game);
    case 'trouble': {
      const risk = gameRisk(game);
      return risk === 'watch' || risk === 'danger';
    }
    case 'offboard':
      return isOffTheBoard(game);
    case 'final':
      return game.state === 'post';
  }
}

/** Urgency order for game cards: live danger first, finished/void games last. */
const URGENCY_RANK: Record<RiskLevel, number> = {
  danger: 0,
  watch: 1,
  ok: 2,
  pregame: 3,
  busted: 4,
  done: 5,
  void: 6,
};

export function sortGames(games: Game[], mode: SortMode): Game[] {
  const byKickoff = (a: Game, b: Game) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id);
  if (mode === 'kickoff') return [...games].sort(byKickoff);
  return [...games].sort(
    (a, b) =>
      URGENCY_RANK[gameRisk(a)] - URGENCY_RANK[gameRisk(b)] ||
      regulationRemaining(a) - regulationRemaining(b) ||
      byKickoff(a, b),
  );
}
