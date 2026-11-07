// Classifieds empty-state, wanted amounts, sample-ad wrap, and classifieds-scoped 44px controls.
// Marketplace and native listings are mocked; nothing reaches the store or tristatemarketplace.com.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const MK = 'https://www.tristatemarketplace.com';
const WANTED = [
  { id: 'mk-a', url: MK + '/listing/a', title: 'Wanted: 16ft utility trailer, tilt or ramp', price: '$2500', town: 'Henderson, KY', desc: 'Tilt or ramp.', srcCategory: 'Trailers', category: 'Trailers', image: '' },
  { id: 'mk-b', url: MK + '/listing/b', title: 'Wanted: riding mower', price: '$900', town: 'Newburgh, IN', desc: 'Any running mower.', srcCategory: 'Lawn & garden', category: 'Lawn & garden', image: '' }
];
const REST = Array.from({ length: 31 }, (_, i) => ({
  id: 'mk-n' + i, url: MK + '/listing/n' + i, title: 'Sample listing number ' + i, price: '$' + (20 + i),
  town: i % 2 ? 'Newburgh, IN' : 'Evansville, IN', desc: 'Fixture listing ' + i + '.', srcCategory: 'Furniture', category: 'Furniture', image: ''
}));
const ITEMS = WANTED.concat(REST);
const NATIVE = [{ id: 'n1abcdef', title: 'Oak kitchen table', price: '80', town: 'Evansville', desc: 'Seats four.', contact: '812-555-0100', category: 'Furniture', at: new Date().toISOString() }];
const ART = '/opt/cursor/artifacts';
fs.mkdirSync(ART, { recursive: true });

async function stub(page, native, market) {
  await page.route(/\/api\/news(\?|$)/, route => route.fulfill({ json: { updatedAt: new Date().toISOString(), sources: [], items: [] } }));
  await page.route(/\/api\/listings\?kind=item$/, route => route.fulfill({ json: { configured: true, items: native } }));
  await page.route(/\/api\/market$/, route => market
    ? route.fulfill({ json: market })
    : route.fulfill({ status: 502, body: '' }));
}

function marketOk(items) {
  return { ok: true, stale: false, fetchedAt: new Date().toISOString(), source: { name: 'tristatemarketplace.com', url: MK + '/' }, items };
}

async function measure(page) {
  return page.evaluate(() => {
    const sel = document.querySelector('#cl .cl-bar select');
    const btn = document.querySelector('#cl .cl-bar > .cl-go');
    const spon = document.querySelector('#cl .spon');
    const chip = document.querySelector('#cl .cl-chip');
    const wx = document.querySelector('.wx-btn');
    const brand = document.querySelector('a.brand');
    const empty = document.querySelector('#cl > .cl-list .cl-empty');
    const r = el => el ? ({ w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }) : null;
    const cs = el => el ? getComputedStyle(el) : null;
    const selCs = cs(sel), btnCs = cs(btn);
    return {
      select: r(sel), post: r(btn), spon: r(spon), chip: r(chip), wx: r(wx),
      brand: brand ? brand.textContent.trim() : '',
      emptyText: empty ? empty.textContent.trim() : null,
      sponOverflow: spon ? Math.max(0, spon.scrollWidth - spon.clientWidth) : 0,
      sponWrap: spon ? getComputedStyle(spon).whiteSpace : null,
      selectWidthPct: sel && btn ? sel.getBoundingClientRect().width / document.querySelector('#cl .cl-bar').getBoundingClientRect().width : 0,
      heightsMatch: sel && btn ? Math.abs(sel.getBoundingClientRect().height - btn.getBoundingClientRect().height) < 1 : false,
      appearance: selCs ? selCs.appearance || selCs.webkitAppearance : null,
      selectPadRight: selCs ? parseFloat(selCs.paddingRight) : 0,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      wantedAmt: (document.querySelector('.row-mk .mk-amt') || {}).textContent || null,
      wantedPriceClass: !!document.querySelector('.row-mk h2') && !document.querySelector('.row-mk:has(h2) .cl-price'),
      testTags: document.querySelectorAll('.row-mk .mk-tag').length,
      marketCount: document.querySelectorAll('.row-mk').length
    };
  });
}

test('empty native with 33 marketplace listings does not say nothing posted yet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page, [], marketOk(ITEMS));
  await page.goto('/classifieds');
  await expect(page.locator('.mk-sec .row-mk')).toHaveCount(33);
  await expect(page.locator('#cl')).not.toContainText('Nothing posted yet');
  await expect(page.locator('#cl')).not.toContainText('No posts on TRISTATENOW yet');
  await expect(page.locator('#cl > .cl-list .cl-empty')).toHaveCount(0);
  await expect(page.locator('.mk-sec h3')).toHaveCount(0);
  await expect(page.locator('.mk-note')).toHaveCount(0);
  await expect(page.locator('#cl')).not.toContainText('From tristatemarketplace.com');
  await expect(page.locator('#cl')).not.toContainText('Test listings from tristatemarketplace.com');
  await expect(page.locator('#cl')).not.toContainText('has not checked these listings');
  await expect(page.locator('.row-mk .mk-tag')).toHaveCount(33);
  await expect(page.locator('.row-mk .mk-amt').first()).toHaveText('$2500');
  await expect(page.locator('.row-mk').first().locator('.cl-price')).toHaveCount(0);
  await expect(page.locator('.row-mk').nth(2).locator('.cl-price')).toHaveText('$20');
  await expect(page.locator('#cl .spon')).toContainText('Hollis & Vance Plumbing');
  await expect(page.locator('#cl .spon')).toContainText('Sample ad');
  await expect(page.locator('#cl > .cl-chips')).toBeVisible();
  await expect(page.locator('.mk-sec .cl-chips')).toHaveCount(0);
  await page.screenshot({ path: ART + '/classifieds-no-heading-390.png', fullPage: true });
});

test('loading empty native does not show an overall-empty message', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route(/\/api\/news(\?|$)/, route => route.fulfill({ json: { updatedAt: new Date().toISOString(), sources: [], items: [] } }));
  await page.route(/\/api\/listings\?kind=item$/, route => route.fulfill({ json: { configured: true, items: [] } }));
  await page.route(/\/api\/market$/, async route => {
    await gate;
    await route.fulfill({ json: marketOk(ITEMS) });
  });
  await page.goto('/classifieds');
  await expect(page.locator('.mk-sec')).toContainText('Loading listings from tristatemarketplace.com');
  await expect(page.locator('#cl')).not.toContainText('Nothing posted yet');
  release();
  await expect(page.locator('.mk-sec .row-mk')).toHaveCount(33);
  await expect(page.locator('#cl')).not.toContainText('Nothing posted yet');
});

test('market error with no native posts is a native-only empty, not overall empty', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page, [], null);
  await page.goto('/classifieds');
  await expect(page.locator('.mk-sec')).toContainText('aren\u2019t available right now');
  await expect(page.locator('#cl > .cl-list .cl-empty')).toContainText('No posts on TRISTATENOW yet. Be the first.');
  await expect(page.locator('#cl')).not.toContainText('Nothing posted yet. Be the first.');
});

test('overall empty: native and marketplace both empty', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page, [], marketOk([]));
  await page.goto('/classifieds');
  await expect(page.locator('#cl > .cl-list .cl-empty')).toContainText('Nothing posted yet. Be the first.');
  await expect(page.locator('.mk-sec')).toContainText('No listings on tristatemarketplace.com right now');
});

test('native posts stay when marketplace listings are present', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page, NATIVE, marketOk(ITEMS));
  await page.goto('/classifieds');
  await expect(page.locator('#cl .row-item:not(.row-mk)', { hasText: 'Oak kitchen table' })).toBeVisible();
  await expect(page.locator('.mk-sec .row-mk')).toHaveCount(33);
  await expect(page.locator('#cl')).not.toContainText('Nothing posted yet');
});

const VIEWPORTS = [
  { width: 320, height: 900, name: '320' },
  { width: 390, height: 900, name: '390' },
  { width: 430, height: 900, name: '430' },
  { width: 1280, height: 900, name: '1280' }
];

for (const dark of [false, true]) {
  for (const vp of VIEWPORTS) {
    test(`${dark ? 'dark' : 'light'} ${vp.name}px: controls, sample ad, and screenshots`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await stub(page, [], marketOk(ITEMS));
      await page.goto('/classifieds');
      await expect(page.locator('.mk-sec .row-mk').first()).toBeVisible();
      const m = await measure(page);
      expect(m.brand).toBe('TRISTATENOW');
      expect(m.emptyText).toBeNull();
      expect(m.marketCount).toBe(33);
      expect(m.testTags).toBe(33);
      expect(m.wantedAmt).toBe('$2500');
      expect(m.select.h).toBeGreaterThanOrEqual(44);
      expect(m.post.h).toBeGreaterThanOrEqual(44);
      expect(Math.abs(m.select.h - m.post.h)).toBeLessThan(1);
      expect(m.chip.h).toBeGreaterThanOrEqual(44);
      expect(m.spon.h).toBeGreaterThanOrEqual(44);
      expect(m.sponOverflow).toBe(0);
      expect(m.pageOverflow).toBe(0);
      expect(m.select.w).toBeGreaterThan(m.post.w);
      if (vp.width <= 430) expect(m.wx.h).toBeLessThan(m.select.h + 1);
      const tag = (dark ? 'dark' : 'light') + '-' + vp.name;
      await page.screenshot({ path: ART + '/classifieds-after-' + tag + '.png', fullPage: true });
      await page.locator('#cl .cl-bar select').focus();
      await page.screenshot({ path: ART + '/classifieds-after-' + tag + '-focus.png', fullPage: false });
    });
  }
}
