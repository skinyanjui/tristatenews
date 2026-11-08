// Classifieds category chips: one horizontal row, 44px taps, scroll to the last chip, no page overflow.
// Listings and marketplace are mocked; nothing is written.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const ART = '/opt/cursor/artifacts';
fs.mkdirSync(ART, { recursive: true });
const MK = 'https://www.tristatemarketplace.com';
const CATS = ['Furniture', 'Electronics', 'Vehicles', 'Tools', 'Home & garden', 'Clothing', 'Sports & outdoors', 'Toys & kids', 'Other'];
const NATIVE = CATS.map((c, i) => ({
  id: 'n' + String(i).padStart(5, '0') + 'ab',
  title: c + ' listing',
  price: String(10 + i),
  town: 'Evansville',
  desc: 'A ' + c + ' post.',
  contact: '812-555-0100',
  category: c,
  at: new Date().toISOString()
}));
const MARKET = [{
  id: 'mk-a', url: MK + '/listing/a', title: 'Wanted: extra chair', price: '$20',
  town: 'Henderson, KY', desc: 'One chair.', srcCategory: 'Furniture', category: 'Furniture', image: ''
}];

async function stub(page) {
  await page.route(/\/api\/news(\?|$)/, route => route.fulfill({ json: { updatedAt: new Date().toISOString(), sources: [], items: [] } }));
  await page.route(/\/api\/listings\?kind=item$/, route => route.fulfill({ json: { configured: true, items: NATIVE } }));
  await page.route(/\/api\/market$/, route => route.fulfill({
    json: { ok: true, stale: false, fetchedAt: new Date().toISOString(), source: { name: 'tristatemarketplace.com', url: MK + '/' }, items: MARKET }
  }));
}

async function chipMetrics(page) {
  return page.evaluate(() => {
    const row = document.querySelector('#cl > .cl-chips');
    const chips = row ? [...row.querySelectorAll('.cl-chip')] : [];
    const r = el => el.getBoundingClientRect();
    const rowBox = row ? r(row) : null;
    const tops = chips.map(c => Math.round(r(c).top));
    const last = chips[chips.length - 1];
    const first = chips[0];
    return {
      count: chips.length,
      labels: chips.map(c => c.textContent.trim()),
      pressed: chips.filter(c => c.getAttribute('aria-pressed') === 'true').map(c => c.textContent.trim()),
      aria: row ? row.getAttribute('aria-label') : null,
      wrap: tops.length ? Math.max(...tops) - Math.min(...tops) > 8 : false,
      chipH: first ? Math.round(r(first).height) : 0,
      rowH: rowBox ? Math.round(rowBox.height) : 0,
      overflowX: row ? row.scrollWidth - row.clientWidth : 0,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      lastFullyVisible: last && rowBox ? r(last).right <= rowBox.right + 2 : false,
      firstTop: tops[0] || 0
    };
  });
}

async function scrollRowToEnd(page) {
  return page.evaluate(() => {
    const row = document.querySelector('#cl > .cl-chips');
    if (!row) return null;
    row.scrollLeft = row.scrollWidth;
    const last = row.querySelectorAll('.cl-chip');
    const chip = last[last.length - 1];
    const rb = row.getBoundingClientRect(), lb = chip.getBoundingClientRect();
    return {
      lastLabel: chip.textContent.trim(),
      lastFullyVisible: lb.right <= rb.right + 2,
      pageOverflow: document.documentElement.scrollWidth - innerWidth
    };
  });
}

const VIEWPORTS = [
  { width: 320, height: 900, name: '320' },
  { width: 390, height: 900, name: '390' },
  { width: 430, height: 900, name: '430' },
  { width: 1280, height: 900, name: '1280' }
];

for (const dark of [false, true]) {
  for (const vp of VIEWPORTS) {
    test(`${dark ? 'dark' : 'light'} ${vp.name}px: one category row, 44px, last chip reachable, no page overflow`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await stub(page);
      await page.goto('/classifieds');
      const row = page.locator('#cl > .cl-chips');
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('aria-label', 'Category');
      const m = await chipMetrics(page);
      expect(m.count).toBe(1 + CATS.length);
      expect(m.labels[0]).toBe('All');
      expect(m.labels[m.labels.length - 1]).toBe('Other');
      expect(m.pressed).toEqual(['All']);
      expect(m.wrap).toBe(false);
      expect(m.chipH).toBeGreaterThanOrEqual(44);
      expect(m.rowH).toBeLessThan(m.chipH + 16);
      expect(m.pageOverflow).toBe(0);
      if (vp.width <= 430) expect(m.overflowX).toBeGreaterThan(0);
      const end = await scrollRowToEnd(page);
      expect(end.lastLabel).toBe('Other');
      expect(end.lastFullyVisible).toBe(true);
      expect(end.pageOverflow).toBe(0);
      const tag = (dark ? 'dark' : 'light') + '-' + vp.name;
      await page.screenshot({ path: ART + '/classifieds-chip-row-' + tag + '-end.png', fullPage: false });
      await page.locator('#cl > .cl-chips .cl-chip', { hasText: 'All' }).evaluate(el => { el.scrollIntoView({ inline: 'start', block: 'nearest' }); });
      await page.screenshot({ path: ART + '/classifieds-chip-row-' + tag + '.png', fullPage: false });
    });
  }
}

test('390px: selecting the last category filters, keeps one row, and keyboard focus reaches it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page);
  await page.goto('/classifieds');
  const other = page.locator('#cl > .cl-chips .cl-chip', { hasText: 'Other' });
  await other.click();
  await expect(other).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#cl > .cl-chips .cl-chip', { hasText: 'All' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#cl .row-item:not(.row-mk)')).toHaveCount(1);
  await expect(page.locator('#cl')).toContainText('Other listing');
  await expect(page.locator('#cl')).not.toContainText('Furniture listing');
  const after = await chipMetrics(page);
  expect(after.wrap).toBe(false);
  expect(after.pressed).toEqual(['Other']);
  expect(after.pageOverflow).toBe(0);
  await page.screenshot({ path: ART + '/classifieds-chip-row-390-selected.png', fullPage: false });
  await page.locator('#cl > .cl-chips .cl-chip', { hasText: 'All' }).click();
  await expect(page.locator('#cl .row-item:not(.row-mk)')).toHaveCount(CATS.length);
  await page.locator('#cl > .cl-chips .cl-chip', { hasText: 'All' }).focus();
  for (let i = 0; i < CATS.length; i++) await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    const row = document.querySelector('#cl > .cl-chips');
    if (!el || !row || !row.contains(el)) return null;
    const rb = row.getBoundingClientRect(), lb = el.getBoundingClientRect();
    return { label: el.textContent.trim(), inView: lb.left >= rb.left - 2 && lb.right <= rb.right + 2 };
  });
  expect(focused).toEqual({ label: 'Other', inView: true });
  await page.screenshot({ path: ART + '/classifieds-chip-row-390-focus.png', fullPage: false });
});
