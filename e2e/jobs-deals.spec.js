// Jobs and Deals reader boards: tabs, labeled samples with images, 44px Post controls, form fields.
// Listings GET is mocked empty; samples are client-side. POST is intercepted so nothing is written.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const ART = '/opt/cursor/artifacts';
fs.mkdirSync(ART, { recursive: true });

async function stub(page) {
  const posts = [];
  await page.route(/\/api\/news(\?|$)/, route => route.fulfill({ json: { updatedAt: new Date().toISOString(), sources: [], items: [] } }));
  await page.route(/\/api\/listings\?kind=job$/, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, items: [] } });
    posts.push(route.request().url());
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route(/\/api\/listings\?kind=deal$/, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, items: [] } });
    posts.push(route.request().url());
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route(/\/api\/listings$/, route => {
    if (route.request().method() === 'POST') {
      posts.push('POST');
      return route.fulfill({ status: 204, body: '' });
    }
    return route.continue();
  });
  return posts;
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

for (const board of [
  { path: '/jobs', root: '#jb', tab: 'Jobs', post: 'Post a job', form: 'Job title', row: '.row-job' },
  { path: '/deals', root: '#dl', tab: 'Deals', post: 'Post a deal', form: 'Business', row: '.row-deal' }
]) {
  for (const vp of [{ width: 390, height: 900, name: '390' }, { width: 1280, height: 900, name: '1280' }]) {
    test(`${board.tab} ${vp.name}px: samples with images, 44px Post, form without submitting`, async ({ page }) => {
      const posts = await stub(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(board.path);
      const tab = page.locator('#tab-' + board.tab.toLowerCase());
      await tab.scrollIntoViewIfNeeded();
      await expect(tab).toBeVisible();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator(board.root)).toBeVisible();
      await expect(page.locator(board.root + ' ' + board.row).first()).toBeVisible();
      await expect(page.locator(board.root + ' .mk-tag', { hasText: 'Sample' }).first()).toBeVisible();
      await expect(page.locator(board.root)).toContainText('Featured · Paid');
      await expect(page.locator(board.root)).not.toContainText('Nothing posted yet. Be the first.');
      await expect(page.locator(board.root + ' .cl-bar > .cl-go')).toHaveText(board.post);
      const m = await measure(page, board.root);
      expect(m.brand).toBe('TRISTATENOW');
      expect(m.tabLabel).toBe(board.tab);
      expect(m.post).toBeGreaterThanOrEqual(44);
      if (m.chip != null) expect(m.chip).toBeGreaterThanOrEqual(44);
      if (vp.width <= 430) expect(m.wx).toBeLessThan(m.post + 1);

      if (board.tab === 'Jobs') {
        const logos = page.locator('#jb .row-job img.bav');
        await expect(logos.first()).toBeVisible();
        const src = await logos.first().getAttribute('src');
        expect(src).toMatch(/^data:image\/svg\+xml/);
        await expect(page.locator('#jb .row-job .ad-cta').first()).toHaveAttribute('href', '/advertise');
        await expect(page.locator('#jb .row-job .ad-cta').first()).toHaveText('Apply');
        await expect(page.locator('#jb .cl-chip', { hasText: 'Part-time' })).toBeVisible();
        await page.locator('#jb .cl-chip', { hasText: 'Part-time' }).click();
        await expect(page.locator('#jb .row-job')).toHaveCount(2);
        await expect(page.locator('#jb')).toContainText('Counter help');
        await expect(page.locator('#jb')).not.toContainText('Clinic nurse');
        await page.locator('#jb .cl-chip', { hasText: 'Any type' }).click();
        await expect(page.locator('#jb .row-job')).toHaveCount(8);
      } else {
        const photos = page.locator('#dl .row-deal img.th');
        await expect(photos.first()).toBeVisible();
        const src = await photos.first().getAttribute('src');
        expect(src).toMatch(/^data:image\/svg\+xml/);
        await expect(page.locator('#dl .row-deal img.bav').first()).toBeVisible();
        await expect(page.locator('#dl .deal-code code').first()).toHaveText('WREN2');
        await expect(page.locator('#dl .cl-chip', { hasText: 'Food & drink' })).toBeVisible();
        await page.locator('#dl .cl-chip', { hasText: 'Food & drink' }).click();
        await expect(page.locator('#dl .row-deal')).toHaveCount(2);
        await page.locator('#dl .cl-chip', { hasText: 'All' }).click();
        await expect(page.locator('#dl .row-deal')).toHaveCount(8);
      }

      const ad = page.locator(board.root + ' .ad-row, ' + board.root + ' .ad-card');
      await expect(ad.first()).toBeVisible();
      await expect(ad.first()).toContainText('Sample ad');

      await page.screenshot({ path: ART + '/jobs-deals-' + board.tab.toLowerCase() + '-' + vp.name + '.png', fullPage: true });
      await page.locator(board.root + ' .cl-bar > .cl-go').click();
      await expect(page.locator(board.root + ' form.cl-form')).toBeVisible();
      await expect(page.locator(board.root + ' form.cl-form')).toContainText(board.form);
      await expect(page.locator(board.root + ' form.cl-form')).toContainText('18 or older');
      await page.screenshot({ path: ART + '/jobs-deals-' + board.tab.toLowerCase() + '-' + vp.name + '-form.png', fullPage: true });
      expect(posts.filter(x => x === 'POST')).toEqual([]);
    });
  }
}
