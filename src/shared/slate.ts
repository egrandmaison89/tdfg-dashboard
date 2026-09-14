/** Sunday 1 PM ET window detection (SPEC R6 / F1). */

const ET_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface EtParts {
  /** YYYY-MM-DD in Eastern time */
  dateKey: string;
  weekday: string;
  hour: number;
  minute: number;
}

export function etParts(iso: string): EtParts | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts: Record<string, string> = {};
  for (const { type, value } of ET_FORMAT.formatToParts(date)) parts[type] = value;
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday ?? '',
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** True for kickoffs on Sunday between 1:00 and 1:59 PM Eastern. */
export function isSundayOnePmET(iso: string): boolean {
  const p = etParts(iso);
  return p !== null && p.weekday === 'Sun' && p.hour === 13;
}

export function slateDateOf(kickoffs: string[]): string | null {
  const first = kickoffs.find(isSundayOnePmET);
  return first ? (etParts(first)?.dateKey ?? null) : null;
}
