// ship100: on Events the date chips share the town row from 1024px (the central column is 896px+ there, side ads or not)
// and keep their own row below it on phones and tablets. No overlap, no page overflow, and the filters still work.
// The event listings are mocked (two towns, so the town menu is a real select); nothing is posted.
const { test, expect } = require('@playwright/test');

const chi = ms => new Date(ms).toLocaleString('en-CA', { timeZone: 'America/Chicago', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const ev = (i, title, town, ms) => { const [d, t] = chi(ms).split(', '); return { id: 'e2e1000' + i, title, town, desc: 'A local community event.', contact: '812-555-0111', category: 'Community', date: d, time: t.replace(/^24/, '00'), place: 'Central Library', at: new Date().toISOString() }; };
const now = Date.now();
const EVENTS = [ev(1, 'Evening chess club', 'Evansville', now + 2 * 36e5), ev(2, 'Riverfront bake sale', 'Henderson', now + 26 * 36e5), ev(3, 'Library story time', 'Evansville', now + 50 * 36e5)];

async function open(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.route(/\/api\/listings\?kind=event$/, route => route.fulfill({ json: { configured: true, items: EVENTS } }));
  await page.route(/\/api\/react(\?|$)/, route => route.fulfill({ json: { configured: true, counts: {} } }));
  await page.goto('/events');
  await page.locator('#ev select[aria-label="Filter events by town"]').waitFor();
}

async function boxes(page) {
  return page.evaluate(() => {
    const q = s => document.querySelector('#ev ' + s).getBoundingClientRect();
    const r = b => ({ l: b.left, r: b.right, t: b.top, b: b.bottom });
    return { town: r(q('.evx-near')), dates: r(q('[aria-label="When"]')), add: r(q('.evx-head .cl-go')), cats: r(q('[aria-label="Category"]')), overflow: document.documentElement.scrollWidth - innerWidth };
  });
}

for (const width of [390, 768, 1023]) {
  test(`${width}px: dates keep their own row under the town and Add an event`, async ({ page }) => {
    await open(page, width);
    const b = await boxes(page);
    expect(Math.abs(b.town.t - b.add.t)).toBeLessThan(1);
    expect(b.dates.t).toBeGreaterThanOrEqual(b.town.b);
    expect(b.cats.t).toBeGreaterThanOrEqual(b.dates.b);
    expect(b.overflow).toBe(0);
  });
}

for (const width of [1024, 1280, 1366, 1440, 1920]) {
  test(`${width}px: dates sit between the town and Add an event on one row`, async ({ page }) => {
    await open(page, width);
    const b = await boxes(page);
    expect(Math.abs(b.dates.t - b.town.t)).toBeLessThan(1);
    expect(Math.abs(b.add.t - b.town.t)).toBeLessThan(1);
    expect(b.dates.l).toBeGreaterThanOrEqual(b.town.r);
    expect(b.dates.r).toBeLessThanOrEqual(b.add.l);
    expect(b.cats.t).toBeGreaterThanOrEqual(Math.max(b.dates.b, b.add.b));
    const dates = page.locator('#ev [aria-label="When"]');
    expect(await dates.evaluate(e => e.scrollWidth - e.clientWidth)).toBe(0);
    expect(b.overflow).toBe(0);
  });
}

test('1024px: a picked date still fits beside the town (the chips wrap in their column), and the filters work', async ({ page }) => {
  await open(page, 1024);
  await page.locator('#ev [aria-label="When"] button', { hasText: 'Today' }).click();
  await expect(page.locator('#ev [aria-label="When"] button', { hasText: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#ev select[aria-label="Filter events by town"]').selectOption('Henderson');
  await expect(page.locator('#ev .evx-near span')).toHaveText(/Henderson/);
  await page.locator('#ev .evx-pickw input').evaluate((i, d) => { i.value = d; i.dispatchEvent(new Event('change')); }, chi(now + 12 * 864e5).slice(0, 10));
  await expect(page.locator('#ev .evx-pick')).toHaveAttribute('aria-pressed', 'true');
  const b = await boxes(page);
  expect(b.dates.l).toBeGreaterThanOrEqual(b.town.r);
  expect(b.dates.r).toBeLessThanOrEqual(b.add.l);
  expect(await page.locator('#ev [aria-label="When"]').evaluate(e => e.scrollWidth - e.clientWidth)).toBe(0);
  expect(b.overflow).toBe(0);
  await page.locator('#ev .evx-head .cl-go').click();
  await expect(page.locator('#ev .evx-head .cl-go')).toHaveText('Cancel');
  await page.locator('#ev .evx-head .cl-go').click();
  await expect(page.locator('#ev .evx-head .cl-go')).toHaveText('Add an event');
});
