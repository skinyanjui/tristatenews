'use strict';
// ship111: Classifieds speed. Native GET /api/listings is Redis-only and never waits on the marketplace crawl.
// GET /api/market serves last-good immediately once the 30-minute window expires, and crawls in the background
// (Vercel waitUntil). Cold miss (nothing cached) still waits for the bounded crawl. Fake marketplace pages and a
// fake store only: EXTRA_FEEDS / SITE_URL / Redis env unset except inside the listings GET case.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'REDIS_URL', 'EXTRA_FEEDS', 'SITE_URL']) delete process.env[k];
const M = require('../api/_market.js');

const SITE = 'https://www.tristatemarketplace.com';
const SITEMAP = '<?xml version="1.0"?><urlset><url><loc>' + SITE + '/listing/camry</loc></url>' +
  '<url><loc>' + SITE + '/listing/wanted-sofa</loc></url></urlset>';
const page = o => '<html><head><title>' + o.title + ' | Tristate Market</title><meta name="description" content="' + o.meta + '"/></head><body>' +
  '<main class="dwrap"><div class="hero"></div><div class="section"><div class="metarow"><span class="pill">' + o.cat +
  '</span><span class="muted metaplace"><span>' + o.town + '</span></span></div><h1 class="dtitle">' + o.title +
  '</h1><div class="mprice"><span class="dprice">' + o.price + '</span></div></div></main></body></html>';
const CAMRY = page({ title: '2015 Ford Fusion Titanium, one owner', meta: '$11,900 · Evansville, IN. One-owner Fusion.', cat: 'Cars', town: 'Evansville, IN', price: '$11,900' });
const SOFA = page({ title: 'Wanted: sectional sofa', meta: '$400 · Evansville, IN. Looking for a clean sectional.', cat: 'Furniture', town: 'Evansville, IN', price: '$400' });
const GOOD = { [SITE + '/sitemap.xml']: SITEMAP, [SITE + '/listing/camry']: CAMRY, [SITE + '/listing/wanted-sofa']: SOFA };

function fakeFetch(map, calls, delay) {
  return async url => {
    calls && calls.push(url);
    if (delay) await new Promise(r => setTimeout(r, delay));
    const body = map[url];
    if (body instanceof Error) throw body;
    return body == null ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => body };
  };
}

test('ship111: last-good after 30 min returns in well under a crawl; cold miss waits; sample count 2', async () => {
  M.reset();
  const t0 = Date.parse('2026-11-06T12:00:00Z'), CRAWL = 400, calls = [];
  const tCold = Date.now();
  const cold = await M.load({ fetch: fakeFetch(GOOD, calls, CRAWL), now: t0 });
  const coldMs = Date.now() - tCold;
  assert.equal(cold.ok, true); assert.equal(cold.stale, false); assert.equal(cold.items.length, 2);
  assert.ok(coldMs >= CRAWL, 'cold waits for the sitemap: ' + coldMs + 'ms');

  const tStale = Date.now();
  const stale = await M.load({ fetch: fakeFetch(GOOD, [], CRAWL), now: t0 + 31 * 60000 });
  const staleMs = Date.now() - tStale;
  assert.equal(stale.ok, true); assert.equal(stale.stale, true); assert.equal(stale.refreshing, true);
  assert.equal(stale.items.length, 2); assert.equal(stale.at, t0);
  assert.ok(staleMs < CRAWL, 'stale-good does not wait for the crawl: ' + staleMs + 'ms vs crawl ' + CRAWL + 'ms');
  assert.ok(staleMs < 80, 'stale-good is prompt: ' + staleMs + 'ms');

  await M.pending();
  const warm = await M.load({ fetch: fakeFetch({}, []), now: t0 + 32 * 60000 });
  assert.equal(warm.stale, false); assert.equal(warm.items.length, 2);
  console.log('# classifieds market timing (2 sample listings, crawl delay ' + CRAWL + 'ms): cold=' + coldMs + 'ms stale-good=' + staleMs + 'ms warm-after-refresh=0-fetch');
});

test('ship111: a failed background crawl keeps last-good as stale and does not scrape again for 30 min', async () => {
  M.reset();
  const t0 = Date.parse('2026-11-06T12:00:00Z');
  await M.load({ fetch: fakeFetch(GOOD), now: t0 });
  const calls = [];
  const r = await M.load({ fetch: fakeFetch({ [SITE + '/sitemap.xml']: new Error('down') }, calls), now: t0 + 31 * 60000 });
  assert.equal(r.stale, true); assert.equal(r.refreshing, true);
  await M.pending();
  assert.ok(calls.length >= 1, 'the background crawl ran');
  const n = calls.length;
  const again = await M.load({ fetch: fakeFetch({ [SITE + '/sitemap.xml']: new Error('down') }, calls), now: t0 + 40 * 60000 });
  assert.equal(again.ok, true); assert.equal(again.stale, true); assert.equal(again.refreshing, false);
  assert.equal(calls.length, n, 'no scrape during the failure cool-off');
});

test('ship111: two overlapping loads share one crawl (no duplicate sitemap)', async () => {
  M.reset();
  const calls = [];
  const fetchImpl = fakeFetch(GOOD, calls, 80);
  const a = M.load({ fetch: fetchImpl, now: 1 });
  const b = M.load({ fetch: fetchImpl, now: 1 });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.items.length, 2); assert.equal(rb.items.length, 2);
  assert.equal(calls.filter(u => u.endsWith('/sitemap.xml')).length, 1);
});

test('ship111: native /api/listings GET is Redis-only and finishes while a marketplace crawl would still be running', async () => {
  const listingsSrc = read('api/listings.js');
  assert.match(listingsSrc, /market: \(\) => require\('\.\/_market\.js'\)/);
  const getBody = listingsSrc.slice(listingsSrc.indexOf('if (req.method === \'GET\')'), listingsSrc.indexOf('if (req.method === \'POST\' && body.action === \'report\')'));
  assert.ok(!/_market|tristatemarketplace|\/api\/market/.test(getBody), 'the listings GET path never loads the marketplace');

  const z = new Map(), kv = new Map();
  const rec = { title: 'Oak table', price: '$40', town: 'Evansville, IN', desc: 'Solid oak.', contact: '812-555-0100', category: 'Furniture', at: new Date().toISOString() };
  kv.set('tsn:ls:n1abcdef', JSON.stringify(rec));
  z.set('tsn:ls:index', new Map([['n1abcdef', Date.now()]]));
  const run = ([op, k, ...a]) => {
    op = String(op).toUpperCase();
    if (op === 'ZREVRANGEBYSCORE') return { result: ['n1abcdef'] };
    if (op === 'GET') return { result: kv.get(k) || null };
    return { result: null };
  };
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(JSON.parse(b).map(run))); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const hung = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).includes('tristatemarketplace')) { hung.push(url); await new Promise(() => {}); }
    return realFetch(url, init);
  };
  process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:' + srv.address().port;
  process.env.UPSTASH_REDIS_REST_TOKEN = 't';
  try {
    delete require.cache[require.resolve('../api/_store.js')];
    delete require.cache[require.resolve('../api/listings.js')];
    const listings = require('../api/listings.js');
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
    const t0 = Date.now();
    await Promise.race([
      listings({ method: 'GET', url: '/api/listings', query: { kind: 'item' }, headers: {} }, res),
      new Promise((_, no) => setTimeout(() => no(new Error('listings GET waited on marketplace')), 500)),
    ]);
    const ms = Date.now() - t0;
    assert.equal(res.code, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.configured, true);
    assert.equal(body.items[0].title, 'Oak table');
    assert.equal(hung.length, 0, 'marketplace was not requested');
    assert.ok(ms < 400, 'native GET is prompt: ' + ms + 'ms');
    console.log('# classifieds native listings GET: ' + ms + 'ms, items=1, marketplace fetches=' + hung.length);
  } finally {
    global.fetch = realFetch;
    srv.close();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete require.cache[require.resolve('../api/_store.js')];
    delete require.cache[require.resolve('../api/listings.js')];
  }
});

test('ship111: /api/market is still listings.js (8 functions); page fetches native and market separately', () => {
  assert.equal(fs.readdirSync(path.join(root, 'api')).filter(n => n.endsWith('.js') && !n.startsWith('_')).length, 8);
  const js = read('public/assets/app.js');
  assert.ok(!/Promise\.all\(\s*\[[^\]]*(listings[^\]]*)market/.test(js));
  assert.match(js, /fetch\('\/api\/listings\?kind=' \+ kind/);
  assert.match(js, /fetch\('\/api\/market'/);
  assert.match(js, /if \(isCl\) \{ renderClassifieds\(\);/);
  assert.match(read('api/_market.js'), /waitUntil/);
  assert.match(read('api/_market.js'), /stale: true/);
});

function fortyMap() {
  const slugs = Array.from({ length: 40 }, (_, i) => 'item-' + i);
  const sitemap = '<?xml version="1.0"?><urlset>' + slugs.map(s => '<url><loc>' + SITE + '/listing/' + s + '</loc></url>').join('') + '</urlset>';
  const map = { [SITE + '/sitemap.xml']: sitemap };
  slugs.forEach((s, i) => { map[SITE + '/listing/' + s] = page({ title: 'Listing number ' + i, meta: '$' + i + ' · Evansville, IN.', cat: 'Furniture', town: 'Evansville, IN', price: '$' + i }); });
  return map;
}

test('ship111: 40 listing pages at 250ms each: cold waits for the concurrent crawl; stale-good returns at once; waitUntil keeps the crawl', async () => {
  M.reset();
  const DELAY = 250, map = fortyMap(), calls = [];
  const t0 = Date.parse('2026-11-06T12:00:00Z');
  const tCold = Date.now();
  const cold = await M.load({ fetch: fakeFetch(map, calls, DELAY), now: t0 });
  const coldMs = Date.now() - tCold;
  assert.equal(cold.ok, true); assert.equal(cold.stale, false); assert.equal(cold.items.length, 40);
  assert.equal(calls.length, 41, 'sitemap + 40 pages');
  assert.ok(coldMs >= DELAY * 2, 'cold waits for concurrent batches: ' + coldMs + 'ms');
  assert.ok(coldMs < M.LIMITS.DEADLINE_MS, 'cold finishes inside the deadline: ' + coldMs + 'ms');

  let bg = null;
  const tStale = Date.now();
  const stale = await M.load({ fetch: fakeFetch(map, [], DELAY), now: t0 + 31 * 60000, background: p => { bg = p; return p; } });
  const staleMs = Date.now() - tStale;
  assert.equal(stale.ok, true); assert.equal(stale.stale, true); assert.equal(stale.refreshing, true);
  assert.equal(stale.items.length, 40);
  assert.ok(staleMs < 80, 'stale-good of 40 listings is prompt: ' + staleMs + 'ms');
  assert.ok(bg, 'the crawl was handed to waitUntil');
  assert.ok(M.pending(), 'inflight is still running after the handler-equivalent return');
  await bg;
  assert.equal(M.pending(), null);
  const warm = await M.load({ fetch: fakeFetch({}, []), now: t0 + 32 * 60000 });
  assert.equal(warm.stale, false); assert.equal(warm.items.length, 40);
  console.log('# classifieds 40-page timing delay=' + DELAY + 'ms: cold=' + coldMs + 'ms stale-good=' + staleMs + 'ms');
});

test('ship111: handler returns before a stale crawl finishes; Vercel waitUntil keeps it; stale answers are no-store', async () => {
  M.reset();
  const t0 = Date.parse('2026-11-06T12:00:00Z');
  await M.load({ fetch: fakeFetch(GOOD), now: t0 });
  let finished = false, waited = null;
  const prev = globalThis[Symbol.for('@vercel/request-context')];
  globalThis[Symbol.for('@vercel/request-context')] = { get: () => ({ waitUntil(p) { waited = p.then(v => { finished = true; return v; }); return waited; } }) };
  const realFetch = global.fetch;
  global.fetch = fakeFetch(GOOD, [], 400);
  const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  try {
    const tH = Date.now();
    await M({ method: 'GET' }, res);
    const handlerMs = Date.now() - tH;
    const body = JSON.parse(res.body);
    assert.equal(res.code, 200);
    assert.equal(body.stale, true);
    assert.equal(body.refreshing, true);
    assert.equal(body.items.length, 2);
    assert.equal(res.h['Cache-Control'], 'no-store');
    assert.ok(handlerMs < 80, 'handler did not wait for the crawl: ' + handlerMs + 'ms');
    assert.equal(finished, false, 'crawl still running after the handler returned');
    assert.ok(waited);
    await waited;
    assert.equal(finished, true);
    console.log('# classifieds handler-return-before-crawl: ' + handlerMs + 'ms');
  } finally {
    global.fetch = realFetch;
    if (prev) globalThis[Symbol.for('@vercel/request-context')] = prev;
    else delete globalThis[Symbol.for('@vercel/request-context')];
  }
});

test('ship111: Redis read failure does not block a cold crawl; a held lock still serves last-good', async () => {
  M.reset();
  const t0 = Date.parse('2026-11-06T12:00:00Z');
  await M.load({ fetch: fakeFetch(GOOD), now: t0 });

  const kv = new Map();
  kv.set('tsn:mk:lock', String(Date.now()));
  const run = ([op, k]) => {
    op = String(op).toUpperCase();
    if (op === 'SET' && k === 'tsn:mk:lock') return { result: null };
    if (op === 'GET' && k === 'tsn:mk:last') return { result: JSON.stringify({ at: t0, items: [{ id: 'mk-camry', title: 'cached' }] }) };
    if (op === 'DEL') return { result: 1 };
    return { result: null };
  };
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(JSON.parse(b).map(run))); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:' + srv.address().port;
  process.env.UPSTASH_REDIS_REST_TOKEN = 't';
  delete require.cache[require.resolve('../api/_store.js')];
  delete require.cache[require.resolve('../api/_market.js')];
  const M2 = require('../api/_market.js');
  const calls = [];
  try {
    M2.reset();
    const locked = await M2.load({ fetch: fakeFetch(GOOD, calls, 50), now: t0 + 31 * 60000 });
    await M2.pending();
    assert.equal(locked.ok, true); assert.equal(locked.stale, true); assert.equal(locked.refreshing, true);
    assert.equal(calls.filter(u => String(u).includes('/listing/')).length, 0, 'lock holder does not scrape');

    srv.close();
    const down = http.createServer((req, res) => { res.statusCode = 500; res.end('no'); });
    await new Promise(r => down.listen(0, '127.0.0.1', r));
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:' + down.address().port;
    delete require.cache[require.resolve('../api/_store.js')];
    delete require.cache[require.resolve('../api/_market.js')];
    const M3 = require('../api/_market.js');
    M3.reset();
    const cold = await M3.load({ fetch: fakeFetch(GOOD), now: t0 });
    assert.equal(cold.ok, true); assert.equal(cold.items.length, 2, 'crawl proceeds when Redis is down');
    down.close();
  } finally {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete require.cache[require.resolve('../api/_store.js')];
    delete require.cache[require.resolve('../api/_market.js')];
  }
});

test('ship111: a fresh answer is CDN-cacheable; stale and errors are no-store so last-good cannot trap the client', async () => {
  M.reset();
  const t0 = Date.parse('2026-11-06T12:00:00Z');
  const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  const realFetch = global.fetch;
  global.fetch = fakeFetch(GOOD);
  try {
    await M({ method: 'GET' }, res);
    assert.match(res.h['Cache-Control'], /s-maxage=1800/);
    M.reset();
    global.fetch = fakeFetch({ [SITE + '/sitemap.xml']: new Error('down') });
    const res2 = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
    await M({ method: 'GET' }, res2);
    assert.equal(res2.h['Cache-Control'], 'no-store');
    const body = JSON.parse(res2.body);
    assert.equal(body.ok, false); assert.equal(body.items.length, 0);
  } finally { global.fetch = realFetch; M.reset(); }
});
