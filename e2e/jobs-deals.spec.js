// Jobs and Deals reader boards: tabs, empty copy, 44px Post controls, form fields.
// Listings GET is mocked; POST is intercepted so nothing is written.
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
  { path: '/jobs', root: '#jb', tab: 'Jobs', post: 'Post a job', empty: 'Nothing posted yet. Be the first.', form: 'Job title' },
  { path: '/deals', root: '#dl', tab: 'Deals', post: 'Post a deal', empty: 'Nothing posted yet. Be the first.', form: 'Business' }
]) {
  for (const vp of [{ width: 390, height: 900, name: '390' }, { width: 1280, height: 900, name: '1280' }]) {
    test(`${board.tab} ${vp.name}px: tab, empty board, 44px Post, form without submitting`, async ({ page }) => {
      const posts = await stub(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(board.path);
      const tab = page.locator('#tab-' + board.tab.toLowerCase());
      await tab.scrollIntoViewIfNeeded();
      await expect(tab).toBeVisible();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator(board.root)).toBeVisible();
      await expect(page.locator(board.root)).toContainText(board.empty);
      await expect(page.locator(board.root + ' .cl-bar > .cl-go')).toHaveText(board.post);
      const m = await measure(page, board.root);
      expect(m.brand).toBe('TRISTATENOW');
      expect(m.tabLabel).toBe(board.tab);
      expect(m.post).toBeGreaterThanOrEqual(44);
      if (m.chip != null) expect(m.chip).toBeGreaterThanOrEqual(44);
      if (vp.width <= 430) expect(m.wx).toBeLessThan(m.post + 1);
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
