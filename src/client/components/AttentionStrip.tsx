import { useState } from 'react';
import { attentionItems, ATTENTION_VISIBLE_LIMIT } from '../../shared/attention';
import type { Game } from '../../shared/types';
import { RISK_LABEL } from '../format';

/** Pinned strip so nothing urgent scrolls past (SPEC AC14.5). */
export function AttentionStrip({ games }: { games: Game[] }) {
  const [expanded, setExpanded] = useState(false);
  const items = attentionItems(games);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, ATTENTION_VISIBLE_LIMIT);

  return (
    <section className="panel attention" aria-labelledby="attention-title" data-testid="attention-strip">
      <div className="panel-head">
        <h2 id="attention-title">
          Needs attention
          <span className="attention-count" data-testid="attention-count">
            {items.length}
          </span>
        </h2>
        <span className="muted">Danger, last chance, and live scoring chances</span>
      </div>
      <ul className="attention-list">
        {shown.map(({ game, team, assessment }) => (
          <li
            key={`${game.id}-${team.id}`}
            className={`attention-item risk-${assessment.level}${assessment.opportunity ? ' is-opportunity' : ''}`}
            data-testid="attention-item"
            data-level={assessment.level}
            data-team={team.abbr}
            data-opportunity={assessment.opportunity ? 'true' : 'false'}
          >
            <span className="attention-head">
              <strong className="abbr">{team.abbr}</strong>
              <span className="need-tags">
                {assessment.missing.map((leg) => (
                  <span key={leg} className="tag">
                    {leg}
                  </span>
                ))}
              </span>
              {/* The level always shows; a chance is an extra cue, never a replacement (AC14.3). */}
              <span className={`badge badge-${assessment.level}`} data-testid="attention-level">
                {RISK_LABEL[assessment.level]}
              </span>
              {assessment.opportunity && (
                <span className="badge badge-chance" data-testid="attention-chance">
                  Chance now
                </span>
              )}
            </span>
            <span className="attention-why">{assessment.reasons.join(' · ')}</span>
          </li>
        ))}
      </ul>
      {items.length > ATTENTION_VISIBLE_LIMIT && (
        <button type="button" className="link-btn" onClick={() => setExpanded((e) => !e)} data-testid="attention-toggle">
          {expanded ? 'Show fewer' : `+${items.length - ATTENTION_VISIBLE_LIMIT} more`}
        </button>
      )}
    </section>
  );
}
