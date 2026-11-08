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
    const vw = innerWidth;
    const rootEl = document.querySelector(sel);
    const cards = [...(rootEl ? rootEl.querySelectorAll('article.row-job, article.row-deal') : [])];
    const rows = [];
    function inside(el, host, pad) {
      if (!el || !host) return null;
      const a = el.getBoundingClientRect(), b = host.getBoundingClientRect();
      return a.left >= b.left - pad && a.right <= b.right + pad && a.width > 0 && a.height > 0;
    }
    cards.forEach(card => {
      const src = card.querySelector('.src');
      const cta = card.querySelector('.ad-cta');
      const coupon = card.querySelector('.deal-code');
      const name = card.querySelector('.src b');
      const tag = card.querySelector('.mk-tag');
      const when = card.querySelector('.src .when');
      const img = card.querySelector('img.th, img.bav');
      const kicker = card.querySelector('.kicker');
      const title = (card.querySelector('h2') || {}).textContent || '';
      const cr = card.getBoundingClientRect();
      const offenders = [];
      [cta, coupon, name, tag, when, img, kicker, src].forEach(el => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) return;
        const pastView = r.right > vw + 1.5;
        const pastCard = r.right > cr.right + 1.5;
        if (pastView || pastCard) {
          offenders.push({
            cls: el.className, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48),
            pastView: Math.round(r.right - vw), pastCard: Math.round(r.right - cr.right)
          });
        }
      });
      rows.push({
        title,
        featured: card.classList.contains('is-featured'),
        sample: !!(tag && /sample/i.test(tag.textContent)),
        hasImg: !!img,
        cta: cta ? cta.textContent.trim() : null,
        coupon: coupon ? coupon.textContent.trim() : null,
        ctaInCard: inside(cta, card, 1.5),
        ctaInView: cta ? cta.getBoundingClientRect().right <= vw + 1.5 : null,
        couponInCard: inside(coupon, card, 1.5),
        couponInView: coupon ? coupon.getBoundingClientRect().right <= vw + 1.5 : null,
        srcOverflow: src ? getComputedStyle(src).overflowX : null,
        srcWrap: src ? getComputedStyle(src).flexWrap : null,
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
      vw,
      pageOverflow: document.documentElement.scrollWidth - vw,
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
      test(`${board.tab} ${dark ? 'dark' : 'light'} ${vp.name}: footer CTA/coupon stay in the card and viewport`, async ({ page }) => {
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
        const longs = m.rows.filter(r => /Regional Medical|Riverside Bakehouse|FALLFESTIVALBUNDLE|Overnight licensed/.test(r.title + (r.coupon || '')));
        expect(longs.length).toBeGreaterThan(0);
        for (const row of m.rows) {
          expect(row.offenders, row.title + ' ' + JSON.stringify(row.offenders)).toEqual([]);
          if (row.cta) {
            expect(row.ctaInCard, row.title + ' CTA in card').toBe(true);
            expect(row.ctaInView, row.title + ' CTA in viewport').toBe(true);
          }
          if (row.coupon) {
            expect(row.couponInCard, row.title + ' coupon in card').toBe(true);
            expect(row.couponInView, row.title + ' coupon in viewport').toBe(true);
          }
        }
        if (board.tab === 'Jobs') {
          const sampleCta = m.rows.find(r => r.sample && r.cta);
          expect(sampleCta.cta).toBe('Advertise a job');
          const paid = m.rows.find(r => r.featured && !r.sample);
          expect(await page.locator('#jb')).toContainText('Featured · Paid');
          expect(await page.locator('#jb')).toContainText('Sample featured placement');
        } else {
          expect(m.rows.some(r => r.hasImg)).toBe(true);
          expect(m.rows.some(r => !r.hasImg)).toBe(true);
        }
        for (const row of m.chipRows) {
          expect(row.wrap).not.toBe('wrap');
          expect(row.wrapVisual).toBe(false);
          expect(row.chipH).toBeGreaterThanOrEqual(44);
        }
        const tag = board.tab.toLowerCase() + '-' + (dark ? 'dark' : 'light') + '-' + vp.name;
        await page.screenshot({ path: ART + '/jobs-deals-mobile-' + tag + '.png', fullPage: false });
      });
    }
  }
}
