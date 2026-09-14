import { Fragment, useState } from 'react';
import { DEFAULT_REGULAR_SEASON_WEEKS, type SeasonHistory, type WeekGrade } from '../../../shared/history';
import {
  legsShort,
  recordStats,
  type Culprit,
  type HistoryScope,
  type MissShare,
  type RecordStats,
  type SeasonRow,
} from '../../../shared/historyStats';
import { formatPct, plural } from '../../format';
import { boardHref, type Navigate } from '../../nav';
import { Link } from '../Link';
import { ChipLegend, WeekChip } from '../WeekChip';

export function StatTiles({ stats, scopeLabel }: { stats: RecordStats; scopeLabel: string }) {
  const drought =
    stats.graded === 0 ? '–' : !stats.hasWon ? 'No wins yet' : stats.weeksSinceLastWin === 0 ? 'Just won' : plural(stats.weeksSinceLastWin, 'week');
  const tiles = [
    {
      key: 'record',
      label: 'Record',
      value: `${stats.wins}–${stats.losses}`,
      note: `${plural(stats.graded, 'week')} graded${stats.noBets ? ` · ${stats.noBets} no bet` : ''}`,
    },
    { key: 'win-rate', label: 'Win rate', value: formatPct(stats.winRate), note: 'every leg hit' },
    { key: 'legs', label: 'Legs hit', value: formatPct(stats.legHitRate), note: 'across graded weeks' },
    { key: 'near', label: 'Near misses', value: String(stats.nearMisses), note: 'lost by 1–2 legs' },
    { key: 'drought', label: 'Since last win', value: drought, note: stats.hasWon ? 'graded weeks' : `in ${plural(stats.graded, 'week')}` },
  ];
  return (
    <section className="tiles" aria-label={`${scopeLabel} summary`}>
      {tiles.map((t) => (
        <div key={t.key} className="tile" data-testid={`tile-${t.key}`}>
          <span className="tile-label">{t.label}</span>
          <span className="tile-value">{t.value}</span>
          <span className="tile-note">{t.note}</span>
        </div>
      ))}
    </section>
  );
}

export function SeasonTable({ rows, scope, navigate }: { rows: SeasonRow[]; scope: HistoryScope; navigate: Navigate }) {
  return (
    <section className="panel" aria-labelledby="season-table-title">
      <div className="panel-head">
        <h3 id="season-table-title">Season records</h3>
        <span className="muted">The numbers behind the charts</span>
      </div>
      <div className="table-scroll">
        <table className="data-table" data-testid="season-table">
          <thead>
            <tr>
              <th scope="col">Season</th>
              <th scope="col" className="num">
                Record
              </th>
              <th scope="col" className="num">
                Win %
              </th>
              <th scope="col" className="num">
                Legs hit
              </th>
              <th scope="col" className="num">
                Near misses
              </th>
              <th scope="col">Weeks won</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.season} className={scope === r.season ? 'is-scoped' : undefined} data-testid="season-row" data-season={r.season}>
                <th scope="row">
                  {r.season}
                  {!r.complete && <span className="tag-soft">in progress</span>}
                </th>
                <td className="num">
                  {r.stats.wins}–{r.stats.losses}
                </td>
                <td className="num">{formatPct(r.stats.winRate)}</td>
                <td className="num">{formatPct(r.stats.legHitRate)}</td>
                <td className="num">{r.stats.nearMisses}</td>
                <td>
                  {r.wonWeeks.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    r.wonWeeks.map((week, i) => (
                      <Fragment key={week}>
                        {i > 0 && ', '}
                        <Link href={boardHref(r.season, week)} navigate={navigate}>
                          Week {week}
                        </Link>
                      </Fragment>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function WeekGrid({ seasons, scope, navigate }: { seasons: SeasonHistory[]; scope: HistoryScope; navigate: Navigate }) {
  const weekCount = Math.max(DEFAULT_REGULAR_SEASON_WEEKS, ...seasons.map((s) => s.weeks.length));
  const weeks = Array.from({ length: weekCount }, (_, i) => i + 1);
  const newestFirst = [...seasons].sort((a, b) => b.season - a.season);

  return (
    <section className="panel" aria-labelledby="week-grid-title">
      <div className="panel-head">
        <h3 id="week-grid-title">Week by week</h3>
        <span className="muted">Tap a week to open its board</span>
      </div>
      <div className="table-scroll" data-testid="week-grid-scroll">
        <table className="week-grid" data-testid="week-grid">
          <thead>
            <tr>
              <th scope="col">Season</th>
              {weeks.map((w) => (
                <th key={w} scope="col">
                  {w}
                </th>
              ))}
              <th scope="col" className="num">
                W–L
              </th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((s) => {
              const stats = recordStats(s.weeks);
              return (
                <tr
                  key={s.season}
                  className={scope !== 'all' && scope !== s.season ? 'is-dim' : undefined}
                  data-testid="grid-row"
                  data-season={s.season}
                >
                  <th scope="row">{s.season}</th>
                  {weeks.map((w) => {
                    const grade = s.weeks.find((x) => x.week === w);
                    return (
                      <td key={w}>
                        {grade && (
                          <WeekChip compact season={s.season} week={w} grade={grade} onActivate={() => navigate(boardHref(s.season, w))} />
                        )}
                      </td>
                    );
                  })}
                  <td className="num">
                    {stats.wins}–{stats.losses}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ChipLegend />
    </section>
  );
}

const NEAR_MISSES_SHOWN = 6;

export function NearMissList({ weeks, navigate }: { weeks: WeekGrade[]; navigate: Navigate }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? weeks : weeks.slice(0, NEAR_MISSES_SHOWN);
  return (
    <section className="panel" aria-labelledby="near-title" data-testid="near-misses">
      <div className="panel-head">
        <h3 id="near-title">Near misses</h3>
        <span className="muted">{plural(weeks.length, 'week')} lost by 1–2 legs</span>
      </div>
      {weeks.length === 0 ? (
        <p className="muted">No near misses in this scope.</p>
      ) : (
        <ul className="near-list">
          {shown.map((w) => {
            const short = legsShort(w);
            return (
              <li key={`${w.season}-${w.week}`} data-testid="near-miss">
                <Link className="near-link" href={boardHref(w.season, w.week)} navigate={navigate}>
                  <span className="near-when">
                    {w.season} · Week {w.week}
                  </span>
                  <span className="near-short">{plural(short, 'leg')} short</span>
                  <span className="need-tags">
                    {w.missedLegs.map((leg, i) => (
                      <span key={i} className="tag">
                        {leg.abbr} {leg.type}
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {weeks.length > NEAR_MISSES_SHOWN && (
        <button type="button" className="link-btn" onClick={() => setExpanded((e) => !e)} data-testid="near-toggle">
          {expanded ? 'Show fewer' : `Show all ${weeks.length}`}
        </button>
      )}
    </section>
  );
}

function MissShareBar({ share }: { share: MissShare }) {
  const pct = (n: number) => `${Math.round((n / share.total) * 100)}%`;
  return (
    <div className="share" data-testid="miss-share">
      <div className="share-bar" role="img" aria-label={`Missed legs: ${pct(share.fg)} field goals, ${pct(share.td)} touchdowns`}>
        {share.fg > 0 && <span className="seg seg-fg" style={{ flexGrow: share.fg }} />}
        {share.td > 0 && <span className="seg seg-td" style={{ flexGrow: share.td }} />}
      </div>
      <div className="share-legend">
        <span>
          <i className="swatch swatch-fg" aria-hidden="true" />
          FG misses <strong>{pct(share.fg)}</strong> ({share.fg})
        </span>
        <span>
          <i className="swatch swatch-td" aria-hidden="true" />
          TD misses <strong>{pct(share.td)}</strong> ({share.td})
        </span>
      </div>
    </div>
  );
}

export function CulpritTable({ culprits, share }: { culprits: Culprit[]; share: MissShare }) {
  const max = culprits[0]?.total ?? 0;
  return (
    <section className="panel" aria-labelledby="culprits-title" data-testid="culprits">
      <div className="panel-head">
        <h3 id="culprits-title">Bust culprits</h3>
        <span className="muted">Missed legs in lost weeks</span>
      </div>
      {share.total === 0 ? (
        <p className="muted">No busted legs in this scope.</p>
      ) : (
        <>
          <MissShareBar share={share} />
          <div className="table-scroll">
            <table className="data-table culprit-table">
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  <th scope="col">Missed legs</th>
                  <th scope="col" className="num">
                    TD
                  </th>
                  <th scope="col" className="num">
                    FG
                  </th>
                </tr>
              </thead>
              <tbody>
                {culprits.map((c) => (
                  <tr key={c.abbr} data-testid="culprit-row" data-team={c.abbr}>
                    <th scope="row">{c.abbr}</th>
                    <td>
                      <span className="meter" aria-hidden="true">
                        <span className="meter-fill" style={{ width: `${max ? (c.total / max) * 100 : 0}%` }} />
                      </span>
                      <span className="meter-value">{c.total}</span>
                    </td>
                    <td className="num">{c.td}</td>
                    <td className="num">{c.fg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
