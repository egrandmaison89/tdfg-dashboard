import { expect, test } from '@playwright/test';
import { allWeeks, mockApis, mockHistory } from './mocks';

const weeks = allWeeks();
const graded = weeks.filter((w) => w.status === 'won' || w.status === 'lost');
const nearMissWeeks = graded
  .filter((w) => w.status === 'lost' && w.totalLegs - w.hitLegs >= 1 && w.totalLegs - w.hitLegs <= 2)
  .sort((a, b) => b.season - a.season || b.week - a.week);

function topCulprit(): string {
  const counts = new Map<string, number>();
  for (const w of graded) if (w.status === 'lost') for (const leg of w.missedLegs) counts.set(leg.abbr, (counts.get(leg.abbr) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
}

test.describe('Live | History tabs (F11)', () => {
  test.beforeEach(async ({ page }) => mockApis(page));

  test('switch tabs without reloading, with working back/forward', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('tab-live')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('bet-status')).toBeVisible();

    await page.evaluate(() => ((window as unknown as { __marker: boolean }).__marker = true));
    await page.getByTestId('tab-history').click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(page.getByTestId('history-page')).toBeVisible();
    await expect(page.getByTestId('tab-history')).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => (window as unknown as { __marker?: boolean }).__marker)).toBe(true); // no reload

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('bet-status')).toBeVisible();
    await page.goForward();
    await expect(page.getByTestId('history-page')).toBeVisible();
  });

  test('deep links to /history load directly', async ({ page }) => {
    await page.goto('/history');
    await expect(page.getByTestId('history-page')).toBeVisible();
  });

  test('the Live tab returns to the week last open on the board', async ({ page }) => {
    await page.goto('/?week=7&seasontype=2&year=2023');
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('tab-live')).toHaveAttribute('href', '/?week=7&seasontype=2&year=2023');
  });
});

test.describe('History page (F13)', () => {
  test.beforeEach(async ({ page }) => mockApis(page));

  test('headline stats for all seasons and a scoped season', async ({ page }) => {
    await page.goto('/history');
    const wins = graded.filter((w) => w.status === 'won').length;
    await expect(page.getByTestId('tile-record')).toContainText(`${wins}–${graded.length - wins}`);
    await expect(page.getByTestId('tile-near')).toContainText(String(nearMissWeeks.length));

    await page.getByTestId('scope-2022').click();
    await expect(page.getByTestId('scope-2022')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tile-record')).toContainText('2–16');
    await page.getByTestId('scope-2026').click();
    await expect(page.getByTestId('tile-record')).toContainText('1–0');
    await expect(page.getByTestId('tile-drought')).toContainText('Just won');
  });

  test('season table: newest first, in-progress label, won weeks link to the board', async ({ page }) => {
    await page.goto('/history');
    const rows = page.getByTestId('season-row');
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toHaveAttribute('data-season', '2026');
    await expect(rows.first()).toContainText('in progress');
    await page.locator('[data-testid="season-row"][data-season="2024"]').getByRole('link', { name: 'Week 18' }).click();
    await expect(page).toHaveURL(/\/\?week=18&seasontype=2&year=2024$/);
    await expect(page.getByTestId('tab-live')).toHaveAttribute('aria-current', 'page');
  });

  test('week grid: every season, statuses, short slate flag, cells open the board', async ({ page }) => {
    await page.goto('/history');
    await expect(page.getByTestId('grid-row')).toHaveCount(6);
    const christmas = page.locator('[data-testid="week-grid"] [data-season="2022"][data-week="16"]');
    await expect(christmas).toHaveAttribute('data-tone', 'won');
    await expect(christmas).toHaveClass(/is-short/);
    await expect(christmas).toHaveAttribute('aria-label', /short slate \(1 game\)/);
    await expect(page.locator('[data-testid="week-grid"] [data-season="2026"][data-week="2"]')).toHaveAttribute('data-tone', 'live');

    await page.locator('[data-testid="week-grid"] [data-season="2023"][data-week="5"]').click();
    await expect(page).toHaveURL(/\/\?week=5&seasontype=2&year=2023$/);
  });

  test('near misses newest first with their missed legs; bust culprits ranked', async ({ page }) => {
    await page.goto('/history');
    const items = page.getByTestId('near-miss');
    await expect(items).toHaveCount(Math.min(6, nearMissWeeks.length));
    const newest = nearMissWeeks[0];
    await expect(items.first()).toContainText(`${newest?.season} · Week ${newest?.week}`);
    for (const leg of newest?.missedLegs ?? []) await expect(items.first()).toContainText(`${leg.abbr} ${leg.type}`);
    if (nearMissWeeks.length > 6) {
      await page.getByTestId('near-toggle').click();
      await expect(items).toHaveCount(nearMissWeeks.length);
    }
    await expect(page.getByTestId('culprit-row').first()).toHaveAttribute('data-team', topCulprit());
    await expect(page.getByTestId('miss-share')).toContainText('FG misses');
  });

  test('trend charts: one mark per season with hover tooltips', async ({ page }) => {
    await page.goto('/history');
    await expect(page.getByTestId('wins-bar')).toHaveCount(6);
    await expect(page.getByTestId('legs-point')).toHaveCount(6);
    const winsTooltip = page.getByTestId('wins-chart').getByTestId('chart-tooltip');
    await page.getByTestId('wins-bar').nth(1).hover(); // 2022 (ascending)
    await expect(winsTooltip).toContainText('2 wins');
    await expect(winsTooltip).toContainText('2022');
    await page.mouse.move(0, 0);
    await expect(winsTooltip).toHaveCount(0);

    const legsTooltip = page.getByTestId('legs-chart').getByTestId('chart-tooltip');
    await page.getByTestId('legs-point').nth(3).focus(); // 2024, keyboard reachable
    await expect(legsTooltip).toContainText('legs hit');
    await expect(legsTooltip).toContainText('2024');
  });

  test('shows a crunching banner while incomplete and clears it when grading finishes', async ({ page }) => {
    // Time-based rather than call-count-based: dev StrictMode mounts twice, so the first two fetches are immediate.
    let firstCallAt: number | null = null;
    await mockApis(page, {
      history: () => {
        firstCallAt ??= Date.now();
        return { status: 200, body: mockHistory({ incomplete: Date.now() - firstCallAt < 2_000 }) };
      },
    });
    await page.goto('/history');
    await expect(page.getByTestId('history-incomplete')).toBeVisible();
    await expect(page.getByTestId('history-incomplete')).toBeHidden({ timeout: 10_000 });
  });

  test('error state offers a retry', async ({ page }) => {
    let fail = true;
    await mockApis(page, { history: () => (fail ? { status: 503, body: { error: 'History is temporarily unavailable.' } } : { status: 200, body: mockHistory() }) });
    await page.goto('/history');
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('history-page')).toBeVisible();
  });
});

test.describe('History on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('no sideways page scroll; the week grid scrolls inside its own container', async ({ page }) => {
    await mockApis(page);
    await page.goto('/history');
    await expect(page.getByTestId('week-grid')).toBeVisible();
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pageOverflow).toBeLessThanOrEqual(0);
    const gridScrolls = await page.getByTestId('week-grid-scroll').evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(gridScrolls).toBe(true);
  });
});

test.describe('Board season picker + week strip (F12)', () => {
  test('pinned week: season select, strip statuses, chips and season changes navigate', async ({ page }) => {
    await mockApis(page);
    await page.goto('/?week=5&seasontype=2&year=2024');
    await expect(page.getByTestId('season-select')).toHaveValue('2024');
    const chips = page.locator('[data-testid="season-picker"] [data-testid="week-chip"]');
    await expect(chips).toHaveCount(18);
    await expect(chips.nth(4)).toHaveAttribute('aria-current', 'true');
    await expect(chips.nth(17)).toHaveAttribute('data-tone', 'won');

    await page.getByTestId('season-select').selectOption('2022');
    await expect(page).toHaveURL(/\/\?week=5&seasontype=2&year=2022$/);
    await chips.nth(15).click();
    await expect(page).toHaveURL(/\/\?week=16&seasontype=2&year=2022$/);
    await expect(chips.nth(15)).toHaveAttribute('aria-current', 'true');

    await page.goBack();
    await expect(page).toHaveURL(/week=5&seasontype=2&year=2022$/);

    await page.getByTestId('current-week').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('current-week')).toHaveCount(0);
  });

  test('choosing the current season returns to the current week', async ({ page }) => {
    await mockApis(page);
    await page.goto('/?week=3&seasontype=2&year=2023');
    await page.getByTestId('season-select').selectOption('2026');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-testid="season-picker"] [data-week="2"]')).toHaveAttribute('aria-current', 'true');
  });

  test('still navigates when history is unavailable (AC12.6)', async ({ page }) => {
    await mockApis(page, { history: () => ({ status: 500, body: { error: 'down' } }) });
    await page.goto('/?week=3&seasontype=2&year=2025');
    const chips = page.locator('[data-testid="season-picker"] [data-testid="week-chip"]');
    await expect(chips).toHaveCount(18);
    await expect(chips.first()).toHaveAttribute('data-tone', 'unknown');
    await chips.nth(9).click();
    await expect(page).toHaveURL(/\/\?week=10&seasontype=2&year=2025$/);
  });

  test('a postponed game shows No bet while legs keep tracking (R10)', async ({ page }) => {
    const { finalGame } = await import('./mocks');
    await mockApis(page, { games: [finalGame('g1'), finalGame('g2', { state: 'void', statusDetail: 'Postponed' })] });
    await page.goto('/');
    await expect(page.getByTestId('bet-status')).toHaveText(/no bet/i);
    await expect(page.getByTestId('leg-counter')).toHaveText(/4\s*\/\s*4/);
  });

  test('demo mode hides the picker', async ({ page }) => {
    await mockApis(page);
    await page.unroute('**/api/slate**');
    await page.goto('/?demo=1&progress=50');
    await expect(page.getByTestId('game-card')).toHaveCount(8);
    await expect(page.getByTestId('season-picker')).toHaveCount(0);
  });
});
