/** Which teams the board should surface right now (SPEC AC14.5). */

import { assessTeam, RISK_SEVERITY, type TeamAssessment } from './risk';
import type { Game, TeamLine } from './types';

export interface AttentionItem {
  game: Game;
  team: TeamLine;
  assessment: TeamAssessment;
}

/** Rows shown before the list collapses into "+N more". */
export const ATTENTION_VISIBLE_LIMIT = 6;

/** Danger and last chance first (worst at the top), then live scoring chances. */
export function attentionItems(games: Game[]): AttentionItem[] {
  return games
    .flatMap((game) => game.teams.map((team) => ({ game, team, assessment: assessTeam(game, team) })))
    .filter(({ assessment }) => assessment.level === 'danger' || assessment.level === 'last_chance' || assessment.opportunity)
    .sort(
      (a, b) =>
        RISK_SEVERITY[b.assessment.level] - RISK_SEVERITY[a.assessment.level] ||
        Number(b.assessment.opportunity) - Number(a.assessment.opportunity) ||
        a.team.abbr.localeCompare(b.team.abbr),
    );
}
