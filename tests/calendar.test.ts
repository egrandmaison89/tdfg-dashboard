import { describe, expect, it } from 'vitest';
import calendarFixture from '../fixtures/history/calendar-2025.json';
import { parseRegularSeasonCalendar } from '../src/shared/calendar';

describe('parseRegularSeasonCalendar (ADR-006)', () => {
  it('reads the 18 regular-season weeks from a real ESPN scoreboard', () => {
    const weeks = parseRegularSeasonCalendar(calendarFixture);
    expect(weeks).toHaveLength(18);
    expect(weeks[0]).toEqual({ week: 1, start: '2025-09-04T07:00Z', end: '2025-09-10T06:59Z' });
    expect(weeks.at(-1)).toEqual({ week: 18, start: '2025-12-31T08:00Z', end: '2026-01-07T07:59Z' });
    expect(weeks.map((w) => w.week)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it('ignores preseason/postseason sections and malformed entries', () => {
    const board = {
      leagues: [
        {
          calendar: [
            { value: '1', entries: [{ value: '1', startDate: '2026-08-01T07:00Z', endDate: '2026-08-08T07:00Z' }] },
            {
              value: '2',
              entries: [
                { value: '2', startDate: '2026-09-17T07:00Z', endDate: '2026-09-24T06:59Z' },
                { value: '1', startDate: '2026-09-10T07:00Z', endDate: '2026-09-17T06:59Z' },
                { value: 'x', startDate: '2026-09-10T07:00Z', endDate: '2026-09-17T06:59Z' },
                { value: '3', startDate: 'soon' },
              ],
            },
          ],
        },
      ],
    };
    expect(parseRegularSeasonCalendar(board).map((w) => w.week)).toEqual([1, 2]);
  });

  it('returns nothing when there is no calendar', () => {
    expect(parseRegularSeasonCalendar({})).toEqual([]);
    expect(parseRegularSeasonCalendar(null)).toEqual([]);
    expect(parseRegularSeasonCalendar({ leagues: [{ calendar: [{ value: '2' }] }] })).toEqual([]);
  });
});
