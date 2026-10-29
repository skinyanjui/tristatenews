// Ship 69: "/", /obituaries and /institutions arrive with the tab's first stories from the snapshot (api/_tabpage.js,
// api/_cards.js): pre-rendered cards in the app.js markup plus a JSON blob app.js draws from, escaped, never baked into
// a static file, with the plain shell as the fallback.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const tab = require('../api/_tabpage.js');
const C = require('../api/_cards.js');
const news = require('../api/news.js');
const vercel = JSON.parse(read('vercel.json'));

function call(query, method) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
      send(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); }, json(b) { this.send(JSON.stringify(b)); } };
    Promise.resolve(tab({ method: method || 'GET', query, headers: {}, url: '/' }, res)).catch(e => resolve({ status: 500, error: e }));
  });
}
const NOW = Date.now(), ago = m => new Date(NOW - m * 6e4).toISOString();
function view() {
  const items = [];
  for (let i = 0; i < 30; i++) items.push({ id: 'n' + i, title: 'Story ' + i, link: 'https://ex.com/' + i, summary: 'S' + i, image: 'https://img.ex.com/' + i + '.jpg', published: ago(60 + i), source: 'Ex', sourceId: 'ex' });
  items.splice(1, 0, { id: 'p1', title: 'Man arrested after chase', link: 'https://police.ex.gov/1', summary: 'x', image: 'https://img.ex.com/mug.jpg', published: ago(70), source: 'EPD', sourceId: 'epd', arrest: true });
  items.splice(3, 0, { id: 'x1', title: 'Evil </script><script>alert(1)</script> \u2028 "q" \'a\' & <b>', link: 'javascript:alert(1)', summary: '<img src=x onerror=alert(1)>', image: '" onerror="alert(1)', published: ago(80), source: '<i>Src</i>', sourceId: 'ex' });
  items.push({ id: 'o1', title: 'Jane Doe obituary', link: 'https://fh.ex.com/o1', summary: '', image: 'https://img.ex.com/o.jpg', published: ago(100), source: 'FH', sourceId: 'fh' });
  items.push({ id: 'e1', title: 'Fair', link: 'https://ev.ex.com/1', published: ago(10), source: 'Ev', sourceId: 'ev' });
  return { updatedAt: ago(5), items, sources: [{ id: 'ex', name: 'Ex', kind: 'news', logo: 'https://logo.ex.com/a.png' }, { id: 'epd', name: 'EPD', kind: 'police' }, { id: 'fh', name: 'FH', kind: 'obits' }, { id: 'ev', name: 'Ev', kind: 'events' }, { id: 'unused', name: 'U', kind: 'news' }], scope: { key: 'tristate' }, features: { scopes: true, routes: true } };
}
const blob = h => { const m = /<script type="application\/json" id="tsn-data">([\s\S]*?)<\/script>/.exec(h); return m && m[1]; };
const listOf = h => { const j = h.indexOf('<script type="application/json" id="tsn-data">'); return h.slice(h.indexOf('<div id="list"'), j >= 0 ? j : h.indexOf('<div class="more"')); };

test('"/" is served by the tab page: rewrite, no public/index.html, shell bundled with api/news.js, still 8 functions', () => {
  assert.ok(vercel.rewrites.some(r => r.source === '/' && r.destination === '/api/news?__route=tabpage&p=/'));
  assert.ok(!fs.existsSync(path.join(root, 'public', 'index.html')), 'a static index.html would win over the rewrite');
  assert.match(vercel.functions['api/news.js'].includeFiles, /data\/pages\/index\.html/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_')).sort(),
    ['alerts.js', 'inbox.js', 'listings.js', 'news.js', 'newsletter.js', 'react.js', 'stripe-webhook.js', 'unsubscribe.js']);
  assert.ok(vercel.redirects.some(r => r.source === '/index.html' && r.destination === '/' && r.permanent));
});

test('"/" with a snapshot: first 24 News stories as cards and JSON, no /api/news preload, edge-cached, head intact', async t => {
  t.mock.method(news, 'homeView', async () => view());
  const out = await call({ p: '/' });
  assert.equal(out.status, 200);
  assert.equal(out.headers['cache-control'], 'public, max-age=0, s-maxage=60, stale-while-revalidate=60');
  const h = out.body, list = listOf(h);
  assert.match(h, /<meta name="google-site-verification" content="[^"]+"/);
  assert.match(h, /<title>Tri-State News<\/title>/);
  assert.match(h, /<link rel="canonical" href="https:\/\/tristatenewss\.vercel\.app\/">/);
  assert.ok(!h.includes('<link rel="preload" href="/api/news"'), 'data is in the page: no preload');
  assert.match(h, /<link rel="preload" href="\/assets\/fonts\/geist-1\.8\.2-latin\.woff2"/);
  assert.match(list, /^<div id="list" class="list news-one" aria-busy="false">/, 'one story per row');
  assert.equal((list.match(/<article class="card/g) || []).length, 24);
  assert.ok(!/ad-card|ad-feed|spon-tag|Sponsored/.test(list), 'no ads in the server cards');
  assert.ok(!list.includes('Jane Doe') && !list.includes('>Fair<'), 'News only');
  // the first picture is the LCP candidate; the rest wait
  assert.equal((list.match(/fetchpriority="high"/g) || []).length, 1);
  assert.match(list, /<img class="th" loading="eager" fetchpriority="high"[^>]*src="https:\/\/img\.ex\.com\/0\.jpg"/);
  const d = JSON.parse(blob(h));
  assert.equal(d.cat, 'news'); assert.equal(d.partial, true); assert.equal(d.items.length, 24);
  assert.deepEqual(d.sources.map(s => s.id).sort(), ['epd', 'ex'], 'only the sources the stories use');
});

test('Police & courts cards: no photo, the not-convicted note, safety section', async t => {
  t.mock.method(news, 'homeView', async () => view());
  const list = listOf((await call({ p: '/' })).body);
  const m = /<article class="card" data-sec="safety">([\s\S]*?)<\/article>/.exec(list);
  assert.ok(m, 'police card rendered');
  assert.ok(!m[1].includes('mug.jpg') && !m[1].includes('class="th"'), 'no photo');
  assert.match(m[1], /<a class="ca noimg"/);
  assert.match(m[1], /<p class="cl-note">Charged or arrested, not convicted\.<\/p>/);
});

test('escaping: HTML text and attributes escaped, bad links become #, JSON cannot close the script (</, U+2028)', async t => {
  t.mock.method(news, 'homeView', async () => view());
  const h = (await call({ p: '/' })).body, list = listOf(h), raw = blob(h);
  assert.ok(!/<script>alert|<img src=x|&amp; <b>|<i>Src/.test(list), 'no markup from the feed in the cards');
  assert.match(list, /Evil &lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; \u2028 &quot;q&quot; &#39;a&#39; &amp; &lt;b&gt;/);
  assert.match(list, /src="&quot; onerror=&quot;alert\(1\)"/, 'attribute value stays one attribute');
  assert.ok(!list.includes('javascript:'), 'javascript: link dropped');
  assert.ok(!/<\/script|<!--|\u2028|\u2029/i.test(raw), 'nothing in the JSON can end the element');
  assert.equal((h.match(/<\/script>/g) || []).length, (read('data/pages/index.html').match(/<\/script>/g) || []).length + 1, 'only our own script tags');
  const d = JSON.parse(raw);
  assert.ok(d.items.some(i => i.title.includes('</script><script>alert(1)</script> \u2028')), 'the JSON round-trips the exact text');
  assert.equal(C.jsonScript({ a: '</script>\u2028\u2029<!--' }), '{"a":"\\u003c/script\\u003e\\u2028\\u2029\\u003c!--"}');
});

test('Obituaries: obituary stories only, no ads, not one-per-row news class; Institutions likewise', async t => {
  t.mock.method(news, 'homeView', async () => view());
  const h = (await call({ p: '/obituaries' })).body, list = listOf(h);
  assert.match(list, /^<div id="list" class="list" aria-busy="false">/);
  assert.equal((list.match(/<article class="card/g) || []).length, 1);
  assert.ok(list.includes('Jane Doe obituary') && !/ad-card|ad-feed|Sponsored/.test(list));
  assert.equal(JSON.parse(blob(h)).cat, 'obits');
  assert.ok(!h.includes('<link rel="preload" href="/api/news"'));
  // no institution stories in the snapshot: the plain shell, short cache
  const ins = await call({ p: '/institutions' });
  assert.equal(blob(ins.body), null); assert.match(ins.body, /<div id="list" class="list" aria-busy="true"><\/div>/);
  assert.match(ins.headers['cache-control'], /s-maxage=60/);
});

test('board tabs never embed stories and keep their head, preload and day-long cache', async t => {
  const hv = t.mock.method(news, 'homeView', async () => view());
  for (const p of ['/events', '/jobs', '/deals', '/classifieds']) {
    const out = await call({ p });
    assert.equal(blob(out.body), null, p);
    assert.match(out.body, /<link rel="preload" href="\/api\/news"/, p);
    assert.equal(out.headers['cache-control'], 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400', p);
  }
  assert.equal(hv.mock.callCount(), 0, 'no store read for board tabs');
});

test('fallback: no snapshot, a throwing or slow store gives the plain shell with 200, never a 500', async t => {
  const shell = tab.page(require('../public/routes.js').byPath('/'));
  for (const impl of [async () => null, async () => { throw new Error('boom'); }, () => new Promise(() => {}), async () => ({ items: 'bad' })]) {
    t.mock.method(news, 'homeView', impl);
    const t0 = Date.now(), out = await call({ p: '/' });
    assert.equal(out.status, 200); assert.equal(out.body, shell);
    assert.ok(Date.now() - t0 < 3000, 'a slow store does not hold the page');
    assert.match(out.headers['cache-control'], /s-maxage=60/);
    t.mock.restoreAll();
  }
  // with no store configured at all (tests run with the store env vars unset), homeView is null
  assert.equal(await news.homeView(), null);
});

test('HEAD gets headers only; the shell file is never rewritten with stories', async t => {
  t.mock.method(news, 'homeView', async () => view());
  const before = read('data/pages/index.html');
  assert.equal((await call({ p: '/' }, 'HEAD')).body, '');
  await call({ p: '/' });
  assert.equal(read('data/pages/index.html'), before);
  assert.ok(!before.includes('id="tsn-data"') && before.includes('<div id="list" class="list" aria-busy="true"></div>'));
});

test('Breaking: an outlet-labeled story within 3 hours leads as the big card, once, with its prefix dropped', () => {
  const v = view();
  v.items.unshift({ id: 'b1', title: 'BREAKING: Bridge closed', link: 'https://ex.com/b1', summary: '', image: '', published: ago(20), source: 'Ex', sourceId: 'ex' });
  const p = C.pick(v, 'news', NOW), list = C.cards(p, NOW);
  assert.match(list, /^<article class="card breaking" data-sec="news"><a class="ca noimg"[^>]*><div class="bd"><div class="bk-head"><span class="pill pill-red"><i><\/i>Breaking<\/span><\/div>/);
  assert.match(list, /<h2>Bridge closed<\/h2>/);
  assert.equal((list.match(/Bridge closed/g) || []).length, 3, 'one card (title, like and share labels)');
  assert.equal((list.match(/<article /g) || []).length, 25, 'Breaking plus 24 stories');
});

test('app.js draws from #tsn-data before loading, without skeletons, and counts only after the full answer', () => {
  const js = read('public/assets/app.js');
  assert.match(js, /getElementById\('tsn-data'\)/);
  assert.match(js, /d\.cat !== state\.cat \|\| SC\.key !== 'tristate'/);
  assert.ok(js.indexOf("getElementById('tsn-data')") < js.lastIndexOf('load(false);'), 'hydrate before the first load');
  assert.match(js, /state\.more = d\.more \|\| null; state\.partial = false;/);
  assert.match(js, /metaEl\.textContent = state\.partial \? upd :/);
});
