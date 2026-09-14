/** Tiny helpers for reading untrusted JSON without throwing. */

export type JsonObject = Record<string, unknown>;

export const obj = (v: unknown): JsonObject =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};

export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback;

export const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
