import { useCallback, useEffect, useState } from 'react';
import { Link } from './components/Link';
import { useHistory } from './hooks';
import { HISTORY_PATH, routeFromPath, type Navigate } from './nav';
import { HistoryPage } from './pages/HistoryPage';
import { LivePage } from './pages/LivePage';

interface Location {
  path: string;
  search: string;
}

const currentLocation = (): Location => ({ path: window.location.pathname, search: window.location.search });

/** App shell: Live | History tabs with pushState routing (SPEC F11). */
export function App() {
  const [location, setLocation] = useState<Location>(currentLocation);
  // The Live tab returns to whichever week was last open on the board.
  const [liveSearch, setLiveSearch] = useState(() => (routeFromPath(window.location.pathname) === 'live' ? window.location.search : ''));
  const history = useHistory();
  const route = routeFromPath(location.path);

  useEffect(() => {
    const onPop = () => {
      const next = currentLocation();
      setLocation(next);
      if (routeFromPath(next.path) === 'live') setLiveSearch(next.search);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate: Navigate = useCallback((href, options = {}) => {
    const url = new URL(href, window.location.origin);
    const target = `${url.pathname}${url.search}`;
    const previousRoute = routeFromPath(window.location.pathname);
    if (target !== `${window.location.pathname}${window.location.search}`) {
      if (options.replace) window.history.replaceState(null, '', target);
      else window.history.pushState(null, '', target);
    }
    setLocation({ path: url.pathname, search: url.search });
    if (routeFromPath(url.pathname) === 'live') setLiveSearch(url.search);
    if (!options.replace && routeFromPath(url.pathname) !== previousRoute) window.scrollTo(0, 0);
  }, []);

  const liveHref = `/${liveSearch}`;

  return (
    <div className="app">
      <header className="topbar">
        <Link className="brand" href="/" navigate={navigate}>
          <span className="brand-mark" aria-hidden="true">
            🏈
          </span>
          <h1>TD + FG Tracker</h1>
        </Link>
        <nav className="tabs" aria-label="Sections">
          <Link href={liveHref} navigate={navigate} aria-current={route === 'live' ? 'page' : undefined} data-testid="tab-live">
            Live
          </Link>
          <Link href={HISTORY_PATH} navigate={navigate} aria-current={route === 'history' ? 'page' : undefined} data-testid="tab-history">
            History
          </Link>
        </nav>
      </header>

      {route === 'history' ? (
        <HistoryPage history={history} navigate={navigate} />
      ) : (
        <LivePage search={location.search} history={history.data} navigate={navigate} />
      )}
    </div>
  );
}
