import { useCallback, useEffect, useState } from 'react';
import type { HistoryResponse } from '../shared/history';
import { nextPollMs } from '../shared/polling';
import type { SlateResponse } from '../shared/types';
import { HISTORY_ERROR_RETRY_MS, historyPollMs, isHistoryResponse } from './nav';
import { apiUrl, isSlateResponse, type SlateQuery } from './query';

export interface SlateState {
  data: SlateResponse | null;
  error: string | null;
  /**
   * Client-clock timestamp of when the data was generated on the server. Derived from the response
   * `Date` header minus `generatedAt`, so CDN cache age is included and client clock skew is not.
   */
  dataAsOf: number | null;
  loading: boolean;
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

function dataAgeAtReceipt(res: Response, slate: SlateResponse): number {
  const served = Date.parse(res.headers.get('date') ?? '');
  const generated = Date.parse(slate.generatedAt);
  if (Number.isNaN(served) || Number.isNaN(generated)) return 0;
  return Math.max(0, served - generated);
}

/**
 * Fetches /api/slate and keeps it fresh on the adaptive cadence (SPEC F9).
 * Pauses while the tab is hidden, refreshes on return, and never discards good data on errors (AC2.4).
 */
export function useSlate(query: SlateQuery): SlateState {
  const [state, setState] = useState<SlateState>({ data: null, error: null, dataAsOf: null, loading: true });
  const url = apiUrl(query);
  const { demo } = query;

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    let latest: SlateResponse | null = null;
    let seq = 0;

    const schedule = () => {
      window.clearTimeout(timer);
      if (demo || document.hidden) return;
      timer = window.setTimeout(load, nextPollMs(latest, Date.now()));
    };

    async function load() {
      const id = ++seq;
      window.clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
        const body: unknown = await res.json().catch((err: unknown) => {
          if (isAbort(err)) throw err;
          return null;
        });
        if (!res.ok) {
          const message = (body as { error?: unknown } | null)?.error;
          throw new Error(typeof message === 'string' ? message : `request failed with ${res.status}`);
        }
        if (!isSlateResponse(body)) throw new Error('unexpected response from the server');
        latest = body;
        const receivedAt = Date.now();
        if (!cancelled) {
          setState({ data: body, error: null, dataAsOf: receivedAt - dataAgeAtReceipt(res, body), loading: false });
        }
      } catch (err) {
        if (cancelled || isAbort(err)) return;
        const message = err instanceof Error ? err.message : 'network error';
        setState((prev) => ({ ...prev, error: message, loading: false }));
      } finally {
        if (!cancelled && id === seq) schedule();
      }
    }

    const onVisibility = () => {
      if (document.hidden) window.clearTimeout(timer);
      else void load();
    };

    void load();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [url, demo]);

  return state;
}

/** String state persisted to localStorage; degrades to plain state if storage is unavailable (AC7.3). */
export function useStoredState<T extends string>(
  key: string,
  fallback: T,
  isValid: (value: string) => value is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw !== null && isValid(raw) ? raw : fallback;
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Storage blocked (private mode etc.) — keep in-memory state only.
      }
    },
    [key],
  );

  return [value, update];
}

export interface HistoryState {
  data: HistoryResponse | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Fetches /api/history, retrying quickly while the server is still grading weeks (AC13.8). */
export function useHistory(): HistoryState {
  const [state, setState] = useState<Omit<HistoryState, 'reload'>>({ data: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    let latest: HistoryResponse | null = null;
    let failed = false;
    let seq = 0;

    const schedule = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      timer = window.setTimeout(load, failed ? HISTORY_ERROR_RETRY_MS : historyPollMs(latest));
    };

    async function load() {
      const id = ++seq;
      window.clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await fetch('/api/history', { signal: controller.signal, headers: { accept: 'application/json' } });
        const body: unknown = await res.json().catch((err: unknown) => {
          if (isAbort(err)) throw err;
          return null;
        });
        if (!res.ok) {
          const message = (body as { error?: unknown } | null)?.error;
          throw new Error(typeof message === 'string' ? message : `request failed with ${res.status}`);
        }
        if (!isHistoryResponse(body)) throw new Error('unexpected response from the server');
        latest = body;
        failed = false;
        if (!cancelled) setState({ data: body, error: null, loading: false });
      } catch (err) {
        if (cancelled || isAbort(err)) return;
        failed = true;
        const message = err instanceof Error ? err.message : 'network error';
        setState((prev) => ({ ...prev, error: message, loading: false }));
      } finally {
        if (!cancelled && id === seq) schedule();
      }
    }

    const onVisibility = () => {
      if (document.hidden) window.clearTimeout(timer);
      else void load();
    };

    void load();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
