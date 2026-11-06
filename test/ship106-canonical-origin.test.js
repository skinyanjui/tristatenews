'use strict';
// ship106: the canonical origin is https://www.tristatenow.com, defined once (public/routes.js ORIGIN) and used by
// every canonical, og:url, og:image, JSON-LD url, both sitemaps, robots.txt and the email links. SITE_URL still
// overrides the email links (previews and local runs). The crawler user agents keep the hosting URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const RT = require('../public/routes.js');
const WWW = 'https://www.tristatenow.com';
const HEADS = [...fs.readdirSync(path.join(root, 'public')).filter(f => f.endsWith('.html')).map(f => 'public/' + f), ...fs.readdirSync(path.join(root, 'data/pages')).filter(f => f.endsWith('.html')).map(f => 'data/pages/' + f)];
const urlsIn = h => [...h.matchAll(/<link rel="canonical" href="([^"]+)"|<meta property="og:(?:url|image)" content="([^"]+)"|"url":"([^"]+)"/g)].map(m => m[1] || m[2] || m[3]);

test('ship106: one canonical origin', () => {
  assert.equal(RT.ORIGIN, WWW);
  assert.match(read('api/_geopage.js'), /const \{ ORIGIN \} = require\('\.\.\/public\/routes\.js'\);/);
  assert.match(read('public/assets/lib.js'), /var ORIGIN = 'https:\/\/www\.tristatenow\.com';/, 'the built bundle carries it');
});

test('ship106: every static head points canonical, og:url, og:image and JSON-LD at the www origin', () => {
  let n = 0;
  for (const f of HEADS) for (const u of urlsIn(read(f))) { n++; assert.ok(u.startsWith(WWW + '/'), f + ': ' + u); }
  assert.ok(n >= 15, 'found the heads (' + n + ')');
  const index = read('data/pages/index.html');
  for (const tag of ['<link rel="canonical" href="https://www.tristatenow.com/">', '<meta property="og:url" content="https://www.tristatenow.com/">', '<meta property="og:image" content="https://www.tristatenow.com/og.png">', '"url":"https://www.tristatenow.com/"'])
    assert.ok(index.includes(tag), tag);
});

test('ship106: robots.txt declares exactly the two www sitemaps', () => {
  const lines = read('public/robots.txt').split('\n').filter(l => /^Sitemap:/i.test(l));
  assert.deepEqual(lines, ['Sitemap: ' + WWW + '/sitemap.xml', 'Sitemap: ' + WWW + '/sitemap-regions.xml']);
});

test('ship106: sitemap.xml lists only www URLs, one per indexable tab plus legal and newsletter', () => {
  const locs = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.equal(locs.length, 8);
  for (const u of locs) assert.ok(u.startsWith(WWW + '/'), u);
  assert.deepEqual(locs.map(u => u.slice(WWW.length)), ['/', '/events', '/obituaries', '/jobs', '/deals', '/classifieds', '/legal', '/newsletter']);
});

test('ship106: the regional sitemap and county pages use the www origin', () => {
  process.env.REGIONAL_ROUTES_ENABLED = 'true';
  const G = require('../api/_geopage.js'), S = require('../api/_scope.js');
  const locs = [...G.sitemap().matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.length >= 3);
  for (const u of locs) assert.ok(u.startsWith(WWW + '/news/'), u);
  const h = G.page(S.parse('county:ky-henderson')).html;
  assert.ok(h.includes('<link rel="canonical" href="' + WWW + '/news/kentucky/henderson">'));
  assert.ok(h.includes('<meta property="og:url" content="' + WWW + '/news/kentucky/henderson">'));
});

test('ship106: every server-built tab page points its head at the www origin', () => {
  const T = require('../api/_tabpage.js');
  for (const r of RT.ROUTES) {
    const h = T.page(r), url = WWW + (r.path === '/' ? '/' : r.path);
    assert.ok(h.includes('<link rel="canonical" href="' + url + '">'), r.path);
    assert.ok(h.includes('<meta property="og:url" content="' + url + '">'), r.path);
  }
});

test('ship106: email links default to the www origin; SITE_URL still overrides them', () => {
  const saved = process.env.SITE_URL;
  delete process.env.SITE_URL;
  const U = require('../api/unsubscribe.js');
  assert.ok(U.link('a@b.co').startsWith(WWW + '/unsubscribe.html?email='));
  process.env.SITE_URL = 'http://127.0.0.1:3077/';
  assert.ok(U.link('a@b.co').startsWith('http://127.0.0.1:3077/unsubscribe.html?email='));
  if (saved === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = saved;
  for (const f of ['api/_subscribe.js', 'api/newsletter.js']) assert.match(read(f), /process\.env\.SITE_URL \|\| ORIGIN\)/, f);
});

test('ship106: the hosting URL survives only in the crawler user agents', () => {
  const files = ['README.md', 'server.js', 'vercel.json', 'public/robots.txt', 'public/sitemap.xml', ...HEADS,
    ...fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js')).map(f => 'api/' + f),
    ...['routes.js', 'assets/lib.js', 'assets/app.js'].map(f => 'public/' + f), ...fs.readdirSync(path.join(root, 'scripts')).filter(f => f.endsWith('.js')).map(f => 'scripts/' + f)];
  for (const f of files) for (const line of read(f).split('\n').filter(l => l.includes('tristatenewss.vercel.app')))
    assert.match(line, /USER_AGENT = |DEFAULT_UA = |const UA = |The old default, /, f + ': ' + line.trim().slice(0, 120));
});
