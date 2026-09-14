# TDFG Dashboard — Architecture & Decisions

## 1. Overview

```
 Browser (React SPA)                Netlify CDN (durable cache)          Netlify Function            ESPN (free, unofficial)
 ─────────────────── poll ──────▶  /api/slate?week=N  ── miss ──▶  netlify/functions/slate.ts ──▶ site.api.espn.com
  adaptive 20s/60s/5m               s-maxage 20s live                  │  1× scoreboard per run         /scoreboard
  pauses when hidden                one upstream run per TTL           │  summary only for games        /summary?event=ID
                                    for ALL viewers                    ▼  whose score changed
                                                                   Netlify Blobs (per-game leg cache, last-good snapshot)
```

- **Frontend:** Vite + React + TypeScript, served as static files.
- **Backend:** one Netlify Function (v2 API) at `/api/slate`.
- **Shared domain logic:** `src/shared/` holds pure, dependency-free TypeScript that the function, the client, and the tests all import.

## 2. Module map

| Path | Responsibility |
|------|----------------|
| `src/shared/types.ts` | The API contract types (SPEC §5) |
| `src/shared/json.ts` | Non-throwing readers for untrusted JSON |
| `src/shared/clock.ts` | Game-clock math (elapsed, regulation remaining) |
| `src/shared/polling.ts` | Client poll cadence (F9) |
| `src/shared/slate.ts` | ET time math and the Sunday 1 PM window filter (R6) |
| `src/shared/espn.ts` | Defensive parsing of ESPN scoreboard/summary JSON into domain types |
| `src/shared/legs.ts` | Scoring plays → per-team TD/FG counts, plus reconciliation with the score |
| `src/shared/risk.ts` | Risk thresholds & per-team/game risk (F6) |
| `src/shared/bet.ts` | Aggregates: counter, bet status, needed list, filters, sorting |
| `src/server/source.ts` | `DataSource` interface + ESPN HTTP implementation (timeouts) |
| `src/server/demo.ts` | Fixture replay `DataSource` (F8) |
| `src/server/cache.ts` | `KeyValueCache` interface: Netlify Blobs implementation + in-memory fallback |
| `src/server/buildSlate.ts` | Orchestration: scoreboard → filter → cached/fresh legs → response |
| `src/server/cacheHeaders.ts` | CDN TTL selection & headers |
| `src/server/handler.ts` | HTTP concerns: params, cache headers, errors |
| `netlify/functions/slate.ts` | Thin Netlify entry that wires the handler |
| `vite.config.ts` | Dev-only middleware that mounts the same handler at `/api/slate` (in-memory cache) |
| `src/client/query.ts`, `hooks.ts` | URL ⇄ API params, polling hook, persisted filter state |
| `src/client/components/**` | Summary, needed list, game cards, filters, week nav, demo controls |

## 3. Caching & upstream budget (ADR-002)

Three layers keep ESPN traffic low and independent of audience size.

1. **CDN durable cache.** The function sets
   `Netlify-CDN-Cache-Control: public, durable, s-maxage=<ttl>, stale-while-revalidate=<swr>`
   and `Netlify-Vary: query=year|seasontype|week|demo|progress`. That means unrelated query params can't bust the cache.
   The handler also rejects non-canonical values (`week=01`, repeats, `demo=x`). Netlify doesn't normalize query
   values, so each spelling would otherwise be a separate cache key and a separate ESPN call.
   `swr` is 5 s for TTLs ≤ 20 s, which keeps live data ≤ ~25 s old at the CDN; otherwise it equals the TTL.
   Every viewer shares one function run per TTL. The TTL is picked per response:

   | Situation | TTL |
   |-----------|-----|
   | Any slate game live, any game with unverified legs, or a kickoff within 15 min | 20 s |
   | First kickoff within 3 h | 60 s |
   | All slate games final | 600 s |
   | Otherwise (pre-week, void, empty) | 300 s |
   | Upstream error (stale snapshot) | 15 s |

   Browsers get `Cache-Control: public, max-age=0, must-revalidate`, so the CDN decides freshness.
2. **Per-game leg cache (Netlify Blobs).** Key: `legs/<eventId>`. Value: `{ scoreKey, tdFg, verified, fetchedAt }`.
   Each run fetches `/summary` for a game only if
   (a) the game has started, **and**
   (b) there's no cached entry, or its `scoreKey` (`away-home` score) differs, or it wasn't `verified`.
   Final + verified games are never fetched again.
   Unverified *live* games are re-fetched every run, so feed lag clears within one TTL. Unverified *final* games are
   re-fetched every run for 15 min after they first mismatch (a last-minute score landing), then at most every
   10 min. That keeps a permanently inconsistent feed from costing one call per run all evening.
   While unverified, counts are merged as the per-team maximum of cached and fresh counts. A summary served from
   ESPN's CDN that's behind can't erase confirmed legs. Lower counts (overturned plays) are accepted once verified.
   An unverified final game never busts the bet (SPEC R9).
   Every Blobs call is capped at 1 s (the client's own retries can take far longer) and treated as a miss on timeout.
3. **Last-good snapshot (Netlify Blobs).** Key: `snapshot/<season>-<type>-<week>`. If ESPN errors or times out (6 s), the last snapshot is served with `stale: true`.

**Budget math, live 1 PM window:** 3 function runs/min × (1 scoreboard + ~0–2 summaries) ≈ **3–9 ESPN requests/min**, whether 1 or 1,000 friends are watching. Netlify usage over a whole season stays far below free-tier limits.

If Blobs is unavailable (local dev, tests), `cache.ts` falls back to a process-memory map. Correctness doesn't change; only cache hit rate does.

## 4. Decision records

### ADR-001 — Data source: ESPN public site API
- **Context:** we need a free, keyless source of live scores with per-play scoring attribution.
- **Options:**
  - ESPN site API: free, has `scoringPlays` with `scoringType` and `team`, but unofficial.
  - SportsDataIO / API-Sports: official, but paid or key-limited.
  - NFL.com: undocumented, and it changes often.
- **Decision:** ESPN. Verified 2026-09-14 against real Week 1 data. `scoringType.name` values seen: `touchdown` (passing, rushing, INT return, fumble recovery) and `field-goal`. OT plays show up as period 5.
- **Consequence:** the schema could change without notice. We mitigate with defensive parsing, contract tests against recorded fixtures, and a stale-snapshot fallback. The `DataSource` interface lets a paid provider be dropped in later.

### ADR-002 — Server-side proxy with CDN cache (not direct browser → ESPN)
- Direct browser calls would multiply upstream traffic by audience size and depend on ESPN's CORS policy.
- A single cached function makes traffic O(1) in viewers. See §3.

### ADR-003 — Legs from scoring plays, not point arithmetic
- Scores are ambiguous: 7 could be one TD + PAT, or a TD with a failed PAT plus a safety. Safeties and 2-point conversions break inference.
- We use explicit plays. Plays are reconciled against the scoreboard by checking that the last scoring play's running score equals the current score. A mismatch sets `legsVerified: false` and forces a re-fetch next run.

### ADR-004 — Risk thresholds are heuristic and time-based
- A win-probability model would be overkill and depends on data we'd have to trust. A clock-plus-needs table is explainable and tunable (SPEC F6).

### ADR-005 — Stack
- Vite + React + TS, because it's familiar, fast, and has first-class Netlify support. There's no SSR need.
- Vitest for unit/integration tests. Playwright for end-to-end tests against a local dev server that mounts the same handler via a Vite middleware. That way end-to-end tests exercise the real server code without needing the Netlify CLI.

## 5. Failure modes

| Failure | Behavior |
|---------|----------|
| ESPN scoreboard 5xx/timeout | Serve last-good snapshot with `stale: true`. The client shows a warning banner. |
| ESPN returns 200 but garbage (no season/week), or zero games for a week that had games | Treated as an outage: serve the snapshot and don't overwrite it. |
| Client gets a non-JSON or malformed 200 | Treated as an error; data already on screen is kept. |
| No snapshot and ESPN down | 503 `{ error }`. The client keeps any data already on screen, plus a banner. |
| Summary fetch fails for one game | Use the cached legs for that game, if any, with `legsVerified: false`. Other games are unaffected. |
| Summary lags the scoreboard | `legsVerified: false`, re-fetched next run (ADR-003). |
| Blobs write fails | Logged and ignored; the response still returns. |
| Client network error | Keep showing last data, show "Last updated Xs ago", and retry on the normal cadence. |
