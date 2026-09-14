import { useEffect, useState } from 'react';
import { FILTERS, type FilterKey, type SortMode } from '../../shared/bet';
import type { SlateResponse } from '../../shared/types';
import { weekLabel } from '../format';
import { adjacentWeek, type WeekRef } from '../query';

export function Controls(props: {
  filter: FilterKey;
  onFilter: (key: FilterKey) => void;
  sort: SortMode;
  onSort: (mode: SortMode) => void;
  counts: Record<FilterKey, number>;
}) {
  return (
    <div className="controls">
      <div className="chips" role="group" aria-label="Filter games">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="chip"
            aria-pressed={props.filter === f.key}
            data-testid={`filter-${f.key}`}
            onClick={() => props.onFilter(f.key)}
          >
            {f.label}
            <span className="chip-count" data-testid={`filter-count-${f.key}`}>
              {props.counts[f.key]}
            </span>
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Sort games">
        {(['urgency', 'kickoff'] as const).map((mode) => (
          <button key={mode} type="button" aria-pressed={props.sort === mode} onClick={() => props.onSort(mode)}>
            {mode === 'urgency' ? 'Urgency' : 'Kickoff'}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WeekNav(props: { data: SlateResponse; pinned: boolean; onWeek: (ref: WeekRef) => void; onCurrent: () => void }) {
  const { data } = props;
  const prev = adjacentWeek(data.seasonType, data.week, -1);
  const next = adjacentWeek(data.seasonType, data.week, 1);
  return (
    <nav className="week-nav" aria-label="Choose week">
      <button type="button" className="icon-btn" aria-label="Previous week" disabled={!prev} onClick={() => prev && props.onWeek(prev)}>
        ‹
      </button>
      <span className="week-label">{weekLabel(data.seasonType, data.week)}</span>
      <button type="button" className="icon-btn" aria-label="Next week" disabled={!next} onClick={() => next && props.onWeek(next)}>
        ›
      </button>
      {props.pinned && (
        <button type="button" className="link-btn" onClick={props.onCurrent}>
          Current
        </button>
      )}
    </nav>
  );
}

const PLAY_STEP = 2;
const PLAY_TICK_MS = 700;

export function DemoControls({ progress, onChange }: { progress: number; onChange: (progress: number) => void }) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => {
      if (progress >= 100) setPlaying(false);
      else onChange(Math.min(100, progress + PLAY_STEP));
    }, PLAY_TICK_MS);
    return () => window.clearTimeout(id);
  }, [playing, progress, onChange]);

  const togglePlay = () => {
    if (!playing && progress >= 100) onChange(0);
    setPlaying((p) => !p);
  };

  return (
    <section className="panel demo" aria-label="Demo controls">
      <div className="demo-row">
        <button type="button" className="btn" onClick={togglePlay} data-testid="demo-play">
          {playing ? 'Pause' : 'Play'}
        </button>
        <div className="demo-slider">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={progress}
            aria-label="Simulated game progress"
            onChange={(e) => {
              setPlaying(false);
              onChange(Number(e.target.value));
            }}
          />
          <div className="demo-ticks" aria-hidden="true">
            <span>Kickoff</span>
            <span>Half</span>
            <span>Final</span>
          </div>
        </div>
        <span className="demo-pct">{progress}%</span>
      </div>
    </section>
  );
}
