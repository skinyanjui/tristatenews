// Ship 65: each tab arrives with its own head (api/_tabpage.js), the home page's CSS and JS are cacheable files
// (public/assets, scripts/build-assets.js), /advertise's fallback redirect is permanent, and /legal is the legal URL.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const RT = require('../public/routes.js');
const tab = require('../api/_tabpage.js');
const B = require('../scripts/build-assets.js');
const vercel = JSON.parse(read('vercel.json'));

function call(handler, query, method) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
      send(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); }, json(b) { this.send(JSON.stringify(b)); } };
    handler({ method: method || 'GET', query, headers: {}, url: '/' }, res);
  });
}
const head = h => h.slice(0, h.indexOf('</head>'));
const one = (h, re) => { const m = h.match(re); return m && m[1]; };

test('each tab is served with its own title, description, canonical and og tags, matching public/routes.js', async () => {
  for (const r of RT.ROUTES.filter(x => x.path !== '/')) {
    const out = await call(tab, { p: r.path });
    assert.equal(out.status, 200, r.path);
    const h = head(out.body), url = RT.ORIGIN + r.path, esc = s => s.replace(/&/g, '&amp;');
    assert.equal(one(h, /<title>([^<]*)<\/title>/), esc(r.title), r.path);
    assert.equal(one(h, /<meta name="description" content="([^"]*)"/), esc(r.desc), r.path);
    assert.equal(one(h, /<link rel="canonical" href="([^"]*)"/), url, r.path);
    assert.equal(one(h, /<meta property="og:url" content="([^"]*)"/), url, r.path);
    assert.equal(one(h, /<meta property="og:title" content="([^"]*)"/), esc(r.title), r.path);
    assert.equal(one(h, /<meta property="og:description" content="([^"]*)"/), esc(r.desc), r.path);
    assert.equal(/<meta name="robots" content="noindex">/.test(h), !r.index, r.path);
    assert.equal(out.headers['x-robots-tag'] === 'noindex', !r.index, r.path);
    assert.match(out.headers['cache-control'], /s-maxage=/);
    assert.ok(h.includes('name="google-site-verification"'), 'verification meta kept');
  }
  const jobs = await call(tab, { p: '/jobs/' });
  assert.match(jobs.body, /<title>Jobs · Tri-State News<\/title>/, 'trailing slash');
  assert.equal((await call(tab, { p: '/jobs' }, 'HEAD')).body, '');
  assert.equal((await call(tab, { p: '/jobs' }, 'POST')).status, 405);
});

test('a path that is not a tab gets the not-found page; "/" stays the static index.html with the News head', async () => {
  assert.equal((await call(tab, { p: '/nope' })).status, 404);
  const home = read('public/index.html'), news = RT.byPath('/');
  assert.equal(one(home, /<title>([^<]*)<\/title>/), news.title);
  assert.equal(one(home, /<link rel="canonical" href="([^"]*)"/), RT.ORIGIN + '/');
});

test('the tab page is hosted by api/news.js: still exactly 8 functions, index.html bundled with it', () => {
  const fns = fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.equal(fns.length, 8, fns.join(', '));
  assert.match(read('api/news.js'), /tabpage: \(\) => require\('\.\/_tabpage\.js'\)/);
  assert.match(vercel.functions['api/news.js'].includeFiles, /public\/index\.html/);
});

test('home page CSS and JS are cacheable files, loaded with a fresh content hash', () => {
  const html = read('public/index.html');
  assert.ok(!/<style>/.test(html), 'no inline <style> block');
  assert.ok(!/<script>\s*\(function \(\) \{/.test(html), 'no inline app script');
  assert.ok(html.includes(B.cssTag(B.hash(read('public/assets/app.css')))), 'app.css ?v= is current: run node scripts/build-assets.js');
  assert.ok(html.includes(B.jsTag(B.hash(read('public/assets/app.js')))), 'app.js ?v= is current: run node scripts/build-assets.js');
  assert.ok(html.indexOf('/assets/app.css') < html.indexOf('</head>'), 'CSS in the head');
  // ship68: lib.js then app.js, both defer in <head> (they run in order after the document is parsed)
  assert.ok(html.includes(B.libTag(B.hash(read('public/assets/lib.js')))), 'lib.js ?v= is current');
  assert.ok(html.indexOf('/assets/lib.js') < html.indexOf('/assets/app.js') && html.indexOf('/assets/app.js') < html.indexOf('</head>'), 'lib.js, then app.js, in the head');
  const h = vercel.headers.find(x => x.source === '/assets/(.*)');
  assert.ok(h && h.headers.some(k => k.key === 'Cache-Control' && /max-age=31536000/.test(k.value) && /immutable/.test(k.value)));
  assert.ok(html.length < 20000, 'first HTML is small: ' + html.length);
});

test('/advertise fallback is a permanent redirect; /legal is the one legal URL', () => {
  assert.match(read('api/_adpage.js'), /res\.status\(308\)/);
  assert.deepEqual(vercel.redirects.find(r => r.source === '/legal.html'), { source: '/legal.html', destination: '/legal', permanent: true });
  const sm = read('public/sitemap.xml');
  assert.ok(sm.includes('<loc>' + RT.ORIGIN + '/legal</loc>') && !sm.includes('legal.html'));
  for (const f of ['public/index.html', 'public/assets/app.js', 'data/pages/404.html', 'data/pages/advertise.html', 'api/newsletter.js'])
    assert.ok(!read(f).includes('/legal.html'), f + ' links /legal directly');
});
