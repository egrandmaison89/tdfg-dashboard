import { describeDrive } from '../../shared/drive';
import { FIELD } from '../../shared/risk';
import type { Game } from '../../shared/types';

/** Field position, down & distance, and what a good outcome looks like (SPEC F15). */
export function DriveStrip({ game }: { game: Game }) {
  const drive = describeDrive(game);
  if (!drive) return null;

  const { possessing, defending, progressPct, downDistance, rangeChip, want, wantTone } = drive;
  const chip =
    rangeChip === 'red-zone'
      ? { className: 'chip-rz', label: 'Red zone' }
      : rangeChip === 'fg-range'
        ? { className: 'chip-fg', label: 'FG range' }
        : rangeChip === 'long-fg'
          ? { className: 'chip-long', label: 'Long FG' }
          : null;

  return (
    <div className={`drive want-${wantTone}`} data-testid="drive-strip">
      <div className="drive-field" role="img" aria-label={drive.summary} data-testid="drive-field">
        <span className="endzone" aria-hidden="true">
          {possessing?.abbr ?? ''}
        </span>
        <span className="field-body">
          <span className="zone zone-fg" style={{ left: `${100 - FIELD.fgRange}%`, width: `${FIELD.fgRange}%` }} aria-hidden="true" />
          <span className="zone zone-rz" style={{ left: `${100 - FIELD.redZone}%`, width: `${FIELD.redZone}%` }} aria-hidden="true" />
          {[25, 50, 75].map((mark) => (
            <span key={mark} className="yard-mark" style={{ left: `${mark}%` }} aria-hidden="true" />
          ))}
          {progressPct !== null && (
            <span className="drive-ball" style={{ left: `${progressPct}%` }} data-testid="drive-ball" data-progress={progressPct} aria-hidden="true">
              🏈
            </span>
          )}
        </span>
        <span className="endzone endzone-target" aria-hidden="true">
          {defending ? `${defending.abbr} ›` : ''}
        </span>
      </div>

      <p className="drive-line">
        {downDistance ? (
          <span data-testid="drive-down">{downDistance}</span>
        ) : (
          <span data-testid="drive-down">{game.isHalftime ? 'Halftime' : 'Between drives'}</span>
        )}
        {chip && (
          <span className={`drive-chip ${chip.className}`} data-testid="drive-chip">
            {chip.label}
          </span>
        )}
      </p>
      <p className="drive-want" data-testid="drive-want">
        {want}
      </p>
    </div>
  );
}
