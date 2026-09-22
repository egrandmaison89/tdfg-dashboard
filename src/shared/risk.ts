/**
 * "In trouble" assessment (SPEC F14). The clock sets a baseline, then possession, field position
 * and timeouts adjust it — a team needing a field goal with the ball in range is in a very
 * different spot from one needing it without the ball and two minutes left.
 */

import { regulationRemaining } from './clock';
import type { Game, LegType, RiskLevel, TeamLine } from './types';

/** Regulation seconds remaining at or below which a team escalates. Tune here. */
export const RISK_THRESHOLDS = {
  twoMissingDanger: 15 * 60,
  twoMissingWatch: 30 * 60,
  oneMissingDanger: 5 * 60,
  oneMissingWatch: 15 * 60,
  /** Final two minutes: whatever is missing is now a last chance. */
  lastChance: 2 * 60,
  /**
   * Inside this, not having the ball matters. Wider than the danger threshold on purpose: a team
   * that needs a kick, has no ball and no timeouts is in trouble well before the two-minute warning.
   */
  noBall: 8 * 60,
} as const;

/** Yards from the opponent's goal line (SPEC R14). */
export const FIELD = {
  redZone: 20,
  fgRange: 38,
  longFgRange: 45,
  /** Close enough that a touchdown is a live threat on this drive. */
  tdThreat: 25,
} as const;

/** Higher = worse. */
export const RISK_SEVERITY: Record<RiskLevel, number> = {
  void: -1,
  done: 0,
  pregame: 1,
  ok: 2,
  watch: 3,
  danger: 4,
  last_chance: 5,
  busted: 6,
};

const ESCALATION: Partial<Record<RiskLevel, RiskLevel>> = {
  ok: 'watch',
  watch: 'danger',
  danger: 'last_chance',
};

const escalate = (level: RiskLevel): RiskLevel => ESCALATION[level] ?? level;
const worst = (a: RiskLevel, b: RiskLevel): RiskLevel => (RISK_SEVERITY[a] >= RISK_SEVERITY[b] ? a : b);

const QUARTERS = ['1st', '2nd', '3rd', '4th'];

const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** Always-present context so no assessment comes back without a reason (AC14.4). */
function clockPhrase(game: Game, remaining: number): string {
  if (game.isHalftime) return 'halftime';
  if (game.period >= 5) return 'overtime';
  if (remaining <= RISK_THRESHOLDS.lastChance) return `final ${formatClock(remaining)}`;
  const quarter = QUARTERS[Math.min(Math.max(game.period, 1), 4) - 1] ?? '4th';
  return `${quarter} quarter · ${formatClock(game.clockSeconds)} left`;
}

export function missingLegs(team: Pick<TeamLine, 'tdCount' | 'fgCount'>): LegType[] {
  const missing: LegType[] = [];
  if (team.tdCount < 1) missing.push('TD');
  if (team.fgCount < 1) missing.push('FG');
  return missing;
}

/** Yards to the end zone this team is attacking, from ESPN's home-goal-based yard line (R15). */
export function yardsToGoal(game: Pick<Game, 'yardLine'>, team: Pick<TeamLine, 'homeAway'>): number | null {
  if (game.yardLine === null) return null;
  const yards = team.homeAway === 'home' ? 100 - game.yardLine : game.yardLine;
  return yards >= 0 && yards <= 100 ? yards : null;
}

export function timeoutsFor(game: Pick<Game, 'homeTimeouts' | 'awayTimeouts'>, team: Pick<TeamLine, 'homeAway'>): number | null {
  return team.homeAway === 'home' ? game.homeTimeouts : game.awayTimeouts;
}

export interface TeamAssessment {
  level: RiskLevel;
  missing: LegType[];
  /** Why it's at this level, in plain words (AC14.4). */
  reasons: string[];
  /** Has the ball, in position to get what it still needs (AC14.3). */
  opportunity: boolean;
  hasBall: boolean;
  yardsToGoal: number | null;
  inFgRange: boolean;
  inRedZone: boolean;
  timeouts: number | null;
}

function clockLevel(missingCount: number, remaining: number): RiskLevel {
  const t = RISK_THRESHOLDS;
  if (missingCount >= 2) {
    if (remaining <= t.twoMissingDanger) return 'danger';
    if (remaining <= t.twoMissingWatch) return 'watch';
    return 'ok';
  }
  if (remaining <= t.oneMissingDanger) return 'danger';
  if (remaining <= t.oneMissingWatch) return 'watch';
  return 'ok';
}

export function assessTeam(game: Game, team: TeamLine): TeamAssessment {
  const missing = missingLegs(team);
  /**
   * Unknown possession (feed gap, between drives) must not be read as "the other team has it",
   * and a possession left over from before the whistle doesn't count at halftime.
   */
  const possessionKnown = game.state === 'in' && !game.isHalftime && game.possessionTeamId !== null;
  const hasBall = possessionKnown && game.possessionTeamId === team.id;
  const yards = hasBall ? yardsToGoal(game, team) : null;
  const inFgRange = yards !== null && yards <= FIELD.fgRange;
  const inRedZone = hasBall && (game.isRedZone || (yards !== null && yards <= FIELD.redZone));
  const timeouts = timeoutsFor(game, team);
  const base: Omit<TeamAssessment, 'level' | 'reasons' | 'opportunity'> = {
    missing,
    hasBall,
    yardsToGoal: yards,
    inFgRange,
    inRedZone,
    timeouts,
  };

  if (game.state === 'void') return { ...base, level: 'void', reasons: ['game postponed'], opportunity: false };
  if (missing.length === 0) return { ...base, level: 'done', reasons: [], opportunity: false };
  if (game.state === 'post') {
    return game.legsVerified
      ? { ...base, level: 'busted', reasons: ['game over'], opportunity: false }
      : { ...base, level: 'danger', reasons: ['final — confirming scoring plays'], opportunity: false };
  }
  if (game.state === 'pre') return { ...base, level: 'pregame', reasons: ['not started'], opportunity: false };

  const remaining = regulationRemaining(game);
  const reasons: string[] = [clockPhrase(game, remaining)];
  let level = clockLevel(missing.length, remaining);

  if (game.period >= 5 || remaining <= RISK_THRESHOLDS.lastChance) level = worst(level, 'last_chance');

  // Only the offense can kick a field goal; a missing TD can still come from the defense (AC14.2).
  const needsOffense = missing.includes('FG');
  if (possessionKnown && !hasBall && needsOffense && remaining <= RISK_THRESHOLDS.noBall) {
    level = escalate(level);
    reasons.push('doesn’t have the ball');
    if (timeouts === 0) {
      level = escalate(level);
      reasons.push('no timeouts left');
    }
  } else if (hasBall) {
    reasons.push('has the ball');
  }

  const opportunity =
    hasBall && ((missing.includes('FG') && inFgRange) || (missing.includes('TD') && yards !== null && yards <= FIELD.tdThreat));
  // Word the chance after what they still need: "field-goal range" is meaningless for a TD-only leg.
  if (opportunity) {
    reasons.push(inRedZone ? 'in the red zone' : missing.includes('FG') && inFgRange ? 'in field-goal range' : 'in scoring position');
  }

  return { ...base, level, reasons, opportunity };
}

export function teamRisk(game: Game, team: TeamLine): RiskLevel {
  return assessTeam(game, team).level;
}

export function gameRisk(game: Game): RiskLevel {
  const [a, b] = game.teams.map((team) => teamRisk(game, team)) as [RiskLevel, RiskLevel];
  return worst(a, b);
}
