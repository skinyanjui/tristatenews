// Photo-led news cards + preview sheet. Listings/news GET mocked; fixtures are fixtures, not real news.
// Redis unset. No crawl/refresh/writes. Bounding rects vs card and viewport (not only scrollWidth).
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const ART = '/opt/cursor/artifacts';
fs.mkdirSync(ART, { recursive: true });

const T0 = Date.parse('2026-11-08T15:00:00Z');
const FIX = {
  id: 'fixture-news-01',
  title: 'Long fixture headline about the riverfront redevelopment that wraps onto extra lines on a phone',
  summary: 'Fixture summary used only to check the two-line preview and the sheet. This is not a republished article.',
  more: 'Fixture summary used only to check the two-line preview and the sheet. This is not a republished article. Extra feed text so the sheet has something to scroll.',
  link: 'https://www.14news.com/fixture-news-01/',
  image: 'https://img.example.test/river.jpg',
  source: 'Very Long Fixture Publisher Name That Should Wrap Or Ellipsize',
  sourceId: 'fix',
  published: new Date(T0 - 12 * 6e4).toISOString(),
  cat: 'Local'
};
const NOIMG = {
  id: 'fixture-news-02',
  title: 'Fixture story with no photograph',
  summary: 'Compact layout fixture. Not real news.',
  link: 'https://www.14news.com/fixture-news-02/',
  image: '',
  source: 'Fixture Desk',
  sourceId: 'fix',
  published: new Date(T0 - 40 * 6e4).toISOString()
};
const BADIMG = {
  id: 'fixture-news-03',
  title: 'Fixture story whose photo fails',
  summary: 'Image error must collapse the photo, not leave a hole.',
  link: 'https://www.14news.com/fixture-news-03/',
  image: 'https://img.example.test/missing.jpg',
  source: 'Fixture Desk',
  sourceId: 'fix',
  published: new Date(T0 - 80 * 6e4).toISOString()
};
const SOURCES = [{ id: 'fix', name: 'Fixture Desk', kind: 'news', logo: '', ok: true, count: 3 }];

async function stub(page, items) {
  await page.route(url => !/^http:\/\/(127\.0\.0\.1|localhost)/.test(url.href) && !url.href.startsWith(page.url()), route => route.abort());
  await page.route(/\/api\/news(\?|$)/, route => route.fulfill({
    json: { updatedAt: new Date(Date.now() + 60 * 1000).toISOString(), sources: SOURCES, items: items || [FIX, NOIMG, BADIMG] }
  }));
  await page.route(/\/api\/(react|alerts|listings|inbox)(\?|$)/, route => route.fulfill({ json: { configured: false, counts: {}, alerts: [], items: [] } }));
  await page.route('https://img.example.test/river.jpg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#8eb4d4"/></svg>'
  }));
  await page.route('https://img.example.test/missing.jpg', route => route.fulfill({ status: 404, body: '' }));
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
      const pic = card.querySelector('img.ns-pic');
      const src = card.querySelector('.ns-src');
      const like = card.querySelector('.acts .like');
      const share = card.querySelector('.acts .share');
      const offenders = [];
      [titleEl, pic, src, like, share].forEach(el => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) return;
        const pastView = r.right > viewRight + 1.5;
        const pastCard = r.right > cr.right + 1.5;
        if (pastView || pastCard) offenders.push({ cls: el.className, pastView: Math.round(r.right - viewRight), pastCard: Math.round(r.right - cr.right) });
      });
      return {
        title: (titleEl || {}).textContent || '',
        hasPic: !!pic,
        likeH: like ? Math.round(like.getBoundingClientRect().height / zoom) : 0,
        shareH: share ? Math.round(share.getBoundingClientRect().height / zoom) : 0,
        cardH: Math.round(cr.height / zoom),
        picH: pic ? Math.round(pic.getBoundingClientRect().height / zoom) : 0,
        picW: pic ? Math.round(pic.getBoundingClientRect().width / zoom) : 0,
        cardW: Math.round(cr.width / zoom),
        h2Size: titleEl ? getComputedStyle(titleEl).fontSize : '',
        dekSize: (() => { const p = card.querySelector('.ns-bd p:not(.cl-note)'); return p ? getComputedStyle(p).fontSize : ''; })(),
        offenders,
        pageOverflow: document.documentElement.scrollWidth - layoutVw
      };
    });
    return {
      pageOverflow: document.documentElement.scrollWidth - layoutVw,
      htmlOverflow: getComputedStyle(document.documentElement).overflowX,
      bodyOverflow: getComputedStyle(document.body).overflowX,
      rows
    };
  });
}

const VIEWPORTS = [
  { width: 320, height: 720, name: '320' },
  { width: 360, height: 740, name: '360' },
  { width: 390, height: 844, name: '390' },
  { width: 430, height: 900, name: '430' },
  { width: 768, height: 1024, name: '768' },
  { width: 1280, height: 1024, name: '1280' }
];

for (const dark of [false, true]) {
  for (const vp of VIEWPORTS) {
    test(`news ${dark ? 'dark' : 'light'} ${vp.name}: stacked cards stay in the card and viewport`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await stub(page);
      await page.goto('/');
      await expect(page.locator('#list article.news-story h2', { hasText: 'Long fixture headline' })).toBeVisible({ timeout: 15000 });
      const m = await layout(page);
      expect(m.htmlOverflow).not.toBe('hidden');
      expect(m.bodyOverflow).not.toBe('hidden');
      expect(m.pageOverflow).toBe(0);
      expect(m.rows.length).toBeGreaterThanOrEqual(2);
      expect(m.rows.some(r => /Long fixture headline/.test(r.title))).toBe(true);
      expect(m.rows.some(r => /no photograph/.test(r.title) && !r.hasPic)).toBe(true);
      const tap = vp.width >= 900 ? 32 : 44;
      for (const row of m.rows) {
        expect(row.offenders, row.title + ' ' + JSON.stringify(row.offenders)).toEqual([]);
        expect(row.likeH).toBeGreaterThanOrEqual(tap);
        expect(row.shareH).toBeGreaterThanOrEqual(tap);
        if (vp.width >= 900) {
          expect(row.likeH).toBeLessThan(40);
          expect(row.shareH).toBeLessThan(40);
        }
      }
      if (vp.name === '390' || vp.name === '1280') {
        const pic = page.locator('#list article.news-story img.ns-pic').first();
        if (await pic.count()) await pic.waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await page.screenshot({ path: ART + '/news-feed-' + (dark ? 'dark' : 'light') + '-' + vp.name + '.png', fullPage: false });
      }
    });
  }
}

test('desktop news cards are compact at 1024/1280/1440; 390 stays stacked with 44px taps', async ({ page }) => {
  const widths = [
    { width: 390, height: 844, desktop: false },
    { width: 1024, height: 900, desktop: true },
    { width: 1280, height: 900, desktop: true },
    { width: 1440, height: 900, desktop: true }
  ];
  for (const vp of widths) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await stub(page);
    await page.goto('/');
    await expect(page.locator('#list article.news-story h2', { hasText: 'Long fixture headline' })).toBeVisible({ timeout: 15000 });
    const pic = page.locator('#list article.news-story img.ns-pic').first();
    if (await pic.count()) await pic.waitFor({ state: 'visible' });
    const m = await layout(page);
    expect(m.pageOverflow).toBe(0);
    const withPic = m.rows.find(r => r.hasPic);
    const noPic = m.rows.find(r => /no photograph/.test(r.title));
    expect(withPic).toBeTruthy();
    expect(noPic).toBeTruthy();
    if (vp.desktop) {
      expect(withPic.picH, vp.width + ' pic height').toBeLessThanOrEqual(320);
      expect(withPic.picH).toBeGreaterThanOrEqual(160);
      expect(withPic.cardH, vp.width + ' image card').toBeLessThan(560);
      expect(withPic.cardH).toBeLessThan(vp.height * 0.7);
      expect(noPic.cardH, vp.width + ' text-only card').toBeLessThan(200);
      expect(parseFloat(withPic.h2Size)).toBeLessThanOrEqual(18);
      expect(withPic.likeH).toBeGreaterThanOrEqual(32);
      expect(withPic.likeH).toBeLessThan(40);
      expect(withPic.cardW).toBeLessThanOrEqual(724);
    } else {
      expect(withPic.likeH).toBeGreaterThanOrEqual(44);
      expect(withPic.shareH).toBeGreaterThanOrEqual(44);
      expect(Math.abs(withPic.picW - withPic.cardW)).toBeLessThanOrEqual(2);
      expect(parseFloat(withPic.h2Size)).toBeGreaterThanOrEqual(19);
    }
  }
});

test('200% zoom at 390: titles and reactions stay in the card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.goto('/');
  await expect(page.locator('#list article.news-story h2', { hasText: 'Long fixture headline' })).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  const m = await layout(page);
  for (const row of m.rows) {
    expect(row.offenders, row.title + JSON.stringify(row.offenders)).toEqual([]);
  }
});

test('failed photo collapses; sheet is accessible; Continue opens the publisher; reactions do not navigate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.goto('/');
  await expect(page.locator('#list article.news-story h2', { hasText: 'Long fixture headline' })).toBeVisible({ timeout: 15000 });
  const fail = page.locator('#list article.news-story', { hasText: 'photo fails' });
  await expect(fail).toBeVisible();
  await page.waitForTimeout(400);
  expect(await fail.locator('img.ns-pic').count()).toBe(0);

  const first = page.locator('#list article.news-story').first();
  const opener = first.locator('a.ca');
  await opener.focus();
  await page.keyboard.press('Enter');
  const dlg = page.locator('dialog.st-sheet');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('Long fixture headline');
  await expect(dlg).toContainText('Fixture summary');
  await expect(dlg.locator('a.st-go')).toHaveAttribute('href', /14news\.com\/fixture-news-01/);
  await expect(dlg.locator('a.st-go')).toHaveAttribute('target', '_blank');
  await expect(dlg).not.toContainText('EXAMPLE STORY');
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await page.screenshot({ path: ART + '/news-sheet-light-390.png', fullPage: false });
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await expect(opener).toBeFocused();

  await opener.click();
  await expect(dlg).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await page.waitForTimeout(150);
  await page.screenshot({ path: ART + '/news-sheet-dark-390.png', fullPage: false });
  const nav = [];
  page.on('framenavigated', f => { if (f === page.mainFrame()) nav.push(f.url()); });
  await dlg.locator('.st-acts .like').click();
  await expect(dlg).toBeVisible();
  expect(nav.filter(u => /14news\.com/.test(u))).toEqual([]);
  await page.mouse.click(8, 8);
  await expect(dlg).toHaveCount(0);
});
