/** Key/value cache: Netlify Blobs in production, process memory elsewhere (ARCHITECTURE §3). */

import { getStore } from '@netlify/blobs';

export interface KeyValueCache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

type Logger = (message: string, err?: unknown) => void;

export class MemoryCache implements KeyValueCache {
  private readonly entries = new Map<string, string>();

  async get<T>(key: string): Promise<T | null> {
    const raw = this.entries.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.entries.set(key, JSON.stringify(value));
  }
}

/**
 * The Blobs client retries 429/5xx with multi-second backoff. The cache is an optimisation, so
 * each call is capped well below the function timeout and treated as a miss if it's slow.
 */
export const BLOBS_TIMEOUT_MS = 1_000;

export interface BlobStoreLike {
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Cache failures are never fatal: reads miss and writes are dropped. */
export class BlobsCache implements KeyValueCache {
  constructor(
    private readonly store: BlobStoreLike,
    private readonly log: Logger,
    private readonly timeoutMs = BLOBS_TIMEOUT_MS,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      return ((await withTimeout(this.store.get(key, { type: 'json' }), this.timeoutMs, `blobs get ${key}`)) as T | null) ?? null;
    } catch (err) {
      this.log(`blobs get failed for ${key}`, err);
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      await withTimeout(this.store.setJSON(key, value), this.timeoutMs, `blobs set ${key}`);
    } catch (err) {
      this.log(`blobs set failed for ${key}`, err);
    }
  }
}

const processCache = new MemoryCache();

export function createCache(log: Logger = console.warn): KeyValueCache {
  try {
    return new BlobsCache(getStore('tdfg'), log);
  } catch (err) {
    log('Netlify Blobs unavailable, falling back to in-memory cache', err);
    return processCache;
  }
}
