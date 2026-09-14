import { useCallback, useEffect, useMemo, useState } from 'react';
import { FILTERS, matchesFilter, sortGames, summarizeBet, type FilterKey, type SortMode } from '../../shared/bet';
import type { HistoryResponse } from '../../shared/history';
import { Controls, DemoControls } from '../components/Controls';
import { GameCard, LegIcon } from '../components/GameCard';
import { SeasonWeekPicker } from '../components/SeasonWeekPicker';
import { BetSummaryPanel, NeededList, UpdatedAgo } from '../components/Summary';
import { slateDateLabel, weekLabel } from '../format';
import { useSlate, useStoredState } from '../hooks';
import { boardHref, type Navigate } from '../nav';
import { readQuery, toSearch } from '../query';

const isFilterKey = (v: string): v is FilterKey => FILTERS.some((f) => f.key === v);
const isSortMode = (v: string): v is SortMode => v === 'urgency' || v === 'kickoff';

export function LivePage({ search, history, navigate }: { search: string; history: HistoryResponse | null; navigate: Navigate }) {
  const query = useMemo(() => readQuery(search), [search]);
  const { data, error, dataAsOf, loading } = useSlate(query);
  const [savedFilter, setSavedFilter] = useStoredState<FilterKey>('tdfg.filter', 'all', isFilterKey);
  const [filterChosenThisVisit, setFilterChosenThisVisit] = useState(false);
  const [sort, setSort] = useStoredState<SortMode>('tdfg.sort', 'urgency', isSortMode);

  // Canonicalise the URL (drops junk/invalid params) without adding a history entry.
  useEffect(() => {
    const canonical = toSearch(query);
    if (search.replace(/^\?/, '') !== canonical) navigate(canonical ? `/?${canonical}` : '/', { replace: true });
  }, [query, search, navigate]);

  const setProgress = useCallback(
    (progress: number) => navigate(`/?${toSearch({ ...query, progress })}`, { replace: true }),
    [query, navigate],
  );
  const chooseFilter = useCallback(
    (key: FilterKey) => {
      setFilterChosenThisVisit(true);
      setSavedFilter(key);
    },
    [setSavedFilter],
  );

  const games = useMemo(() => data?.games ?? [], [data]);
  const summary = useMemo(() => summarizeBet(games), [games]);
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, games.filter((g) => matchesFilter(g, f.key)).length])) as Record<FilterKey, number>,
    [games],
  );
  // A filter remembered from an earlier visit that matches nothing now falls back to All.
  const filter: FilterKey = !filterChosenThisVisit && savedFilter !== 'all' && counts[savedFilter] === 0 ? 'all' : savedFilter;
  const visible = useMemo(() => sortGames(games.filter((g) => matchesFilter(g, filter)), sort), [games, filter, sort]);
  const anyLive = games.some((g) => g.state === 'in');
  const hasLegs = summary.totalLegs > 0;
  const pinned = query.week !== undefined;

  return (
    <>
      <div className="board-head">
        <p className="subtitle">
          {data && `${weekLabel(data.seasonType, data.week)} ${data.season}${data.slateDate ? ` · ${slateDateLabel(data.slateDate)}` : ''} · `}
          Sunday 1 PM ET slate
        </p>
        <UpdatedAgo at={dataAsOf} live={anyLive && !query.demo} />
      </div>

      {data && !query.demo && (
        <SeasonWeekPicker
          data={data}
          history={history}
          requested={{ season: query.year, week: query.week }}
          pinned={pinned}
          onWeek={(season, week) => navigate(boardHref(season, week))}
          onCurrent={() => navigate('/')}
        />
      )}

      {query.demo && (
        <div className="banner banner-demo" role="status" data-testid="demo-banner">
          <strong>DEMO</strong> — replaying Week 1 (Sun Sep 13, 2026) from recorded ESPN data.{' '}
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            Exit demo
          </a>
        </div>
      )}
      {data?.stale && (
        <div className="banner banner-warn" role="status" data-testid="stale-banner">
          The live feed hiccuped — showing the last scores we received. Retrying automatically.
        </div>
      )}
      {error && data && (
        <div className="banner banner-warn" role="alert" data-testid="error-banner">
          Couldn’t refresh ({error}). Showing earlier data and retrying.
        </div>
      )}

      <main>
        {query.demo && <DemoControls progress={query.progress} onChange={setProgress} />}

        {!data && loading && <p className="empty">Loading the slate…</p>}
        {!data && !loading && error && (
          <div className="empty" role="alert">
            <p>Couldn’t load scores: {error}</p>
            <button type="button" className="btn" onClick={() => window.location.assign('/')}>
              Try again
            </button>
          </div>
        )}
        {data && !hasLegs && (
          <p className="empty" data-testid="empty-slate">
            {games.length === 0
              ? `No Sunday 1 PM ET games in ${weekLabel(data.seasonType, data.week)}.`
              : 'Every Sunday 1 PM ET game this week was postponed or canceled — no bet.'}
          </p>
        )}

        {hasLegs && (
          <>
            <div className="top-grid">
              <BetSummaryPanel summary={summary} />
              <NeededList summary={summary} />
            </div>
            <Controls filter={filter} onFilter={chooseFilter} sort={sort} onSort={setSort} counts={counts} />
          </>
        )}
        {games.length > 0 &&
          (visible.length === 0 ? (
            <p className="empty small" data-testid="no-matches">
              No games match this filter.
            </p>
          ) : (
            <div className="games-grid">
              {visible.map((g) => (
                <GameCard key={g.id} game={g} />
              ))}
            </div>
          ))}
      </main>

      <footer className="legend">
        <div className="legend-items">
          <span>
            <LegIcon state="hit" label="Example: scored" /> Scored
          </span>
          <span>
            <LegIcon state="pending" label="Example: still needed" /> Still needed
          </span>
          <span>
            <LegIcon state="busted" label="Example: missed" /> Missed
          </span>
          <span>🏈 Has the ball</span>
        </div>
        <p>
          The bet: every team kicking off Sunday at 1:00 PM ET scores at least one touchdown (any kind, OT counts) and one made
          field goal. A postponed game means no bet that week. Scores via ESPN, refreshed about every 20 seconds during games.{' '}
          {!query.demo && (
            <a
              href="/?demo=1"
              onClick={(e) => {
                e.preventDefault();
                navigate('/?demo=1');
              }}
            >
              Try the demo
            </a>
          )}
        </p>
      </footer>
    </>
  );
}
