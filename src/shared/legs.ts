/** Scoring plays → TD/FG legs (SPEC R2–R5, ADR-003). */

import { arr, num, obj, str } from './json';

export type ScoringKind = 'TD' | 'FG' | 'other';

export interface ScoringPlay {
  teamId: string;
  kind: ScoringKind;
  period: number;
  clockSeconds: number;
  /** Running score after this play (includes any PAT/2PT on the same play). */
  awayScore: number;
  homeScore: number;
}

export interface LegCounts {
  td: number;
  fg: number;
}

function kindOf(play: Record<string, unknown>): ScoringKind {
  const scoringType = str(obj(play.scoringType).name);
  if (scoringType === 'touchdown') return 'TD';
  if (scoringType === 'field-goal') return 'FG';
  if (scoringType) return 'other';
  // Fallback if ESPN ever drops scoringType: the play-type abbreviation.
  const abbr = str(obj(play.type).abbreviation);
  return abbr === 'TD' ? 'TD' : abbr === 'FG' ? 'FG' : 'other';
}

export function parseScoringPlays(summary: unknown): ScoringPlay[] {
  return arr(obj(summary).scoringPlays)
    .map((raw): ScoringPlay => {
      const p = obj(raw);
      return {
        teamId: str(obj(p.team).id),
        kind: kindOf(p),
        period: num(obj(p.period).number),
        clockSeconds: num(obj(p.clock).value),
        awayScore: num(p.awayScore),
        homeScore: num(p.homeScore),
      };
    })
    .filter((p) => p.teamId !== '');
}

export function tallyLegs(plays: ScoringPlay[], teamIds: readonly string[]): Record<string, LegCounts> {
  const counts: Record<string, LegCounts> = {};
  for (const id of teamIds) counts[id] = { td: 0, fg: 0 };
  for (const play of plays) {
    const c = counts[play.teamId];
    if (!c) continue;
    if (play.kind === 'TD') c.td += 1;
    else if (play.kind === 'FG') c.fg += 1;
  }
  return counts;
}

/** Scoring plays are complete when the last one's running score equals the scoreboard. */
export function playsMatchScore(plays: ScoringPlay[], awayScore: number, homeScore: number): boolean {
  const last = plays.at(-1);
  if (!last) return awayScore === 0 && homeScore === 0;
  return last.awayScore === awayScore && last.homeScore === homeScore;
}
