// Public comments + Saved articles. Listings/news GET mocked; fixtures are fixtures, not real news.
// Redis unset. No crawl/refresh/production writes. Bounding rects vs card and viewport.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const ART = '/opt/cursor/artifacts';
fs.mkdirSync(ART, { recursive: true });
const FIXDIR = '/workspace/docs/superpowers/fixtures/news-comments-bookmarks';
fs.mkdirSync(FIXDIR, { recursive: true });

const T0 = Date.parse('2026-11-08T22:00:00Z');
const FIX = {
  id: 'fixture-news-01',
  title: 'EXAMPLE · NOT REAL NEWS — Long fixture headline about the riverfront redevelopment',
  summary: 'Fixture summary used only to check comments and Saved. This is not a republished article.',
  more: 'Fixture summary used only to check comments and Saved. This is not a republished article. Extra feed text so the sheet has something to scroll.',
  link: 'https://www.14news.com/fixture-news-01/',
  image: 'https://img.example.test/river.jpg',
  source: 'Fixture Desk',
  sourceId: 'fix',
  published: new Date(T0 - 12 * 6e4).toISOString(),
  cat: 'Local'
};
const NOIMG = {
  id: 'fixture-news-02',
  title: 'EXAMPLE · Fixture story with no photograph',
  summary: 'Compact layout fixture. Not real news.',
  link: 'https://www.14news.com/fixture-news-02/',
  image: '',
  source: 'Fixture Desk',
  sourceId: 'fix',
  published: new Date(T0 - 40 * 6e4).toISOString()
};
const CRIME = {
  id: 'fixture-news-crime',
  title: 'EXAMPLE · Man arrested downtown after overnight chase',
  summary: 'Crime fixture: comments must stay off. Not real news.',
  link: 'https://www.14news.com/fixture-crime/',
  image: 'https://img.example.test/river.jpg',
  source: 'Fixture Desk',
  sourceId: 'fix',
  published: new Date(T0 - 80 * 6e4).toISOString()
};
const HOMICIDE = {
  id: 'fixture-news-homicide',
  title: 'Woman allegedly killed by husband texted sister she was \u2018not good\u2019 days before her body was found',
  summary: 'Homicide fixture: comments must stay off. Not real news.',
  link: 'https://www.14news.com/fixture-homicide/',
  image: 'https://img.example.test/mug.jpg',
  source: 'Fixture Desk',
  sourceId: 'fix',
  published: new Date(T0 - 85 * 6e4).toISOString()
};
const SPORT = {
  id: 'fixture-news-sport',
  title: 'EXAMPLE · Pacers kill off the Heat in overtime',
  summary: 'Sports fixture: comments stay on. Not real news.',
  link: 'https://www.14news.com/fixture-sport/',
  image: 'https://img.example.test/river.jpg',
  source: 'Fixture Desk',
  sourceId: 'fix',
  published: new Date(T0 - 50 * 6e4).toISOString()
};
const WEATHER = {
  id: 'fixture-news-weather',
  title: 'EXAMPLE · Storm kills 3 in western Kentucky after overnight flooding',
  summary: 'Weather fixture: comments stay on. Not real news.',
  link: 'https://www.14news.com/fixture-weather/',
  image: 'https://img.example.test/river.jpg',
  source: 'Fixture Desk',
  sourceId: 'fix',
  published: new Date(T0 - 55 * 6e4).toISOString()
};
const POLICE = {
  id: 'fixture-police-01',
  title: 'EXAMPLE · Annual report published',
  summary: 'Police fixture. Not real news.',
  link: 'https://police.example.test/report',
  image: 'https://img.example.test/mug.jpg',
  source: 'Fixture PD',
  sourceId: 'pd',
  arrest: true,
  published: new Date(T0 - 90 * 6e4).toISOString()
};
const SOURCES = [
  { id: 'fix', name: 'Fixture Desk', kind: 'news', logo: '', ok: true, count: 6 },
  { id: 'pd', name: 'Fixture PD', kind: 'police', logo: '', ok: true, count: 1 }
];

const comments = {};
function commentId() { return 'c' + Math.random().toString(36).slice(2, 10); }

async function stub(page, items, opts) {
  Object.keys(comments).forEach(k => { delete comments[k]; });
  opts = opts || {};
  if (!opts.readyCalls) opts.readyCalls = { n: 0 };
  await page.route(url => !/^http:\/\/(127\.0\.0\.1|localhost)/.test(url.href) && !url.href.startsWith(page.url()), route => route.abort());
  await page.route(/\/api\/news(\?|$)/, route => route.fulfill({
    json: { updatedAt: new Date(Date.now() + 60 * 1000).toISOString(), sources: SOURCES, items: items || [FIX, NOIMG, SPORT, WEATHER, CRIME, HOMICIDE, POLICE] }
  }));
  await page.route(/\/api\/(react|alerts|listings|inbox)(\?|$)/, route => {
    if (route.request().method() === 'POST' && /\/api\/react/.test(route.request().url())) {
      return route.fulfill({ json: { configured: true, count: 1 } });
    }
    return route.fulfill({ json: { configured: false, counts: {}, alerts: [], items: [] } });
  });
  await page.route(/\/api\/comments(\?|$)/, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'GET' && url.searchParams.get('review')) {
      return route.fulfill({ status: 404, json: { error: 'not found' } });
    }
    if (req.method() === 'GET' && url.searchParams.get('ids')) {
      const counts = {};
      url.searchParams.get('ids').split(',').forEach(id => { if (comments[id] && comments[id].length) counts[id] = comments[id].length; });
      return route.fulfill({ json: { configured: true, counts } });
    }
    if (req.method() === 'GET' && url.searchParams.get('id')) {
      const id = url.searchParams.get('id');
      if (/crime|police|homicide/i.test(id) || id === storyId(CRIME.link) || id === storyId(HOMICIDE.link) || id === storyId(POLICE.link)) {
        return route.fulfill({ json: { configured: true, allowed: false, comments: [], count: 0, total: 0 } });
      }
      const list = comments[id] || [];
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const slice = list.slice(offset, offset + 20);
      return route.fulfill({ json: { configured: true, allowed: true, comments: slice, count: list.length, total: list.length, offset } });
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON() || {};
      if (body.action === 'ready') {
        opts.readyCalls.n += 1;
        if (opts.cookiesBlocked) return route.fulfill({ json: { ready: false } });
        return route.fulfill({ json: { ready: true } });
      }
      if (body.action === 'mine') {
        const ids = Array.isArray(body.ids) ? body.ids : [];
        return route.fulfill({ json: { mine: ids } });
      }
      if (body.action === 'delete') {
        Object.keys(comments).forEach(sid => {
          comments[sid] = (comments[sid] || []).filter(c => c.id !== body.id);
        });
        return route.fulfill({ json: { ok: true, deleted: true } });
      }
      if (body.action === 'report') {
        if (opts.reportFail) return route.fulfill({ status: 429, json: { error: 'too many' } });
        return route.fulfill({ json: { ok: true } });
      }
      const id = String(body.id || '');
      const text = String(body.text || '').replace(/[<>]/g, ' ').trim().slice(0, 300);
      if (!text) return route.fulfill({ status: 400, json: { error: 'Add a comment.' } });
      if (/https?:\/\//i.test(text)) return route.fulfill({ status: 400, json: { error: 'Links aren’t allowed.' } });
      if (/don.?t use the word|hate all/i.test(text)) {
        return route.fulfill({ json: { ok: true, pending: true, id: commentId() } });
      }
      if (/\b(fuck|shit|asshole|nigger|faggot)\b/i.test(text)) {
        return route.fulfill({ status: 400, json: { error: 'This comment can’t be posted.' } });
      }
      if (opts.slowCreate) await new Promise(r => setTimeout(r, 400));
      const c = { id: commentId(), text, at: new Date().toISOString() };
      comments[id] = comments[id] || [];
      comments[id].unshift(c);
      return route.fulfill({ json: { ok: true, comment: c } });
    }
    return route.fulfill({ json: { configured: true, comments: [], counts: {} } });
  });
  await page.route('https://img.example.test/river.jpg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#8eb4d4"/><text x="40" y="80" fill="#123" font-size="36">EXAMPLE · NOT REAL NEWS</text></svg>'
  }));
  await page.route('https://img.example.test/mug.jpg', route => route.fulfill({ status: 404, body: '' }));
}

function storyId(link) {
  link = String(link || '');
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < link.length; i++) { const c = link.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'h' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

async function layout(page) {
  return page.evaluate(() => {
    const zoom = parseFloat(getComputedStyle(document.body).zoom) || parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const layoutVw = innerWidth;
    const viewRight = innerWidth * zoom;
    const cards = [...document.querySelectorAll('#list article.news-story, #list article.card.news-story')];
    const rows = cards.map(card => {
      const cr = card.getBoundingClientRect();
      const titleEl = card.querySelector('h2');
      const like = card.querySelector('.acts .like');
      const share = card.querySelector('.acts .share');
      const cm = card.querySelector('.acts .cm-btn');
      const sv = card.querySelector('.acts .sv-btn');
      const offenders = [];
      [titleEl, like, share, cm, sv].forEach(el => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) return;
        if (r.right > viewRight + 1.5 || r.right > cr.right + 1.5) offenders.push({ cls: el.className, pastView: Math.round(r.right - viewRight), pastCard: Math.round(r.right - cr.right) });
      });
      return {
        title: (titleEl || {}).textContent || '',
        likeH: like ? Math.round(like.getBoundingClientRect().height / zoom) : 0,
        shareH: share ? Math.round(share.getBoundingClientRect().height / zoom) : 0,
        cmH: cm ? Math.round(cm.getBoundingClientRect().height / zoom) : 0,
        svH: sv ? Math.round(sv.getBoundingClientRect().height / zoom) : 0,
        hasCm: !!cm,
        hasSv: !!sv,
        offenders
      };
    });
    return { pageOverflow: document.documentElement.scrollWidth - layoutVw, rows };
  });
}

const VIEWPORTS = [
  { width: 320, height: 720, name: '320' },
  { width: 390, height: 844, name: '390' },
  { width: 1280, height: 1024, name: '1280' }
];

test('card/sheet comment, save/unsave, Saved list, heart independence, crime off, reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.goto('/');
  await expect(page.locator('#list article.news-story h2', { hasText: 'riverfront redevelopment' })).toBeVisible({ timeout: 15000 });

  const first = page.locator('#list article.news-story', { hasText: 'riverfront redevelopment' });
  const crimeCard = page.locator('#list article.news-story', { hasText: 'Man arrested downtown' });
  const homicideCard = page.locator('#list article.news-story', { hasText: 'allegedly killed by husband' });
  const sportCard = page.locator('#list article.news-story', { hasText: 'Pacers kill off the Heat' });
  const weatherCard = page.locator('#list article.news-story', { hasText: 'Storm kills 3' });
  const policeCard = page.locator('#list article.news-story', { hasText: 'Annual report published' });
  await expect(first.locator('.cm-btn')).toBeVisible();
  await expect(first.locator('.sv-btn')).toBeVisible();
  await expect(crimeCard.locator('.cm-btn')).toHaveCount(0);
  await expect(homicideCard.locator('.cm-btn')).toHaveCount(0);
  await expect(homicideCard.locator('img.ns-pic')).toHaveCount(0);
  await expect(policeCard.locator('.cm-btn')).toHaveCount(0);
  await expect(sportCard.locator('.cm-btn')).toBeVisible();
  await expect(weatherCard.locator('.cm-btn')).toBeVisible();
  await expect(crimeCard.locator('.sv-btn')).toBeVisible();
  await policeCard.locator('.sv-btn').click();
  await crimeCard.locator('.sv-btn').click();
  await homicideCard.locator('.sv-btn').click();
  await page.locator('#savedBtn').click();
  const svMug = page.locator('dialog.sv-sheet');
  await expect(svMug).toBeVisible();
  await expect(svMug.locator('.sv-item', { hasText: 'Annual report' })).toHaveCount(1);
  await expect(svMug.locator('.sv-item', { hasText: 'arrested downtown' })).toHaveCount(1);
  await expect(svMug.locator('.sv-item', { hasText: 'allegedly killed by husband' })).toHaveCount(1);
  await expect(svMug.locator('.sv-item', { hasText: 'Annual report' }).locator('img.sv-pic')).toHaveCount(0);
  await expect(svMug.locator('.sv-item', { hasText: 'arrested downtown' }).locator('img.sv-pic')).toHaveCount(0);
  await expect(svMug.locator('.sv-item', { hasText: 'allegedly killed by husband' }).locator('img.sv-pic')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await policeCard.locator('.sv-btn').click();
  await crimeCard.locator('.sv-btn').click();
  await homicideCard.locator('.sv-btn').click();

  await first.locator('.cm-btn').click();
  const cm = page.locator('dialog.cm-sheet');
  await expect(cm).toBeVisible();
  await expect(cm).toContainText('No comments yet');
  await cm.locator('textarea').fill('EXAMPLE public comment on the riverfront. Not a real person.');
  await cm.locator('.cm-post').click();
  await expect(cm).toContainText('EXAMPLE public comment');
  await page.keyboard.press('Escape');
  await expect(cm).toHaveCount(0);
  await expect(first.locator('.cm-btn')).toBeFocused();

  await first.locator('.sv-btn').click();
  await expect(first.locator('.sv-btn')).toHaveAttribute('aria-pressed', 'true');
  await first.locator('.like').click();
  await expect(first.locator('.like')).toHaveAttribute('aria-pressed', 'true');
  await expect(first.locator('.sv-btn')).toHaveAttribute('aria-pressed', 'true');
  await first.locator('.like').click();
  await expect(first.locator('.like')).toHaveAttribute('aria-pressed', 'false');
  await expect(first.locator('.sv-btn')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#savedBtn').click();
  const sv = page.locator('dialog.sv-sheet');
  await expect(sv).toBeVisible();
  await expect(sv).toContainText('riverfront redevelopment');
  await expect(sv.locator('a.st-go')).toHaveAttribute('href', /14news\.com\/fixture-news-01/);
  await expect(sv.locator('a.st-go')).toHaveAttribute('target', '_blank');
  await page.screenshot({ path: ART + '/news-saved-light-390.png', fullPage: false });
  fs.copyFileSync(ART + '/news-saved-light-390.png', FIXDIR + '/news-saved-light-390.png');
  await page.keyboard.press('Escape');
  await expect(page.locator('#savedBtn')).toBeFocused();

  await first.locator('a.ca').click();
  const sheet = page.locator('dialog.st-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.sv-btn')).toHaveAttribute('aria-pressed', 'true');
  await sheet.locator('.cm-btn').click();
  await expect(page.locator('dialog.cm-sheet')).toBeVisible();
  await expect(page.locator('dialog.cm-sheet')).toContainText('EXAMPLE public comment');
  await page.screenshot({ path: ART + '/news-comments-light-390.png', fullPage: false });
  fs.copyFileSync(ART + '/news-comments-light-390.png', FIXDIR + '/news-comments-light-390.png');
  await page.keyboard.press('Escape');
  await expect(sheet.locator('.cm-btn')).toBeFocused();
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(first).toBeVisible({ timeout: 15000 });
  await expect(first.locator('.sv-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(first.locator('.like')).toHaveAttribute('aria-pressed', 'false');

  await first.locator('.sv-btn').click();
  await expect(first.locator('.sv-btn')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#savedBtn').click();
  await expect(page.locator('dialog.sv-sheet')).toContainText('Nothing saved');
});

test('migration: existing tsn.saved stays saved and hearts stay pressed without a like POST', async ({ page }) => {
  const posts = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  page.on('request', req => { if (req.method() === 'POST' && /\/api\/react/.test(req.url())) posts.push(req.postData() || ''); });
  await page.addInitScript(items => {
    localStorage.setItem('tsn.saved', JSON.stringify(items));
  }, [
    { title: FIX.title, link: FIX.link, summary: FIX.summary, image: FIX.image, published: FIX.published, source: FIX.source, sourceId: FIX.sourceId },
    { title: POLICE.title, link: POLICE.link, summary: POLICE.summary, image: POLICE.image, published: POLICE.published, source: POLICE.source, sourceId: POLICE.sourceId }
  ]);
  await page.goto('/');
  await expect(page.locator('#list article.news-story h2', { hasText: 'riverfront redevelopment' })).toBeVisible({ timeout: 15000 });
  const first = page.locator('#list article.news-story', { hasText: 'riverfront redevelopment' });
  await expect(first.locator('.sv-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(first.locator('.like')).toHaveAttribute('aria-pressed', 'true');
  expect(posts).toEqual([]);
  const liked = await page.evaluate(() => localStorage.getItem('tsn.liked'));
  expect(liked).toContain(FIX.link);
  await page.locator('#savedBtn').click();
  const sv = page.locator('dialog.sv-sheet');
  await expect(sv.locator('.sv-item', { hasText: 'riverfront redevelopment' })).toHaveCount(1);
  await expect(sv.locator('.sv-item', { hasText: 'Annual report' })).toHaveCount(1);
  await expect(sv.locator('.sv-item', { hasText: 'riverfront redevelopment' }).locator('img.sv-pic')).toHaveCount(1);
  await expect(sv.locator('.sv-item', { hasText: 'Annual report' }).locator('img.sv-pic')).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tsn.saved') || '[]'));
  expect(stored.find(x => /Annual report/.test(x.title)).image).toBe('');
  expect(stored.find(x => /riverfront/.test(x.title)).image).toContain('river.jpg');
});

test('failed report stays Report and restores the opener', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page, null, { reportFail: true });
  await page.goto('/');
  await expect(page.locator('#list article.news-story h2', { hasText: 'riverfront redevelopment' })).toBeVisible({ timeout: 15000 });
  const first = page.locator('#list article.news-story', { hasText: 'riverfront redevelopment' });
  await first.locator('.cm-btn').click();
  const cm = page.locator('dialog.cm-sheet');
  await expect(cm).toBeVisible();
  await cm.locator('textarea').fill('EXAMPLE comment to report.');
  await cm.locator('.cm-post').click();
  const rp = cm.locator('.cm-item').first().locator('.cm-report');
  await expect(rp).toBeVisible();
  await rp.click();
  await expect(rp).toHaveText('Report');
  await expect(rp).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(first.locator('.cm-btn')).toBeFocused();
});

test('cookies blocked keep the form and Post re-runs ready; hold stays pending; double-submit posts once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const opts = { cookiesBlocked: true };
  await stub(page, null, opts);
  await page.goto('/');
  await expect(page.locator('#list article.news-story h2', { hasText: 'riverfront redevelopment' })).toBeVisible({ timeout: 15000 });
  const first = page.locator('#list article.news-story', { hasText: 'riverfront redevelopment' });
  await first.locator('.cm-btn').click();
  const cm = page.locator('dialog.cm-sheet');
  await expect(cm).toBeVisible();
  await expect(cm.locator('form.cm-form')).toBeVisible();
  await cm.locator('textarea').fill('EXAMPLE still trying to post.');
  const readyBefore = opts.readyCalls.n;
  await cm.locator('.cm-post').click();
  await expect.poll(() => opts.readyCalls.n, { timeout: 15000 }).toBeGreaterThan(readyBefore);
  await expect(cm.locator('.cm-item')).toHaveCount(0);
  await expect(cm.locator('form.cm-form')).toBeVisible();
  await page.keyboard.press('Escape');

  opts.cookiesBlocked = false;
  Object.keys(comments).forEach(k => { delete comments[k]; });
  await first.locator('.cm-btn').click();
  const sheet = page.locator('dialog.cm-sheet');
  await expect(sheet).toBeVisible();
  await sheet.locator('textarea').fill('Don’t use the word nigger here');
  await sheet.locator('.cm-post').click();
  await expect(sheet.locator('.cm-item.cm-pending')).toContainText('Waiting for review');
  await expect(sheet.locator('.cm-item.cm-pending')).toContainText('Don’t use the word nigger here');
  await page.keyboard.press('Escape');

  opts.slowCreate = true;
  Object.keys(comments).forEach(k => { delete comments[k]; });
  await first.locator('.cm-btn').click();
  const d2 = page.locator('dialog.cm-sheet');
  await expect(d2).toBeVisible();
  await d2.locator('textarea').fill('EXAMPLE only one of these.');
  await d2.locator('.cm-post').evaluate(btn => { btn.click(); btn.click(); });
  await expect(d2.locator('.cm-item')).toHaveCount(1);
});

test('filter reject keeps the draft; owner Delete is 44px and confirm-cancels leave the comment', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.goto('/');
  await expect(page.locator('#list article.news-story h2', { hasText: 'riverfront redevelopment' })).toBeVisible({ timeout: 15000 });
  const first = page.locator('#list article.news-story', { hasText: 'riverfront redevelopment' });
  await first.locator('.cm-btn').click();
  const cm = page.locator('dialog.cm-sheet');
  await expect(cm).toBeVisible();
  await cm.locator('textarea').fill('EXAMPLE fuck this riverfront.');
  await cm.locator('.cm-post').click();
  await expect(cm.locator('textarea')).toHaveValue('EXAMPLE fuck this riverfront.');
  await expect(cm.locator('.cm-item')).toHaveCount(0);
  await cm.locator('textarea').fill('EXAMPLE public comment I can delete.');
  await cm.locator('.cm-post').click();
  await expect(cm.locator('.cm-item')).toContainText('EXAMPLE public comment I can delete.');
  const del = cm.locator('.cm-del');
  await expect(del).toBeVisible();
  const box = await del.boundingBox();
  expect(box).toBeTruthy();
  expect(box.height).toBeGreaterThanOrEqual(44);
  page.once('dialog', d => d.dismiss());
  await del.click();
  await expect(cm.locator('.cm-item')).toContainText('EXAMPLE public comment I can delete.');
  page.once('dialog', d => d.accept());
  await del.click();
  await expect(cm.locator('.cm-item')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('no-image and long text still expose save; 44px targets at 320–1280; 200% zoom', async ({ page }) => {
  for (const vp of VIEWPORTS) {
    for (const dark of [false, true]) {
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await stub(page);
      await page.goto('/');
      await expect(page.locator('#list article.news-story h2', { hasText: 'riverfront redevelopment' })).toBeVisible({ timeout: 15000 });
      const m = await layout(page);
      expect(m.pageOverflow).toBe(0);
      for (const row of m.rows) {
        expect(row.offenders, row.title + ' ' + JSON.stringify(row.offenders)).toEqual([]);
        expect(row.likeH).toBeGreaterThanOrEqual(44);
        expect(row.shareH).toBeGreaterThanOrEqual(44);
        expect(row.svH).toBeGreaterThanOrEqual(44);
        if (/arrested downtown|Annual report|allegedly killed/.test(row.title)) expect(row.hasCm).toBe(false);
        else {
          expect(row.hasCm).toBe(true);
          expect(row.cmH).toBeGreaterThanOrEqual(44);
        }
      }
      const noimg = m.rows.find(r => /no photograph/.test(r.title));
      expect(noimg).toBeTruthy();
      if (vp.name === '390') {
        await page.locator('#list article.news-story', { hasText: 'riverfront redevelopment' }).locator('.cm-btn').click();
        await expect(page.locator('dialog.cm-sheet')).toBeVisible();
        await page.screenshot({ path: ART + '/news-comments-' + (dark ? 'dark' : 'light') + '-390.png', fullPage: false });
        fs.copyFileSync(ART + '/news-comments-' + (dark ? 'dark' : 'light') + '-390.png', FIXDIR + '/news-comments-' + (dark ? 'dark' : 'light') + '-390.png');
        await page.keyboard.press('Escape');
        const save = page.locator('#list article.news-story', { hasText: 'riverfront redevelopment' }).locator('.sv-btn');
        if (await save.getAttribute('aria-pressed') !== 'true') await save.click();
        await page.locator('#savedBtn').click();
        await expect(page.locator('dialog.sv-sheet')).toContainText('riverfront redevelopment');
        await page.screenshot({ path: ART + '/news-saved-' + (dark ? 'dark' : 'light') + '-390.png', fullPage: false });
        fs.copyFileSync(ART + '/news-saved-' + (dark ? 'dark' : 'light') + '-390.png', FIXDIR + '/news-saved-' + (dark ? 'dark' : 'light') + '-390.png');
        await page.keyboard.press('Escape');
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.goto('/');
  await expect(page.locator('#list article.news-story h2', { hasText: 'riverfront redevelopment' })).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  const z = await layout(page);
  for (const row of z.rows) expect(row.offenders, JSON.stringify(row.offenders)).toEqual([]);
});
