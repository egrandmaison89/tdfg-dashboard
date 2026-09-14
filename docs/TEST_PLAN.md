# TDFG Dashboard — Test & QA Plan

Every acceptance criterion (AC) in SPEC.md maps to at least one automated test or an explicit manual QA step.
All suites run with `npm test` (unit + integration) and `npm run e2e` (Playwright). `npm run verify` runs lint, typecheck, tests, build, and e2e.

## 1. Test data
- `fixtures/2026-wk1/`: **real** ESPN scoreboard and trimmed summaries for Sunday 2026-09-13 (13 Sunday games, 8 in the 1 PM window). It includes a pick-six (TB, PIT), a defensive fumble-recovery TD, and OT scoring (NO @ DET).
- `fixtures/live-mnf/`: real in-progress snapshots of DEN @ KC (MNF, 2026-09-14). Used to validate live-state parsing (clock, period, possession, halftime).
- Synthetic builders in `tests/helpers.ts` cover conditions real data didn't show: void games, feed lag, overturned plays, and DST dates.

## 2. Unit tests (Vitest)

| Suite | Covers | Key cases |
|-------|--------|-----------|
| `slate.test.ts` | F1, R6 | 17:00Z in September counts as Sun 1 PM EDT ✓. 18:00Z in December counts as 1 PM EST ✓. 17:00Z in December is Noon EST ✗. 13:30Z Sunday (9:30 AM London) ✗. 20:25Z ✗. Saturday 1 PM ✗. Monday ✗. 1:05 PM ✓. 2:00 PM ✗. |
| `espn.test.ts` | F2, contract | Parses the real scoreboard. Handles missing `situation`, missing logos, and scores given as strings. Maps `STATUS_POSTPONED`/`CANCELED` to void, `STATUS_HALFTIME` to halftime, and period 5 to OT. Away/home ordering is correct. |
| `legs.test.ts` | F3, R2–R5, ADR-003 | Offensive, INT-return, and fumble-recovery TDs count. OT TD counts. FG counts. Safety counts as neither. Plays credited to the right team id. Reconciliation: last play's score matches the scoreboard (verified), lags it (unverified), 0–0 with no plays (verified). |
| `risk.test.ts` | F6 | Full table: every threshold boundary (exactly 15:00, 5:00, 30:00), halftime, OT, pregame, final → busted/done. |
| `bet.test.ts` | F4, F5, F7, R7–R10 | Counter totals. Void game excluded. WON before finals. BUSTED names the missing legs. NOT STARTED. Needed list text and sort order. Remainder breakdown text. Each filter predicate and count. Urgency vs kickoff sort. |
| `polling.test.ts` | F9, ADR-002 | Poll interval: live 20 s, pre-kickoff 60 s, idle 5 min, all final 10 min, unverified final 20 s. CDN TTL table for each situation, SWR, Vary header. |
| `query.test.ts` | F1.5, F7 | Client URL parsing and validation, week bounds, crossing season-type boundaries, response shape guard. |
| `cache.test.ts` | ARCH §3 | Blobs timeout/error → miss. Memory cache copies values. |

## 3. Integration tests (Vitest, mocked `fetch`)

| Suite | Covers |
|-------|--------|
| `buildSlate.test.ts` › golden | End-to-end server pipeline over the real Week 1 fixtures: 8 games returned, and **golden leg table** asserted for all 16 teams. It's hand-checked against the recorded scoring plays and the reconciliation totals. |
| `buildSlate.test.ts` › upstream budget | First run: 1 scoreboard + 8 summaries. Second run with unchanged scores: **1 scoreboard + 0 summaries**. One score changes → exactly 1 summary. Unverified live → re-fetched every run. Unverified final → every run for 15 min, then every 10 min. Pregame games → 0 summaries. A lagging final recovers to WON without ever busting. Lagging summaries never lower confirmed counts. An overturned play un-hits the leg. |
| `buildSlate.test.ts` › failure handling | Scoreboard 500 with snapshot present → `stale: true` + snapshot. No snapshot → throws/503. Malformed 200 or an empty week that previously had games → snapshot. One summary fails → other games fine, and that game is unverified but not busted. |
| `handler.test.ts` | Query parsing (`week` must be an int 1–25, otherwise 400), demo routing, response headers, JSON shape. |
| `demo.test.ts` | Progress 0: all pregame. 50: mid-game, plays only up to half. 100: all final, and legs equal the golden table. Monotonic: legs never un-hit as progress rises. |

## 4. End-to-end tests (Playwright, Chromium, demo mode)

| Spec | Steps | Expectations |
|------|-------|--------------|
| `dashboard.spec.ts › final state` | Open `/?demo=1&progress=100` | 8 game cards. Counter 32/32. Status pill WON. 32 ✓ cells. (✗ cells are covered by the mocked live-mode spec.) |
| `› edge states` | Mocked API | Stale banner. Empty-slate state. Unverified final shows "needed", not ✗, and the bet stays Alive. A saved filter matching nothing falls back to All. |
| `› midgame` | progress=50 | Some ✓ and some blanks. Needed list non-empty and sorted by urgency. |
| `› filters` | Click each chip | Card counts match chip badges. "Off the board" cards have 4 ✓. |
| `› persistence` | Select "In trouble", reload | Filter still active. |
| `› mobile` | 375×812 viewport | No horizontal scroll (`scrollWidth <= clientWidth`). Counter visible without scrolling. |
| `› a11y labels` | Query by accessible name | "CHI touchdown scored" and similar labels exist. |
| `› error banner` | Route `/api/slate` to 500 after first load | Banner appears. Previous cards still rendered. |

## 5. Manual / exploratory QA checklist (performed by an independent QA agent)
1. Read SPEC.md and verify each AC against the running app (demo mode) and the test code. Report gaps.
2. Hit the live `/api/slate` locally against real ESPN. Confirm the current-week response and that no non-1 PM games appear.
3. Confirm cache headers in the live response.
4. Walk the demo slider from 0 → 100 and check for visual glitches, flicker, and incorrect risk colors.
5. Review the code for edge cases not covered by tests.
6. Screenshot desktop (1280) and mobile (375).

## 6. Exit criteria for "ready to review"
- `npm run verify` green.
- The QA agent reports no P0/P1 defects open. Any deferred items are listed in `docs/CHANGELOG.md`.
- The live smoke run against ESPN succeeds.
