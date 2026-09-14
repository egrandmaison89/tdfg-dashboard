/** "In trouble" heuristic (SPEC F6, ADR-004). */

import { regulationRemaining } from './clock';
import type { Game, LegType, RiskLevel, TeamLine } from './types';

/** Regulation seconds remaining at or below which a team escalates. Tune here. */
export const RISK_THRESHOLDS = {
  twoMissingDanger: 15 * 60,
  twoMissingWatch: 30 * 60,
  oneMissingDanger: 5 * 60,
  oneMissingWatch: 15 * 60,
} as const;

/** Higher = worse. */
export const RISK_SEVERITY: Record<RiskLevel, number> = {
  void: -1,
  done: 0,
  pregame: 1,
  ok: 2,
  watch: 3,
  danger: 4,
  busted: 5,
};

export function missingLegs(team: Pick<TeamLine, 'tdCount' | 'fgCount'>): LegType[] {
  const missing: LegType[] = [];
  if (team.tdCount < 1) missing.push('TD');
  if (team.fgCount < 1) missing.push('FG');
  return missing;
}

export function teamRisk(game: Game, team: TeamLine): RiskLevel {
  if (game.state === 'void') return 'void';
  const missing = missingLegs(team).length;
  if (missing === 0) return 'done';
  // A final game only busts once its scoring plays reconcile; until then a late score may still be landing.
  if (game.state === 'post') return game.legsVerified ? 'busted' : 'danger';
  if (game.state === 'pre') return 'pregame';
  if (game.period >= 5) return 'danger';

  const remaining = regulationRemaining(game);
  const t = RISK_THRESHOLDS;
  if (missing >= 2) {
    if (remaining <= t.twoMissingDanger) return 'danger';
    if (remaining <= t.twoMissingWatch) return 'watch';
    return 'ok';
  }
  if (remaining <= t.oneMissingDanger) return 'danger';
  if (remaining <= t.oneMissingWatch) return 'watch';
  return 'ok';
}

export function gameRisk(game: Game): RiskLevel {
  const [a, b] = game.teams.map((team) => teamRisk(game, team)) as [RiskLevel, RiskLevel];
  return RISK_SEVERITY[a] >= RISK_SEVERITY[b] ? a : b;
}
