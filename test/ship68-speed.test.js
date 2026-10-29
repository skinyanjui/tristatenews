// Ship 68 (McMaster-style speed pass): one deferred library bundle instead of six blocking scripts, preloads for the
// news data and the font, self-hosted Geist, short caching for small static files, a reserved tab row (layout shift),
// one board request at a time plus prefetch on intent, and every source's pictures size-checked.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const B = require('../scripts/build-assets.js');
const vercel = JSON.parse(read('vercel.json'));
const html = read('data/pages/index.html'), head = html.slice(0, html.indexOf('</head>'));

test('no parser-blocking scripts: lib.js (the six libraries + the head call) and app.js are defer, in order', () => {
  assert.equal(read('public/assets/lib.js'), B.libSource(), 'lib.js is current: run node scripts/build-assets.js');
  for (const f of B.LIBS) assert.ok(!html.includes('<script src="/' + f + '"'), f + ' is bundled, not loaded on its own');
  const srcs = [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"/g)];
  assert.deepEqual(srcs.map(m => m[2].split('?')[0]), ['/assets/lib.js', '/assets/app.js']);
  assert.ok(srcs.every(m => /\bdefer\b/.test(m[1])), 'all defer');
  assert.ok(!/<script>[^<]/.test(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '')), 'no inline script left');
  assert.ok(B.libSource().indexOf('public/routes.js') < B.libSource().indexOf(B.APPLY), 'the head call runs after routes.js');
  // the other pages still load the standalone files
  assert.match(read('public/creative.html'), /<script src="\/adsizes\.js"><\/script>/);
});

test('preloads: the news data (fetched the same way, so it is reused) and the sans font', () => {
  assert.ok(head.includes('<link rel="preload" href="/api/news" as="fetch" crossorigin>'));
  assert.ok(head.includes('<link rel="preload" href="/assets/fonts/geist-1.8.2-latin.woff2" as="font" type="font/woff2" crossorigin>'));
  assert.match(read('public/assets/app.js'), /var url = '\/api\/news' \+ \(SC\.key !== 'tristate' \? '\?scope=' \+ SC\.key : ''\)/);
  // county and state pages fetch a scoped URL: no preload there
  const S = require('../api/_scope.js'), G = require('../api/_geopage.js');
  assert.ok(!G.page(S.parse('state:in')).html.includes('rel="preload" href="/api/news"'));
});

test('Geist is self-hosted (OFL), with no Google Fonts anywhere and the CSP narrowed', () => {
  for (const f of ['public/assets/fonts/geist-1.8.2-latin.woff2', 'public/assets/fonts/geist-mono-1.8.2-500-latin.woff2']) {
    const b = fs.readFileSync(path.join(root, f));
    assert.equal(b.slice(0, 4).toString(), 'wOF2', f); assert.ok(b.length < 40000, f + ' ' + b.length);
  }
  assert.match(read('public/assets/fonts/OFL.txt'), /SIL Open Font License/);
  assert.match(read('public/assets/app.css'), /@font-face \{ font-family:'Geist'; font-style:normal; font-weight:400 600; font-display:swap; src:url\('\/assets\/fonts\/geist-1\.8\.2-latin\.woff2'\)/);
  for (const f of ['data/pages/index.html', 'public/legal.html', 'public/newsletter.html', 'public/unsubscribe.html', 'data/pages/404.html']) assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(read(f)), f);
  for (const f of ['public/legal.html', 'public/newsletter.html', 'public/unsubscribe.html', 'data/pages/404.html']) assert.ok(read(f).includes('/assets/fonts/geist-1.8.2.css'), f);
  const csp = vercel.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.ok(!/fonts\.g/.test(csp)); assert.match(csp, /font-src 'self' data:;/);
});

test('caching: assets (incl. fonts) a year; the small standalone files 5 minutes, not revalidated every visit', () => {
  assert.ok(vercel.headers.some(h => h.source === '/assets/(.*)' && /immutable/.test(h.headers[0].value)));
  const h = vercel.headers.find(x => /sponsors\.json/.test(x.source));
  for (const f of B.LIBS.concat(['sponsors.json', 'manifest.webmanifest', 'legal.css'])) assert.ok(h.source.includes(f), f);
  assert.equal(h.headers[0].value, 'public, max-age=300, stale-while-revalidate=86400');
});

test('layout: the tab row has its height before it is drawn; footer still in the flow', () => {
  const css = read('public/assets/app.css');
  assert.match(css, /\.tabs \{[^}]*min-height:calc\(var\(--ctl\) \+ 2px\)/);
  assert.ok(!/\.legal-foot[^{]*\{[^}]*position:\s*fixed/.test(css));
});

test('boards: one request per board at a time; hover, touch or focus on a tab prefetches it', () => {
  const js = read('public/assets/app.js');
  assert.match(js, /if \(b\.pending\) return b\.pending;/);
  assert.match(js, /b\.pending = null; renderTabs\(\)/);
  assert.match(js, /\['pointerover', 'touchstart', 'focusin'\]\.forEach/);
  assert.match(js, /var TAB_BOARD = \{ classifieds: 'item', deals: 'deal', events: 'event', jobs: 'job', obits: 'obit' \};/);
});

test('pictures: every source is size-checked; over 500 KB a card shows no photo', () => {
  const news = require('../api/news.js'), src = read('api/news.js');
  assert.equal(news.IMG_MAX_BYTES, 500 * 1024);
  assert.match(src, /if \(last\.items\.length\) \{ try \{ await sizeImages\(last\.items, prev, source\.kind === 'events' \? 0 : IMG_BUDGET_MS\); \}/);
  assert.equal(news.IMG_BUDGET_MS, 2500);
  assert.ok(!/source\.kind === 'events' && last\.items\.length\) \{ try \{ await sizeImages/.test(src));
});
