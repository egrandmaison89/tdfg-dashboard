import { expect, test, type Page } from '@playwright/test';

const SEVERITY: Record<string, number> = { void: -1, done: 0, pregame: 1, ok: 2, watch: 3, danger: 4, busted: 5 };

const cards = (page: Page) => page.getByTestId('game-card');

async function openDemo(page: Page, progress: number) {
  await page.goto(`/?demo=1&progress=${progress}`);
  await expect(cards(page)).toHaveCount(8);
}

test.describe('demo replay', () => {
  test('pregame: nothing hit, not started', async ({ page }) => {
    await openDemo(page, 0);
    await expect(page.getByTestId('leg-counter')).toHaveText(/0\s*\/\s*32/);
    await expect(page.getByTestId('bet-status')).toHaveText(/not started/i);
    await expect(page.getByTestId('demo-banner')).toBeVisible();
  });

  test('final: all 32 legs hit and the bet is won', async ({ page }) => {
    await openDemo(page, 100);
    await expect(page.getByTestId('leg-counter')).toHaveText(/32\s*\/\s*32/);
    await expect(page.getByTestId('bet-status')).toHaveText(/won/i);
    await expect(page.locator('[data-testid="game-card"] [data-state="hit"]')).toHaveCount(32);
    await expect(page.getByRole('img', { name: 'CHI touchdown scored' })).toHaveCount(1);
  });

  test('mid-game: needed list is populated and sorted by urgency', async ({ page }) => {
    await openDemo(page, 85);
    const items = page.getByTestId('needed-item');
    await expect(items.first()).toBeVisible();
    const risks = await items.evaluateAll((els) => els.map((el) => el.getAttribute('data-risk') ?? ''));
    const severities = risks.map((r) => SEVERITY[r] ?? -2);
    expect(severities).toEqual([...severities].sort((a, b) => b - a));
    // Each needed entry lists 1–2 missing legs; the cards must show exactly that many blank cells.
    const missingTags = await page.locator('[data-testid="needed-item"] .tag').count();
    await expect(page.locator('[data-testid="game-card"] [data-state="pending"]')).toHaveCount(missingTags);
    expect(missingTags).toBeGreaterThan(0);
  });

  test('filter chips show counts that match the cards displayed', async ({ page }) => {
    await openDemo(page, 85);
    for (const key of ['all', 'live', 'needs', 'trouble', 'offboard', 'final']) {
      await page.getByTestId(`filter-${key}`).click();
      const expected = Number(await page.getByTestId(`filter-count-${key}`).textContent());
      if (expected === 0) await expect(page.getByTestId('no-matches')).toBeVisible();
      else await expect(cards(page)).toHaveCount(expected);
      if (key === 'offboard' && expected > 0) {
        await expect(page.locator('[data-testid="game-card"] [data-state="pending"]')).toHaveCount(0);
      }
    }
  });

  test('selected filter persists across reloads', async ({ page }) => {
    await openDemo(page, 85);
    await page.getByTestId('filter-needs').click();
    await page.reload();
    await expect(page.getByTestId('filter-needs')).toHaveAttribute('aria-pressed', 'true');
  });

  test('slider drives the replay through the server pipeline', async ({ page }) => {
    await openDemo(page, 0);
    await page.getByLabel('Simulated game progress').fill('50');
    await expect(page.getByTestId('game-card').first()).toContainText('Halftime');
    await expect(page).toHaveURL(/progress=50/);
  });

  test('shows an error banner and keeps data when a refresh fails', async ({ page }) => {
    await openDemo(page, 40);
    await page.route('**/api/slate**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }),
    );
    await page.getByLabel('Simulated game progress').fill('60');
    await expect(page.getByTestId('error-banner')).toBeVisible();
    await expect(cards(page)).toHaveCount(8);
  });
});

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('no horizontal scroll and counter above the fold', async ({ page }) => {
    await openDemo(page, 85);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByTestId('leg-counter')).toBeInViewport();
  });
});

const liveSlate = {
  generatedAt: new Date().toISOString(),
  source: 'espn',
  stale: false,
  season: 2026,
  seasonType: 2,
  week: 1,
  slateDate: '2026-09-13',
  games: [
    {
      id: 'final-busted',
      kickoff: '2026-09-13T17:00Z',
      state: 'post',
      statusDetail: 'Final',
      period: 4,
      clockSeconds: 0,
      isHalftime: false,
      possessionTeamId: null,
      isRedZone: false,
      downDistance: null,
      legsVerified: true,
      teams: [
        { id: '2', abbr: 'BUF', name: 'Buffalo Bills', logo: null, color: '#00338d', homeAway: 'away', score: 24, tdCount: 3, fgCount: 1 },
        { id: '34', abbr: 'HOU', name: 'Houston Texans', logo: null, color: '#03202f', homeAway: 'home', score: 21, tdCount: 3, fgCount: 0 },
      ],
    },
    {
      id: 'live-redzone',
      kickoff: '2026-09-13T17:00Z',
      state: 'in',
      statusDetail: 'Q4 2:11',
      period: 4,
      clockSeconds: 131,
      isHalftime: false,
      possessionTeamId: '3',
      isRedZone: true,
      downDistance: '2nd & 4 at CAR 9',
      legsVerified: false,
      teams: [
        { id: '3', abbr: 'CHI', name: 'Chicago Bears', logo: null, color: '#0b1c3a', homeAway: 'away', score: 13, tdCount: 1, fgCount: 2 },
        { id: '29', abbr: 'CAR', name: 'Carolina Panthers', logo: null, color: '#0085ca', homeAway: 'home', score: 3, tdCount: 0, fgCount: 1 },
      ],
    },
  ],
};

const mockSlate = (page: Page, body: unknown) =>
  page.route('**/api/slate**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));

test.describe('edge states (mocked API)', () => {
  test('stale snapshot shows the stale banner (AC2.4)', async ({ page }) => {
    await mockSlate(page, { ...liveSlate, stale: true });
    await page.goto('/');
    await expect(page.getByTestId('stale-banner')).toBeVisible();
    await expect(cards(page)).toHaveCount(2);
  });

  test('empty slate shows the empty state (AC1.4)', async ({ page }) => {
    await mockSlate(page, { ...liveSlate, slateDate: null, games: [] });
    await page.goto('/');
    await expect(page.getByTestId('empty-slate')).toContainText('No Sunday 1 PM ET games in Week 1');
    await expect(page.getByTestId('bet-status')).toHaveCount(0);
  });

  test('a final game with unverified plays is not busted (QA F1)', async ({ page }) => {
    const [finalGame] = liveSlate.games;
    await mockSlate(page, { ...liveSlate, games: [{ ...finalGame, legsVerified: false }] });
    await page.goto('/');
    await expect(page.getByTestId('bet-status')).toHaveText(/alive/i);
    await expect(page.locator('[data-testid="game-card"] [data-state="busted"]')).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'HOU field goal needed' })).toBeVisible();
    await expect(page.getByTestId('verifying')).toBeVisible();
  });

  test('a saved filter that matches nothing falls back to All (QA F11)', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('tdfg.filter', 'trouble'));
    await openDemo(page, 100);
    await expect(page.getByTestId('filter-all')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('live mode (mocked API)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSlate(page, liveSlate);
  });

  test('renders busted legs, danger, possession and verifying state', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('bet-status')).toHaveText(/busted/i);
    await expect(page.getByTestId('busted-legs')).toContainText('HOU FG');
    await expect(page.getByRole('img', { name: 'HOU field goal missed' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'CAR touchdown needed' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'CHI has the ball in the red zone' })).toBeVisible();
    await expect(page.getByTestId('verifying')).toBeVisible();
    await expect(page.locator('[data-game-id="live-redzone"]')).toHaveAttribute('data-risk', 'danger');
    await expect(page.getByTestId('leg-counter')).toHaveText(/6\s*\/\s*8/);
    await expect(page.getByTestId('updated-ago')).toBeVisible();
  });

  test('week navigation requests the selected week', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('bet-status')).toBeVisible();
    const request = page.waitForRequest(/\/api\/slate\?week=2&seasontype=2&year=2026/);
    await page.getByRole('button', { name: 'Next week' }).click();
    await request;
    await expect(page).toHaveURL(/week=2/);
  });
});
