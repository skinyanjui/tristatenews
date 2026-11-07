// ship110: the open page fetches a fresh /api/news snapshot every 5 minutes while visible and online, never while
// hidden or offline, at once when the tab comes back; an unchanged answer redraws nothing (the same card nodes stay),
// and new stories appear without moving the story the reader is looking at. /api/* is mocked and every request off
// the local server is refused, so nothing leaves the machine. Time is driven by Playwright's clock.
const { test, expect } = require('@playwright/test');

const T0 = Date.parse('2026-11-07T15:00:00Z');
const story = (n, minsAgo, o) => Object.assign({ id: 'wfie-' + n, title: 'Evansville story number ' + n, link: 'https://www.14news.com/2026/11/07/story-' + n + '/', summary: 'Summary ' + n + '.', image: '', source: '14 News', sourceId: 'wfie', published: new Date(T0 - minsAgo * 6e4).toISOString() }, o || {});
const SOURCES = [{ id: 'wfie', name: '14 News', area: 'Evansville', kind: 'news', ok: true, count: 40, logo: '' }];
const snap = (items, at) => ({ updatedAt: new Date(at).toISOString(), sources: SOURCES, items });
const BASE = Array.from({ length: 40 }, (_, i) => story(i + 1, 20 + i * 30));

async function setup(page, answers) {
  const asked = [];
  let next = 0;
  await page.route(url => !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url.href), route => route.abort());
  // the local server's own first stories (embedded in the page) would come first; the mocked answers are the subject
  await page.route(url => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/$/.test(url.href), async route => {
    const r = await route.fetch();
    const html = (await r.text()).replace(/<script[^>]*id="tsn-data"[\s\S]*?<\/script>/, '');
    return route.fulfill({ response: r, body: html });
  });
  await page.route(/\/api\/news(\?|$)/, route => { asked.push(Date.now()); const a = answers[Math.min(next++, answers.length - 1)]; return route.fulfill({ json: a, headers: { 'cache-control': 'no-store' } }); });
  await page.route(/\/api\/(react|alerts|listings|inbox)(\?|$)/, route => route.fulfill({ json: { configured: false, counts: {}, alerts: [], items: [] } }));
  return asked;
}
const setHidden = (page, hidden) => page.evaluate(h => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

test('visible: a fresh snapshot every 5 minutes; an unchanged one redraws nothing', async ({ page }) => {
  await page.clock.install({ time: T0 });
  const asked = await setup(page, [snap(BASE, T0 - 6e4)]);
  await page.goto('/');
  await expect(page.locator('#list article.card').first()).toContainText('Evansville story number 1');
  const n0 = asked.length;
  await page.locator('#list article.card').first().evaluate(c => { c.__probe = 1; });
  await page.clock.runFor(6 * 60 * 1000);
  await expect.poll(() => asked.length).toBe(n0 + 1);
  await page.waitForTimeout(200);
  expect(await page.locator('#list article.card').first().evaluate(c => c.__probe === 1 && c.isConnected), 'same card node: no list redraw').toBe(true);
  await page.clock.runFor(5 * 60 * 1000);
  await expect.poll(() => asked.length).toBe(n0 + 2);
});

test('hidden or offline: no requests; back to visible: one request at once', async ({ page, context }) => {
  await page.clock.install({ time: T0 });
  const asked = await setup(page, [snap(BASE, T0 - 6e4)]);
  await page.goto('/');
  await expect(page.locator('#list article.card').first()).toBeVisible();
  const n0 = asked.length;
  await setHidden(page, true);
  await page.clock.runFor(30 * 60 * 1000);
  expect(asked.length, 'nothing while hidden').toBe(n0);
  await setHidden(page, false);
  await expect.poll(() => asked.length).toBe(n0 + 1);
  await context.setOffline(true);
  await page.clock.runFor(15 * 60 * 1000);
  expect(asked.length, 'nothing while offline').toBe(n0 + 1);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => asked.length).toBe(n0 + 2);
});

test('new stories appear on their own; a reader scrolled down keeps the story they were reading in place', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.clock.install({ time: T0 });
  const fresh = [story(101, 2, { title: 'Fresh Evansville story A' }), story(102, 3, { title: 'Fresh Evansville story B' })].concat(BASE);
  await setup(page, [snap(BASE, T0 - 6e4), snap(fresh, T0 + 4 * 6e4)]);
  await page.goto('/');
  const cards = page.locator('#list article.card');
  await expect(cards.first()).toContainText('Evansville story number 1');
  const target = cards.filter({ hasText: 'Evansville story number 8' }).first();
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 37));
  const before = await target.boundingBox();
  await page.clock.runFor(6 * 60 * 1000);
  await expect(page.locator('#list')).toContainText('Fresh Evansville story A');
  await page.waitForTimeout(800); // rebuilt cards above it settle after the redraw
  const after = await cards.filter({ hasText: 'Evansville story number 8' }).first().boundingBox();
  expect(Math.abs(after.y - before.y), 'the story on screen did not move').toBeLessThanOrEqual(1);
  // at the top, the new stories are simply first
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(cards.first()).toContainText('Fresh Evansville story A');
});

test('a story dated by day only shows its day, never a made-up time', async ({ page }) => {
  await page.clock.install({ time: T0 });
  const dayOnly = story(201, 0, { title: 'Dubois County council approves budget', published: '2026-11-07T06:00:00.000Z', datePrecision: 'day' });
  await setup(page, [snap([dayOnly].concat(BASE), T0 - 6e4)]);
  await page.goto('/');
  const t = page.locator('#list article.card', { hasText: 'Dubois County council approves budget' }).locator('time');
  await expect(t).toHaveText('Today');
  await expect(t).toHaveAttribute('title', 'Saturday, November 7');
});
