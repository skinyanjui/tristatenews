// Ads PR 1: GET /api/catalog (read-only, hosted by api/listings.js through a vercel.json rewrite; no new function) and
// the page reading its prices from it, showing price and duration before checkout. No network: fetch is intercepted.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const C = require('../api/_catalog.js');

// ---- handlers with a faked store and Stripe ----
function fakeWorld() {
  const kv = new Map(), z = new Map(), ttl = new Map(), stripe = [], log = [];
  const run = ([op, k, ...a]) => {
    log.push([op, k, ...a]);
    switch (op) {
      case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
      case 'SET': { if (a.includes('NX') && kv.has(k)) return { result: null }; kv.set(k, a[0]); const i = a.indexOf('EX'); if (i >= 0) ttl.set(k, Number(a[i + 1])); return { result: 'OK' }; }
      case 'ZSCORE': return { result: z.has(k) && z.get(k).has(a[0]) ? String(z.get(k).get(a[0])) : null };
      case 'ZADD': { const s = z.get(k) || new Map(); z.set(k, s); s.set(a[1], Number(a[0])); return { result: 1 }; }
      default: return { result: null };
    }
  };
  const fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith('https://kv.test/')) return new Response(JSON.stringify(JSON.parse(init.body).map(run)), { status: 200 });
    if (url === 'https://api.stripe.com/v1/checkout/sessions') { const form = new URLSearchParams(String(init.body)); stripe.push(form); return new Response(JSON.stringify({ id: 'cs_test_' + stripe.length, url: 'https://checkout.stripe.com/c/pay/cs_test_' + stripe.length }), { status: 200 }); }
    throw new Error('unexpected fetch ' + url);
  };
  return { kv, z, ttl, stripe, log, fetch };
}
const ENV = { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: 'whsec_placeholder', SITE_URL: 'https://site.test' };
async function withWorld(env, fn) {
  const saved = { ...process.env }, realFetch = global.fetch, w = fakeWorld();
  for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k];
  Object.assign(process.env, env); global.fetch = w.fetch;
  try { return await fn(f => require(path.join(API, f + '.js')), w); } finally { process.env = saved; global.fetch = realFetch; for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k]; }
}
function mockRes() {
  const r = { code: 200, body: undefined, headers: {} };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; };
  r.status = c => { r.code = c; return r; };
  r.send = s => { try { r.body = JSON.parse(s); } catch (_) { r.body = s; } return r; };
  r.json = o => { r.body = JSON.parse(JSON.stringify(o)); return r; };
  r.end = () => r;
  return r;
}
const call = async (fn, req) => { const res = mockRes(); await fn(Object.assign({ headers: {}, query: {} }, req), res); return res; };

test('GET /api/catalog: same answer from listings.js (Vercel rewrite and local path) as from the handler; read-only', async () => {
  for (const env of [Object.assign({}, ENV, { STRIPE_SECRET_KEY: '' }), ENV]) {
    await withWorld(env, async (mod, w) => {
      const direct = await call(mod('_catalog'), { method: 'GET', url: '/api/catalog' });
      const vercel = await call(mod('listings'), { method: 'GET', url: '/api/listings?__route=catalog', query: { __route: 'catalog' } });
      const local = await call(mod('listings'), { method: 'GET', url: '/api/catalog' });
      assert.strictEqual(direct.code, 200);
      assert.deepStrictEqual(vercel.body, direct.body); assert.deepStrictEqual(local.body, direct.body);
      assert.deepStrictEqual(direct.body, JSON.parse(JSON.stringify(C.publicCatalog(!!env.STRIPE_SECRET_KEY))));
      assert.match(direct.headers['cache-control'], /public/);
      assert.strictEqual((await call(mod('listings'), { method: 'POST', url: '/api/catalog', body: { cents: 1 } })).code, 405);
      assert.deepStrictEqual(w.log, [], 'no store commands');
    });
  }
});

test('the page reads prices from /api/catalog and shows price and duration before checkout', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.ok(html.includes("fetch('/api/catalog')"));
  assert.ok(!/fetch\('\/api\/checkout', \{ cache/.test(html), 'prices no longer come from GET /api/checkout');
  assert.ok(html.includes("'Feature for ' + pr.days + ' days · ' + money(pr.cents)"));
  assert.ok(html.includes("['item', 'Featured classified']"));
  for (const old of ['$29/30', '2900', '1500, days']) assert.ok(!html.includes(old), old);
  // the money() formatter, extracted and run
  const src = html.match(/function money\(c\) \{[^\n]*\}/)[0];
  const money = new Function(src + '; return money;')();
  assert.deepStrictEqual([1900, 5900, 119900, 249900, 1950].map(money), ['$19', '$59', '$1,199', '$2,499', '$19.50']);
});
