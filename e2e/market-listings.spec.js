// ship105: tristatemarketplace.com test listings on Classifieds, with /api/market and /api/listings mocked (nothing
// reaches the marketplace or the store). Checks the disclosure, the per-card tag and link, dedupe against a native
// post, the town filter, the stale and failure states, and the TRISTATENOW wordmark and footer link at 320px.
const { test, expect } = require('@playwright/test');

const MK = 'https://www.tristatemarketplace.com';
const ITEMS = [
  { id: 'mk-a', url: MK + '/listing/a', title: 'Antique dresser with marble top', price: '$120', town: 'Newburgh, IN', desc: 'Inlaid drawers.', srcCategory: 'Furniture', category: 'Furniture', image: '' },
  { id: 'mk-b', url: MK + '/listing/b', title: 'Trek mountain bike, medium frame', price: '$520', town: 'Evansville, IN', desc: 'Tuned up.', srcCategory: 'Sports', category: 'Sports & outdoors', image: '' },
  { id: 'mk-c', url: MK + '/listing/c', title: 'Oak kitchen table', price: '$80', town: 'Evansville, IN', desc: 'Same as a post here.', srcCategory: 'Furniture', category: 'Furniture', image: '' }
];
const NATIVE = [{ id: 'n1abcdef', title: 'Oak kitchen table', price: '80', town: 'Evansville', desc: 'Seats four.', contact: '812-555-0100', category: 'Furniture', at: new Date().toISOString() }];

async function open(page, width, market) {
  await page.setViewportSize({ width, height: 1000 });
  await page.route(/\/api\/listings\?kind=item$/, route => route.fulfill({ json: { configured: true, items: NATIVE } }));
  await page.route(/\/api\/market$/, route => market ? route.fulfill({ json: market }) : route.fulfill({ status: 502, body: '' }));
  await page.goto('/classifieds');
  await page.locator('.mk-sec').waitFor();
}

test('390px: the section, its disclosure, a Test listing tag and the original link on every card; a repeat of a post is left out', async ({ page }) => {
  await open(page, 390, { ok: true, stale: false, fetchedAt: new Date().toISOString(), source: { name: 'tristatemarketplace.com', url: MK + '/' }, items: ITEMS });
  const sec = page.locator('.mk-sec');
  await expect(sec.locator('h3')).toHaveText('From tristatemarketplace.com');
  await expect(sec.locator('.mk-note')).toContainText('Test listings from tristatemarketplace.com, shown while we test the site. Some are samples');
  await expect(sec.locator('.row-mk')).toHaveCount(2);
  await expect(sec.locator('.row-mk .mk-tag')).toHaveCount(2);
  await expect(sec.locator('.row-mk a.ca').first()).toHaveAttribute('href', MK + '/listing/a');
  await expect(sec.locator('.row-mk a.ca').first()).toHaveAttribute('target', '_blank');
  await expect(sec.getByText('Oak kitchen table')).toHaveCount(0);
  await expect(page.locator('#cl .row-item:not(.row-mk)', { hasText: 'Oak kitchen table' })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test('1280px: the town filter applies to the marketplace listings too', async ({ page }) => {
  await open(page, 1280, { ok: true, stale: false, fetchedAt: new Date().toISOString(), source: {}, items: ITEMS });
  await page.locator('#cl select').first().selectOption('Newburgh');
  await expect(page.locator('.mk-sec .row-mk')).toHaveCount(1);
  await expect(page.locator('.mk-sec .row-mk h2')).toHaveText('Antique dresser with marble top');
});

test('stale data says when it is from; a failure shows no listings, only a note and a link', async ({ page }) => {
  await open(page, 390, { ok: true, stale: true, fetchedAt: '2026-11-05T18:00:00Z', source: {}, items: ITEMS });
  await expect(page.locator('.mk-sec')).toContainText('Showing listings as of November 5');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await open(page, 390, null);
  await expect(page.locator('.mk-sec .row-mk')).toHaveCount(0);
  await expect(page.locator('.mk-sec')).toContainText('aren\u2019t available right now');
  await expect(page.locator('.mk-sec a', { hasText: 'Browse them there' })).toHaveAttribute('href', MK + '/');
});

test('320px: the TRISTATENOW wordmark and the footer link fit', async ({ page }) => {
  await open(page, 320, { ok: true, stale: false, fetchedAt: new Date().toISOString(), source: {}, items: ITEMS });
  await expect(page.locator('a.brand')).toHaveText('TRISTATENOW');
  await expect(page).toHaveTitle(/TRISTATENOW/);
  const link = page.locator('.legal-links a', { hasText: 'tristatemarketplace.com' });
  await expect(link).toHaveAttribute('href', MK + '/');
  const nav = await page.evaluate(() => { const n = document.querySelector('.nav-in'); return [n.scrollWidth - n.clientWidth, document.documentElement.scrollWidth - innerWidth]; });
  expect(nav).toEqual([0, 0]);
});
