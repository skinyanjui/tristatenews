// Not-found page: unknown paths answer 404 with data/pages/404.html (noindex, no ads), hosted by api/inbox.js
// (?__route=notfound) so there is no new function. vercel.json keeps every route, tab and 308 redirect working.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const RT = require('../public/routes.js');
const NF = require('../api/_notfound.js');
const inbox = require('../api/inbox.js');
const page = fs.readFileSync(path.join(root, 'data/pages/404.html'), 'utf8');

function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = c => { r.statusCode = c; return r; };
  r.send = b => { r.body = b; return r; };
  r.json = b => { r.headers['content-type'] = 'application/json'; r.body = JSON.stringify(b); return r; };
  return r;
}
const call = (h, url, method = 'GET', query = {}) => { const res = fakeRes(); h({ method, url, query, headers: {} }, res); return res; };

// ---- the page ----
test('the 404 page is noindex, links every section and offers search', () => {
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /<title>Page not found · Tri-State News<\/title>/);
  for (const [href, label] of [['/', 'News'], ['/events', 'Events'], ['/obituaries', 'Obituaries'], ['/jobs', 'Jobs'], ['/deals', 'Deals'], ['/classifieds', 'Classifieds']])
    assert.ok(page.includes(`<a href="${href}">${label}</a>`), label);
  assert.match(page, /<form class="nf-q" role="search" method="get" action="\/">/);
  assert.match(page, /name="q" type="search"/);
  assert.ok(!/rel="canonical"/.test(page), 'no canonical on a 404');
});

test('the 404 page carries no ads, ad scripts or outside scripts', () => {
  assert.ok(!/<script[^>]+src=/i.test(page), 'no external scripts');
  for (const s of ['adslots', 'adsizes', 'featured.js', 'Sponsored', 'Sample ad', 'house-ad', 'data-slot', 'googlesyndication'])
    assert.ok(!page.includes(s), s);
  assert.ok(page.includes('/legal.css'), 'site styles');
});

test('the home page reads ?q= so the 404 search lands on results', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /new URLSearchParams\(location\.search\)\.get\('q'\)/);
});

// ---- the handler ----
test('handler: GET answers 404 HTML, noindex header; HEAD has no body', () => {
  const r = call(NF, '/no-such-page');
  assert.equal(r.statusCode, 404);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(r.body, page);
  const h = call(NF, '/no-such-page', 'HEAD');
  assert.equal(h.statusCode, 404); assert.equal(h.body, '');
  const p = call(NF, '/no-such-page', 'POST');
  assert.equal(p.statusCode, 404); assert.equal(p.headers.allow, 'GET, HEAD');
});

test('handler: unknown /api paths answer JSON 404, not HTML', () => {
  const r = call(NF, '/api/inbox?__route=notfound&api=1', 'GET', { __route: 'notfound', api: '1' });
  assert.equal(r.statusCode, 404);
  assert.deepEqual(JSON.parse(r.body), { error: 'not found' });
  assert.equal(r.headers['cache-control'], 'no-store');
  const d = call(NF, '/api/nope');
  assert.equal(d.statusCode, 404); assert.deepEqual(JSON.parse(d.body), { error: 'not found' });
});

test('inbox hosts the notfound route; /api/inbox alone still answers JSON 404', () => {
  const r = call(inbox, '/api/inbox?__route=notfound', 'GET', { __route: 'notfound' });
  assert.equal(r.statusCode, 404); assert.equal(r.body, page);
  const bare = call(inbox, '/api/inbox');
  assert.equal(bare.statusCode, 404); assert.deepEqual(JSON.parse(bare.body), { error: 'not found' });
});

test('still exactly 8 functions', () => {
  const fns = fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.equal(fns.length, 8, fns.join(','));
});

// ---- vercel.json routing, simulated: redirects, then the filesystem (public/ and functions), then rewrites ----
function toRe(src) {
  let re = '';
  for (const part of src.split('/').slice(1)) {
    let m;
    if ((m = /^:(\w+)\*$/.exec(part))) re += '(?:/(.*))?';
    else if ((m = /^:(\w+)\((.+)\)$/.exec(part))) re += '/(' + m[2] + ')';
    else if ((m = /^:(\w+)$/.exec(part))) re += '/([^/]+)';
    else re += '/' + part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + (re || '/') + '$', 'i');
}
const files = new Set(fs.readdirSync(path.join(root, 'public')).map(f => '/' + f));
const fns = new Set(fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_')).map(f => '/api/' + f.slice(0, -3)));
function route(p) {
  for (const r of vercel.redirects) if (toRe(r.source).test(p)) return { status: r.permanent ? 308 : 307, to: r.destination };
  if (p === '/') return { status: 200, file: '/index.html' };
  if (files.has(p)) return { status: 200, file: p };
  if (fns.has(p)) return { status: 200, fn: p };
  for (const r of vercel.rewrites) if (toRe(r.source).test(p)) {
    const d = r.destination;
    if (d.includes('__route=notfound')) return { status: 404, fn: d };
    return { status: 200, [d.startsWith('/api/') ? 'fn' : 'file']: d };
  }
  return { status: 404, platform: true };
}

test('catch-all rewrites are last and go to the notfound route', () => {
  const tail = vercel.rewrites.slice(-2);
  assert.deepEqual(tail, [{ source: '/api/:path*', destination: '/api/inbox?__route=notfound&api=1' }, { source: '/:path*', destination: '/api/inbox?__route=notfound' }]);
  assert.equal(vercel.rewrites.filter(r => r.destination.includes('notfound')).length, 2);
  assert.ok(Object.keys(vercel.functions['api/inbox.js'] || {}).includes('includeFiles') && vercel.functions['api/inbox.js'].includeFiles === 'data/pages/**');
});

test('unknown paths are 404s', () => {
  for (const p of ['/404test', '/foo/bar', '/zzz.html', '/events/extra', '/wp-login.php', '/.env'])
    assert.equal(route(p).status, 404, p);
  // /news/<state>[/<county>] goes to the county-page handler, which answers 404 itself for anything that isn't one of
  // our states or counties, and for every path while REGIONAL_ROUTES_ENABLED is off (test/scope.test.js).
  for (const p of ['/news/x', '/news/x/y']) assert.match(route(p).fn, /__route=geopage/, p);
  assert.match(route('/api/nope').fn, /api=1/);
  assert.doesNotMatch(route('/nope').fn, /api=1/);
});

test('every tab path and the home page stay 200 on index.html', () => {
  for (const r of RT.ROUTES) assert.deepEqual(route(r.path), { status: 200, file: '/index.html' }, r.path);
});

test('the 308 redirects for retired paths still run first', () => {
  for (const p of ['/all', '/liked', '/news', '/police-courts', '/police', '/courts', '/all/', '/news/'])
    assert.deepEqual(route(p), { status: 308, to: '/' }, p);
  for (const p of ['/events/', '/jobs/']) assert.deepEqual(route(p), { status: 308, to: '/:tab' }, p);
});

test('pages, files, functions and API rewrites are untouched', () => {
  for (const p of ['/legal.html', '/order.html', '/admin.html', '/unsubscribe.html', '/newsletter.html', '/robots.txt', '/sitemap.xml', '/favicon.svg', '/breaking.js', '/legal.css'])
    assert.equal(route(p).status, 200, p);
  assert.equal(route('/newsletter').file, '/newsletter.html');
  assert.equal(route('/advertise').fn, '/api/inbox?__route=adpage');
  for (const p of ['/api/news', '/api/listings', '/api/inbox', '/api/unsubscribe']) assert.deepEqual(route(p), { status: 200, fn: p }, p);
  for (const [p, d] of [['/api/subscribe', '/api/unsubscribe?__route=subscribe'], ['/api/packages', '/api/inbox?__route=packages'], ['/api/catalog', '/api/listings?__route=catalog'], ['/api/refresh', '/api/news?__route=refresh']])
    assert.deepEqual(route(p), { status: 200, fn: d }, p);
});

test('clean page paths serve their page instead of the home page', () => {
  for (const n of ['legal', 'privacy', 'terms', 'accessibility', 'advertising', 'copyright', 'corrections', 'order', 'creative', 'unsubscribe', 'admin']) {
    assert.ok(files.has('/' + n + '.html'), n + '.html exists');
    assert.deepEqual(route('/' + n), { status: 200, file: '/' + n + '.html' }, n);
  }
});

// ---- the local server matches ----
function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers })); }).on('error', reject);
  });
}
test('local server: unknown paths 404 with the page; tabs, pages and redirect targets 200', async t => {
  const port = await new Promise(resolve => { const s = require('net').createServer().listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => resolve(n)); }); });
  const env = Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1' });
  for (const k of Object.keys(env)) if (/^(KV_|UPSTASH_|REDIS_URL$|EXTRA_FEEDS$|STRIPE_|RESEND_|TSN_ALLOW_LIVE_REDIS$)/.test(k)) delete env[k];
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => srv.kill());
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start')), 30000);
    srv.stdout.on('data', d => { if (/running at/.test(String(d))) { clearTimeout(to); resolve(); } });
    let err = ''; srv.stderr.on('data', d => { err += d; });
    srv.on('exit', c => { clearTimeout(to); reject(new Error('server exited ' + c + ': ' + err.slice(0, 300))); });
  });
  const nf = await get(port, '/no-such-page');
  assert.equal(nf.status, 404); assert.match(nf.body, /We couldn’t find that page/); assert.equal(nf.headers['x-robots-tag'], 'noindex, nofollow');
  const api = await get(port, '/api/no-such-thing');
  assert.equal(api.status, 404); assert.deepEqual(JSON.parse(api.body), { error: 'not found' });
  for (const p of ['/all', '/liked/', '/news', '/police-courts', '/police', '/courts']) { const r = await get(port, p); assert.equal(r.status, 308, p); assert.equal(r.headers.location, '/', p); }
  for (const p of ['/', '/events', '/jobs/', '/obituaries', '/legal', '/legal.html', '/admin', '/newsletter']) assert.equal((await get(port, p)).status, 200, p);
});
