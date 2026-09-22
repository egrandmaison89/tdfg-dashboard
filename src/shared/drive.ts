/** Drive strip content: where the ball is, and what we want from this possession (SPEC F15). */

import { assessTeam, FIELD, missingLegs, yardsToGoal } from './risk';
import type { Game, TeamLine } from './types';

export type WantTone = 'need' | 'watch' | 'neutral';

export interface DriveInfo {
  possessing: TeamLine | null;
  defending: TeamLine | null;
  yardsToGoal: number | null;
  /** 0 = own goal line, 100 = the end zone they're attacking. */
  progressPct: number | null;
  inRedZone: boolean;
  inFgRange: boolean;
  isLongFgRange: boolean;
  downDistance: string | null;
  down: number | null;
  distance: number | null;
  /** Range badge to show, chosen by what the possessing team still needs (never "FG range" for a TD-only leg). */
  rangeChip: 'red-zone' | 'fg-range' | 'long-fg' | null;
  /** One line: what a good outcome here looks like for the bet (AC15.3). */
  want: string;
  wantTone: WantTone;
  /** Full sentence for screen readers (AC15.5). */
  summary: string;
}

const legsPhrase = (team: TeamLine) => missingLegs(team).join(' + ');

function wantFor(game: Game, possessing: TeamLine | null, defending: TeamLine | null): { want: string; tone: WantTone } {
  if (!possessing || !defending) {
    const stillNeeded = game.teams.filter((t) => missingLegs(t).length > 0);
    if (stillNeeded.length === 0) return { want: 'Both teams are off the board — enjoy the football.', tone: 'neutral' };
    return { want: `Waiting on the next drive — ${stillNeeded.map((t) => `${t.abbr} needs ${legsPhrase(t)}`).join(', ')}.`, tone: 'watch' };
  }

  const missing = missingLegs(possessing);
  const assessment = assessTeam(game, possessing);
  const defenseMissing = missingLegs(defending);

  if (missing.length === 2) {
    return { want: `Any score helps — ${possessing.abbr} still needs a TD and a FG.`, tone: 'need' };
  }
  if (missing[0] === 'TD') {
    const fourthDownInRange = game.down === 4 && assessment.inFgRange;
    if (fourthDownInRange) return { want: `${possessing.abbr} needs 6 — going for it beats a field goal here.`, tone: 'need' };
    if (assessment.inRedZone) return { want: `${possessing.abbr} needs a TD and they’re in the red zone.`, tone: 'need' };
    return { want: `${possessing.abbr} needs a TD — a field goal here doesn’t help.`, tone: 'need' };
  }
  if (missing[0] === 'FG') {
    if (assessment.inFgRange) return { want: `${possessing.abbr} needs a made FG — they’re in range right now.`, tone: 'need' };
    return { want: `${possessing.abbr} needs a made FG — get inside the ${FIELD.fgRange}.`, tone: 'need' };
  }
  if (defenseMissing.length > 0) {
    return { want: `${possessing.abbr} is done — we want a quick stop so ${defending.abbr} gets the ball back.`, tone: 'watch' };
  }
  return { want: 'Both teams are off the board — enjoy the football.', tone: 'neutral' };
}

export function describeDrive(game: Game): DriveInfo | null {
  if (game.state !== 'in') return null;

  // At halftime ESPN may still name a possessing team; there is no live drive to describe.
  const possessing = game.isHalftime ? null : (game.teams.find((t) => t.id === game.possessionTeamId) ?? null);
  const defending = possessing ? (game.teams.find((t) => t.id !== possessing.id) ?? null) : null;
  const yards = possessing ? yardsToGoal(game, possessing) : null;
  const inFgRange = yards !== null && yards <= FIELD.fgRange;
  const isLongFgRange = yards !== null && yards > FIELD.fgRange && yards <= FIELD.longFgRange;
  const inRedZone = possessing !== null && (game.isRedZone || (yards !== null && yards <= FIELD.redZone));
  const needsFg = possessing !== null && missingLegs(possessing).includes('FG');
  const rangeChip: DriveInfo['rangeChip'] = inRedZone
    ? 'red-zone'
    : needsFg && inFgRange
      ? 'fg-range'
      : needsFg && isLongFgRange
        ? 'long-fg'
        : null;
  const { want, tone } = wantFor(game, possessing, defending);

  const spot = game.downDistance ?? (yards !== null ? `${yards} yards out` : null);
  const summary = possessing
    ? `${possessing.abbr} has the ball${spot ? `, ${spot}` : ''}${yards !== null ? `, ${yards} yards from the end zone` : ''}. ${want}`
    : `${game.isHalftime ? 'Halftime' : 'Between drives'}. ${want}`;

  return {
    possessing,
    defending,
    yardsToGoal: yards,
    progressPct: yards === null ? null : Math.min(100, Math.max(0, 100 - yards)),
    inRedZone,
    inFgRange,
    isLongFgRange,
    rangeChip,
    downDistance: game.downDistance,
    down: game.down,
    distance: game.distance,
    want,
    wantTone: tone,
    summary,
  };
}
