# 🏈 TD + FG Tracker

A live dashboard for our weekly NFL parlay: **every team kicking off Sunday at 1:00 PM ET must score at least one
touchdown and one field goal.** It shows which of the legs are already off the board, which are still needed,
which games are in trouble, and whether the bet is alive.

- **Live mode:** `/` shows the current week's Sunday 1 PM slate. It refreshes about every 20 s while games are on, with a drive strip per live game, a pinned "needs attention" strip, and the week's payout.
- **Other weeks:** use the ‹ › week arrows, or `/?week=3&seasontype=2&year=2026`.
- **Demo:** `/?demo=1` replays the real Week 1 (Sep 13, 2026) slate with a game-clock slider.

## How it works

```
Browser ──poll──▶ Netlify CDN (durable cache, 20 s TTL live) ──▶ Netlify Function /api/slate ──▶ ESPN public API
                                                                   └─ Netlify Blobs: per-game leg cache + last-good snapshot
```

- **Free data:** ESPN's public scoreboard + game summary endpoints. No API key.
- **Legs come from ESPN's scoring plays**, not point math. Any TD counts: offense, defense, special teams, and OT.
- **Upstream traffic doesn't grow with viewers.** The CDN serves every friend from one function run per TTL. Each run makes 1 scoreboard request plus a game-summary request only for games whose score changed. That's about 3–9 ESPN requests/min during the 1 PM window.

Full details: [docs/SPEC.md](docs/SPEC.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/TEST_PLAN.md](docs/TEST_PLAN.md) · [docs/CHANGELOG.md](docs/CHANGELOG.md)

## Development

Requires Node 22.12+.

```bash
npm install
npm run dev          # http://localhost:5173 — /api/slate runs the real handler against ESPN
npm test             # unit + integration (Vitest)
npm run e2e          # browser tests (Playwright; run `npx playwright install chromium` once)
npm run verify       # lint + typecheck + tests + build + e2e
```

## Deploying to Netlify

1. In Netlify: **Add new site → Import an existing project → GitHub →** pick `tdfg-dashboard`.
2. Build settings come from `netlify.toml` (`npm run build`, publish `dist`, functions in `netlify/functions`).
3. Deploy. Netlify Blobs is enabled automatically.
4. **Odds editing (optional):** set `TDFG_ODDS_KEY` to a passphrase (`netlify env:set TDFG_ODDS_KEY "…"`). Without it, `/api/odds` is read-only and the editor stays hidden.
5. **Powered by Netlify badge:** turn it off under **Project configuration → General → Powered by Netlify badge**. There is no API or CLI for this setting.

## Project layout

```
src/shared/   pure domain logic shared by server, client and tests (slate window, parsing, legs, risk, bet)
src/server/   data sources, caching, pipeline, HTTP handler
src/client/   React UI
netlify/functions/slate.ts   Netlify Function entry
fixtures/     recorded real ESPN data used by tests and demo mode
tests/  e2e/  Vitest and Playwright suites
docs/         spec, architecture decisions, test plan, changelog
```
