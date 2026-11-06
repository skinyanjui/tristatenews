// ship108: Vercel Speed Insights in the browser, against the local server only. /_vercel/speed-insights/* is answered
// by a stub here, so no real script loads and nothing is sent to Vercel.
const { test, expect } = require('@playwright/test');

const STUB = 'window.__siLoads = (window.__siLoads || 0) + 1;'
  + 'window.si = function (k, f) { if (k === "beforeSend") window.__siBeforeSend = f; };'
  + '(window.siq || []).forEach(function (a) { window.si(a[0], a[1]); });';

async function watch(page) {
  const seen = [];
  page.on('request', r => { if (/_vercel|vercel-insights|vercel-scripts/.test(r.url())) seen.push(r.method() + ' ' + r.url()); });
  await page.route('**/_vercel/speed-insights/**', route => route.request().method() === 'GET'
    ? route.fulfill({ contentType: 'application/javascript', body: STUB }) : route.fulfill({ status: 204, body: '' }));
  return seen;
}
const tags = page => page.evaluate(() => [...document.querySelectorAll('script[src*="/_vercel/speed-insights/"]')].map(s => ({ src: s.getAttribute('src'), ...s.dataset })));

test('local by default: no Speed Insights script and no request to Vercel', async ({ page }) => {
  const seen = await watch(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(await tags(page)).toEqual([]);
  expect(seen).toEqual([]);
  expect(await page.evaluate(() => typeof window.TSNSpeedInsights.injectSpeedInsights)).toBe('function');
});

test('forced on: one deferred script, the route follows tab switches, and URLs lose their query', async ({ page }) => {
  const seen = await watch(page);
  await page.addInitScript(() => { window.TSN_SPEED_INSIGHTS = 'force'; });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?q=river');
  await expect.poll(() => page.evaluate(() => window.__siLoads)).toBe(1);
  expect(await tags(page)).toEqual([{ src: '/_vercel/speed-insights/script.js', sdkn: '@vercel/speed-insights', sdkv: '2.1.0', route: '/' }]);
  await page.locator('.tab', { hasText: 'Events' }).first().click();
  await expect(page).toHaveURL(/\/events$/);
  await expect.poll(async () => (await tags(page))[0].route).toBe('/events');
  await page.goBack();
  await expect.poll(async () => (await tags(page))[0].route).toBe('/');
  const origin = await page.evaluate(() => location.origin);
  const sent = await page.evaluate(() => window.__siBeforeSend({ type: 'vital', url: location.origin + '/events?town=newburgh#ev-1', route: '/events' }));
  expect(sent.url).toBe(origin + '/events');
  expect(await tags(page)).toHaveLength(1);
  expect(seen).toEqual(['GET ' + origin + '/_vercel/speed-insights/script.js']);
});

test('forced on: county pages report a grouped route, and Legal loads it once', async ({ page }) => {
  await watch(page);
  await page.addInitScript(() => { window.TSN_SPEED_INSIGHTS = 'force'; });
  await page.goto('/legal#privacy');
  await expect.poll(() => page.evaluate(() => window.__siLoads)).toBe(1);
  expect((await tags(page)).map(t => t.route)).toEqual(['/legal']);
  expect(await page.evaluate(() => window.TSNSpeedInsights.route('/news/kentucky/henderson/'))).toBe('/news/[state]/[county]');
});
