// Jobs and Deals reader boards: labeled samples with images, one-row chips, 44px Post, demo-only apply/report/feature.
// Listings GET is mocked empty; samples are client-side. POST/checkout are intercepted so nothing is written.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const ART = '/opt/cursor/artifacts';
fs.mkdirSync(ART, { recursive: true });

async function stub(page) {
  const hits = [];
  await page.route(/\/api\/news(\?|$)/, route => route.fulfill({ json: { updatedAt: new Date().toISOString(), sources: [], items: [] } }));
  await page.route(/\/api\/listings(\?|$)/, route => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'POST') {
      hits.push('POST');
      return route.fulfill({ status: 204, body: '' });
    }
    if (/kind=job/.test(url)) return route.fulfill({ json: { configured: true, items: [] } });
    if (/kind=deal/.test(url)) return route.fulfill({ json: { configured: true, items: [] } });
    return route.continue();
  });
  await page.route(/\/api\/checkout/, route => {
    hits.push('CHECKOUT');
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route(/\/api\/advertise/, route => {
    hits.push('ADVERTISE');
    return route.fulfill({ json: { ok: false } });
  });
  return hits;
}

async function measure(page, root) {
  return page.evaluate(sel => {
    const btn = document.querySelector(sel + ' .cl-bar > .cl-go');
    const chip = document.querySelector(sel + ' .cl-chip');
    const wx = document.querySelector('.wx-btn');
    const tab = document.querySelector(sel === '#jb' ? '#tab-jobs' : '#tab-deals');
    const r = el => el ? Math.round(el.getBoundingClientRect().height) : null;
    return {
      post: r(btn),
      chip: r(chip),
      wx: r(wx),
      tabLabel: tab ? tab.textContent.trim() : null,
      brand: (document.querySelector('a.brand') || {}).textContent.trim()
    };
  }, root);
}

async function chipMetrics(page, sel) {
  return page.evaluate(s => {
    const row = document.querySelector(s);
    const chips = row ? [...row.querySelectorAll('.cl-chip')] : [];
    const r = el => el.getBoundingClientRect();
    const rowBox = row ? r(row) : null;
    const tops = chips.map(c => Math.round(r(c).top));
    const last = chips[chips.length - 1];
    return {
      count: chips.length,
      labels: chips.map(c => c.textContent.trim()),
      wrap: tops.length ? Math.max(...tops) - Math.min(...tops) > 8 : false,
      chipH: chips[0] ? Math.round(r(chips[0]).height) : 0,
      overflowX: row ? row.scrollWidth - row.clientWidth : 0,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      lastFullyVisible: last && rowBox ? r(last).right <= rowBox.right + 4 || (row.scrollWidth - row.clientWidth - row.scrollLeft < 2) : false,
      wrapStyle: row ? getComputedStyle(row).flexWrap : null
    };
  }, sel);
}

const BOARDS = [
  { path: '/jobs', root: '#jb', tab: 'Jobs', post: 'Post a job', form: 'Job title', row: '.row-job', catSel: '#jb > .cl-chips', lastCat: 'Other', sampleNote: 'Not a real opening' },
  { path: '/deals', root: '#dl', tab: 'Deals', post: 'Post a deal', form: 'Business', row: '.row-deal', catSel: '#dl > .cl-chips', lastCat: 'Other', sampleNote: 'Not a real offer' }
];
const VIEWPORTS = [
  { width: 320, height: 900, name: '320' },
  { width: 390, height: 900, name: '390' },
  { width: 430, height: 900, name: '430' },
  { width: 1280, height: 900, name: '1280' }
];

for (const board of BOARDS) {
  for (const dark of [false, true]) {
    for (const vp of VIEWPORTS) {
      test(`${board.tab} ${dark ? 'dark' : 'light'} ${vp.name}px: labeled samples, one category row, no writes`, async ({ page }) => {
        const hits = await stub(page);
        await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(board.path);
        const tab = page.locator('#tab-' + board.tab.toLowerCase());
        await tab.scrollIntoViewIfNeeded();
        await expect(tab).toBeVisible();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator(board.root)).toBeVisible();
        await expect(page.locator(board.root + ' ' + board.row).first()).toBeVisible();
        await expect(page.locator(board.root + ' .bd-demo').first()).toBeVisible();
        await expect(page.locator(board.root)).toContainText('Sample featured placement');
        await expect(page.locator(board.root)).not.toContainText('Featured · Paid');
        await expect(page.locator(board.root)).toContainText(board.sampleNote);
        await expect(page.locator(board.root)).not.toContainText('Nothing posted yet. Be the first.');
        await expect(page.locator(board.root + ' .cl-link')).toHaveCount(0);
        await expect(page.locator(board.root + ' .cl-feature')).toHaveCount(0);
        const m = await measure(page, board.root);
        expect(m.brand).toBe('TRISTATENOW');
        expect(m.tabLabel).toBe(board.tab);
        expect(m.post).toBeGreaterThanOrEqual(44);
        if (m.chip != null) expect(m.chip).toBeGreaterThanOrEqual(44);
        if (vp.width <= 430) expect(m.wx).toBeLessThan(m.post + 1);

        const cats = await chipMetrics(page, board.catSel);
        expect(cats.wrapStyle).not.toBe('wrap');
        expect(cats.wrap).toBe(false);
        expect(cats.chipH).toBeGreaterThanOrEqual(44);
        expect(cats.pageOverflow).toBe(0);
        expect(cats.labels[0]).toBe('All');
        expect(cats.labels[cats.labels.length - 1]).toBe(board.lastCat);
        if (vp.width <= 390) expect(cats.overflowX).toBeGreaterThan(0);
        await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
        await page.evaluate(s => {
          const row = document.querySelector(s);
          if (row) row.scrollLeft = row.scrollWidth;
        }, board.catSel);
        const end = await chipMetrics(page, board.catSel);
        expect(end.lastFullyVisible).toBe(true);
        expect(end.pageOverflow).toBe(0);
        await page.evaluate(s => { const row = document.querySelector(s); if (row) row.scrollLeft = 0; }, board.catSel);

        if (board.tab === 'Jobs') {
          const types = await chipMetrics(page, '#jb .ev-filters .cl-chips');
          expect(types.wrap).toBe(false);
          expect(types.wrapStyle).not.toBe('wrap');
          expect(types.pageOverflow).toBe(0);
          const logos = page.locator('#jb .row-job .job-logo img.bav');
          await expect(logos.first()).toBeVisible();
          expect(await logos.first().getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
          await expect(page.locator('#jb .row-job .job-when').first()).toBeVisible();
          await expect(page.locator('#jb .row-job .job-tag').first()).toBeVisible();
          await expect(page.locator('#jb .row-job .job-town').first()).toBeVisible();
          await expect(page.locator('#jb .row-job .job-foot .job-view').first()).toHaveText('View job');
          expect(await page.locator('#jb .row-job .job-view').first().evaluate(el => Math.round(el.getBoundingClientRect().height))).toBeGreaterThanOrEqual(44);
          if (vp.width >= 1024) {
            const firstThreeTops = await page.evaluate(() => [...document.querySelectorAll('#jb .row-job')].slice(0, 3).map(el => Math.round(el.getBoundingClientRect().top)));
            expect(firstThreeTops.length).toBe(3);
            expect(Math.max(...firstThreeTops) - Math.min(...firstThreeTops)).toBeLessThanOrEqual(2);
          }
        } else {
          const photos = page.locator('#dl .row-deal img.deal-img');
          await expect(photos.first()).toBeVisible();
          expect(await photos.first().getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
          await expect(page.locator('#dl .row-deal img.bav').first()).toBeVisible();
          await expect(page.locator('#dl .row-deal .deal-view').first()).toHaveText('View deal');
        }

        const tag = board.tab.toLowerCase() + '-' + (dark ? 'dark' : 'light') + '-' + vp.name;
        await page.screenshot({ path: ART + '/jobs-deals-' + tag + '.png', fullPage: true });
        expect(hits.filter(x => x === 'POST' || x === 'CHECKOUT' || x === 'ADVERTISE')).toEqual([]);
      });
    }
  }
}

test('Jobs View job opens a demo dialog; Advertise a job is in the sheet; Part-time filter works', async ({ page }) => {
  const hits = await stub(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/jobs');
  await expect(page.locator('#jb .row-job')).toHaveCount(8);
  await page.locator('#jb .cl-chip', { hasText: 'Part-time' }).click();
  await expect(page.locator('#jb .row-job')).toHaveCount(2);
  await expect(page.locator('#jb')).toContainText('Counter help');
  await expect(page.locator('#jb')).not.toContainText('Clinic nurse');
  await page.locator('#jb .cl-chip', { hasText: 'Any type' }).click();
  await expect(page.locator('#jb .row-job')).toHaveCount(8);
  const view = page.locator('#jb .row-job .job-view').first();
  await view.focus();
  await page.keyboard.press('Enter');
  const dlg = page.locator('dialog.bd-sheet');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('This is a demo listing');
  await expect(dlg).not.toContainText('Apply');
  await expect(dlg.locator('a.bd-quiet')).toHaveAttribute('href', '/advertise');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(view).toBeFocused();
  expect(hits.filter(x => x === 'POST' || x === 'CHECKOUT' || x === 'ADVERTISE')).toEqual([]);
});

test('Deals View deal opens a demo dialog; Food & drink filter works; Post form does not submit', async ({ page }) => {
  const hits = await stub(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/deals');
  await expect(page.locator('#dl .row-deal')).toHaveCount(8);
  await page.locator('#dl .cl-chip', { hasText: 'Food & drink' }).click();
  await expect(page.locator('#dl .row-deal')).toHaveCount(2);
  await page.locator('#dl .cl-chip', { hasText: 'All' }).click();
  await expect(page.locator('#dl .row-deal')).toHaveCount(8);
  await page.locator('#dl .row-deal .deal-view').first().click();
  const dlg = page.locator('dialog.bd-sheet');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('This is a demo listing');
  await expect(dlg).toContainText('WREN2');
  await expect(dlg).not.toContainText('Copy code');
  await expect(dlg).not.toContainText('Get offer');
  await dlg.locator('.bd-x').click();
  await expect(dlg).toHaveCount(0);
  await page.locator('#dl .cl-bar > .cl-go').click();
  await expect(page.locator('#dl form.cl-form')).toBeVisible();
  await expect(page.locator('#dl form.cl-form')).toContainText('Business');
  await expect(page.locator('#dl form.cl-form')).toContainText('18 or older');
  await page.screenshot({ path: ART + '/jobs-deals-deals-390-form.png', fullPage: true });
  expect(hits.filter(x => x === 'POST' || x === 'CHECKOUT' || x === 'ADVERTISE')).toEqual([]);
});
