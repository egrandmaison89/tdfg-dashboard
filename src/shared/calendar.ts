/** ESPN season calendar: regular-season week start/end dates (ADR-006). */

import { arr, num, obj, str } from './json';

export interface CalendarWeek {
  week: number;
  /** ISO start (inclusive) and end (exclusive-ish) of the NFL week, as ESPN reports them. */
  start: string;
  end: string;
}

export function parseRegularSeasonCalendar(scoreboard: unknown): CalendarWeek[] {
  const league = obj(arr(obj(scoreboard).leagues)[0]);
  const regular = arr(league.calendar)
    .map(obj)
    .find((section) => str(section.value) === '2');
  return arr(regular?.entries)
    .map((raw) => {
      const e = obj(raw);
      return { week: num(e.value), start: str(e.startDate), end: str(e.endDate) };
    })
    .filter((w) => w.week > 0 && !Number.isNaN(Date.parse(w.start)) && !Number.isNaN(Date.parse(w.end)))
    .sort((a, b) => a.week - b.week);
}
