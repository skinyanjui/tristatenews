// Tab URLs: every tab has a path, vercel.json rewrites each path to index.html, and the sitemap lists the indexable ones.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const RT = require('../public/routes.js');
const root = path.join(__dirname, '..');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const html = require('./_page.js')();
const sitemap = fs.readFileSync(path.join(root, 'public/sitemap.xml'), 'utf8');

test('every tab in index.html has a route, and paths are unique', () => {
  const cats = [...html.match(/var CATS = \[([\s\S]*?)\];/)[1].matchAll(/id: '([a-z]+)'/g)].map(m => m[1]);
  assert.ok(cats.length >= 7);
  assert.ok(!cats.includes('safety'), 'no Police & courts tab');
  assert.ok(!cats.includes('all') && !cats.includes('saved'), 'no All tab and no Liked page');
  for (const c of cats) assert.ok(RT.byCat(c), 'no route for tab ' + c);
  assert.equal(new Set(RT.ROUTES.map(r => r.path)).size, RT.ROUTES.length);
  assert.equal(RT.byPath('/').cat, 'news', 'News is the landing tab');
  for (const old of ['/all', '/all/', '/ALL', '/liked', '/news', '/news?x=1']) assert.equal(RT.byPath(old).cat, 'news', old);
});

test('vercel.json rewrites every non-root route to the tab page (index.html with its own head) and nothing else', () => {
  const rw = vercel.rewrites.find(r => r.destination === '/api/news?__route=tabpage&p=/:tab');
  assert.ok(!vercel.rewrites.some(r => r.destination === '/index.html'), 'no tab is served as the bare index.html');
  const alt = rw.source.match(/\(([^)]+)\)/)[1].split('|').map(x => '/' + x).sort();
  assert.deepEqual(alt, RT.ROUTES.filter(r => r.path !== '/').map(r => r.path).sort());
  for (const keep of ['/api/news', '/legal.html', '/unsubscribe.html', '/admin.html', '/breaking.js']) assert.ok(!new RegExp('^/(' + alt.map(a => a.slice(1)).join('|') + ')$').test(keep), keep);
});

test('sitemap lists every indexable route, and not /news, /all or /liked', () => {
  for (const old of ['/news', '/all', '/liked']) assert.ok(!sitemap.includes('<loc>' + RT.ORIGIN + old + '</loc>'), old);
  for (const r of RT.ROUTES) assert.equal(sitemap.includes('<loc>' + RT.ORIGIN + r.path + '</loc>'), r.index, r.path);
  assert.ok(sitemap.includes('<loc>' + RT.ORIGIN + '/legal</loc>') && !sitemap.includes('/legal.html'));
});

test('path lookup ignores case, trailing slash, query and hash; titles and descriptions are distinct', () => {
  assert.equal(RT.byPath('/Jobs/?x=1#a').cat, 'jobs');
  for (const p of ['/police-courts', '/Police-Courts/?x=1#a', '/police', '/courts']) assert.equal(RT.byPath(p).cat, 'news', p);
  assert.equal(RT.byPath('/obituaries').cat, 'obits');
  assert.equal(RT.byPath('/nope'), null);
  assert.equal(new Set(RT.ROUTES.map(r => r.title)).size, RT.ROUTES.length);
  assert.equal(new Set(RT.ROUTES.map(r => r.desc)).size, RT.ROUTES.length);
  assert.equal(RT.byCat('safety'), null, 'no Police & courts route');
  assert.match(RT.byCat('news').desc, /police and courts/);
});

test('index.html loads routes.js in <head> before the first render', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<script src="/routes.js"></script>'));
  assert.ok(head.indexOf('/routes.js') < head.indexOf('TSNRoutes.apply'));
});

test('old All and Liked links redirect to News at /: vercel redirects, hash and ?tab= links', () => {
  for (const src of ['/:old(news|all|liked|police-courts|police|courts)', '/:old(news|all|liked|police-courts|police|courts)/']) {
    const r = vercel.redirects.find(x => x.source === src);
    assert.ok(r && r.destination === '/' && r.permanent, src);
  }
  for (const k of ['all', 'news', 'liked', 'saved', 'safety', 'police', 'courts', 'police-courts']) assert.ok(RT.OLD_TABS[k], k);
  assert.ok(!sitemap.includes('/police-courts'), 'not in the sitemap');
  assert.ok(html.includes('var oldH = !!RT.OLD_TABS[h], oldT = !!RT.OLD_TABS[t];'));
  assert.ok(!/\{ id: 'all'|\{ id: 'saved'|Nothing liked yet|state\.cat === 'saved'|state\.cat === 'all'/.test(html), 'no All tab or Liked page left');
  assert.ok(html.includes("cat: 'news', limit"), 'News is the default tab');
  assert.ok(html.includes('toggleSaved(it)') && html.includes("fetch('/api/react'"), 'hearts and shared counts stay');
});

test('News merges Police & courts items in feed order; their cards keep no photos and the not-convicted note; News ads never next to them', () => {
  const src = html.slice(html.indexOf('function inCat('), html.indexOf('function filtered('));
  const kinds = { n: 'news', p: 'police', c: 'courts', e: 'events', o: 'obits', i: 'institution' };
  const inCat = new Function('kindOf', src + '; return inCat;')(id => kinds[id]);
  const items = ['n', 'p', 'e', 'c', 'o', 'i', 'n'].map((k, i) => ({ sourceId: k, t: i }));
  assert.deepEqual(items.filter(i => inCat(i, 'news')).map(i => i.sourceId + i.t), ['n0', 'p1', 'c3', 'n6'], 'news + police + courts, same order');
  assert.ok(!/id: 'safety'/.test(html) && !RT.byCat('safety'), 'Police & courts has no tab of its own: its items are only in News');
  const mk = html.slice(html.indexOf('function makeCard('), html.indexOf('function makeCard(') + 3000);
  assert.ok(mk.includes("safe = kd === 'police' || kd === 'courts'") && mk.includes("var pic = safe ? '' : it.image;"), 'no photos, decided by source kind on every tab');
  assert.ok(mk.includes("if (safe && it.arrest) body.appendChild(el('p', 'cl-note', 'Charged or arrested, not convicted.'));"));
  assert.ok(html.includes("var AD_TABS = ['events', 'jobs', 'deals', 'classifieds', 'news'];"), 'News carries ads now (not Obituaries)');
  assert.ok(html.includes("return k === 'police' || k === 'courts'; }), TSNAds.NEWS_EVERY)"), 'the in-feed card knows which stories are Police & courts');
  assert.ok(html.includes("(state.cat === 'news')) ? [top] : []; // at most ONE Breaking item"), 'one Breaking item');
});
