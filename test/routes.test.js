// Tab URLs: every tab has a path, vercel.json rewrites each path to index.html, and the sitemap lists the indexable ones.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const RT = require('../public/routes.js');
const root = path.join(__dirname, '..');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'public/sitemap.xml'), 'utf8');

test('every tab in index.html has a route, and paths are unique', () => {
  const cats = [...html.match(/var CATS = \[([\s\S]*?)\];/)[1].matchAll(/id: '([a-z]+)'/g)].map(m => m[1]);
  assert.ok(cats.length >= 8);
  assert.ok(!cats.includes('all') && !cats.includes('saved'), 'no All tab and no Liked page');
  for (const c of cats) assert.ok(RT.byCat(c), 'no route for tab ' + c);
  assert.equal(new Set(RT.ROUTES.map(r => r.path)).size, RT.ROUTES.length);
  assert.equal(RT.byPath('/').cat, 'news', 'News is the landing tab');
  for (const old of ['/all', '/all/', '/ALL', '/liked', '/news', '/news?x=1']) assert.equal(RT.byPath(old).cat, 'news', old);
});

test('vercel.json rewrites every non-root route to /index.html and nothing else', () => {
  const rw = vercel.rewrites.find(r => r.destination === '/index.html');
  const alt = rw.source.match(/\(([^)]+)\)/)[1].split('|').map(x => '/' + x).sort();
  assert.deepEqual(alt, RT.ROUTES.filter(r => r.path !== '/').map(r => r.path).sort());
  for (const keep of ['/api/news', '/legal.html', '/unsubscribe.html', '/admin.html', '/breaking.js']) assert.ok(!new RegExp('^/(' + alt.map(a => a.slice(1)).join('|') + ')$').test(keep), keep);
});

test('sitemap lists every indexable route, and not /news, /all or /liked', () => {
  for (const old of ['/news', '/all', '/liked']) assert.ok(!sitemap.includes('<loc>' + RT.ORIGIN + old + '</loc>'), old);
  for (const r of RT.ROUTES) assert.equal(sitemap.includes('<loc>' + RT.ORIGIN + r.path + '</loc>'), r.index, r.path);
  assert.ok(sitemap.includes('/legal.html'));
});

test('path lookup ignores case, trailing slash, query and hash; titles and descriptions are distinct', () => {
  assert.equal(RT.byPath('/Police-Courts/?x=1#a').cat, 'safety');
  assert.equal(RT.byPath('/obituaries').cat, 'obits');
  assert.equal(RT.byPath('/nope'), null);
  assert.equal(new Set(RT.ROUTES.map(r => r.title)).size, RT.ROUTES.length);
  assert.equal(new Set(RT.ROUTES.map(r => r.desc)).size, RT.ROUTES.length);
  assert.match(RT.byCat('safety').desc, /not convicted/);
});

test('index.html loads routes.js in <head> before the first render', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<script src="/routes.js"></script>'));
  assert.ok(head.indexOf('/routes.js') < head.indexOf('TSNRoutes.apply'));
});

test('old All and Liked links redirect to News at /: vercel redirects, hash and ?tab= links', () => {
  for (const src of ['/:old(news|all|liked)', '/:old(news|all|liked)/']) {
    const r = vercel.redirects.find(x => x.source === src);
    assert.ok(r && r.destination === '/' && r.permanent, src);
  }
  for (const k of ['all', 'news', 'liked', 'saved']) assert.ok(RT.OLD_TABS[k], k);
  assert.ok(html.includes('var oldH = !!RT.OLD_TABS[h], oldT = !!RT.OLD_TABS[t];'));
  assert.ok(!/\{ id: 'all'|\{ id: 'saved'|Nothing liked yet|state\.cat === 'saved'|state\.cat === 'all'/.test(html), 'no All tab or Liked page left');
  assert.ok(html.includes("cat: 'news', limit"), 'News is the default tab');
  assert.ok(html.includes('toggleSaved(it)') && html.includes("fetch('/api/react'"), 'hearts and shared counts stay');
});

test('News merges Police & courts items in feed order; their cards keep no photos and the not-convicted note; no ads on News', () => {
  const src = html.slice(html.indexOf('function inCat('), html.indexOf('function filtered('));
  const kinds = { n: 'news', p: 'police', c: 'courts', e: 'events', o: 'obits', i: 'institution' };
  const inCat = new Function('kindOf', src + '; return inCat;')(id => kinds[id]);
  const items = ['n', 'p', 'e', 'c', 'o', 'i', 'n'].map((k, i) => ({ sourceId: k, t: i }));
  assert.deepEqual(items.filter(i => inCat(i, 'news')).map(i => i.sourceId + i.t), ['n0', 'p1', 'c3', 'n6'], 'news + police + courts, same order');
  assert.deepEqual(items.filter(i => inCat(i, 'safety')).map(i => i.sourceId), ['p', 'c'], 'Police & courts tab unchanged');
  assert.ok(RT.byCat('safety') && /id: 'safety'/.test(html), 'the Police & courts tab stays');
  const mk = html.slice(html.indexOf('function makeCard('), html.indexOf('function makeCard(') + 3000);
  assert.ok(mk.includes("safe = kd === 'police' || kd === 'courts'") && mk.includes("var pic = safe ? '' : it.image;"), 'no photos, decided by source kind on every tab');
  assert.ok(mk.includes("if (safe && it.arrest) body.appendChild(el('p', 'cl-note', 'Charged or arrested, not convicted.'));"));
  assert.ok(html.includes("var AD_TABS = ['events', 'jobs', 'deals', 'classifieds'];"), 'no ads on News');
  assert.ok(html.includes("(state.cat === 'news')) ? [top] : []; // at most ONE Breaking item"), 'one Breaking item');
});
