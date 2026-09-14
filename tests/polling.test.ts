import { describe, expect, it } from 'vitest';
import { cacheHeaders, cdnTtlSeconds, TTL } from '../src/server/cacheHeaders';
import { nextPollMs, POLL_FINAL_MS, POLL_IDLE_MS, POLL_LIVE_MS, POLL_PREGAME_MS } from '../src/shared/polling';
import { game, slate } from './helpers';

const NOW = Date.parse('2026-09-13T16:30:00Z');
const minutesFromNow = (m: number) => new Date(NOW + m * 60_000).toISOString();

describe('nextPollMs (F9, AC9.1)', () => {
  it.each([
    ['nothing loaded yet', null, POLL_LIVE_MS],
    ['empty slate', slate([]), POLL_IDLE_MS],
    ['all void', slate([game({ state: 'void' })]), POLL_IDLE_MS],
    ['a game is live', slate([game({ state: 'in' }), game({ state: 'pre' })]), POLL_LIVE_MS],
    ['kickoff in 30 min', slate([game({ state: 'pre', kickoff: minutesFromNow(30) })]), POLL_PREGAME_MS],
    ['kickoff in 2 h', slate([game({ state: 'pre', kickoff: minutesFromNow(120) })]), POLL_IDLE_MS],
    ['kickoff time passed, still pre', slate([game({ state: 'pre', kickoff: minutesFromNow(-2) })]), POLL_LIVE_MS],
    ['all final', slate([game({ state: 'post' }), game({ state: 'void' })]), POLL_FINAL_MS],
    ['final but unverified', slate([game({ state: 'post', legsVerified: false })]), POLL_LIVE_MS],
  ])('%s', (_label, s, expected) => {
    expect(nextPollMs(s, NOW)).toBe(expected);
  });
});

describe('cdnTtlSeconds (ARCHITECTURE §3)', () => {
  it.each([
    ['demo', slate([game({ state: 'in' })], { source: 'demo' }), TTL.demo],
    ['stale snapshot', slate([game({ state: 'in' })], { stale: true }), TTL.stale],
    ['empty', slate([]), TTL.idle],
    ['live', slate([game({ state: 'in' })]), TTL.live],
    ['kickoff in 10 min', slate([game({ state: 'pre', kickoff: minutesFromNow(10) })]), TTL.live],
    ['kickoff in 2 h', slate([game({ state: 'pre', kickoff: minutesFromNow(120) })]), TTL.nearKickoff],
    ['kickoff in 5 h', slate([game({ state: 'pre', kickoff: minutesFromNow(300) })]), TTL.idle],
    ['all final', slate([game({ state: 'post' })]), TTL.allFinal],
    ['final but unverified', slate([game({ state: 'post', legsVerified: false })]), TTL.live],
  ])('%s', (_label, s, expected) => {
    expect(cdnTtlSeconds(s, NOW)).toBe(expected);
  });

  it('builds durable CDN headers that vary only on meaningful params, with short SWR when live (QA F9)', () => {
    expect(cacheHeaders(20)).toEqual({
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=20, stale-while-revalidate=5',
      'Netlify-Vary': 'query=year|seasontype|week|demo|progress',
    });
    expect(cacheHeaders(600)['Netlify-CDN-Cache-Control']).toBe('public, durable, s-maxage=600, stale-while-revalidate=600');
  });
});
