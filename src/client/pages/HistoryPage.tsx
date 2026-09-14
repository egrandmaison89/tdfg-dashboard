import { useMemo, useState } from 'react';
import {
  bustCulprits,
  missShare,
  nearMisses,
  recordStats,
  scopeWeeks,
  seasonRows,
  type HistoryScope,
} from '../../shared/historyStats';
import { CulpritTable, NearMissList, SeasonTable, StatTiles, WeekGrid } from '../components/history/HistoryParts';
import { LegsChart, WinsChart } from '../components/history/TrendCharts';
import type { HistoryState } from '../hooks';
import type { Navigate } from '../nav';

/** Bet history (SPEC F13). */
export function HistoryPage({ history, navigate }: { history: HistoryState; navigate: Navigate }) {
  const { data, error, loading, reload } = history;
  const [scope, setScope] = useState<HistoryScope>('all');

  const seasons = useMemo(() => data?.seasons ?? [], [data]);
  const rows = useMemo(() => seasonRows(seasons), [seasons]);
  // A scope pointing at a season that no longer exists falls back to all seasons.
  const activeScope: HistoryScope = scope !== 'all' && !seasons.some((s) => s.season === scope) ? 'all' : scope;
  const weeks = useMemo(() => scopeWeeks(seasons, activeScope), [seasons, activeScope]);
  const stats = useMemo(() => recordStats(weeks), [weeks]);
  const misses = useMemo(() => nearMisses(weeks), [weeks]);
  const culprits = useMemo(() => bustCulprits(weeks), [weeks]);
  const share = useMemo(() => missShare(weeks), [weeks]);

  if (!data) {
    return (
      <main className="history">
        {loading || !error ? (
          <p className="empty">Loading history…</p>
        ) : (
          <div className="empty" role="alert">
            <p>Couldn’t load history: {error}</p>
            <button type="button" className="btn" onClick={reload}>
              Try again
            </button>
          </div>
        )}
      </main>
    );
  }

  const scopeLabel = activeScope === 'all' ? `Since ${data.startSeason}` : `${activeScope} season`;

  return (
    <main className="history" data-testid="history-page">
      <div className="history-head">
        <h2>Bet history</h2>
        <p className="muted">Every regular-season Sunday since {data.startSeason}, graded as if we placed the bet.</p>
      </div>

      {data.incomplete && (
        <div className="banner banner-demo" role="status" data-testid="history-incomplete">
          Crunching history… some weeks are still being graded. This page updates on its own.
        </div>
      )}
      {error && (
        <div className="banner banner-warn" role="alert" data-testid="history-error">
          Couldn’t refresh history ({error}). Showing earlier data.
        </div>
      )}

      {seasons.length === 0 ? (
        <p className="empty">No graded weeks yet.</p>
      ) : (
        <>
          <div className="chips scope-chips" role="group" aria-label="Scope">
            <button type="button" className="chip" aria-pressed={activeScope === 'all'} onClick={() => setScope('all')} data-testid="scope-all">
              All seasons
            </button>
            {rows.map((r) => (
              <button
                key={r.season}
                type="button"
                className="chip"
                aria-pressed={activeScope === r.season}
                onClick={() => setScope(r.season)}
                data-testid={`scope-${r.season}`}
              >
                {r.season}
              </button>
            ))}
          </div>

          <StatTiles stats={stats} scopeLabel={scopeLabel} />

          <div className="chart-grid">
            <WinsChart rows={rows} scope={activeScope} />
            <LegsChart rows={rows} scope={activeScope} />
          </div>

          <SeasonTable rows={rows} scope={activeScope} navigate={navigate} />
          <WeekGrid seasons={seasons} scope={activeScope} navigate={navigate} />

          <div className="history-split">
            <NearMissList key={String(activeScope)} weeks={misses} navigate={navigate} />
            <CulpritTable culprits={culprits} share={share} />
          </div>
        </>
      )}
    </main>
  );
}
