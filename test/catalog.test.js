// Ads PR 1: the server-side catalog (api/_catalog.js), checkout reading prices only from it, and purchases made
// before the catalog keeping what they bought. No network: the Upstash store and Stripe are faked by
// intercepting fetch, with placeholder keys.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const C = require('../api/_catalog.js');

const isCents = n => Number.isInteger(n) && n > 0;

test('Featured prices in integer cents, with durations', () => {
  const want = { item: [1900, 7], event: [5900, 7], deal: [7900, 14], job: [9900, 30] };
  assert.deepStrictEqual(Object.keys(C.FEATURED).sort(), Object.keys(want).sort());
  for (const [k, [cents, days]] of Object.entries(want)) {
    const p = C.featuredPrice(k);
    assert.deepStrictEqual([p.cents, p.days, p.priceVersion], [cents, days, C.PRICE_VERSION], k);
    assert.ok(isCents(p.cents) && Number.isInteger(p.days), k);
  }
  for (const k of ['obit', 'news', '', undefined, '__proto__', 'constructor', 'toString']) assert.strictEqual(C.featuredPrice(k), null, String(k));
});

test('Packages A–D: $249, $599, $1,199, $2,499 per 30 days; D is request-proposal; A–C ordered online (ads Phase 6)', () => {
  const want = { A: 24900, B: 59900, C: 119900, D: 249900 };
  for (const [id, cents] of Object.entries(want)) { assert.strictEqual(C.PACKAGES[id].cents, cents, id); assert.strictEqual(C.PACKAGES[id].days, 30, id); }
  assert.strictEqual(C.PACKAGES.D.status, 'request_proposal');
  assert.deepStrictEqual(C.packageEligibility('D'), { ok: false, reason: 'request_proposal' });
  for (const id of ['A', 'B', 'C']) { assert.deepStrictEqual(C.packageEligibility(id), { ok: true }, id); assert.strictEqual(C.PACKAGES[id].status, 'available', id); }
  assert.deepStrictEqual(['A', 'B', 'C'].map(id => C.PACKAGES[id].contents), [
    { boardCards: 1, sponsorLines: 1, newsCard: false, sideAds: false },
    { boardCards: 2, sponsorLines: 1, newsCard: true, sideAds: false },
    { boardCards: 4, sponsorLines: 2, newsCard: true, sideAds: true }]);
  assert.ok(!('contents' in C.PACKAGES.D), 'D has no fixed contents: it is quoted');
  for (const id of ['E', '', '__proto__', 'constructor']) assert.deepStrictEqual(C.packageEligibility(id), { ok: false, reason: 'unknown_package' }, id);
});

test('Newsletter $199 single / $699 for 4 sends, dedicated email by proposal: not purchasable until every gate is met', () => {
  assert.deepStrictEqual([C.NEWSLETTER.single.cents, C.NEWSLETTER.single.sends, C.NEWSLETTER.four.cents, C.NEWSLETTER.four.sends], [19900, 1, 69900, 4]);
  assert.deepStrictEqual([C.NEWSLETTER.single.status, C.NEWSLETTER.four.status, C.NEWSLETTER.dedicated.status], ['not_available', 'not_available', 'request_proposal']);
  assert.ok(!('cents' in C.NEWSLETTER.dedicated), 'a dedicated email has no list price');
  assert.strictEqual(C.NEWSLETTER_MIN_VERIFIED, 1500);
  const ALL = ['verified_subscribers', 'measured_deliverability', 'defined_inventory', 'approved'];
  const yes = { verifiedSubscribers: 1500, deliverabilityMeasured: true, inventoryDefined: true, approved: true };
  assert.deepStrictEqual(C.newsletterEligibility({ verifiedSubscribers: 0 }).unmet, ALL);
  assert.deepStrictEqual(C.newsletterEligibility().unmet, ALL);
  assert.deepStrictEqual(C.newsletterEligibility(Object.assign({}, yes, { verifiedSubscribers: 1499 })).unmet, ['verified_subscribers']);
  assert.deepStrictEqual(C.newsletterEligibility(Object.assign({}, yes, { deliverabilityMeasured: 'yes' })).unmet, ['measured_deliverability']);
  assert.deepStrictEqual(C.newsletterEligibility(Object.assign({}, yes, { inventoryDefined: false })).unmet, ['defined_inventory']);
  assert.deepStrictEqual(C.newsletterEligibility(Object.assign({}, yes, { approved: undefined })).unmet, ['approved']);
  assert.strictEqual(C.newsletterEligibility(Object.assign({}, yes, { verifiedSubscribers: '1500' })).ok, true);
});

test('Sponsored feature $499 and creative $99 (waived on packages of $599 or more): not purchasable yet', () => {
  assert.deepStrictEqual([C.ADDONS.sponsoredFeature.cents, C.ADDONS.creative.cents], [49900, 9900]);
  for (const v of Object.values(C.ADDONS)) assert.strictEqual(v.status, 'not_available');
  assert.deepStrictEqual(['A', 'B', 'C', 'D', 'none'].map(C.creativeCents), [9900, 0, 0, 0, 9900]);
});

test('the catalog is frozen and every amount is integer cents', () => {
  assert.throws(() => { 'use strict'; C.FEATURED.job.cents = 1; });
  assert.strictEqual(C.FEATURED.job.cents, 9900);
  const walk = (o, at) => { for (const [k, v] of Object.entries(o)) { if (k === 'cents' || k === 'waivedFromPackageCents') assert.ok(isCents(v), at + k); else if (v && typeof v === 'object') walk(v, at + k + '.'); } };
  walk(C.publicCatalog(true), '');
});

test('publicCatalog: availability flags', () => {
  const off = C.publicCatalog(false), on = C.publicCatalog(true);
  assert.strictEqual(off.priceVersion, C.PRICE_VERSION); assert.strictEqual(off.currency, 'usd');
  for (const k of Object.keys(C.FEATURED)) {
    assert.deepStrictEqual([off.featured[k].purchasable, off.featured[k].status], [false, 'not_available'], k);
    assert.deepStrictEqual([on.featured[k].purchasable, on.featured[k].status], [true, 'available'], k);
    assert.deepStrictEqual([on.featured[k].cents, on.featured[k].days], [C.FEATURED[k].cents, C.FEATURED[k].days]);
  }
  for (const cat of [on, off]) for (const g of ['packages', 'newsletter', 'addons']) for (const [k, v] of Object.entries(cat[g])) assert.strictEqual(v.purchasable, g === 'packages' && ['A', 'B', 'C'].includes(k), g + '.' + k);
  assert.strictEqual(off.addons.sponsoredFeature.status, 'not_available', 'the sponsored feature stays coming soon');
  assert.deepStrictEqual(on.newsletterGate, { minVerifiedSubscribers: 1500, gates: ['verified_subscribers', 'measured_deliverability', 'defined_inventory', 'approved'] });
});

test('legacy table is exactly the prices checkout charged before the catalog', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(C.HISTORY.legacy.featured)), { job: { cents: 2900, days: 30 }, deal: { cents: 1900, days: 14 }, event: { cents: 1500, days: 7 }, item: { cents: 500, days: 7 } });
});

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
const listing = (w, id, kind, extra) => {
  const index = { item: 'tsn:ls:index', deal: 'tsn:dl:index', event: 'tsn:ev:index', job: 'tsn:jb:index' }[kind];
  w.kv.set('tsn:ls:' + id, JSON.stringify(Object.assign({ title: 'Line cook', uid: 'user-0001', at: '2026-10-18T14:00:00.000Z' }, extra || {})));
  if (index) { const s = w.z.get(index) || new Map(); s.set(id, Date.now()); w.z.set(index, s); }
};

test('GET /api/checkout: prices are the catalog table, with its version', async () => {
  await withWorld(ENV, async mod => {
    const r = await call(mod('_checkout'), { method: 'GET' });
    assert.strictEqual(r.body.configured, true);
    assert.strictEqual(r.body.priceVersion, C.PRICE_VERSION);
    for (const k of Object.keys(C.FEATURED)) assert.deepStrictEqual(r.body.prices[k], { cents: C.FEATURED[k].cents, days: C.FEATURED[k].days, label: C.FEATURED[k].label });
    assert.deepStrictEqual(mod('_checkout').INDEX, Object.fromEntries(Object.keys(C.FEATURED).map(k => [k, mod('listings').indexFor(k)])));
  });
});

test('POST /api/checkout charges the catalog price and ignores every price the client sends; records the price version', async () => {
  await withWorld(ENV, async (mod, w) => {
    listing(w, 'abcdef12', 'job');
    const r = await call(mod('listings'), { method: 'POST', url: '/api/checkout', query: { __route: 'checkout' }, headers: { host: 'x.test' }, body: { id: 'abcdef12', kind: 'job', uid: 'user-0001', cents: 1, amount: 1, unit_amount: 1, price: '$1', days: 365, priceVersion: 'legacy', price_version: 'legacy', currency: 'jpy' } });
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.match(r.body.url, /^https:\/\/checkout\.stripe\.com\//);
    const f = w.stripe[0];
    assert.strictEqual(f.get('line_items[0][price_data][unit_amount]'), '9900');
    assert.strictEqual(f.get('line_items[0][price_data][currency]'), 'usd');
    assert.strictEqual(f.get('line_items[0][price_data][product_data][name]'), 'Featured job · 30 days');
    assert.deepStrictEqual(['id', 'kind', 'days', 'cents', 'price_version'].map(k => f.get('metadata[' + k + ']')), ['abcdef12', 'job', '30', '9900', C.PRICE_VERSION]);
    assert.strictEqual(f.get('success_url'), 'https://site.test/?featured=ok');
    const order = JSON.parse(w.kv.get('tsn:order:cs_test_1'));
    assert.deepStrictEqual([order.listing, order.kind, order.cents, order.days, order.priceVersion, order.status], ['abcdef12', 'job', 9900, 30, C.PRICE_VERSION, 'created']);
    assert.strictEqual(w.ttl.get('tsn:order:cs_test_1'), 30 * 86400, 'unpaid orders expire; the webhook makes paid ones permanent');
  });
});

test('POST /api/checkout: each board kind at its own price', async () => {
  await withWorld(ENV, async (mod, w) => {
    let n = 0;
    for (const kind of Object.keys(C.FEATURED)) {
      const id = 'kind' + kind.padEnd(4, 'x');
      listing(w, id, kind);
      const r = await call(mod('_checkout'), { method: 'POST', headers: { host: 'x.test' }, body: { id, kind, uid: 'user-0001' } });
      assert.strictEqual(r.code, 200, kind);
      assert.strictEqual(w.stripe[n++].get('line_items[0][price_data][unit_amount]'), String(C.FEATURED[kind].cents), kind);
    }
  });
});

test('POST /api/checkout: a post can only be bought at its own board’s price; obituaries and unknown kinds are refused', async () => {
  await withWorld(ENV, async (mod, w) => {
    listing(w, 'jobpost1', 'job');
    for (const kind of ['item', 'event', 'deal']) {
      const r = await call(mod('_checkout'), { method: 'POST', headers: { host: 'x.test' }, body: { id: 'jobpost1', kind, uid: 'user-0001' } });
      assert.strictEqual(r.code, 400, kind);
    }
    listing(w, 'obitpost', 'obit');
    for (const kind of ['obit', '__proto__', 'constructor', '', undefined]) assert.strictEqual((await call(mod('_checkout'), { method: 'POST', headers: { host: 'x.test' }, body: { id: 'obitpost', kind, uid: 'user-0001' } })).code, 400, String(kind));
    assert.strictEqual((await call(mod('_checkout'), { method: 'POST', headers: { host: 'x.test' }, body: { id: 'jobpost1', kind: 'job', uid: 'someone-else' } })).code, 403);
    assert.strictEqual(w.stripe.length, 0, 'Stripe never called');
  });
});

test('POST /api/checkout without Stripe configured: unchanged answer, no Stripe call', async () => {
  await withWorld(Object.assign({}, ENV, { STRIPE_SECRET_KEY: '' }), async (mod, w) => {
    const r = await call(mod('_checkout'), { method: 'POST', body: { id: 'abcdef12', kind: 'job', uid: 'user-0001' } });
    assert.deepStrictEqual(r.body, { configured: false });
    assert.strictEqual(w.stripe.length, 0);
  });
});

// A purchase made at the old prices (no price_version in its metadata) gets the days it paid for, and an existing
// Featured period is extended, never shortened or re-priced. (Ads PR 2 adds the order record and the post extension;
// test/webhook.test.js covers the rest of the webhook.)
function signed(event, secret) {
  const raw = JSON.stringify(event), t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(t + '.' + raw).digest('hex');
  const req = Readable.from([Buffer.from(raw)]); req.method = 'POST'; req.headers = { 'stripe-signature': 't=' + t + ',v1=' + sig };
  return req;
}
test('legacy purchases keep what was agreed: old-price sessions apply their own days; existing Featured time is kept', async () => {
  await withWorld(ENV, async (mod, w) => {
    const until = Date.now() + 10 * 864e5;
    listing(w, 'legacy01', 'job', { featuredUntil: until, title: 'Paid at $29' });
    const before = JSON.parse(w.kv.get('tsn:ls:legacy01'));
    const ev = { id: 'evt_legacy_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_legacy', payment_status: 'paid', amount_total: 2900, currency: 'usd', metadata: { id: 'legacy01', kind: 'job', days: '30' } } } };
    const res = mockRes(); await mod('stripe-webhook')(signed(ev, ENV.STRIPE_WEBHOOK_SECRET), res);
    assert.strictEqual(res.code, 200);
    const after = JSON.parse(w.kv.get('tsn:ls:legacy01'));
    assert.ok(Math.abs(after.featuredUntil - (until + 30 * 864e5)) < 5000, 'extended by the 30 days bought, from the existing end');
    assert.deepStrictEqual(Object.assign({}, after, { featuredUntil: 0, featuredOrders: 0 }), Object.assign({}, before, { featuredUntil: 0, featuredOrders: 0 }), 'nothing else on the post changes');
    assert.deepStrictEqual(Object.keys(after.featuredOrders), ['cs_test_legacy']);
    assert.ok(w.log.some(c => c[0] === 'SET' && c[1] === 'tsn:ls:legacy01' && c.includes('KEEPTTL')));
    // a post already Featured under the old prices is still featured; nothing re-prices it
    assert.ok(after.featuredUntil > Date.now());
    const order = JSON.parse(w.kv.get('tsn:order:cs_test_legacy'));
    assert.deepStrictEqual([order.legacy, order.priceVersion, order.cents, order.days, order.status, order.paidCents], [true, 'legacy', 2900, 30, 'fulfilled', 2900]);
  });
});
