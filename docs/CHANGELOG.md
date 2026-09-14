# Changelog & build log

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
- Deployed to Netlify production (CLI deploy, team `egrandmaison89`): https://tittyfg.netlify.app
  (production URL updated from `tdfg-dashboard.netlify.app`; Netlify site slug is `tittyfg`)
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
