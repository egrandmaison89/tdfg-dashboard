import type { BetStatus, BetSummary } from '../../shared/bet';
import { agoLabel, gameStatusText } from '../format';
import { useNow } from '../hooks';
import { TeamLogo } from './GameCard';

const STATUS_LABEL: Record<BetStatus, string> = {
  NO_GAMES: 'No games',
  NO_BET: 'No bet · game postponed',
  NOT_STARTED: 'Not started',
  ALIVE: 'Alive',
  WON: 'Won 🎉',
  BUSTED: 'Busted',
};

export function BetSummaryPanel({ summary }: { summary: BetSummary }) {
  const pct = summary.totalLegs ? Math.round((summary.hitLegs / summary.totalLegs) * 100) : 0;
  return (
    <section className={`panel summary status-${summary.status.toLowerCase()}`} aria-label="Parlay status">
      <div className="summary-top">
        <span className="eyebrow">Legs off the board</span>
        <span className="status-pill" data-testid="bet-status">
          {STATUS_LABEL[summary.status]}
        </span>
      </div>
      <p className="counter" data-testid="leg-counter">
        <span className="hit">{summary.hitLegs}</span>
        <span className="sep"> / </span>
        <span className="total">{summary.totalLegs}</span>
        <span className="unit"> legs</span>
      </p>
      <div
        className="progress"
        role="progressbar"
        aria-label="Legs off the board"
        aria-valuemin={0}
        aria-valuemax={summary.totalLegs}
        aria-valuenow={summary.hitLegs}
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="remainder">
        {summary.status === 'WON' ? 'Every team has a TD and a field goal. Cash it.' : summary.remainderText}
      </p>
      {summary.bustedLegs.length > 0 && (
        <p className="busted-line" data-testid="busted-legs">
          Busted by {summary.bustedLegs.map((l) => `${l.abbr} ${l.type}`).join(', ')}
        </p>
      )}
    </section>
  );
}

export function NeededList({ summary }: { summary: BetSummary }) {
  if (summary.status === 'NO_GAMES' || summary.status === 'WON') return null;

  if (summary.status === 'NOT_STARTED') {
    return (
      <section className="panel needed" aria-labelledby="needed-title">
        <div className="panel-head">
          <h2 id="needed-title">Still needed</h2>
        </div>
        <p className="muted">
          Every team needs a TD and a field goal — {summary.totalLegs} legs to go once the games kick off.
        </p>
      </section>
    );
  }

  if (summary.needed.length === 0) return null;

  return (
    <section className="panel needed" aria-labelledby="needed-title">
      <div className="panel-head">
        <h2 id="needed-title">Still needed</h2>
        <span className="muted">Most urgent first</span>
      </div>
      <ul className="needed-list">
        {summary.needed.map((entry) => {
          const hasBall = entry.game.state === 'in' && entry.game.possessionTeamId === entry.team.id;
          return (
            <li
              key={`${entry.game.id}-${entry.team.id}`}
              className={`needed-item risk-${entry.risk}`}
              data-testid="needed-item"
              data-risk={entry.risk}
            >
              <span className="risk-dot" aria-hidden="true" />
              <TeamLogo team={entry.team} size={22} />
              <strong className="abbr">{entry.team.abbr}</strong>
              <span className="need-tags">
                {entry.missing.map((leg) => (
                  <span key={leg} className="tag">
                    {leg}
                  </span>
                ))}
              </span>
              <span className="ctx">
                {gameStatusText(entry.game)}
                {hasBall && (entry.game.isRedZone ? ' · 🏈 red zone' : ' · 🏈 ball')}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function UpdatedAgo({ at, live }: { at: number | null; live: boolean }) {
  const now = useNow(1000);
  if (at === null) return null;
  return (
    <span className="updated" data-testid="updated-ago">
      {live && <span className="live-dot" aria-hidden="true" />}
      Updated {agoLabel(now - at)}
    </span>
  );
}
