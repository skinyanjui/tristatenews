// Ads PR 2: the retry-safe Stripe webhook, order records, refunds and disputes, removals of Featured posts, the
// admin's /api/orders view, and checkout's Featured window. No network: the Upstash store and Stripe are faked by
// intercepting fetch, with placeholder keys.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const C = require('../api/_catalog.js');
const F = require('../public/featured.js');
const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const DAY = 864e5;

// A small Upstash: values, expiries (absolute ms), sorted sets, sets. w.fail(cmd) makes one command answer an error
// (the rest of that pipeline still runs, as in Upstash).
function fakeWorld() {
  const kv = new Map(), exp = new Map(), z = new Map(), sets = new Map(), stripe = [], log = [];
  const w = { kv, exp, z, sets, stripe, log, fail: null };
  const live = k => { if (exp.has(k) && exp.get(k) <= Date.now()) { kv.delete(k); exp.delete(k); } return kv.has(k); };
  const run = cmd => {
    const [op, k, ...a] = cmd;
    log.push(cmd);
    if (w.fail && w.fail(cmd)) return { error: 'ERR injected' };
    switch (op) {
      case 'GET': return { result: live(k) ? kv.get(k) : null };
      case 'MGET': return { result: [k, ...a].map(x => (live(x) ? kv.get(x) : null)) };
      case 'SET': {
        if (a.includes('NX') && live(k)) return { result: null };
        kv.set(k, a[0]);
        const i = a.indexOf('EX');
        if (i >= 0) exp.set(k, Date.now() + Number(a[i + 1]) * 1000); else if (!a.includes('KEEPTTL')) exp.delete(k);
        return { result: 'OK' };
      }
      case 'DEL': { const had = kv.delete(k); exp.delete(k); return { result: had ? 1 : 0 }; }
      case 'PTTL': return { result: !live(k) ? -2 : exp.has(k) ? exp.get(k) - Date.now() : -1 };
      case 'EXPIRE': if (!live(k)) return { result: 0 }; exp.set(k, Date.now() + Number(a[0]) * 1000); return { result: 1 };
      case 'ZADD': { const s = z.get(k) || new Map(); z.set(k, s); s.set(a[1], Number(a[0])); return { result: 1 }; }
      case 'ZREM': { const s = z.get(k); return { result: s && s.delete(a[0]) ? 1 : 0 }; }
      case 'ZSCORE': return { result: z.has(k) && z.get(k).has(a[0]) ? String(z.get(k).get(a[0])) : null };
      case 'ZREVRANGE': { const s = [...(z.get(k) || new Map())].sort((x, y) => y[1] - x[1]).map(x => x[0]); return { result: s.slice(Number(a[0]), Number(a[1]) + 1) }; }
      case 'SADD': { const s = sets.get(k) || new Set(); sets.set(k, s); s.add(a[0]); return { result: 1 }; }
      case 'SCARD': return { result: (sets.get(k) || new Set()).size };
      default: return { result: null };
    }
  };
  w.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith('https://kv.test/')) return new Response(JSON.stringify(JSON.parse(init.body).map(run)), { status: 200 });
    if (url === 'https://api.stripe.com/v1/checkout/sessions') { const form = new URLSearchParams(String(init.body)); stripe.push(form); return new Response(JSON.stringify({ id: 'cs_test_' + stripe.length, url: 'https://checkout.stripe.com/c/pay/cs_test_' + stripe.length }), { status: 200 }); }
    throw new Error('unexpected fetch ' + url);
  };
  return w;
}
const ENV = { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: 'whsec_placeholder', SITE_URL: 'https://site.test', LISTINGS_ADMIN_KEY: 'admin-placeholder-key' };
async function withWorld(env, fn) {
  const saved = { ...process.env }, realFetch = global.fetch, w = fakeWorld();
  const clear = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k]; };
  clear(); Object.assign(process.env, env); global.fetch = w.fetch;
  try { return await fn(f => require(path.join(API, f + '.js')), w); } finally { process.env = saved; global.fetch = realFetch; clear(); }
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
const INDEX = { item: 'tsn:ls:index', deal: 'tsn:dl:index', event: 'tsn:ev:index', job: 'tsn:jb:index' };
function listing(w, id, kind, extra, ttlDays) {
  w.kv.set('tsn:ls:' + id, JSON.stringify(Object.assign({ title: 'Line cook', uid: 'user-0001', at: new Date().toISOString() }, extra || {})));
  w.exp.set('tsn:ls:' + id, Date.now() + (ttlDays || 30) * DAY);
  const s = w.z.get(INDEX[kind]) || new Map(); s.set(id, Date.now()); w.z.set(INDEX[kind], s);
}
const post = (w, id) => JSON.parse(w.kv.get('tsn:ls:' + id));
const order = (w, sid) => JSON.parse(w.kv.get('tsn:order:' + sid));
const attention = w => [...(w.z.get('tsn:orders:attention') || new Map()).keys()];
function signed(event, secret) {
  const raw = JSON.stringify(event), t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret || ENV.STRIPE_WEBHOOK_SECRET).update(t + '.' + raw).digest('hex');
  const req = Readable.from([Buffer.from(raw)]); req.method = 'POST'; req.headers = { 'stripe-signature': 't=' + t + ',v1=' + sig };
  return req;
}
async function hook(mod, ev) { const res = mockRes(); await mod('stripe-webhook')(signed(ev), res); return res; }
let n = 0;
const evt = (type, object) => ({ id: 'evt_test_' + (++n), type, data: { object } });
const paidSession = (sid, extra) => Object.assign({ id: sid, payment_status: 'paid', amount_total: 9900, currency: 'usd', payment_intent: 'pi_' + sid.slice(3), metadata: { id: 'jobpost1', kind: 'job', days: '30', cents: '9900', price_version: C.PRICE_VERSION } }, extra || {});
async function checkout(mod, w, id, kind) {
  const r = await call(mod('listings'), { method: 'POST', url: '/api/checkout', query: { __route: 'checkout' }, headers: { host: 'x.test' }, body: { id, kind, uid: 'user-0001' } });
  assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  return 'cs_test_' + w.stripe.length;
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 5000, msg + ': ' + a + ' vs ' + b);

// ---- fulfillment ----
test('webhook fulfills a paid order: Featured period, permanent order record, payment link; marker written last', async () => {
  await withWorld(ENV, async (mod, w) => {
    listing(w, 'jobpost1', 'job', null, 40);
    const sid = await checkout(mod, w, 'jobpost1', 'job');
    assert.ok(w.exp.has('tsn:order:' + sid), 'unpaid order has a TTL');
    const ev = evt('checkout.session.completed', paidSession(sid));
    const r = await hook(mod, ev);
    assert.deepStrictEqual([r.code, r.body.outcome], [200, 'fulfilled']);
    const p = post(w, 'jobpost1'), o = order(w, sid);
    near(p.featuredUntil, Date.now() + 30 * DAY, 'featured for the 30 days bought');
    assert.deepStrictEqual(p.featuredOrders[sid], [o.featuredFrom, o.featuredUntil]);
    assert.deepStrictEqual([o.status, o.paidCents, o.paidCurrency, o.paymentIntent, o.priceVersion], ['fulfilled', 9900, 'usd', 'pi_' + sid.slice(3), C.PRICE_VERSION]);
    assert.ok(!w.exp.has('tsn:order:' + sid), 'a paid order never expires');
    assert.strictEqual(w.kv.get('tsn:order:pi:pi_' + sid.slice(3)), sid);
    assert.ok(!w.exp.has('tsn:order:pi:pi_' + sid.slice(3)));
    assert.ok(w.z.get('tsn:orders').has(sid)); assert.deepStrictEqual(attention(w), []);
    const last = w.log[w.log.length - 1];
    assert.deepStrictEqual(last, ['SET', 'tsn:stripe:evt:' + ev.id, 'fulfilled', 'EX', String(30 * 86400)]);
    near(w.exp.get('tsn:ls:jobpost1'), Date.now() + 40 * DAY, 'post TTL untouched when it outlives the period');
  });
});

test('webhook idempotency: the same event twice, and a second event for the same session, change nothing', async () => {
  await withWorld(ENV, async (mod, w) => {
    listing(w, 'jobpost1', 'job', null, 40);
    const sid = await checkout(mod, w, 'jobpost1', 'job');
    const ev = evt('checkout.session.completed', paidSession(sid));
    await hook(mod, ev);
    const once = w.kv.get('tsn:ls:jobpost1'), rec = w.kv.get('tsn:order:' + sid);
    const again = await hook(mod, ev);
    assert.deepStrictEqual(again.body, { received: true, duplicate: true });
    const other = await hook(mod, evt('checkout.session.async_payment_succeeded', paidSession(sid)));
    assert.strictEqual(other.body.outcome, 'already_fulfilled');
    assert.strictEqual(w.kv.get('tsn:ls:jobpost1'), once); assert.strictEqual(w.kv.get('tsn:order:' + sid), rec);
  });
});

test('webhook retry safety: a store failure answers 500 with no marker, and the retry finishes without applying twice', async () => {
  await withWorld(ENV, async (mod, w) => {
    listing(w, 'jobpost1', 'job', null, 40);
    const sid = await checkout(mod, w, 'jobpost1', 'job');
    const ev = evt('checkout.session.completed', paidSession(sid));
    // the post is written, then the order record fails
    w.fail = c => c[0] === 'SET' && c[1] === 'tsn:order:' + sid;
    assert.strictEqual((await hook(mod, ev)).code, 500);
    assert.ok(!w.kv.has('tsn:stripe:evt:' + ev.id), 'not marked processed');
    const stamped = post(w, 'jobpost1');
    assert.ok(stamped.featuredOrders[sid], 'the post change landed before the failure');
    w.fail = null;
    const r = await hook(mod, ev);
    assert.deepStrictEqual([r.code, r.body.outcome], [200, 'fulfilled']);
    assert.strictEqual(post(w, 'jobpost1').featuredUntil, stamped.featuredUntil, 'not extended a second time');
    assert.strictEqual(order(w, sid).status, 'fulfilled');
    assert.deepStrictEqual([order(w, sid).featuredFrom, order(w, sid).featuredUntil], stamped.featuredOrders[sid], 'the order records the window that was applied');
    // the marker itself fails: 500, and Stripe's retry sees the finished order
    listing(w, 'jobpost2', 'job', null, 40);
    const sid2 = await checkout(mod, w, 'jobpost2', 'job');
    const ev2 = evt('checkout.session.completed', paidSession(sid2, { metadata: { id: 'jobpost2', kind: 'job', days: '30', cents: '9900', price_version: C.PRICE_VERSION } }));
    w.fail = c => c[1] === 'tsn:stripe:evt:' + ev2.id && c[0] === 'SET' && c[2] !== 'processing'; // the outcome marker, not the claim
    assert.strictEqual((await hook(mod, ev2)).code, 500);
    w.fail = null;
    const before = post(w, 'jobpost2').featuredUntil;
    assert.strictEqual((await hook(mod, ev2)).body.outcome, 'already_fulfilled');
    assert.strictEqual(post(w, 'jobpost2').featuredUntil, before);
    assert.strictEqual(w.kv.get('tsn:stripe:evt:' + ev2.id), 'already_fulfilled');
  });
});

test('webhook amount checks: amount, currency, and a tampered order all go to the attention list unapplied', async () => {
  await withWorld(ENV, async (mod, w) => {
    const cases = [
      ['short', { amount_total: 100 }],
      ['wrong currency', { currency: 'eur' }],
      ['metadata at a made-up price', { amount_total: 100, metadata: { id: 'jobpost1', kind: 'job', days: '30', cents: '100', price_version: C.PRICE_VERSION } }],
      ['metadata with extra days', { metadata: { id: 'jobpost1', kind: 'job', days: '365', cents: '9900', price_version: C.PRICE_VERSION } }],
      ['unknown price version', { metadata: { id: 'jobpost1', kind: 'job', days: '30', cents: '9900', price_version: '1999-01-01' } }]
    ];
    listing(w, 'jobpost1', 'job', null, 40);
    let i = 0;
    for (const [name, extra] of cases) {
      const sid = 'cs_test_mm' + (++i);
      const r = await hook(mod, evt('checkout.session.completed', paidSession(sid, extra)));
      assert.strictEqual(r.body.outcome, 'amount_mismatch', name);
      assert.strictEqual(order(w, sid).status, 'amount_mismatch', name);
      assert.ok(attention(w).includes(sid), name);
    }
    assert.ok(!post(w, 'jobpost1').featuredUntil, 'nothing applied');
  });
});

test('webhook rebuilds a lost order from the session metadata; bad metadata is held for review', async () => {
  await withWorld(ENV, async (mod, w) => {
    listing(w, 'jobpost1', 'job', null, 40);
    const r = await hook(mod, evt('checkout.session.completed', paidSession('cs_test_lost')));
    assert.strictEqual(r.body.outcome, 'fulfilled');
    assert.deepStrictEqual([order(w, 'cs_test_lost').rebuilt, order(w, 'cs_test_lost').listing], [true, 'jobpost1']);
    const bad = await hook(mod, evt('checkout.session.completed', paidSession('cs_test_bad', { metadata: { id: '../x', kind: 'obit', days: '30', cents: '9900', price_version: C.PRICE_VERSION } })));
    assert.strictEqual(bad.body.outcome, 'needs_review');
    assert.ok(attention(w).includes('cs_test_bad'));
  });
});

test('webhook: a paid order whose post is gone, or whose date has passed, is recorded as needing a refund (never dropped)', async () => {
  await withWorld(ENV, async (mod, w) => {
    const r = await hook(mod, evt('checkout.session.completed', paidSession('cs_test_gone')));
    assert.strictEqual(r.body.outcome, 'needs_refund');
    assert.deepStrictEqual([order(w, 'cs_test_gone').problem, order(w, 'cs_test_gone').paidCents], ['post_missing', 9900]);
    assert.ok(attention(w).includes('cs_test_gone'));
    assert.ok(!w.exp.has('tsn:order:cs_test_gone'));
    listing(w, 'evtpost1', 'event', { date: '2026-01-01' });
    const ev = await hook(mod, evt('checkout.session.completed', paidSession('cs_test_past', { amount_total: C.FEATURED.event.cents, metadata: { id: 'evtpost1', kind: 'event', days: String(C.FEATURED.event.days), cents: String(C.FEATURED.event.cents), price_version: C.PRICE_VERSION } })));
    assert.strictEqual(ev.body.outcome, 'needs_refund');
    assert.strictEqual(order(w, 'cs_test_past').problem, 'post_date_passed');
    assert.ok(!post(w, 'evtpost1').featuredUntil);
  });
});

test('webhook: an event is featured until the end of its day; an undated post outliving its TTL is kept on its board', async () => {
  await withWorld(ENV, async (mod, w) => {
    const date = new Date(Date.now() + 3 * DAY).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    listing(w, 'evtpost2', 'event', { date });
    const e = C.FEATURED.event;
    await hook(mod, evt('checkout.session.completed', paidSession('cs_test_ev', { amount_total: e.cents, metadata: { id: 'evtpost2', kind: 'event', days: String(e.days), cents: String(e.cents), price_version: C.PRICE_VERSION } })));
    assert.strictEqual(post(w, 'evtpost2').featuredUntil, F.dayEnd(date));
    assert.ok(!w.log.some(c => c[0] === 'EXPIRE' && c[1] === 'tsn:ls:evtpost2'), 'events are not extended');
    // a job with 2 days left buys 30 days: post, photo and index entry last to the period's end + 1 day
    listing(w, 'jobold01', 'job', null, 2);
    w.kv.set('tsn:ls:img:jobold01', 'data'); w.exp.set('tsn:ls:img:jobold01', Date.now() + 2 * DAY);
    w.z.get('tsn:jb:index').set('jobold01', Date.now() - 43 * DAY);
    await hook(mod, evt('checkout.session.completed', paidSession('cs_test_old', { metadata: { id: 'jobold01', kind: 'job', days: '30', cents: '9900', price_version: C.PRICE_VERSION } })));
    const until = post(w, 'jobold01').featuredUntil;
    near(w.exp.get('tsn:ls:jobold01'), until + DAY, 'post TTL');
    near(w.exp.get('tsn:ls:img:jobold01'), until + DAY, 'photo TTL');
    near(w.z.get('tsn:jb:index').get('jobold01'), until + DAY - 45 * DAY, 'index score keeps it past the prune cutoff');
    assert.strictEqual(order(w, 'cs_test_old').postExtendedTo, new Date(until + DAY).toISOString());
  });
});

test('webhook: unpaid completion waits; a failed delayed payment is recorded; unhandled types and bad requests', async () => {
  await withWorld(ENV, async (mod, w) => {
    listing(w, 'jobpost1', 'job', null, 40);
    const sid = await checkout(mod, w, 'jobpost1', 'job');
    assert.strictEqual((await hook(mod, evt('checkout.session.completed', paidSession(sid, { payment_status: 'unpaid' })))).body.outcome, 'pending');
    assert.strictEqual(order(w, sid).status, 'created');
    assert.strictEqual((await hook(mod, evt('checkout.session.async_payment_failed', paidSession(sid, { payment_status: 'unpaid' })))).body.outcome, 'payment_failed');
    assert.strictEqual(order(w, sid).status, 'payment_failed');
    assert.ok(!post(w, 'jobpost1').featuredUntil);
    const writes = w.log.length;
    assert.deepStrictEqual((await hook(mod, evt('customer.created', { id: 'cus_1' }))).body, { received: true });
    assert.strictEqual(w.log.length, writes, 'unhandled events touch nothing');
    const req = signed(evt('charge.refunded', { id: 'ch_1' }), 'whsec_wrong'); const res = mockRes();
    await mod('stripe-webhook')(req, res); assert.strictEqual(res.code, 400);
    assert.deepStrictEqual(mod('stripe-webhook').HANDLED, ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'charge.refunded', 'charge.dispute.created']);
  });
  await withWorld(Object.assign({}, ENV, { STRIPE_WEBHOOK_SECRET: '' }), async mod => {
    assert.strictEqual((await hook(mod, evt('charge.refunded', { id: 'ch_1' }))).code, 503);
  });
});

// ---- refunds and disputes ----
test('a full refund ends the unused part of that order only; a partial refund goes to the attention list', async () => {
  await withWorld(ENV, async (mod, w) => {
    const earlier = Date.now() + 5 * DAY;
    listing(w, 'jobpost1', 'job', { featuredUntil: earlier }, 60);
    await hook(mod, evt('checkout.session.completed', paidSession('cs_test_r1')));
    near(post(w, 'jobpost1').featuredUntil, earlier + 30 * DAY, 'stacked on the earlier period');
    const part = await hook(mod, evt('charge.refunded', { id: 'ch_test_r1', payment_intent: 'pi_test_r1', amount: 9900, amount_refunded: 2000, refunded: false }));
    assert.strictEqual(part.body.outcome, 'partially_refunded');
    assert.ok(attention(w).includes('cs_test_r1'));
    near(post(w, 'jobpost1').featuredUntil, earlier + 30 * DAY, 'partial: still featured');
    const full = await hook(mod, evt('charge.refunded', { id: 'ch_test_r1', payment_intent: 'pi_test_r1', amount: 9900, amount_refunded: 9900, refunded: true }));
    assert.strictEqual(full.body.outcome, 'refunded');
    const p = post(w, 'jobpost1'), o = order(w, 'cs_test_r1');
    near(p.featuredUntil, earlier, 'the earlier paid period is kept');
    assert.ok(!('cs_test_r1' in p.featuredOrders));
    assert.deepStrictEqual([o.status, o.refundedCents, o.paidCents], ['refunded', 9900, 9900]);
    assert.deepStrictEqual(attention(w), []);
  });
});

test('a full refund of a post featured only by that order un-features it; a refund for an order needing one clears it', async () => {
  await withWorld(ENV, async (mod, w) => {
    listing(w, 'jobpost1', 'job', null, 40);
    await hook(mod, evt('checkout.session.completed', paidSession('cs_test_r2')));
    await hook(mod, evt('charge.refunded', { id: 'ch_test_r2', payment_intent: 'pi_test_r2', amount: 9900, amount_refunded: 9900, refunded: true }));
    assert.ok(post(w, 'jobpost1').featuredUntil <= Date.now());
    await hook(mod, evt('checkout.session.completed', paidSession('cs_test_r3', { metadata: { id: 'nopost99', kind: 'job', days: '30', cents: '9900', price_version: C.PRICE_VERSION } })));
    assert.ok(attention(w).includes('cs_test_r3'));
    await hook(mod, evt('charge.refunded', { id: 'ch_test_r3', payment_intent: 'pi_test_r3', amount: 9900, amount_refunded: 9900, refunded: true }));
    assert.strictEqual(order(w, 'cs_test_r3').status, 'refunded');
    assert.deepStrictEqual(attention(w), []);
  });
});

test('disputes are recorded for the admin; refunds and disputes for unknown payments are kept, not dropped', async () => {
  await withWorld(ENV, async (mod, w) => {
    listing(w, 'jobpost1', 'job', null, 40);
    await hook(mod, evt('checkout.session.completed', paidSession('cs_test_d1')));
    const d = await hook(mod, evt('charge.dispute.created', { id: 'dp_test_1', payment_intent: 'pi_test_d1', amount: 9900, reason: 'fraudulent', status: 'needs_response' }));
    assert.strictEqual(d.body.outcome, 'disputed');
    const o = order(w, 'cs_test_d1');
    assert.deepStrictEqual([o.status, o.statusBeforeDispute, o.dispute.id, o.dispute.reason], ['disputed', 'fulfilled', 'dp_test_1', 'fraudulent']);
    assert.ok(attention(w).includes('cs_test_d1'));
    assert.ok(post(w, 'jobpost1').featuredUntil > Date.now(), 'a dispute does not un-feature the post');
    assert.strictEqual((await hook(mod, evt('charge.refunded', { id: 'ch_unknown', payment_intent: 'pi_unknown', amount: 500, amount_refunded: 500, refunded: true }))).body.outcome, 'refund_unmatched');
    assert.strictEqual((await hook(mod, evt('charge.dispute.created', { id: 'dp_unknown', charge: 'ch_x', payment_intent: 'pi_nope', amount: 500 }))).body.outcome, 'dispute_unmatched');
    assert.deepStrictEqual([order(w, 'ch:ch_unknown').status, order(w, 'ch:dp_unknown').status], ['refund_unmatched', 'dispute_unmatched']);
    assert.ok(attention(w).includes('ch:ch_unknown') && attention(w).includes('ch:dp_unknown'));
  });
});

// ---- removals ----
test('removing a post that is still Featured leaves a record: reports and admin for review, the poster for reference', async () => {
  await withWorld(ENV, async (mod, w) => {
    const L = mod('listings'), fu = Date.now() + 10 * DAY;
    const rm = () => [...w.kv.keys()].filter(k => k.startsWith('tsn:order:rm-')).map(k => JSON.parse(w.kv.get(k)));
    listing(w, 'reppost1', 'job', { featuredUntil: fu, featuredOrders: { cs_test_a: [1, fu] } });
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) assert.strictEqual((await call(L, { method: 'POST', headers: { 'x-forwarded-for': ip }, body: { action: 'report', id: 'reppost1', uid: 'user-0002' } })).code, 200);
    // ship67: a Featured post is never removed or hidden by reports: it stays up and goes to the admin review queue
    assert.ok(w.kv.has('tsn:ls:reppost1') && !JSON.parse(w.kv.get('tsn:ls:reppost1')).hidden, 'still up');
    assert.ok(w.z.get('tsn:ls:review').has('reppost1'), 'queued for review');
    listing(w, 'admpost1', 'job', { featuredUntil: fu });
    assert.strictEqual((await call(L, { method: 'DELETE', headers: { 'x-admin-key': ENV.LISTINGS_ADMIN_KEY }, query: { id: 'admpost1' } })).code, 200);
    listing(w, 'ownpost1', 'job', { featuredUntil: fu });
    assert.strictEqual((await call(L, { method: 'DELETE', query: { id: 'ownpost1', uid: 'user-0001' } })).code, 200);
    listing(w, 'plain001', 'job');
    assert.strictEqual((await call(L, { method: 'DELETE', query: { id: 'plain001', uid: 'user-0001' } })).code, 200);
    const recs = rm().sort((a, b) => a.listing.localeCompare(b.listing));
    assert.deepStrictEqual(recs.map(r => [r.listing, r.reason, r.status, r.featuredUntil]), [['admpost1', 'admin', 'needs_review', fu], ['ownpost1', 'poster', 'removed_by_poster', fu]]);
    assert.strictEqual(attention(w).length, 1);
    for (const k of w.kv.keys()) if (k.startsWith('tsn:order:')) assert.ok(!w.exp.has(k), k + ' has no TTL');
    assert.strictEqual((await call(L, { method: 'DELETE', query: { id: 'plain001', uid: 'user-0009' } })).code, 403, 'still only the poster');
  });
});

// ---- the admin view ----
test('GET /api/orders: admin key only (404 otherwise), newest first, with totals', async () => {
  await withWorld(ENV, async (mod, w) => {
    listing(w, 'jobpost1', 'job', null, 40);
    await hook(mod, evt('checkout.session.completed', paidSession('cs_test_o1')));
    await hook(mod, evt('checkout.session.completed', paidSession('cs_test_o2', { metadata: { id: 'nopost99', kind: 'job', days: '30', cents: '9900', price_version: C.PRICE_VERSION } })));
    await hook(mod, evt('charge.refunded', { id: 'ch_test_o1', payment_intent: 'pi_test_o1', amount: 9900, amount_refunded: 1000, refunded: false }));
    const L = mod('listings'), q = { __route: 'orders' };
    for (const headers of [{}, { 'x-admin-key': 'wrong' }]) {
      const r = await call(L, { method: 'GET', url: '/api/orders', query: q, headers });
      assert.deepStrictEqual([r.code, r.body], [404, { error: 'not found' }]);
    }
    assert.strictEqual((await call(L, { method: 'POST', url: '/api/orders', query: q, headers: { 'x-admin-key': ENV.LISTINGS_ADMIN_KEY } })).code, 404, 'read-only');
    const r = await call(L, { method: 'GET', url: '/api/orders', query: q, headers: { 'x-admin-key': ENV.LISTINGS_ADMIN_KEY } });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(r.headers['cache-control'], 'no-store');
    assert.deepStrictEqual(r.body.orders.map(o => o.key).sort(), ['cs_test_o1', 'cs_test_o2']);
    assert.deepStrictEqual(r.body.attention.map(o => [o.key, o.status]).sort(), [['cs_test_o1', 'partially_refunded'], ['cs_test_o2', 'needs_refund']]);
    assert.deepStrictEqual(r.body.totals, { orders: 2, paidCents: 19800, refundedCents: 1000, attention: 2 });
  });
  await withWorld(Object.assign({}, ENV, { LISTINGS_ADMIN_KEY: '' }), async mod => {
    assert.strictEqual((await call(mod('listings'), { method: 'GET', url: '/api/orders', query: { __route: 'orders' }, headers: { 'x-admin-key': '' } })).code, 404, 'no admin key configured: nothing to see');
  });
});

test('admin.html: orders and attention sections added; newsletter, inquiries and tips sections unchanged', () => {
  const html = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
  for (const s of ["get('/api/subscribe')", "get('/api/advertise')", "get('/api/submit')", "get('/api/orders')", 'id="csv"', 'id="nl"', 'id="ad"', 'id="at"', 'id="ors"', "if (!r[0] && !r[1] && !r[2] && !r[3]"]) assert.ok(html.includes(s), s);
  assert.ok(!/method:\s*'(POST|DELETE|PUT|PATCH)'[^\n]*\/api\/orders/.test(html), 'the orders view only reads');
});

// ---- checkout names the window ----
test('POST /api/checkout: an event soon is sold "until <day>", one too close is refused; sessions expire in an hour', async () => {
  await withWorld(ENV, async (mod, w) => {
    const chi = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const soon = chi(Date.now() + 3 * DAY), today = chi(Date.now());
    listing(w, 'evsoon01', 'event', { date: soon });
    const sid = await checkout(mod, w, 'evsoon01', 'event');
    const f = w.stripe[0], until = F.dayEnd(soon);
    assert.strictEqual(f.get('line_items[0][price_data][product_data][name]'), C.FEATURED.event.label + ' · until ' + F.dayLabel(until));
    assert.strictEqual(f.get('line_items[0][price_data][unit_amount]'), String(C.FEATURED.event.cents));
    assert.strictEqual(f.get('metadata[until]'), String(until));
    assert.ok(Math.abs(Number(f.get('expires_at')) - (Date.now() / 1000 + 3600)) < 10);
    const o = order(w, sid);
    assert.deepStrictEqual([o.quotedUntil, o.capped, o.currency], [until, true, 'usd']);
    listing(w, 'evtoday1', 'event', { date: today });
    const r = await call(mod('_checkout'), { method: 'POST', headers: { host: 'x.test' }, body: { id: 'evtoday1', kind: 'event', uid: 'user-0001' } });
    assert.deepStrictEqual([r.code, r.body], [409, { error: 'This post is too close to its date to feature.' }]);
    assert.strictEqual(w.stripe.length, 1, 'Stripe not called');
  });
});
