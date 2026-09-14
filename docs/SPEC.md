# TDFG Dashboard — Product Spec

**Status:** v1.0 approved for build · **Owner:** Eric Grandmaison · **Last updated:** 2026-09-14

## 1. Problem

Every NFL Sunday a friend group places one shared parlay: **every team playing in the Sunday
1:00 PM ET window must score at least one touchdown (TD) and at least one field goal (FG).**
With 6–10 games at once, nobody can easily tell which of the 12–20 teams have already scored
which way. The end of the window gets chaotic because no scoreboard tracks *TD and FG per team*.

## 2. Goal

A public, mobile-first web page that shows live, for this week's Sunday 1 PM slate:
which legs are hit, which are still needed, which are in danger, and whether the bet is alive.

### Non-goals (v1)
- Accounts, logins, bet slips, odds, or payouts.
- Games outside the Sunday 1:00 PM ET window (TNF, SNF, MNF, 4 PM, international mornings).
- Push notifications.
- Paid data providers.

## 3. Bet rules (source of truth for all logic)

| ID | Rule | Decision |
|----|------|----------|
| R1 | A **leg** is one (team, scoring type) pair. Each team has exactly 2 legs: TD and FG. | Confirmed |
| R2 | A TD leg is hit by **any touchdown credited to that team**: offensive, defensive (pick-six, fumble return) or special-teams. | Confirmed |
| R3 | A FG leg is hit by any **successful** field goal credited to that team. Missed or blocked FGs don't count. | Confirmed |
| R4 | **Overtime scoring counts.** | Confirmed |
| R5 | Safeties, extra points, and 2-point conversions (including defensive 2-point returns) hit **no** leg. | Derived from R2/R3 |
| R6 | The slate is every game whose kickoff is **Sunday, 1:00 PM–1:59 PM America/New_York**. That covers normal 1:00 kickoffs and rare 1:05 shifts. 9:30 AM international games and 4 PM games are excluded. | Confirmed |
| R7 | **Total legs** = 2 × number of teams in non-void games. | Derived |
| R8 | The bet is **WON** as soon as every leg is hit, even if games are still in progress. | Derived |
| R9 | The bet is **BUSTED** as soon as any game is final, its scoring plays reconcile with the final score, and one of its teams is missing a leg. A final game whose plays haven't caught up yet never busts the bet. | Derived (tightened after QA) |
| R10 | A game that is **postponed or canceled**, or that ESPN reports as over without being completed, is *void*. Its legs are removed from the total, the way sportsbooks void parlay legs. A game *suspended to resume later* stays in progress. | Assumption, listed in §9 |

## 4. Features & acceptance criteria

Priority: **P0** is required for launch, **P1** is expected in v1, **P2** is nice-to-have and included if cheap.

### F1 — Slate detection (P0)
Automatically chooses the right games.
- **AC1.1** By default the page shows ESPN's "current" NFL week and filters it to Sunday 1 PM ET games (R6).
- **AC1.2** Thursday, Saturday, Monday, 4:05/4:25 PM, 8:20 PM, and 9:30 AM games never appear.
- **AC1.3** The Sunday is computed in America/New_York, not UTC, and DST is handled correctly. A 1:00 PM EDT kickoff is 17:00Z and a 1:00 PM EST kickoff is 18:00Z.
- **AC1.4** If the selected week has no 1 PM Sunday games, a friendly empty state explains that.
- **AC1.5 (P2)** Prev/next week controls load other weeks of the season (`?week=N`), for things like "did we win last week?".

### F2 — Live scores (P0)
- **AC2.1** Every slate game shows both teams (logo, abbreviation, score) and its state: kickoff time (pre), quarter + clock / Halftime / OT (live), or Final / Final-OT.
- **AC2.2** Data is at most **~20–40 s old** while any slate game is live. That's the server cache TTL plus the client poll interval.
- **AC2.3** During live games, the team with possession is marked and red-zone possessions are highlighted, when the feed provides it.
- **AC2.4** A "Last updated Xs ago" indicator is always visible. If the latest fetch failed or the server served stale data, a warning banner appears and the last good data stays on screen.

### F3 — Leg tracker (P0)
The core visual.
- **AC3.1** Each team row has a **TD** cell and an **FG** cell. A hit leg shows a green check ✓, and a pending leg is blank.
- **AC3.2** A leg that can no longer be hit (game final, leg missing) shows a red ✗.
- **AC3.3** Leg status comes from ESPN scoring plays (`scoringType.name` = `touchdown` / `field-goal`, attributed via `team.id`), never guessed from point totals.
- **AC3.4** If the scoring plays don't yet match the scoreboard score (feed lag), the game shows a subtle "verifying…" marker. Legs already confirmed stay shown, and the server re-checks on the next refresh.
- **AC3.5** A scoring play later overturned or removed by ESPN un-hits the leg on the next refresh.

### F4 — Bet summary / counter (P0)
- **AC4.1** A header counter reads "**H / T legs**" (for example "12 / 16"), with a progress bar.
- **AC4.2** A bet status pill shows `NOT STARTED` (no game started), `ALIVE`, `WON` (R8), or `BUSTED` (R9). When busted, it names the leg(s) that busted it. (`NO GAMES` is used internally for an empty slate, which shows the AC1.4 empty state instead.)
- **AC4.3** When all remaining legs are hit, the page celebrates visibly (the WON state).

### F5 — "Still needed" list (P0)
- **AC5.1** Lists every team with at least one pending leg, for example "CAR — FG" or "CHI — TD + FG".
- **AC5.2** Each entry shows game context: quarter/clock and whether the team has the ball.
- **AC5.3** Sorted most urgent first: danger, then watch, then ok, then not started. Ties go to less time remaining.
- **AC5.4** A summary line breaks down the remainder, for example "4 legs left: 2 TDs, 2 FGs across 3 teams".

### F6 — Risk / "in trouble" assessment (P1)
Per team, using only the missing-leg count and the game time remaining (`remaining`).
Regulation remaining = (4 − quarter) × 15:00 + clock. Halftime counts as 30:00 remaining.

| Level | Condition |
|-------|-----------|
| `done` | No legs missing |
| `busted` | Game final, plays verified, and ≥1 leg missing. A final game that's still unverified counts as `danger`. |
| `pregame` | Game not started |
| `danger` | In OT and ≥1 leg missing; **or** 2 missing and remaining ≤ 15:00; **or** 1 missing and remaining ≤ 5:00 |
| `watch` | 2 missing and remaining ≤ 30:00; **or** 1 missing and remaining ≤ 15:00 |
| `ok` | Otherwise |

- **AC6.1** A game's risk is its worst team's risk.
- **AC6.2** Game cards and needed-list entries are color-coded by risk: danger red, watch amber, ok blue ("on track"), done green.
- **AC6.3** The thresholds are named constants in one module, so they're easy to tune.

### F7 — Filters & sorting (P1)
- **AC7.1** Filter chips, one active at a time, each with a live count: **All · Live · Needs legs · In trouble · Off the board · Final**.
  - *Needs legs*: a game with ≥1 pending leg (not busted).
  - *In trouble*: game risk is `watch` or `danger`.
  - *Off the board*: all 4 legs of the game are hit.
  - *Final*: game state is post.
- **AC7.2** Sort toggle: **Urgency** (default) or **Kickoff**.
- **AC7.3** The chosen filter and sort persist per browser (localStorage) and fall back gracefully if storage is unavailable. A filter remembered from an earlier visit that matches no games shows All instead.

### F8 — Demo / replay mode (P1)
Makes it possible to review and QA mid-game behavior on a non-game day.
- **AC8.1** `/?demo=1` replays the real 2026 Week 1 slate from bundled fixtures.
- **AC8.2** A progress slider (0–100% of game time) and a play button step the replay. Legs, clocks, risk, and counter all update through the same server pipeline as live data.
- **AC8.3** Demo mode is clearly labeled "DEMO — replaying Week 1" and never touches ESPN.

### F9 — Efficient polling (P0)
- **AC9.1** The client polls `/api/slate` on an adaptive interval:
  - 20 s while any game is live
  - 60 s within 60 min before the first kickoff
  - 5 min otherwise
  - none after every game is final, except a 10 min check in case of stat corrections
- **AC9.2** Polling pauses while the tab is hidden and refreshes immediately when it becomes visible.
- **AC9.3** No viewer can make the server hit ESPN more than about once per 20 s per week-view, no matter how many viewers there are (see ARCHITECTURE §3).

### F10 — Layout & accessibility (P0)
- **AC10.1** Usable at 360 px wide with no horizontal scroll. Two or more columns of game cards appear at ≥ 900 px.
- **AC10.2** Check/✗ marks carry text alternatives ("TD scored", "FG needed"), so status never relies on color alone.
- **AC10.3** Dark theme by default. Text contrast meets WCAG AA.

## 5. Data contract — `GET /api/slate`

Query params (all optional; anything else is ignored and doesn't affect caching):
- `year`, `seasontype` (1 pre, 2 regular, 3 post), `week` (1–25). Omitted means ESPN's current week.
- `demo` (`1`). `progress` (integer 0–100, only valid with `demo=1`). The server defaults `progress` to 100 and the UI to 72.
- Values must be canonical integers: `01`, `1.0`, `1e0`, and repeated params are rejected, because each spelling would be its own CDN cache key.
- Invalid values get a `400 { error }`. Upstream failure with no snapshot gets a `503 { error }`.

```jsonc
{
  "generatedAt": "2026-09-13T18:42:10.123Z",
  "source": "espn" | "demo",
  "stale": false,             // true = upstream failed, serving last good snapshot
  "season": 2026, "seasonType": 2, "week": 1,
  "slateDate": "2026-09-13",  // Sunday in ET, or null if no slate
  "games": [{
    "id": "401872661",
    "kickoff": "2026-09-13T17:00Z",
    "state": "pre" | "in" | "post" | "void",
    "statusDetail": "Q3 4:12",
    "period": 3, "clockSeconds": 252, "isHalftime": false,
    "possessionTeamId": "29" | null, "isRedZone": false, "downDistance": "3rd & 4 at CHI 22" | null,
    "legsVerified": true,
    "teams": [ // [away, home]
      { "id": "3", "abbr": "CHI", "name": "Chicago Bears", "logo": "https://…", "color": "#0b1c3a",
        "homeAway": "away", "score": 24, "tdCount": 3, "fgCount": 1 }
    ]
  }]
}
```

## 6. Success criteria
- On a real Sunday, the page's leg states match the final box scores for 100% of legs.
- There are zero paid API costs, and usage stays inside Netlify free-tier limits.
- The friend group can answer "what do we still need?" in under 3 seconds on a phone.

## 7. Out of scope / future ideas
Push/SMS alerts when a leg hits or goes into danger · configurable bet rules (e.g. TD-only) · historical win/loss record · 4 PM window mode.

## 8. Glossary
**Leg** — one team + one scoring type. **Off the board** — a leg (or game) whose requirements are all satisfied. **Slate** — the set of games in the window.

## 9. Assumptions to confirm with Eric
1. Void games (R10) are dropped from the parlay rather than busting it.
2. A game suspended mid-play and resumed later stays "in progress" until ESPN marks it final. A game ESPN ends without completing is void.
