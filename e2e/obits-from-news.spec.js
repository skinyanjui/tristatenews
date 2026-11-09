// ship123: a fixture news-kind obituary appears on /obituaries and not on /.
const { test, expect } = require('@playwright/test');

const MORRIS = {
  id: 'gn-hamilton-54',
  title: 'Marilyn Kay Morris, age 73, of Montgomery, TX (formerly of McLeansboro)',
  summary: 'Marilyn Kay Morris, age 73, of Montgomery, TX (formerly of McLeansboro), passed away.',
  link: 'https://news.google.com/rss/articles/fixture-morris-obit',
  published: new Date(Date.now() - 2 * 3600e3).toISOString(),
  source: 'Hamilton County news',
  sourceId: 'gn-hamilton'
};
const NEWS = {
  id: 'n-1',
  title: 'Council passes riverfront plan for the east bank',
  summary: 'A zoning vote downtown.',
  link: 'https://n.ex/river',
  published: new Date(Date.now() - 3600e3).toISOString(),
  source: 'Fixture Desk',
  sourceId: 'n'
};
const SOURCES = [
  { id: 'gn-hamilton', name: 'Hamilton County news', kind: 'news', area: 'McLeansboro', ok: true, count: 1 },
  { id: 'n', name: 'Fixture Desk', kind: 'news', area: 'Evansville', ok: true, count: 1 }
];

async function stub(page) {
  await page.route(url => !/^http:\/\/(127\.0\.0\.1|localhost)/.test(url.href) && !url.href.startsWith(page.url()), route => route.abort());
  await page.route(/\/api\/news(\?|$)/, route => {
    const u = new URL(route.request().url());
    const path = u.searchParams.get('p') || '';
    // tabpage / client load: return the same snapshot; page() remount is exercised via client itemKind too.
    route.fulfill({
      json: {
        updatedAt: new Date(Date.now() + 60e3).toISOString(),
        sources: SOURCES,
        items: [MORRIS, NEWS]
      }
    });
  });
  await page.route(/\/api\/(react|alerts|listings|inbox)(\?|$)/, route => route.fulfill({
    json: { configured: false, counts: {}, alerts: [], items: [], boards: {} }
  }));
}

test('ship123: Morris fixture is on /obituaries and not on News home', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.goto('/');
  await expect(page.locator('#list')).toContainText('riverfront plan', { timeout: 15000 });
  await expect(page.locator('#list')).not.toContainText('Marilyn Kay Morris');

  await page.goto('/obituaries');
  await expect(page.locator('#list')).toContainText('Marilyn Kay Morris', { timeout: 15000 });
  await expect(page.locator('#list article').filter({ hasText: 'Marilyn Kay Morris' })).toBeVisible();
  // Obituary row: no comment button, source attribution kept.
  const row = page.locator('#list article').filter({ hasText: 'Marilyn Kay Morris' });
  await expect(row.locator('.cm-btn')).toHaveCount(0);
  await expect(row).toContainText(/Hamilton County/i);
});
