// Jobs/Deals on phones: card footers (CTA, coupon, sample tag, company, date) must stay inside the card
// and the viewport. document.scrollWidth alone is not enough — .src overflow:hidden can hide the overflow.
// Listings GET is mocked (one long real-shaped post plus the client-side samples). Nothing is written.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const ART = '/opt/cursor/artifacts';
fs.mkdirSync(ART, { recursive: true });

const LONG_JOB = {
  id: 'longjob01',
  title: 'Overnight licensed practical nurse supervisor',
  business: 'Southwest Indiana Regional Medical Center',
  jobType: 'Full-time',
  pay: '$32 an hour',
  category: 'Healthcare',
  town: 'Mount Vernon, IN',
  desc: 'A long-named listing used only to check the row still fits. Not submitted.',
  contact: '812-555-0199',
  featured: true,
  at: new Date().toISOString()
};
const LONG_DEAL = {
  id: 'longdeal01',
  title: 'Holiday pastry and coffee pairing',
  business: 'Riverside Bakehouse and Mercantile',
  category: 'Food & drink',
  town: 'Newburgh, IN',
  desc: 'A long-named deal used only to check the coupon still fits. Not submitted.',
  contact: '812-555-0188',
  code: 'FALLFESTIVALBUNDLE',
  featured: true,
  at: new Date().toISOString()
};

async function stub(page) {
  await page.route(/\/api\/news(\?|$)/, route => route.fulfill({ json: { updatedAt: new Date().toISOString(), sources: [], items: [] } }));
  await page.route(/\/api\/listings(\?|$)/, route => {
    const req = route.request();
    if (req.method() === 'POST') return route.fulfill({ status: 204, body: '' });
    const url = req.url();
    if (/kind=job/.test(url)) return route.fulfill({ json: { configured: true, items: [LONG_JOB] } });
    if (/kind=deal/.test(url)) return route.fulfill({ json: { configured: true, items: [LONG_DEAL] } });
    return route.continue();
  });
}

async function layout(page, root) {
  return page.evaluate(sel => {
    const zoom = parseFloat(getComputedStyle(document.body).zoom) || parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const layoutVw = innerWidth;
    const viewRight = innerWidth * zoom;
    const rootEl = document.querySelector(sel);
    const cards = [...(rootEl ? rootEl.querySelectorAll('article.row-job, article.row-deal') : [])];
    const rows = [];
    function inside(el, host, pad) {
      if (!el || !host) return null;
      const a = el.getBoundingClientRect(), b = host.getBoundingClientRect();
      return a.left >= b.left - pad && a.right <= b.right + pad && a.width > 0 && a.height > 0;
    }
    cards.forEach(card => {
      const cta = card.querySelector('.bd-view');
      const demo = card.querySelector('.bd-demo');
      const img = card.querySelector('img.deal-img, img.bav');
      const titleEl = card.querySelector('h2');
      const pay = card.querySelector('.job-pay');
      const meta = card.querySelector('.job-meta, .deal-cond');
      const who = (card.querySelector('.job-co, .deal-biz') || {}).textContent || '';
      const title = (who + ' ' + ((titleEl || {}).textContent || '')).trim();
      const cr = card.getBoundingClientRect();
      const offenders = [];
      [cta, demo, img, titleEl, pay, meta].forEach(el => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) return;
        const pastView = r.right > viewRight + 1.5;
        const pastCard = r.right > cr.right + 1.5;
        if (pastView || pastCard) {
          offenders.push({
            cls: el.className, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48),
            pastView: Math.round(r.right - viewRight), pastCard: Math.round(r.right - cr.right)
          });
        }
      });
      rows.push({
        title,
        featured: card.classList.contains('is-featured'),
        sample: !!(demo && /demo listing/i.test(demo.textContent)),
        hasImg: !!card.querySelector('img.deal-img'),
        cta: cta ? cta.textContent.trim() : null,
        ctaH: cta ? Math.round(cta.getBoundingClientRect().height / zoom) : 0,
        ctaInCard: inside(cta, card, 1.5),
        ctaInView: cta ? cta.getBoundingClientRect().right <= viewRight + 1.5 : null,
        offenders
      });
    });
    const chipRows = [...(rootEl ? rootEl.querySelectorAll('.cl-chips') : [])].map(row => {
      const chips = [...row.querySelectorAll('.cl-chip')];
      const tops = chips.map(c => Math.round(c.getBoundingClientRect().top));
      return {
        aria: row.getAttribute('aria-label'),
        wrap: getComputedStyle(row).flexWrap,
        wrapVisual: tops.length ? Math.max(...tops) - Math.min(...tops) > 8 : false,
        chipH: chips[0] ? Math.round(chips[0].getBoundingClientRect().height) : 0,
        overflowX: row.scrollWidth - row.clientWidth
      };
    });
    return {
      vw: layoutVw,
      pageOverflow: document.documentElement.scrollWidth - layoutVw,
      htmlOverflow: getComputedStyle(document.documentElement).overflowX,
      bodyOverflow: getComputedStyle(document.body).overflowX,
      rows, chipRows
    };
  }, root);
}

const VIEWPORTS = [
  { width: 320, height: 700, name: '320' },
  { width: 360, height: 800, name: '360' },
  { width: 375, height: 812, name: '375' },
  { width: 390, height: 844, name: '390' },
  { width: 414, height: 896, name: '414' },
  { width: 430, height: 932, name: '430' },
  { width: 667, height: 375, name: 'landscape' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 1280, height: 800, name: '1280' }
];

for (const board of [
  { path: '/jobs', root: '#jb', tab: 'Jobs' },
  { path: '/deals', root: '#dl', tab: 'Deals' }
]) {
  for (const dark of [false, true]) {
    for (const vp of VIEWPORTS) {
      test(`${board.tab} ${dark ? 'dark' : 'light'} ${vp.name}: stacked card and View CTA stay in the card and viewport`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await stub(page);
        await page.goto(board.path);
        await expect(page.locator(board.root + ' article').first()).toBeVisible();
        const m = await layout(page, board.root);
        expect(m.htmlOverflow, 'must not clip the page to hide overflow').not.toBe('hidden');
        expect(m.bodyOverflow).not.toBe('hidden');
        expect(m.pageOverflow).toBe(0);
        expect(m.rows.length).toBeGreaterThanOrEqual(8);
        const featured = m.rows.filter(r => r.featured);
        expect(featured.length).toBeGreaterThan(0);
        const samples = m.rows.filter(r => r.sample);
        expect(samples.length).toBeGreaterThanOrEqual(8);
        const longs = m.rows.filter(r => /Regional Medical|Riverside Bakehouse|Overnight licensed|Holiday pastry/.test(r.title));
        expect(longs.length).toBeGreaterThan(0);
        for (const row of m.rows) {
          expect(row.offenders, row.title + ' ' + JSON.stringify(row.offenders)).toEqual([]);
          expect(row.cta, row.title + ' has View').toBeTruthy();
          expect(row.ctaH, row.title + ' tap').toBeGreaterThanOrEqual(44);
          expect(row.ctaInCard, row.title + ' CTA in card').toBe(true);
          expect(row.ctaInView, row.title + ' CTA in viewport').toBe(true);
        }
        if (board.tab === 'Jobs') {
          expect(m.rows.every(r => r.cta === 'Apply')).toBe(true);
          expect(await page.locator('#jb')).toContainText('Featured · Paid');
          expect(await page.locator('#jb')).toContainText('Sample featured placement');
          expect(await page.locator('#jb')).toContainText('Demo listing');
        } else {
          expect(m.rows.every(r => r.cta === 'View deal')).toBe(true);
          expect(m.rows.some(r => r.hasImg)).toBe(true);
          expect(m.rows.some(r => !r.hasImg)).toBe(true);
          expect(await page.locator('#dl')).toContainText('Demo listing');
        }
        for (const row of m.chipRows) {
          expect(row.wrap).not.toBe('wrap');
          expect(row.wrapVisual).toBe(false);
          expect(row.chipH).toBeGreaterThanOrEqual(44);
        }
        const tag = board.tab.toLowerCase() + '-' + (dark ? 'dark' : 'light') + '-' + vp.name;
        await page.screenshot({ path: ART + '/stacked-' + tag + '.png', fullPage: false });
      });
    }
  }
}

test('200% zoom at 375: View buttons and titles stay in the card', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await stub(page);
  await page.goto('/jobs');
  await expect(page.locator('#jb .row-job').first()).toBeVisible();
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  const m = await layout(page, '#jb');
  for (const row of m.rows) {
    expect(row.offenders, row.title + ' ' + JSON.stringify(row.offenders)).toEqual([]);
    expect(row.ctaInCard).toBe(true);
    expect(row.ctaInView).toBe(true);
  }
  await page.screenshot({ path: ART + '/stacked-jobs-375-zoom200.png', fullPage: false });
});

test('real job Apply links to the listing contact; real deal Copy code stays in the detail dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.goto('/jobs');
  const jobApply = page.locator('#jb .row-job', { hasText: 'Overnight licensed' }).locator('a.job-view');
  await expect(jobApply).toHaveText('Apply');
  await expect(jobApply).toHaveAttribute('href', /tel:/);
  await expect(page.locator('#jb .row-job', { hasText: 'Overnight licensed' })).toContainText('Featured · Paid');
  await expect(page.locator('#jb .row-job', { hasText: 'Overnight licensed' })).not.toContainText('This is a demo listing');
  await page.goto('/deals');
  await page.locator('#dl .row-deal', { hasText: 'Holiday pastry' }).locator('.deal-view').click();
  const dealDlg = page.locator('dialog.bd-sheet');
  await expect(dealDlg).toBeVisible();
  await expect(dealDlg).toContainText('FALLFESTIVALBUNDLE');
  await expect(dealDlg.locator('button.bd-act', { hasText: 'Copy code' })).toBeVisible();
  await expect(dealDlg.locator('a.bd-act', { hasText: 'Get offer' })).toHaveAttribute('href', /tel:/);
  await page.screenshot({ path: ART + '/stacked-deals-detail-390.png', fullPage: false });
});
