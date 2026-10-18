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
  assert.ok(cats.length >= 9);
  for (const c of cats) assert.ok(RT.byCat(c), 'no route for tab ' + c);
  assert.equal(new Set(RT.ROUTES.map(r => r.path)).size, RT.ROUTES.length);
  assert.equal(RT.byPath('/').cat, 'all');
});

test('vercel.json rewrites every non-root route to /index.html and nothing else', () => {
  const rw = vercel.rewrites.find(r => r.destination === '/index.html');
  const alt = rw.source.match(/\(([^)]+)\)/)[1].split('|').map(x => '/' + x).sort();
  assert.deepEqual(alt, RT.ROUTES.filter(r => r.path !== '/').map(r => r.path).sort());
  for (const keep of ['/api/news', '/legal.html', '/unsubscribe.html', '/admin.html', '/breaking.js']) assert.ok(!new RegExp('^/(' + alt.map(a => a.slice(1)).join('|') + ')$').test(keep), keep);
});

test('sitemap lists every indexable route and not the Liked tab', () => {
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
