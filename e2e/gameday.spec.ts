import { expect, test } from '@playwright/test';
import { finalGame, liveGame, mockApis } from './mocks';

test.describe('drive strip (F15)', () => {
  test('shows field position, down & distance and what we want', async ({ page }) => {
    await mockApis(page, { games: [liveGame('g1')] });
    await page.goto('/');
    const strip = page.getByTestId('drive-strip');
    await expect(strip).toBeVisible();
    await expect(page.getByTestId('drive-down')).toHaveText('2nd & 6 at AWY 30');
    await expect(page.getByTestId('drive-want')).toHaveText(/HOM needs a made FG — they’re in range right now/);
    // Ball 30 yards out → 70% of the way to the end zone.
    await expect(page.getByTestId('drive-ball')).toHaveAttribute('data-progress', '70');
    await expect(page.getByTestId('drive-field')).toHaveAttribute('aria-label', /HOM has the ball, 2nd & 6 at AWY 30, 30 yards from the end zone/);
  });

  test('handles a possession-free moment without a ball marker', async ({ page }) => {
    await mockApis(page, { games: [liveGame('g1', { possessionTeamId: null, downDistance: null, isHalftime: true, statusDetail: 'Halftime' })] });
    await page.goto('/');
    await expect(page.getByTestId('drive-strip')).toBeVisible();
    await expect(page.getByTestId('drive-ball')).toHaveCount(0);
    await expect(page.getByTestId('drive-down')).toHaveText('Halftime');
  });

  test('labels the range by what the team needs (QA F-09)', async ({ page }) => {
    await mockApis(page, { games: [liveGame('g1')] });
    await page.goto('/');
    await expect(page.getByTestId('drive-chip')).toHaveText('FG range');

    const tdOnly = liveGame('g2', {
      teams: [
        { id: 'g2a', abbr: 'AWY', name: 'Away', logo: null, color: null, homeAway: 'away', score: 17, tdCount: 2, fgCount: 1 },
        { id: 'g2h', abbr: 'HOM', name: 'Home', logo: null, color: null, homeAway: 'home', score: 14, tdCount: 0, fgCount: 2 },
      ],
      possessionTeamId: 'g2h',
    });
    await mockApis(page, { games: [tdOnly] });
    await page.goto('/');
    await expect(page.getByTestId('drive-chip')).toHaveCount(0);
    await expect(page.getByTestId('drive-want')).toContainText('a field goal here doesn’t help');
  });

  test('is absent for games that are not live', async ({ page }) => {
    await mockApis(page, { games: [finalGame('g1')] });
    await page.goto('/');
    await expect(page.getByTestId('game-card')).toBeVisible();
    await expect(page.getByTestId('drive-strip')).toHaveCount(0);
  });
});

test.describe('needs attention (F14)', () => {
  test('pins urgent teams and live scoring chances, with reasons', async ({ page }) => {
    await mockApis(page, { games: [liveGame('g1')] });
    await page.goto('/');
    const items = page.getByTestId('attention-item');
    await expect(page.getByTestId('attention-strip')).toBeVisible();
    await expect(page.getByTestId('attention-count')).toHaveText('1');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toHaveAttribute('data-team', 'HOM');
    await expect(items.first()).toHaveAttribute('data-opportunity', 'true');
    await expect(items.first()).toContainText('Chance now');
    await expect(items.first()).toContainText('in field-goal range');
    // A chance never hides the risk level (AC14.3, QA F-03).
    await expect(items.first().getByTestId('attention-level')).toHaveText('In danger');
  });

  test('escalates a team that needs a kick without the ball, and says why', async ({ page }) => {
    const game = liveGame('g1', {
      possessionTeamId: 'g1a',
      statusDetail: 'Q4 6:40',
      clockSeconds: 400,
      homeTimeouts: 0,
      downDistance: '1st & 10 at HOM 40',
      yardLine: 40,
    });
    await mockApis(page, { games: [game] });
    await page.goto('/');
    const item = page.getByTestId('attention-item').filter({ hasText: 'HOM' });
    await expect(item).toHaveAttribute('data-level', 'last_chance');
    await expect(item).toContainText('doesn’t have the ball');
    await expect(item).toContainText('no timeouts left');
    await expect(page.locator('[data-testid="game-card"]').first()).toHaveAttribute('data-risk', 'last_chance');
    await expect(page.getByTestId('risk-why')).toContainText('no timeouts left');
    // The worst level gets a badge on the card too (QA F-05).
    await expect(page.locator('[data-testid="game-card"] .badge').first()).toHaveText('Critical');
  });

  test('stays out of the way when nothing is urgent', async ({ page }) => {
    await mockApis(page, { games: [liveGame('g1', { period: 1, clockSeconds: 800, statusDetail: 'Q1 13:20', yardLine: 30 })] });
    await page.goto('/');
    await expect(page.getByTestId('game-card')).toBeVisible();
    await expect(page.getByTestId('attention-strip')).toHaveCount(0);
  });
});

test.describe('payout (F16)', () => {
  const odds = { american: 2500, stake: 20, note: 'DK slip', updatedAt: '2026-09-20T16:00:00Z' };

  test('shows the entered price, payout and our estimate', async ({ page }) => {
    await mockApis(page, { games: [finalGame('g1'), finalGame('g2')], odds });
    await page.goto('/');
    await expect(page.getByTestId('odds-headline')).toContainText('+2500');
    await expect(page.getByTestId('odds-headline')).toContainText('$500');
    await expect(page.getByTestId('odds-headline')).toContainText('$20 stake');
    await expect(page.getByTestId('odds-headline')).toContainText('DK slip');
    await expect(page.getByTestId('odds-estimate')).toContainText('Pre-kickoff estimate for 2 games');
    await expect(page.getByTestId('odds-edit')).toHaveCount(0); // read-only without a passphrase
  });

  test('saves new odds through the editor', async ({ page }) => {
    await mockApis(page, { games: [finalGame('g1')], oddsEditable: true });
    let posted: Record<string, unknown> | null = null;
    await page.route('**/api/odds**', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ odds: { american: 1800, stake: 10, note: null, updatedAt: '2026-09-20T16:05:00Z' } }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('odds-empty')).toBeVisible();
    await page.getByTestId('odds-edit').click();
    await page.getByTestId('odds-american').fill('+1800');
    await page.getByTestId('odds-stake').fill('10');
    await page.getByTestId('odds-key').fill('secret');
    await page.getByTestId('odds-save').click();

    await expect(page.getByTestId('odds-form')).toHaveCount(0);
    expect(posted).toMatchObject({ american: '+1800', stake: '10', key: 'secret', season: 2026, seasonType: 2, week: 2 });
    // The saved value appears immediately, without waiting for a cached slate to catch up (QA F-02).
    await expect(page.getByTestId('odds-headline')).toContainText('+1800');
  });

  test('editor is keyboard friendly: focus moves in, Escape closes, focus returns (QA F-17)', async ({ page }) => {
    await mockApis(page, { games: [finalGame('g1')], oddsEditable: true });
    await page.goto('/');
    await page.getByTestId('odds-edit').click();
    await expect(page.getByTestId('odds-american')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('odds-form')).toHaveCount(0);
    await expect(page.getByTestId('odds-edit')).toBeFocused();
  });

  test('keeps the form open and explains a rejected passphrase', async ({ page }) => {
    await mockApis(page, { games: [finalGame('g1')], oddsEditable: true });
    await page.route('**/api/odds**', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Wrong passphrase' }) })
        : route.fallback(),
    );
    await page.goto('/');
    await page.getByTestId('odds-edit').click();
    await page.getByTestId('odds-american').fill('+1800');
    await page.getByTestId('odds-stake').fill('10');
    await page.getByTestId('odds-key').fill('nope');
    await page.getByTestId('odds-save').click();
    await expect(page.getByTestId('odds-error')).toHaveText('Wrong passphrase');
    await expect(page.getByTestId('odds-form')).toBeVisible();
    await expect(page.getByTestId('odds-american')).toHaveAttribute('aria-invalid', 'true');
  });

  test('says a postponed week does not count (QA F-14)', async ({ page }) => {
    await mockApis(page, {
      games: [finalGame('g1'), finalGame('g2', { state: 'void', statusDetail: 'Postponed' })],
      odds: { american: 2500, stake: 20, note: null, updatedAt: '2026-09-20T16:00:00Z' },
    });
    await page.goto('/');
    await expect(page.getByTestId('bet-status')).toHaveText(/no bet/i);
    await expect(page.getByTestId('odds-no-bet')).toContainText('postponed');
    await expect(page.getByTestId('odds-headline')).toContainText('Would have paid');
  });
});

test.describe('game day on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('drive strip and attention strip fit without sideways scroll', async ({ page }) => {
    await mockApis(page, { games: [liveGame('g1'), liveGame('g2')], odds: { american: 2500, stake: 20, note: null, updatedAt: '2026-09-20T16:00:00Z' } });
    await page.goto('/');
    await expect(page.getByTestId('drive-strip').first()).toBeVisible();
    await expect(page.getByTestId('attention-strip')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
