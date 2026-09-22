# Changelog & build log

## 1.2.0 — 2026-09-22 — Attention, drive strip, payout

### Requirements interview (with Eric)
| Question | Decision |
|----------|----------|
| Odds | DraftKings blocks automated access, so: enter the real price (shared with everyone) **and** show our own estimate |
| Alerts | Louder on screen only — no browser notifications or sound |
| Drive graphic | Compact field strip inside each live card |
| Trouble logic | Weigh possession, field position and timeouts; add a "last chance" level with plain-language reasons |

### Research before build
- DraftKings' public endpoints return **403 Access Denied** to servers, and a browser fetch would be blocked by CORS. ESPN does carry DraftKings' game lines (moneyline/spread/total) but not per-team TD/FG props, so the entered price is the source of truth.
- ESPN's live `situation` carries `down`, `distance`, `yardLine`, `downDistanceText`, `possession`, `isRedZone` and per-side timeouts.
- Verified against the recorded Monday-night game that `yardLine` is absolute from the **home** goal line (R15).
- The "Powered by Netlify" badge is a project setting with no API or CLI; it has to be switched off in the Netlify UI (F17).

### Added
- **Smarter trouble logic (F14):** possession, field position and timeouts adjust the clock-based level; new `last_chance` level; `opportunity` flag for a team in scoring position for the leg it needs; every assessment carries reasons ("doesn't have the ball", "no timeouts left", "in field-goal range"). A pinned **Needs attention** strip lists danger, last chance and live chances with a count.
- **Drive strip (F15):** per-live-game field bar with ball spot, red-zone and FG-range shading, down & distance, and a one-line "what we want here" that changes with what each team still needs.
- **Payout (F16):** `POST /api/odds` stores the week's price behind a passphrase (`TDFG_ODDS_KEY`); the slate carries it so everyone on the link sees the same number. The panel shows price, profit, stake, return, and our own calibrated estimate from 5 seasons of leg rates.
- ESPN parsing extended for down/distance/yard line/timeouts, with demo mode generating a plausible drive so the strip is reviewable off-season.

### Fixed
- Unknown possession was being read as "the other team has the ball", which over-escalated urgency (caught by a failing test).
- The "no timeouts" escalation could never fire, because its 5:00 window sat entirely inside the danger threshold; widened to 8:00.
- A CSS class collision (`.ball`) leaked absolute positioning onto the team-row possession marker, floating a stray football at the page edge (caught in visual review).
- A busted week with nothing pending read "Nothing left to hit."; it now says how many legs short.

### QA round (independent reviewer): findings and resolutions
All five gates were green when the reviewer started, so every finding below is something the suite missed.

| ID | Sev | Finding | Resolution |
|----|-----|---------|------------|
| F-01 | P1 | `POST /api/odds` always returned 200: the cache swallows write failures, so a lost write looked saved | Cache gained `strict`/`timeoutMs` options; odds writes throw on failure (→ 503) and get a 6 s timeout, reads 4 s. Test asserts a failed write reports 503. |
| F-02 | P1 | Odds rode along on the CDN-cached slate (up to 24 h), so a saved price could stay invisible — or revert for the person who saved it | Odds now have their own `GET /api/odds` endpoint with a 15 s shared cache; the panel reads from it and shows the saved value immediately. |
| F-03 | P1 | "Chance now" replaced the risk badge, so a team in danger rendered calm green | The level badge always shows; the chance is an extra badge, and the green styling is an accent that no longer overrides red. |
| F-04 | P1 | `.needed-item.risk-last_chance` had no CSS, so the most urgent row looked the calmest | Styled with the danger treatment plus a ring. |
| F-05 | P1 | `BADGE_RISKS` never learned the new level, so the worst games showed no badge | Added. |
| F-06 | P1 | `reasons` could come back empty, suppressing the "why" line | Reasons always lead with clock context ("4th quarter · 3:12 left", "halftime", "final 1:45"). Test sweeps every quarter/clock combination. |
| F-07 | P1 | Multiplicative calibration priced a 1-game slate at 73.6% — above a single team's own 76% hit rate, and clippable to p=1 | Calibration moved into the exponent (effective independent teams). A 1-game week now prices at 60.7%, always ≤ one team's rate, monotone in slate size. |
| F-08 | P1 | Open POST with no throttle and a non-constant-time passphrase compare | Constant-time compare, 8 wrong attempts per client per minute → 429, failures logged. |
| F-09 | P2 | "FG range" shown for a team that only needs a TD, directly above "a field goal here doesn't help" | Range wording and the chip follow what's still needed; TD-only reads "in scoring position". |
| F-10 | P2 | Possession left over at halftime produced a live drive and a "chance now" | Halftime is treated as no possession in both the assessment and the drive strip. |
| F-11 | P2 | Opportunity outranked severity in the strip; "pinned" wasn't sticky; no length cap | Sorted worst-first, `position: sticky`, capped at 6 rows with "+N more". |
| F-12 | P2 | "Last chance" overstated an escalated case with 7:30 left | Level renamed in the UI to **Critical**. |
| F-13 | P2 | A decided week still read "5 legs still needed" and showed a live chance | "5 legs short" when busted; the estimate is labelled pre-kickoff and drops the chance once settled. |
| F-14 | P2 | A postponed (no-bet) week still said "Pays $550" | Adds "No bet this week — a game was postponed". |
| F-15 | P2 | `stake` coerced `null`/`[]`/`true` into numbers | Type-checked like `american`; tests cover each. |
| F-16 | P2 | Rapid clicks fired concurrent POSTs | Guard at the top of submit. Two-writer last-write-wins is accepted and documented. |
| F-17 | P2 | Editor dropped focus, ignored Escape, error not tied to fields | Focus moves to the first field and back to the trigger, Escape closes, `aria-invalid`/`aria-describedby` wired. |
| F-18 | P2 | `needsAttention` and `isLongFgRange` were dead code, and the test plan credited the unused one | `attentionItems` (what the UI uses) moved to `src/shared/attention.ts` and tested there; long range now renders its own chip. |
| F-19 | P2 | Unicode minus broke copy-paste of negative odds | ASCII. |
| F-20 | P2 | `package.json` still on 1.1.0 | Bumped to 1.2.0. |
| AC14.1 caveat | — | The recorded fixture predated v1.2 and lacked timeout fields, so escalation was unverified against real data | Fixture re-trimmed from the raw capture; a test asserts down, distance, yard line and timeouts parse from all 9 real captures. |

### Verification
- Lint ✓, typecheck ✓, build ✓.
- Vitest: **432 tests** (88 new for v1.2).
- Playwright: **43 tests** (15 new for v1.2).
- Live check against the dev server: odds POST accepted, wrong passphrase 401, invalid odds 400, GET returns the stored price, slate carries it.
- Real-data check: all 9 Monday-night captures parse down/distance/yard line/timeouts, and yards-to-goal matches `downDistanceText` in both directions.

## 1.1.0 — 2026-09-14 — Season navigation & bet history

### Requirements interview (with Eric)
| Question | Decision |
|----------|----------|
| History span | 2021 onward; the current season updates weekly |
| Which weeks count | Every regular-season Sunday, graded as if bet (no playoffs) |
| Layout | Live \| History tabs (`/`, `/history`) |
| Board navigation | Season picker plus a week strip colored by result |
| History views | Season records, week-by-week grid, near misses and bust culprits, trend charts |
| Postponed game | That week is **No bet** and doesn't count; the live board keeps tracking (R10 changed) |
| Thin weeks (e.g. 2022 W16 with 1 game) | Graded normally, flagged as a short slate (< 4 games) |
| Near miss | Lost by 1–2 legs |

### Research before build
- ESPN has play-level scoring data from 2002 (2000 has none).
- Across 2021–2025 there are 669 Sunday 1 PM games in 90 weeks. All 669 reconcile, and none were postponed. 2022 W16 had a single game.
- An independent Python grader gives 3–87, with wins in 2022 W12, 2022 W16 and 2024 W18. That output is committed as `fixtures/history/oracle-2021-2025.json`.

### Added
- `GET /api/history` (ADR-006):
  - A committed bundle covers 2021–2025, generated by `npm run build:history` through the production pipeline. It uses a disk cache, so building the bundle made 0 ESPN calls.
  - The current season is graded incrementally. Final week grades are stored in Blobs, and upcoming weeks cost no upstream calls.
  - A per-run grading budget returns `incomplete` so the client retries.
  - When ESPN is down, bundled seasons are still served and ungraded weeks show as pending.
- CDN TTLs: history is 10 s if incomplete, 30 s if a week is live, 600 s otherwise. An explicitly requested, long-settled `/api/slate` week is cached for 1 day.
- Live | History tabs with pushState routing, back/forward support and deep links.
- Season picker and week strip: chips colored by status (won, lost, near miss, no bet, live, upcoming, short slate), each with an accessible label.
- History page:
  - Scope chips and headline tiles: record, win %, legs hit %, near misses, weeks since last win.
  - Two single-series trend charts: wins per season as columns and legs hit % as a line. They use hover and focus tooltips and colors validated by the dataviz checker on the dark surface, and the season table serves as their table view.
  - Week-by-week grid, near-miss list, and bust culprits with a TD vs FG share bar.
- `NO_BET` status on the live board.

### Verification
- Lint ✓, typecheck ✓.
- Vitest: 339 tests, plus the live-fixture suite added in the follow-up. They include all 90 bundled weeks checked against the independent oracle, plus the history pipeline's budget, cache, outage, void, empty-week and offseason cases.
- Playwright: 30 tests covering tabs, back/forward, deep links, headline stats and scoping, the season table, the grid, near misses, culprits, chart tooltips (mouse and keyboard), the incomplete banner, the error retry, a 375 px layout, the season picker and week strip (including without history data), No bet, and demo mode.
- **Live Monday night recording (DEN @ KC):** 9 in-game captures confirm the parser's field names (`STATUS_IN_PROGRESS`, `situation.possession`, `isRedZone`, `downDistanceText`). All 9 captures reconcile scoring plays with the live score. New case observed: `isRedZone: true` with no possession right after a score, which is handled safely. A trimmed fixture and test are committed.
- **Not yet done for 1.1:** independent QA round and production deploy.

## 1.0.0 — 2026-09-14

### Requirements interview (with Eric)
| Question | Decision |
|----------|----------|
| What counts as a TD? | Any TD credited to the team (offense, defense, special teams); OT counts |
| Which games? | Sunday games kicking off at 1:00 PM ET only |
| Data source / freshness | Free ESPN public API, ~20 s freshness via server-side cache |
| Repo | Public GitHub repo `tdfg-dashboard` |

### Research & verification before build
- Confirmed ESPN `scoreboard` and `summary` endpoints work without a key.
- Verified with real 2026 Week 1 data: `scoringPlays[].scoringType.name` is `touchdown` or `field-goal`. INT-return and fumble-recovery TDs are tagged `touchdown` and credited to the defense. OT plays show as period 5.
- Recorded the Week 1 Sunday slate as test fixtures (`fixtures/2026-wk1/replay.json`). All 32 legs across the 8 games at 1 PM were hit, and the scoring plays add up exactly to the final scores.

### Added
- Spec, architecture/ADRs, and test plan (`docs/`).
- Sunday 1 PM ET slate detection that handles DST.
- Netlify Function `/api/slate`:
  - ESPN proxy with a durable CDN cache (adaptive TTL) and `Netlify-Vary` on meaningful params.
  - Per-game leg cache in Netlify Blobs. Summaries are fetched only when a score changes.
  - Last-good snapshot fallback with a `stale` flag.
  - Reconciliation of scoring plays against the scoreboard (`legsVerified`).
- Dashboard:
  - Legs counter with progress bar and bet status (Not started / Alive / Won / Busted, naming the busted legs).
  - "Still needed" list sorted by urgency.
  - Game cards with ✓/✗ leg cells, possession/red-zone hints, and a risk badge.
  - Filters with counts (persisted), urgency/kickoff sort, and week navigation.
  - Adaptive polling that pauses in hidden tabs.
  - Stale and error banners, and an accessible labels legend.
- Demo mode (`/?demo=1`) replaying Week 1 through the real server pipeline, with a play/slider control.

### Verification log
- Unit + integration (Vitest): 133 tests passing.
- End-to-end (Playwright, Chromium): 10 tests passing, including a 375 px mobile layout check.
- Live smoke against real ESPN (local dev server): the current week returns the 8 Week 1 games at 1 PM, matching the golden table. Week 2 returns the 8 Sep 20 games at 1 PM and excludes the TNF and late games. Cache headers as designed.
- Netlify runtime check (`netlify build --offline` + `netlify serve`):
  - The function bundles and registers at the literal route `/api/slate`, and isn't shadowed by the SPA redirect.
  - Netlify Blobs runs in sandbox mode with no fallback.
  - Demo, 400 on bad params, and SPA deep links all work.
- Independent QA review: see the QA section below.

### Release
- Re-verified after the QA fixes: lint ✓, typecheck ✓, 178/178 unit and integration tests ✓, build ✓, 14/14 Playwright e2e ✓.
- Pushed to https://github.com/egrandmaison89/tdfg-dashboard (public).
- Deployed to Netlify production (CLI deploy, team `egrandmaison89`): https://tdfg-dashboard.netlify.app
- Production smoke test:
  - `?week=01` → 400 (confirms the post-QA function is live).
  - `/api/slate` → 8 games, 32/32 legs, served as `cache-status: "Netlify Durable"; hit`.
  - Week 2 → the 8 Sep 20 games at 1 PM (pre).
  - Demo and SPA deep links work. No console errors. Logos load.

### QA round 1 (independent reviewer): findings and resolutions
All automated gates passed at review time, but the reviewer found real defects by reproducing Sunday scenarios.

| ID | Sev | Finding | Resolution |
|----|-----|---------|------------|
| F1 | P0 | A game ending on a late score (summary lagging the scoreboard) showed **BUSTED** for 10–30 min | Unverified finals never bust (`isSettled`). They're re-checked every run for 15 min, and their slate uses the live CDN TTL and client cadence. Regression tests for server, bet logic, and e2e. |
| F2 | P0 | A summary fetch failure on a cold cache busted the bet | Same fix as F1, plus a test |
| F3 | P1 | A lagging or regressed summary lowered already-confirmed legs | Unverified counts merge as a per-team maximum. Decreases are accepted only when verified. Test. |
| F4 | P1 | A malformed or empty 200 scoreboard overwrote the good snapshot | Missing season/week counts as an outage. An empty slate for a week that had games serves the snapshot. Tests. |
| F5 | P1 | Non-canonical params (`week=01`, `demo=x`, repeats) created extra CDN keys, meaning extra ESPN calls | Strict canonical parsing with 400s; `seasontype` limited to 1–3. Tests. |
| F6 | P1 | The Blobs client's retry backoff could exceed the function timeout | Every Blobs call is capped at 1 s and treated as a miss. Tests. |
| F7 | P1 | A non-JSON 200 or an abort during body read could wipe on-screen data | Abort is re-thrown and the response shape validated. Good data is never discarded. Test for the guard. |
| F8 | P1 | `post` with `completed:false` (abandoned) could bust | Treated as void. Spec R10 contradiction resolved. Test. |
| F9 | P2 | SWR = TTL made live data up to ~40 s old; "Updated" hid CDN age | SWR 5 s for short TTLs. The "Updated" age comes from the server `Date` header minus `generatedAt`, so it's skew-proof. |
| F10 | P2 | Verified finals are never re-fetched for stat corrections | **Won't fix:** a correction that changes TD/FG attribution always changes the score, which already triggers a re-fetch. |
| F11 | P2 | A saved filter could greet the user with an empty page | A saved filter matching nothing falls back to All until the user picks one. e2e test. |
| F12 | P2 | An all-void slate showed an empty "0 / 0" panel | Empty and all-postponed messages; summary hidden. |
| F13 | P2 | `--faint` text contrast 3.8:1 | Raised to `#8493a6` (≥ 4.5:1 on the surface color). |
| F14 | P2 | "ok" risk is blue; spec said neutral | Spec updated: blue = "on track" is intentional. |
| F15 | P2 | Week bounds, no Week 18 → playoffs, bad URL error loop | Bounds are pre 1–4, reg 1–18, post 1–5, with navigation across season types. Invalid URL params are dropped client-side, and "Try again" goes to `/`. Tests. |
| F16 | P2 | Delayed games rendered as "Q2 5:00" | Non-clock live statuses use ESPN's text. Test. |
| F17 | P2 | Doc drift; live Monday night fixture not yet recorded | Docs corrected. The Monday night recording is scheduled for tonight (in progress). |
| F18 | P2 | Demo possession heuristic wrong before defensive TDs | Won't fix (demo-only, cosmetic). |
