import { describe, expect, it, vi } from 'vitest';
import { BlobsCache, MemoryCache, type BlobStoreLike } from '../src/server/cache';

const never = () => new Promise<never>(() => {});

describe('BlobsCache (QA F6)', () => {
  it('treats a hung read as a miss within the timeout', async () => {
    const log = vi.fn();
    const store: BlobStoreLike = { get: never, setJSON: never };
    const cache = new BlobsCache(store, log, 20);
    const started = Date.now();
    expect(await cache.get('k')).toBeNull();
    await cache.set('k', { a: 1 });
    expect(Date.now() - started).toBeLessThan(500);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('treats errors as misses and dropped writes', async () => {
    const log = vi.fn();
    const store: BlobStoreLike = {
      get: () => Promise.reject(new Error('429')),
      setJSON: () => Promise.reject(new Error('500')),
    };
    const cache = new BlobsCache(store, log, 50);
    expect(await cache.get('k')).toBeNull();
    await expect(cache.set('k', 1)).resolves.toBeUndefined();
  });

  it('returns stored values and null for missing keys', async () => {
    const data = new Map<string, unknown>([['k', { a: 1 }]]);
    const store: BlobStoreLike = {
      get: async (key) => data.get(key) ?? null,
      setJSON: async (key, value) => data.set(key, value),
    };
    const cache = new BlobsCache(store, vi.fn(), 50);
    expect(await cache.get('k')).toEqual({ a: 1 });
    expect(await cache.get('missing')).toBeNull();
  });
});

describe('MemoryCache', () => {
  it('round-trips copies of values', async () => {
    const cache = new MemoryCache();
    const value = { a: [1] };
    await cache.set('k', value);
    value.a.push(2);
    expect(await cache.get('k')).toEqual({ a: [1] });
  });
});
