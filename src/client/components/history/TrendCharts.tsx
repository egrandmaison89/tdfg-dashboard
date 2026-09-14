/**
 * Season trend charts (SPEC AC13.3). Two single-series charts rather than one dual-axis chart:
 * wins per season (columns) and share of legs hit (line). The season table is their table view.
 */

import { useState } from 'react';
import type { HistoryScope, SeasonRow } from '../../../shared/historyStats';
import { formatPct, plural } from '../../format';

const W = 340;
const H = 190;
const M = { top: 20, right: 14, bottom: 26, left: 34 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const BASELINE = M.top + PLOT_H;
const MAX_BAR_WIDTH = 24;
const BAR_RADIUS = 4;

interface ChartProps {
  rows: SeasonRow[];
  scope: HistoryScope;
}

const ascending = (rows: SeasonRow[]) => [...rows].sort((a, b) => a.season - b.season);
const bandOf = (n: number) => PLOT_W / Math.max(1, n);
const centerOf = (i: number, band: number) => M.left + band * i + band / 2;
const isDim = (scope: HistoryScope, season: number) => scope !== 'all' && scope !== season;

/** Column with a 4px rounded data end and a square baseline. */
export function columnPath(x: number, y: number, width: number, base: number): string {
  const r = Math.max(0, Math.min(BAR_RADIUS, base - y, width / 2));
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${base}Z`;
}

function ChartTooltip({ xPct, yPct, value, detail }: { xPct: number; yPct: number; value: string; detail: string }) {
  return (
    <div className="chart-tooltip" role="presentation" style={{ left: `${xPct}%`, top: `${yPct}%` }} data-testid="chart-tooltip">
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}

const seasonName = (r: SeasonRow) => `${r.season}${r.complete ? '' : ' (in progress)'}`;

export function WinsChart({ rows, scope }: ChartProps) {
  const data = ascending(rows);
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(3, ...data.map((r) => r.stats.wins));
  const step = max <= 6 ? 1 : Math.ceil(max / 5);
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const yOf = (v: number) => BASELINE - (v / max) * PLOT_H;
  const band = bandOf(data.length);
  const barWidth = Math.min(MAX_BAR_WIDTH, band * 0.6);
  const hovered = active === null ? undefined : data[active];

  return (
    <figure className="chart" data-testid="wins-chart">
      <figcaption>
        <strong>Wins per season</strong>
        <span className="muted">Weeks where every leg hit</span>
      </figcaption>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Wins per season">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={M.left} x2={W - M.right} y1={yOf(t)} y2={yOf(t)} />
              <text className="tick" x={M.left - 8} y={yOf(t)} dy="0.32em" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          <line className="axis" x1={M.left} x2={W - M.right} y1={BASELINE} y2={BASELINE} />
          {data.map((r, i) => {
            const cx = centerOf(i, band);
            const y = yOf(r.stats.wins);
            return (
              <g key={r.season} className={`mark${isDim(scope, r.season) ? ' is-dim' : ''}${active === i ? ' is-active' : ''}`}>
                {r.stats.wins > 0 && <path className="bar" d={columnPath(cx - barWidth / 2, y, barWidth, BASELINE)} />}
                <text className="value" x={cx} y={y - 7} textAnchor="middle">
                  {r.stats.graded ? r.stats.wins : '–'}
                </text>
                <text className="tick" x={cx} y={H - 8} textAnchor="middle">
                  {r.season}
                  {r.complete ? '' : '*'}
                </text>
                <rect
                  className="hit"
                  x={M.left + band * i}
                  y={M.top - 12}
                  width={band}
                  height={PLOT_H + 12}
                  tabIndex={0}
                  role="img"
                  aria-label={`${seasonName(r)}: ${plural(r.stats.wins, 'win')}, record ${r.stats.wins}–${r.stats.losses}`}
                  data-testid="wins-bar"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
        {hovered && active !== null && (
          <ChartTooltip
            xPct={(centerOf(active, band) / W) * 100}
            yPct={(yOf(hovered.stats.wins) / H) * 100}
            value={plural(hovered.stats.wins, 'win')}
            detail={`${seasonName(hovered)} · ${hovered.stats.wins}–${hovered.stats.losses} · ${formatPct(hovered.stats.winRate)} win rate`}
          />
        )}
      </div>
      {data.some((r) => !r.complete) && <p className="chart-note">* season in progress</p>}
    </figure>
  );
}

export function LegsChart({ rows, scope }: ChartProps) {
  const data = ascending(rows);
  const [active, setActive] = useState<number | null>(null);
  const values = data.flatMap((r) => (r.stats.legHitRate === null ? [] : [r.stats.legHitRate * 100]));
  const lo = values.length ? Math.max(0, Math.floor((Math.min(...values) - 2) / 5) * 5) : 0;
  const hi = values.length ? Math.min(100, Math.ceil((Math.max(...values) + 2) / 5) * 5) : 100;
  const span = Math.max(5, hi - lo);
  const step = span / 5 > 6 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => lo + i * step);
  const yOf = (pct: number) => BASELINE - ((pct - lo) / span) * PLOT_H;
  const band = bandOf(data.length);

  let path = '';
  let penDown = false;
  data.forEach((r, i) => {
    if (r.stats.legHitRate === null) {
      penDown = false;
      return;
    }
    path += `${penDown ? 'L' : 'M'}${centerOf(i, band)},${yOf(r.stats.legHitRate * 100)}`;
    penDown = true;
  });

  const lastIndex = data.map((r) => r.stats.legHitRate !== null).lastIndexOf(true);
  const last = data[lastIndex];
  const hovered = active === null ? undefined : data[active];

  return (
    <figure className="chart" data-testid="legs-chart">
      <figcaption>
        <strong>Legs hit</strong>
        <span className="muted">Share of all legs that hit, graded weeks</span>
      </figcaption>
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Share of legs hit per season">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={M.left} x2={W - M.right} y1={yOf(t)} y2={yOf(t)} />
              <text className="tick" x={M.left - 8} y={yOf(t)} dy="0.32em" textAnchor="end">
                {t}%
              </text>
            </g>
          ))}
          {data.map((r, i) => (
            <text key={r.season} className="tick" x={centerOf(i, band)} y={H - 8} textAnchor="middle">
              {r.season}
              {r.complete ? '' : '*'}
            </text>
          ))}
          {active !== null && <line className="crosshair" x1={centerOf(active, band)} x2={centerOf(active, band)} y1={M.top} y2={BASELINE} />}
          <path className="line" d={path} />
          {data.map((r, i) =>
            r.stats.legHitRate === null ? null : (
              <circle
                key={r.season}
                className={`dot${isDim(scope, r.season) ? ' is-dim' : ''}${active === i ? ' is-active' : ''}`}
                cx={centerOf(i, band)}
                cy={yOf(r.stats.legHitRate * 100)}
                r={active === i ? 5 : 4}
              />
            ),
          )}
          {last && last.stats.legHitRate !== null && (
            <text className="value" x={centerOf(lastIndex, band)} y={yOf(last.stats.legHitRate * 100) - 10} textAnchor="middle">
              {formatPct(last.stats.legHitRate)}
            </text>
          )}
          {data.map((r, i) => (
            <rect
              key={r.season}
              className="hit"
              x={M.left + band * i}
              y={M.top}
              width={band}
              height={PLOT_H}
              tabIndex={0}
              role="img"
              aria-label={`${seasonName(r)}: ${formatPct(r.stats.legHitRate)} of legs hit`}
              data-testid="legs-point"
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </svg>
        {hovered && active !== null && (
          <ChartTooltip
            xPct={(centerOf(active, band) / W) * 100}
            yPct={((hovered.stats.legHitRate === null ? BASELINE : yOf(hovered.stats.legHitRate * 100)) / H) * 100}
            value={`${formatPct(hovered.stats.legHitRate)} legs hit`}
            detail={`${seasonName(hovered)} · ${hovered.stats.nearMisses} near ${hovered.stats.nearMisses === 1 ? 'miss' : 'misses'}`}
          />
        )}
      </div>
      {data.some((r) => !r.complete) && <p className="chart-note">* season in progress</p>}
    </figure>
  );
}
