// ship122: social/psych audit — empty Jobs/Deals, comment norms, larger text, borderless reactions, end card.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const ART = '/opt/cursor/artifacts';
fs.mkdirSync(ART, { recursive: true });

const T0 = Date.parse('2026-11-09T22:00:00Z');
const STORIES = Array.from({ length: 4 }, (_, i) => ({
  id: 'fix-story-' + i,
  title: 'EXAMPLE · Fixture story ' + (i + 1) + ' for the end-of-deck card',
  summary: 'Fixture summary. Not real news.',
  link: 'https://www.14news.com/fixture-story-' + i + '/',
  image: '',
  source: 'Fixture Desk',
  sourceId: 'fix',
  published: new Date(T0 - (i + 1) * 3600 * 1000).toISOString()
}));

async function stubNews(page, items) {
  await page.route(/\/api\/news(\?|$)/, route => route.fulfill({
    json: {
      updatedAt: new Date().toISOString(),
      sources: [{ id: 'fix', name: 'Fixture Desk', kind: 'news' }],
      items: items || STORIES
    }
  }));
  await page.route(/\/api\/listings(\?|$)/, route => {
    const url = route.request().url();
    if (/kind=job/.test(url) || /kind=deal/.test(url)) {
      return route.fulfill({ json: { configured: true, items: [] } });
    }
    return route.fulfill({ json: { configured: true, items: [] } });
  });
  await page.route(/\/api\/comments/, async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { configured: true, allowed: true, comments: [], count: 0, total: 0 } });
    }
    const body = route.request().postDataJSON() || {};
    if (body.action === 'ready') return route.fulfill({ json: { ready: true } });
    return route.fulfill({ json: { ok: true } });
  });
}

test('ship122: empty Jobs board leads with empty state then labeled examples', async ({ page }) => {
  await stubNews(page);
  await page.goto('/jobs');
  await expect(page.locator('#jb .cl-empty')).toContainText('No local listings yet. Post the first one');
  await expect(page.locator('#jb .cl-examples')).toHaveText('Examples of what listings look like');
  await expect(page.locator('#jb .job.row-job')).toHaveCount(8);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#jb').screenshot({ path: ART + '/ship122-jobs-empty-390.png' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#jb').screenshot({ path: ART + '/ship122-jobs-empty-1280.png' });
});

test('ship122: comment norms visible; reaction buttons borderless; larger text toggle', async ({ page }) => {
  await stubNews(page);
  await page.goto('/');
  await page.evaluate(() => { try { localStorage.setItem('tsn.theme', 'light'); } catch (e) {} });
  await page.reload();
  const card = page.locator('article.card.news-story').first();
  await expect(card).toBeVisible();
  const buttons = card.locator('.ns-foot :is(.like, .share, .cm-btn, .sv-btn)');
  await expect(buttons).toHaveCount(4);
  const styles = await buttons.evaluateAll(els => els.map(el => {
    const s = getComputedStyle(el);
    return {
      borderWidth: s.borderWidth,
      borderStyle: s.borderStyle,
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      boxShadow: s.boxShadow
    };
  }));
  for (const s of styles) {
    expect(s.borderWidth === '0px' || s.borderStyle === 'none').toBeTruthy();
    expect(s.outlineStyle === 'none' || s.outlineWidth === '0px').toBeTruthy();
    expect(s.boxShadow === 'none').toBeTruthy();
  }
  const acts = card.locator('.ns-foot .acts').first();
  const actsBorder = await acts.evaluate(el => {
    const s = getComputedStyle(el);
    return { borderWidth: s.borderWidth, borderStyle: s.borderStyle, boxShadow: s.boxShadow };
  });
  expect(actsBorder.borderWidth === '0px' || actsBorder.borderStyle === 'none').toBeTruthy();
  expect(actsBorder.boxShadow).toBe('none');

  await card.locator('.cm-btn').click();
  await expect(page.locator('.cm-norms')).toContainText('Comments are public and anonymous');
  await expect(page.locator('.cm-norms a')).toHaveAttribute('href', '/legal');
  await expect(page.locator('.cm-own')).toContainText('Only this browser can delete its comments');
  await page.locator('dialog.cm-sheet .st-x').click();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#textBtn').click();
  await expect(page.locator('html')).toHaveClass(/text-lg/);
  const size = await page.evaluate(() => getComputedStyle(document.body).fontSize);
  expect(size).toBe('16px');
});

test('ship122: end-of-deck shows caught-up card', async ({ page }) => {
  await stubNews(page, STORIES);
  await page.goto('/');
  await page.locator('article.card.news-story a.ca').first().click();
  const sheet = page.locator('dialog.st-sheet');
  await expect(sheet).toBeVisible();
  for (let i = 0; i < STORIES.length; i++) {
    await sheet.locator('.st-next').click();
    await page.waitForTimeout(500);
  }
  await expect(sheet.locator('.st-caught h2')).toHaveText(/caught up/i);
  await expect(sheet.getByRole('button', { name: 'Back to top' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Show older stories' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await sheet.screenshot({ path: ART + '/ship122-caught-up-390.png' });
});
