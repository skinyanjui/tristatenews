// ship100: on Events the date chips share the town row from 1024px (the central column is 896px+ there, side ads or not)
// and keep their own row below it on phones and tablets. No overlap, no page overflow, and the filters still work.
// The event listings are mocked (two towns, so the town menu is a real select); nothing is posted.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const ART = '/opt/cursor/artifacts';
fs.mkdirSync(ART, { recursive: true });

const chi = ms => new Date(ms).toLocaleString('en-CA', { timeZone: 'America/Chicago', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const ev = (i, title, town, ms, category) => { const [d, t] = chi(ms).split(', '); return { id: 'e2e1000' + i, title, town, desc: 'A local community event.', contact: '812-555-0111', category: category || 'Community', date: d, time: t.replace(/^24/, '00'), place: 'Central Library', at: new Date().toISOString() }; };
const now = Date.now();
const EVENTS = [
  ev(1, 'Evening chess club', 'Evansville', now + 2 * 36e5, 'Community'),
  ev(2, 'Riverfront bake sale', 'Henderson', now + 26 * 36e5, 'Food & drink'),
  ev(3, 'Library story time', 'Evansville', now + 50 * 36e5, 'Family'),
  ev(4, 'River jazz night', 'Owensboro', now + 8 * 36e5, 'Music'),
  ev(5, 'Aces watch party', 'Evansville', now + 30 * 36e5, 'Sports'),
  ev(6, 'Gallery walk', 'Henderson', now + 54 * 36e5, 'Arts'),
  ev(7, 'Swap meet', 'Newburgh', now + 78 * 36e5, 'Other')
];

async function open(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.route(/\/api\/news(\?|$)/, route => route.fulfill({ json: { updatedAt: new Date().toISOString(), sources: [], items: [] } }));
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
    expect(await dates.evaluate(e => getComputedStyle(e).flexWrap)).not.toBe('wrap');
    expect(await dates.evaluate(e => {
      const chips = [...e.querySelectorAll('.cl-chip')];
      const tops = chips.map(c => Math.round(c.getBoundingClientRect().top));
      return { wrap: tops.length ? Math.max(...tops) - Math.min(...tops) > 8 : false, h: Math.round(e.getBoundingClientRect().height) };
    })).toEqual(expect.objectContaining({ wrap: false }));
    expect(b.overflow).toBe(0);
  });
}

test('1024px: a picked date still fits beside the town (the chips stay one row in their column), and the filters work', async ({ page }) => {
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
  expect(await page.locator('#ev [aria-label="When"]').evaluate(e => getComputedStyle(e).flexWrap)).not.toBe('wrap');
  expect(b.overflow).toBe(0);
  await page.locator('#ev .evx-head .cl-go').click();
  await expect(page.locator('#ev .evx-head .cl-go')).toHaveText('Cancel');
  await page.locator('#ev .evx-head .cl-go').click();
  await expect(page.locator('#ev .evx-head .cl-go')).toHaveText('Add an event');
});

async function rowMetrics(page, sel) {
  return page.evaluate(s => {
    const row = document.querySelector(s);
    const chips = row ? [...row.querySelectorAll('.cl-chip')] : [];
    const r = el => el.getBoundingClientRect();
    const rowBox = row ? r(row) : null;
    const tops = chips.map(c => Math.round(r(c).top));
    const last = chips[chips.length - 1];
    return {
      count: chips.length,
      wrap: tops.length ? Math.max(...tops) - Math.min(...tops) > 8 : false,
      chipH: chips[0] ? Math.round(r(chips[0]).height) : 0,
      overflowX: row ? row.scrollWidth - row.clientWidth : 0,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      lastFullyVisible: last && rowBox ? r(last).right <= rowBox.right + 4 || (row.scrollWidth - row.clientWidth - row.scrollLeft < 2) : false,
      wrapStyle: row ? getComputedStyle(row).flexWrap : null
    };
  }, sel);
}

for (const dark of [false, true]) {
  for (const vp of [{ width: 320, name: '320' }, { width: 390, name: '390' }, { width: 430, name: '430' }, { width: 1280, name: '1280' }]) {
    test(`${dark ? 'dark' : 'light'} ${vp.name}px: Events When and Category stay one row, last chip reachable, no page overflow`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await open(page, vp.width);
      for (const sel of ['#ev [aria-label="When"]', '#ev [aria-label="Category"]']) {
        const m = await rowMetrics(page, sel);
        expect(m.wrapStyle).not.toBe('wrap');
        expect(m.wrap).toBe(false);
        expect(m.chipH).toBeGreaterThanOrEqual(44);
        expect(m.pageOverflow).toBe(0);
        if (sel.includes('Category') && vp.width <= 430) expect(m.overflowX).toBeGreaterThan(0);
        await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
        await page.evaluate(s => {
          const row = document.querySelector(s);
          if (row) row.scrollLeft = row.scrollWidth;
        }, sel);
        const end = await rowMetrics(page, sel);
        expect(end.lastFullyVisible).toBe(true);
        expect(end.pageOverflow).toBe(0);
        await page.evaluate(s => { const row = document.querySelector(s); if (row) row.scrollLeft = 0; }, sel);
      }
      await page.screenshot({ path: ART + '/events-chip-row-' + (dark ? 'dark' : 'light') + '-' + vp.name + '.png', fullPage: false });
    });
  }
}

test('News and Obituaries have no in-page category chip row', async ({ page }) => {
  await page.route(/\/api\/news(\?|$)/, route => route.fulfill({ json: { updatedAt: new Date().toISOString(), sources: [], items: [] } }));
  await page.route(/\/api\/listings\?kind=obit$/, route => route.fulfill({ json: { configured: true, items: [] } }));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  await expect(page.locator('#tab-news')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#list')).toBeVisible();
  await expect(page.locator('#list .cl-chips')).toHaveCount(0);
  await page.goto('/obituaries');
  await expect(page.locator('#ob')).toBeVisible();
  await expect(page.locator('#ob .cl-chips')).toHaveCount(0);
});
