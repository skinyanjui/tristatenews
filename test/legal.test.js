// Ads PR 5: public/legal.html describes what is live: catalog prices, the Featured period and refunds, order
// records, ad spots and the no-targeting rule, affiliate links, and exactly what the site stores.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../api/_catalog.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const legal = read('public/legal.html'), html = read('public/index.html');
const text = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const section = id => { const a = legal.indexOf('<section class="lg-panel" id="' + id + '"'); assert.ok(a >= 0, id); return legal.slice(a, legal.indexOf('</section>', a)); };
const terms = section('terms'), privacy = section('privacy'), ads = section('advertising');
const usd = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 });

test('Terms §7 states every current Featured price and period from the catalog, and the price lock', () => {
  for (const [kind, p] of Object.entries(C.FEATURED)) {
    const m = terms.match(new RegExp('<span data-price="' + kind + '">([^<]+)</span>'));
    assert.ok(m, kind);
    assert.strictEqual(m[1], p.label + ' ' + usd(p.cents) + ' for ' + p.days + ' days', kind);
  }
  assert.strictEqual(C.PRICE_VERSION, '2026-10-18', 'prices changed: update Terms §7 and this test');
  const t = text(terms);
  assert.ok(/new prices apply only to new purchases/.test(t) && /keeps the price and the days it was sold with/.test(t));
  for (const old of Object.values(C.HISTORY.legacy.featured)) assert.ok(!t.includes(usd(old.cents) + ' for ' + old.days + ' days'), 'no old price shown as current');
});

test('Terms §7 matches the code: capped period at full price, shown first, undated posts kept, refunds, disputes', () => {
  const t = text(terms.slice(terms.indexOf('id="terms-paid"'), terms.indexOf('id="terms-newsletter"')));
  for (const s of ['end of the event’s date or the deal’s end date (midnight Central time)', 'the price is the same full price', 'If less than a day would be added',
    'we keep the post (and its photo) on its board until the period ends', 'stays open for one hour', 'we flag the order for a refund',
    'doesn’t match the price shown', 'we review the removal; if the post broke these terms, no refund is due', 'A full refund ends the Featured period that payment bought',
    'A partial refund doesn’t change the period', 'we record the dispute', 'never see or store your card number', 'processed by Stripe', 'if you remove your own post'])
    assert.ok(t.includes(s), s);
  assert.ok(t.includes('Last updated October 18, 2026'));
});

test('packages are "available by inquiry" with no price or contents; newsletter sponsorship not offered yet', () => {
  const t = text(legal);
  assert.ok(text(ads).includes('Advertising packages: available by inquiry'));
  for (const p of Object.values(C.PACKAGES)) assert.ok(!t.includes(usd(p.cents)), 'no package price ' + usd(p.cents));
  for (const n of Object.values(C.NEWSLETTER)) if (n.cents) assert.ok(!t.includes(usd(n.cents)), 'no newsletter price');
  assert.ok(!/Package [A-D]/.test(t), 'no package names or inclusions promised');
  assert.ok(text(ads).includes('Newsletter sponsorship: not offered yet'));
});

test('Advertising Policy: ad spots, house units, no targeting, ad-free sections, labels, networks, affiliate links', () => {
  const t = text(ads);
  for (const s of ['Sponsor lines', 'Sponsored cards', 'after the sixth post', 'at most one per board', 'Side ads', '“Advertise with us,”', 'Featured · Paid',
    'appear on the Events, Jobs, Deals and Classifieds boards', 'News, which also carries Police & courts items, has sponsored cards between stories and side ads', 'never placed directly before or after a Police & courts item', 'There are no ads on Institutions, Obituaries, breaking-news alerts or search results', 'Sponsored cards in News',
    'Our own ads are never targeted', 'Every reader of a board sees the same ad', 'they take equal turns of 15 minutes by the clock', 'so it can’t be oversold: three for the sponsored card and three for the sponsor line on each board, three for the sponsored card in News, and two for each side ad', 'rel="sponsored"', 'https', 'don’t use animation, autoplaying video or sound, pop-ups',
    'We don’t use any third-party ad network today', 'consent notice', 'labeled “paid link”', 'we may earn a commission', 'never affects which obituaries appear or what they say',
    'the funeral home has its own florist page, the link goes there', 'no ad, image, script, cookie or tracking pixel', 'until then no affiliate links appear', 'A “Send flowers” link without that label earns us nothing', 'Last updated October 21, 2026'])
    assert.ok(t.includes(s), s);
  assert.ok(!/florist one|1-800-flowers|ftd\b|teleflora|bloomnation/i.test(legal), 'no affiliate partner named until Sam joins a program');
  // the table of contents lists every heading
  const tocHtml = ads.slice(ads.indexOf('<details class="lg-toc">'), ads.indexOf('</details>'));
  const toc = [...tocHtml.matchAll(/<a href="#(advertising-[a-z]+)">/g)].map(m => m[1]), heads = [...ads.matchAll(/<h3 id="(advertising-[a-z]+)">/g)].map(m => m[1]);
  assert.deepStrictEqual(toc, heads);
});

test('no sample text except the labeled placeholder sample ads; placeholders only Sam or a lawyer can fill are still there', () => {
  assert.ok(!/sample/i.test(legal.replace(/placeholder sample ads?|“Sample ad\.?”|samples follow/gi, '')));
  for (const ph of ['[LEGAL ENTITY NAME]', '[MAILING ADDRESS]', '[DMCA AGENT NAME]', '[DMCA AGENT EMAIL]', '[COUNTY]']) assert.ok(legal.includes(ph), ph);
});

test('Privacy matches the code: every browser-storage key is described; no cookies, analytics or ad-network code', () => {
  const keys = new Set([...html.matchAll(/localStorage\.(?:getItem|setItem)\('([^']+)'/g)].map(m => m[1])
    .concat([...html.matchAll(/(?:RECENT_KEY|NL_KEY) = '([^']+)'/g)].map(m => m[1]), [...html.matchAll(/key: '(tsn\.[A-Za-z]+)'/g)].map(m => m[1])));
  const DESCRIBED = { 'tsn.theme': 'light or dark theme', wxLoc: 'chosen weather location', 'tsn.saved': 'liked stories', 'tsn.recent': 'recent searches',
    'tsn.nl': 'whether you’ve signed up for the newsletter', 'tsn.uid': 'A random browser ID', 'tsn.mine': 'posts you made from this browser', 'tsn.mineDeals': 'posts you made from this browser',
    'tsn.mineEvents': 'posts you made from this browser', 'tsn.mineJobs': 'posts you made from this browser', 'tsn.mineObits': 'posts you made from this browser' };
  assert.deepStrictEqual([...keys].sort(), Object.keys(DESCRIBED).sort(), 'a new browser-storage key needs a line in the Privacy Policy');
  const t = text(privacy);
  for (const d of new Set(Object.values(DESCRIBED))) assert.ok(t.includes(d), d);
  for (const f of fs.readdirSync(path.join(root, 'public')).filter(f => /\.(html|js)$/.test(f))) {
    const src = read('public/' + f);
    assert.ok(!/document\.cookie|sessionStorage|googletagmanager|google-analytics|gtag\(|_vercel\/insights|adsbygoogle|pagead2/.test(src), f);
  }
  assert.ok(t.includes('Tri-State News itself doesn’t set cookies') && t.includes('We don’t use analytics tools') && t.includes('We don’t use any third-party ad network today'));
});

test('Privacy: order records are described as stored, and the payment code never keeps card or contact details from Stripe', () => {
  const t = text(privacy);
  for (const s of ['Order records', 'We don’t store your name, email or card details from Stripe', 'An unpaid checkout is deleted after 30 days', 'have no automatic expiry',
    'what you’re interested in', 'the package and budget you pick (optional)', 'our own status for the inquiry (new, contacted, proposal sent, won, lost or spam)', 'kept 400 days after the last change', 'the change log keeps the latest 1,000 changes', 'Stripe receives the post’s ID, title and board', 'Last updated October 18, 2026'])
    assert.ok(t.includes(s), s);
  for (const f of ['api/stripe-webhook.js', 'api/_orders.js', 'api/_checkout.js'])
    assert.ok(!/customer_details|customer_email|receipt_email|billing_details|\.card\b|payment_method_details/.test(read(f)), f + ' stores no card or contact data');
  const ck = read('api/_checkout.js');
  assert.ok(ck.includes("'line_items[0][price_data][product_data][description]': String(o.title || '').slice(0, 120)"), 'the post title goes to Stripe, as the policy says');
});

test('Advertising Policy §7 and Privacy: creative standards, the review process and the upload data are described', () => {
  const t = legal.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
  for (const s of ['7. Ad images, words and review', 'Nobody can upload an ad anonymously', 'one still JPEG, PNG or WebP image, at least 300×150 pixels', '300 KB or smaller', 'No animation, video or sound',
    'up to 60 characters', 'up to 140 characters', '“Visit website,” “Shop now,” “Learn more,” “Call now” or “Get directions.”', 'not a link shortener or a redirect',
    'A person at Tri-State News reviews every ad before it runs', 'nothing uploaded appears on the site until it’s approved', 'recorded reason', 'Rejected and withdrawn images are deleted',
    'Ad uploads (advertisers)', 'Waiting for review: 60 days', 'one still image with a short headline and text', 'signups and ad uploads',
    'Sizes: we use standard (IAB) ad sizes', '728×90 (leaderboard) for the sponsored card in News', '320×100 (large mobile banner) on phones', '300×250 (medium rectangle) for the sponsored card on the Events, Jobs, Deals and Classifieds boards',
    '160×600 (wide skyscraper) for side ads, and 300×600 (half page)', 'The sponsor line is a line of text, not a sized unit', 'Banners for a size (optional)', 'exactly that shape', 'deleted when the ad is rejected or withdrawn'])
    assert.ok(t.includes(s), s);
  assert.ok(!/text only/i.test(t), 'no longer says ads are text only');
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'docs/legal-review.md'), 'utf8').includes('Ads PR C: advertiser creatives'));
});
