import { useEffect, useRef } from 'react';
import { REGULAR_SEASON_TYPE, type HistoryResponse } from '../../shared/history';
import type { SlateResponse } from '../../shared/types';
import { weekLabel } from '../format';
import { findSeason, landingForSeason, seasonOptions, weeksInSeason } from '../nav';
import { WeekChip } from './WeekChip';

/** Season select + result-colored week strip for the board (SPEC F12). */
export function SeasonWeekPicker(props: {
  data: SlateResponse;
  history: HistoryResponse | null;
  /** Season/week the URL asks for (shown immediately, before that week's data arrives). */
  requested: { season: number | undefined; week: number | undefined };
  pinned: boolean;
  onWeek: (season: number, week: number) => void;
  onCurrent: () => void;
}) {
  const { data, history, requested, pinned } = props;
  const viewingSeason = requested.season ?? data.season;
  const isRegular = requested.week !== undefined || data.seasonType === REGULAR_SEASON_TYPE;
  const viewingWeek = requested.week ?? (isRegular ? data.week : null);
  const currentSeason = history?.currentSeason ?? (pinned ? viewingSeason : data.season);
  const options = seasonOptions(currentSeason, history?.startSeason, viewingSeason);
  const season = findSeason(history, viewingSeason);
  const weekCount = weeksInSeason(history, viewingSeason);
  const stripRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (strip && chip) strip.scrollLeft = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
  }, [viewingSeason, viewingWeek, weekCount]);

  return (
    <div className="season-picker" data-testid="season-picker">
      <div className="season-row">
        <label className="season-select">
          <span className="sr-only">Season</span>
          <select
            value={viewingSeason}
            data-testid="season-select"
            onChange={(e) => {
              const target = Number(e.target.value);
              const landing = landingForSeason(target, currentSeason, viewingWeek, weeksInSeason(history, target));
              if (landing.kind === 'current') props.onCurrent();
              else props.onWeek(landing.season, landing.week);
            }}
          >
            {options.map((s) => (
              <option key={s} value={s}>
                {s} season
              </option>
            ))}
          </select>
        </label>
        {!isRegular && <span className="postseason-note">Playoffs · {weekLabel(data.seasonType, data.week)}</span>}
        {pinned && (
          <button type="button" className="link-btn" onClick={props.onCurrent} data-testid="current-week">
            Current week
          </button>
        )}
      </div>
      <ul className="week-strip" ref={stripRef} aria-label={`${viewingSeason} regular-season weeks`}>
        {Array.from({ length: weekCount }, (_, i) => i + 1).map((week) => (
          <li key={week}>
            <WeekChip
              season={viewingSeason}
              week={week}
              grade={season?.weeks.find((w) => w.week === week)}
              current={isRegular && week === viewingWeek}
              onActivate={() => props.onWeek(viewingSeason, week)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
