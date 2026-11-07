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

test('native posts show while the marketplace is still loading; arriving market cards do not rebuild the native list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route(/\/api\/news(\?|$)/, async route => {
    await new Promise(r => setTimeout(r, 400));
    await route.fulfill({ json: { updatedAt: new Date().toISOString(), sources: [], items: [] } });
  });
  await page.route(/\/api\/listings\?kind=item$/, route => route.fulfill({ json: { configured: true, items: NATIVE } }));
  await page.route(/\/api\/market$/, async route => {
    await gate;
    await route.fulfill({ json: { ok: true, stale: false, fetchedAt: new Date().toISOString(), source: { name: 'tristatemarketplace.com', url: MK + '/' }, items: ITEMS } });
  });
  const t0 = Date.now();
  await page.goto('/classifieds');
  const native = page.locator('#cl .row-item:not(.row-mk)', { hasText: 'Oak kitchen table' });
  await expect(native).toBeVisible({ timeout: 2000 });
  const nativeMs = Date.now() - t0;
  expect(nativeMs, 'native posts must not wait on the marketplace crawl').toBeLessThan(1500);
  await expect(page.locator('.mk-sec')).toContainText('Loading listings from tristatemarketplace.com');
  await expect(page.locator('.row-mk')).toHaveCount(0);
  await native.evaluate(c => { c.__probe = 1; });
  release();
  await expect(page.locator('.row-mk')).toHaveCount(2);
  expect(await native.evaluate(c => c.__probe === 1 && c.isConnected), 'native card node kept').toBe(true);
});

test('a hidden Classifieds tab does not fetch /api/market; becoming visible does, once', async ({ page }) => {
  const asked = [];
  await page.route(/\/api\/listings\?kind=item$/, route => route.fulfill({ json: { configured: true, items: NATIVE } }));
  await page.route(/\/api\/market$/, route => {
    asked.push(Date.now());
    return route.fulfill({ json: { ok: true, stale: false, fetchedAt: new Date().toISOString(), source: {}, items: ITEMS } });
  });
  await page.goto('/');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('#tabs [data-cat="classifieds"]').click();
  await expect(page.locator('#cl')).toBeVisible();
  await page.waitForTimeout(400);
  expect(asked.length, 'no market fetch while hidden').toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => asked.length).toBe(1);
  await page.locator('#tabs [data-cat="news"]').click();
  await page.locator('#tabs [data-cat="classifieds"]').click();
  await page.waitForTimeout(200);
  expect(asked.length, 'one fetch per page lifetime').toBe(1);
});

test('stale-while-refreshing shows last-good listings without a failure line', async ({ page }) => {
  await open(page, 390, { ok: true, stale: true, refreshing: true, fetchedAt: '2026-11-05T18:00:00Z', source: {}, items: ITEMS });
  await expect(page.locator('.mk-sec .row-mk')).toHaveCount(2);
  await expect(page.locator('.mk-sec')).toContainText('Showing listings as of November 5');
  await expect(page.locator('.mk-sec')).not.toContainText('Couldn\u2019t refresh just now');
});

const FORTY = Array.from({ length: 40 }, (_, i) => ({
  id: 'mk-f' + i, url: MK + '/listing/f' + i, title: 'Sample listing number ' + i, price: '$' + (20 + i),
  town: i % 2 ? 'Newburgh, IN' : 'Evansville, IN', desc: 'Fixture listing ' + i + '.', srcCategory: 'Furniture', category: 'Furniture', image: ''
}));
const FRESH_FORTY = FORTY.concat([{
  id: 'mk-new', url: MK + '/listing/new', title: 'Snow blower, like new', price: '$90',
  town: 'Henderson, KY', desc: 'Runs.', srcCategory: 'Tools', category: 'Tools', image: ''
}]);

test('when the first /api/market is still refreshing, the open tab fetches once more and paints the new listings', async ({ page }) => {
  await page.clock.install({ time: Date.parse('2026-11-07T18:00:00Z') });
  let n = 0;
  await page.route(/\/api\/listings\?kind=item$/, route => route.fulfill({ json: { configured: true, items: NATIVE } }));
  await page.route(/\/api\/market$/, route => {
    n += 1;
    const first = n === 1;
    return route.fulfill({ json: { ok: true, stale: first, refreshing: first, fetchedAt: first ? '2026-11-05T18:00:00Z' : '2026-11-07T18:00:10Z', source: { name: 'tristatemarketplace.com', url: MK + '/' }, items: first ? FORTY : FRESH_FORTY } });
  });
  await page.goto('/classifieds');
  await expect(page.locator('.mk-sec .row-mk')).toHaveCount(40);
  await expect(page.locator('.mk-sec')).toContainText('Showing listings as of November 5');
  await expect(page.locator('.mk-note')).toContainText('Test listings from tristatemarketplace.com, shown while we test the site. Some are samples');
  expect(n).toBe(1);
  await page.screenshot({ path: '/opt/cursor/artifacts/classifieds-stale-40.png', fullPage: true });
  await page.clock.runFor(10000);
  await expect(page.getByText('Snow blower, like new')).toBeVisible();
  await expect(page.locator('.mk-sec .row-mk')).toHaveCount(41);
  expect(n).toBe(2);
  await page.clock.runFor(20000);
  expect(n, 'one follow-up, not a poll loop').toBe(2);
  await page.screenshot({ path: '/opt/cursor/artifacts/classifieds-after-followup.png', fullPage: true });
});

test('a hidden tab does not follow up a refreshing market; becoming visible does, once', async ({ page }) => {
  await page.clock.install({ time: Date.parse('2026-11-07T18:00:00Z') });
  let n = 0;
  await page.route(/\/api\/listings\?kind=item$/, route => route.fulfill({ json: { configured: true, items: NATIVE } }));
  await page.route(/\/api\/market$/, route => {
    n += 1;
    return route.fulfill({ json: { ok: true, stale: n === 1, refreshing: n === 1, fetchedAt: '2026-11-05T18:00:00Z', source: {}, items: ITEMS } });
  });
  await page.goto('/classifieds');
  await expect(page.locator('.row-mk')).toHaveCount(2);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(10000);
  expect(n, 'no follow-up while hidden').toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => n).toBe(2);
  await page.clock.runFor(10000);
  expect(n, 'still one follow-up').toBe(2);
});

test('native first card with a 40-listing cold marketplace; empty native still shows market cards and filters', async ({ page }) => {
  let release;
  const gate = new Promise(r => { release = r; });
  const timings = {};
  await page.route(/\/api\/listings\?kind=item$/, route => route.fulfill({ json: { configured: true, items: [] } }));
  await page.route(/\/api\/market$/, async route => {
    await gate;
    await route.fulfill({ json: { ok: true, stale: false, refreshing: false, fetchedAt: new Date().toISOString(), source: { name: 'tristatemarketplace.com', url: MK + '/' }, items: FORTY } });
  });
  const t0 = Date.now();
  await page.goto('/classifieds');
  await expect(page.locator('.mk-sec')).toContainText('Loading listings from tristatemarketplace.com');
  timings.loadingNoteMs = Date.now() - t0;
  expect(timings.loadingNoteMs, 'loading note must not wait on the crawl').toBeLessThan(1500);
  await expect(page.locator('#cl .row-item:not(.row-mk)')).toHaveCount(0);
  await expect(page.locator('.mk-note')).toContainText('Some are samples');
  release();
  const tM = Date.now();
  await expect(page.locator('.mk-sec .row-mk')).toHaveCount(40);
  timings.coldMarketCardsMs = Date.now() - t0;
  timings.coldAfterReleaseMs = Date.now() - tM;
  await expect(page.locator('#cl .cl-empty')).toContainText('Nothing posted yet');
  await page.locator('#cl select').first().selectOption('Newburgh');
  await expect(page.locator('.mk-sec .row-mk')).toHaveCount(20);
  await expect(page.locator('.mk-note')).toContainText('Test listings from tristatemarketplace.com');
  await page.screenshot({ path: '/opt/cursor/artifacts/classifieds-empty-native-40.png', fullPage: true });
  console.log('TIMING empty-native cold-market', JSON.stringify(timings));
});

test('cached marketplace 40 listings paint at once; a no-store fetch is used; offline skips the request', async ({ page }) => {
  const asked = [];
  await page.route(/\/api\/listings\?kind=item$/, route => route.fulfill({ json: { configured: true, items: NATIVE } }));
  await page.route(/\/api\/market$/, route => {
    asked.push({ at: Date.now(), cache: route.request().headers()['cache-control'] || route.request().headers()['pragma'] || '' });
    return route.fulfill({
      json: { ok: true, stale: false, refreshing: false, fetchedAt: new Date().toISOString(), source: {}, items: FORTY },
      headers: { 'cache-control': 'no-store' }
    });
  });
  const t0 = Date.now();
  await page.goto('/classifieds');
  await expect(page.locator('.mk-sec .row-mk')).toHaveCount(40);
  const cachedMs = Date.now() - t0;
  expect(cachedMs, 'cached 40 listings should paint promptly').toBeLessThan(2000);
  expect(asked.length).toBe(1);
  await page.screenshot({ path: '/opt/cursor/artifacts/classifieds-cached-40.png', fullPage: true });
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
  await page.locator('#tabs [data-cat="news"]').click();
  await page.locator('#tabs [data-cat="classifieds"]').click();
  await page.waitForTimeout(200);
  expect(asked.length, 'offline / already-asked does not refetch').toBe(1);
  console.log('TIMING cached-40 first-card', cachedMs);
});

test('a failed market does not trap the loading note; native cards stay', async ({ page }) => {
  await page.route(/\/api\/listings\?kind=item$/, route => route.fulfill({ json: { configured: true, items: NATIVE } }));
  await page.route(/\/api\/market$/, route => route.fulfill({ status: 502, body: '' }));
  await page.goto('/classifieds');
  await expect(page.locator('#cl .row-item:not(.row-mk)', { hasText: 'Oak kitchen table' })).toBeVisible();
  await expect(page.locator('.mk-sec')).toContainText('aren\u2019t available right now');
  await expect(page.locator('.mk-sec')).not.toContainText('Loading listings from tristatemarketplace.com');
  await expect(page.locator('.row-mk')).toHaveCount(0);
  await page.screenshot({ path: '/opt/cursor/artifacts/classifieds-market-error.png', fullPage: true });
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
