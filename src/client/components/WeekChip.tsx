import type { WeekGrade } from '../../shared/history';
import { boardHref, CHIP_GLYPH, chipLabel, chipTone, type ChipTone } from '../nav';
import { isPlainClick } from './Link';

export function WeekChip(props: {
  season: number;
  week: number;
  grade: WeekGrade | undefined;
  current?: boolean;
  /** Glyph only (the week number is in a column header). */
  compact?: boolean;
  onActivate: () => void;
}) {
  const { season, week, grade, current = false, compact = false } = props;
  const tone = chipTone(grade);
  const label = `${season} ${chipLabel(week, grade)}`;
  return (
    <a
      href={boardHref(season, week)}
      className={`week-chip tone-${tone}${grade?.shortSlate ? ' is-short' : ''}${compact ? ' is-compact' : ''}`}
      aria-current={current ? 'true' : undefined}
      aria-label={label}
      title={label}
      data-testid="week-chip"
      data-season={season}
      data-week={week}
      data-tone={tone}
      onClick={(e) => {
        if (!isPlainClick(e)) return;
        e.preventDefault();
        props.onActivate();
      }}
    >
      {!compact && <span className="chip-week">{week}</span>}
      <span className="chip-glyph" aria-hidden="true">
        {CHIP_GLYPH[tone]}
      </span>
    </a>
  );
}

const LEGEND: { tone: ChipTone; label: string; short?: boolean }[] = [
  { tone: 'won', label: 'Won' },
  { tone: 'lost', label: 'Lost' },
  { tone: 'near', label: 'Near miss (1–2 legs)' },
  { tone: 'no_bet', label: 'No bet' },
  { tone: 'live', label: 'In progress' },
  { tone: 'upcoming', label: 'Upcoming' },
  { tone: 'won', label: 'Short slate (< 4 games)', short: true },
];

export function ChipLegend() {
  return (
    <ul className="chip-legend" aria-label="Week status key">
      {LEGEND.map(({ tone, label, short }) => (
        <li key={label}>
          <span className={`week-chip is-compact is-sample tone-${short ? 'upcoming' : tone}${short ? ' is-short' : ''}`} aria-hidden="true">
            <span className="chip-glyph">{short ? '' : CHIP_GLYPH[tone]}</span>
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}
