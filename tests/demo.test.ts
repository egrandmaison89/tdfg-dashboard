import { describe, expect, it } from 'vitest';
import { buildSlate } from '../src/server/buildSlate';
import { MemoryCache } from '../src/server/cache';
import { DemoSource } from '../src/server/demo';
import { summarizeBet } from '../src/shared/bet';
import { GOLDEN } from './helpers';

const run = (progress: number) =>
  buildSlate({}, { source: new DemoSource(progress), cache: new MemoryCache(), now: () => new Date('2026-09-13T18:00:00Z') });

describe('demo replay (F8)', () => {
  it('progress 0: every game pregame, nothing hit', async () => {
    const slate = await run(0);
    expect(slate.source).toBe('demo');
    expect(slate.games).toHaveLength(8);
    expect(slate.games.every((g) => g.state === 'pre')).toBe(true);
    expect(summarizeBet(slate.games)).toMatchObject({ status: 'NOT_STARTED', hitLegs: 0, totalLegs: 32 });
  });

  it('progress 30: live second-quarter clocks with possession hints', async () => {
    const slate = await run(30);
    expect(slate.games.every((g) => g.state === 'in' && g.statusDetail === 'Q2 12:00')).toBe(true);
    expect(slate.games.some((g) => g.possessionTeamId !== null)).toBe(true);
  });

  it('progress 50: halftime, scores reconcile, partially hit', async () => {
    const slate = await run(50);
    expect(slate.games.every((g) => g.isHalftime && g.statusDetail === 'Halftime' && g.legsVerified)).toBe(true);
    const { hitLegs, status } = summarizeBet(slate.games);
    expect(status).toBe('ALIVE');
    expect(hitLegs).toBeGreaterThan(0);
    expect(hitLegs).toBeLessThan(32);
  });

  it('progress 100: final results equal the golden table', async () => {
    const slate = await run(100);
    expect(slate.games.every((g) => g.state === 'post')).toBe(true);
    for (const t of slate.games.flatMap((g) => g.teams)) {
      expect({ abbr: t.abbr, td: t.tdCount, fg: t.fgCount }).toEqual(GOLDEN[t.id]);
    }
    expect(summarizeBet(slate.games).status).toBe('WON');
  });

  it('legs never un-hit as progress increases', async () => {
    const previous = new Map<string, { td: number; fg: number }>();
    for (let p = 0; p <= 100; p += 5) {
      const slate = await run(p);
      for (const t of slate.games.flatMap((g) => g.teams)) {
        const prev = previous.get(t.id) ?? { td: 0, fg: 0 };
        expect(t.tdCount).toBeGreaterThanOrEqual(prev.td);
        expect(t.fgCount).toBeGreaterThanOrEqual(prev.fg);
        previous.set(t.id, { td: t.tdCount, fg: t.fgCount });
      }
    }
  });

  it('clamps out-of-range progress', async () => {
    expect((await run(150)).games.every((g) => g.state === 'post')).toBe(true);
    expect((await run(-5)).games.every((g) => g.state === 'pre')).toBe(true);
  });
});
