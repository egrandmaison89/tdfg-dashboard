import type { Game, LegType, RiskLevel } from '../shared/types';

export function kickoffLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`;
}

export function gameStatusText(game: Game): string {
  if (game.state === 'pre') return kickoffLabel(game.kickoff);
  if (game.state === 'void') return game.statusDetail || 'Postponed';
  return game.statusDetail;
}

export function slateDateLabel(dateKey: string | null): string {
  if (!dateKey) return '';
  const d = new Date(`${dateKey}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function weekLabel(seasonType: number, week: number): string {
  if (seasonType === 3) return ['Wild Card', 'Divisional', 'Conference', 'Pro Bowl', 'Super Bowl'][week - 1] ?? `Postseason ${week}`;
  if (seasonType === 1) return `Preseason ${week}`;
  return `Week ${week}`;
}

export const LEG_NAME: Record<LegType, string> = { TD: 'touchdown', FG: 'field goal' };

export function formatPct(ratio: number | null, digits = 1): string {
  if (ratio === null) return '–';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const RISK_LABEL: Record<RiskLevel, string> = {
  void: 'Void',
  done: 'Off the board',
  pregame: 'Not started',
  ok: 'On track',
  watch: 'Watch',
  danger: 'In danger',
  last_chance: 'Critical',
  busted: 'Busted',
};
