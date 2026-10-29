// Ads Phase 6: self-serve Packages A–C (api/_packages.js). An advertiser picks a package, boards and a start date,
// leaves contact details (the order is a lead in the inquiry inbox with the same AD- reference), uploads the creative
// with that reference, then pays: Stripe Checkout when a real key is set, otherwise the order waits as
// 'pending payment' for a manual invoice. An admin marks it invoiced/paid and activates it into a campaign within the
// PR #36 caps. Unpaid orders hold their shares for a while. No network: Upstash and Stripe are faked, placeholder keys.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const C = require('../api/_catalog.js');
const P = require('../api/_packages.js');
const CP = require('../api/_campaigns.js');
const ADMIN = 'admin-placeholder-key', WHSEC = 'whsec_placeholder';
const NOW = Date.parse('2026-10-18T18:00:00Z'); // Oct 18, 1 PM CT
const DAY = 864e5;

function fakeStore(stripe) {
  const kv = new Map(), z = new Map(), sets = new Map(), lists = new Map(), stripeCalls = [];
  const run = ([op, k, ...a]) => {
    switch (op) {
      case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
      case 'MGET': return { result: [k, ...a].map(x => (kv.has(x) ? kv.get(x) : null)) };
      case 'SET': if (a.includes('NX') && kv.has(k)) return { result: null }; kv.set(k, a[0]); return { result: 'OK' };
      case 'INCR': kv.set(k, String((Number(kv.get(k)) || 0) + 1)); return { result: Number(kv.get(k)) };
      case 'EXPIRE': case 'PERSIST': return { result: 1 };
      case 'ZADD': { const s = z.get(k) || new Map(); z.set(k, s); s.set(a[1], Number(a[0])); return { result: 1 }; }
      case 'ZREM': { const s = z.get(k); return { result: s && s.delete(a[0]) ? 1 : 0 }; }
      case 'ZREVRANGE': return { result: [...(z.get(k) || new Map())].sort((x, y) => y[1] - x[1]).map(x => x[0]).slice(Number(a[0]), Number(a[1]) + 1) };
      case 'SADD': { const s = sets.get(k) || new Set(); sets.set(k, s); s.add(a[0]); return { result: 1 }; }
      case 'SREM': { const s = sets.get(k); return { result: s && s.delete(a[0]) ? 1 : 0 }; }
      case 'SMEMBERS': return { result: [...(sets.get(k) || [])] };
      case 'SCARD': return { result: (sets.get(k) || new Set()).size };
      case 'LPUSH': { const l = lists.get(k) || []; lists.set(k, l); l.unshift(...a); return { result: l.length }; }
      case 'LTRIM': { const l = lists.get(k) || []; lists.set(k, l.slice(Number(a[0]), Number(a[1]) + 1)); return { result: 'OK' }; }
      case 'LRANGE': return { result: (lists.get(k) || []).slice(Number(a[0]), Number(a[1]) + 1) };
      default: throw new Error('unexpected command ' + op);
    }
  };
  const fetch = async (u, init) => {
    if (String(u) === 'https://api.stripe.com/v1/checkout/sessions') {
      stripeCalls.push(Object.fromEntries(new URLSearchParams(init.body)));
      return stripe ? new Response(JSON.stringify(stripe), { status: 200 }) : new Response('{}', { status: 500 });
    }
    if (!String(u).startsWith('https://kv.test/')) throw new Error('unexpected fetch ' + u);
    return new Response(JSON.stringify(JSON.parse(init.body).map(run)), { status: 200 });
  };
  return { kv, z, sets, lists, fetch, stripeCalls };
}
async function withStore(env, fn, stripe) {
  const saved = { ...process.env }, realFetch = global.fetch, realNow = Date.now, s = fakeStore(stripe);
  let now = NOW;
  const clear = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k]; };
  clear(); Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', LISTINGS_ADMIN_KEY: ADMIN, ADS_CAMPAIGNS: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: WHSEC, SITE_URL: 'https://site.test' }, env);
  global.fetch = s.fetch; Date.now = () => now;
  try {
    const inbox = require('../api/inbox.js');
    const call = async (method, opts) => {
      opts = opts || {};
      const out = { status: 0, body: null };
      const res = { setHeader() {}, status(c) { out.status = c; return res; }, send(b) { out.body = typeof b === 'string' ? JSON.parse(b) : b; return res; }, json(o) { out.body = o; return res; }, end() { return res; } };
      await inbox({ method, url: '/api/packages', query: Object.assign({ __route: 'packages' }, opts.query || {}), headers: Object.assign({ 'x-forwarded-for': opts.ip || '203.0.113.9' }, opts.admin ? { 'x-admin-key': opts.admin } : {}), body: opts.body || {} }, res);
      return out;
    };
    const hook = async ev => {
      const raw = JSON.stringify(ev), t = Math.floor(Date.now() / 1000);
      const req = Readable.from([Buffer.from(raw)]); req.method = 'POST';
      req.headers = { 'stripe-signature': 't=' + t + ',v1=' + crypto.createHmac('sha256', WHSEC).update(t + '.' + raw).digest('hex') };
      const out = { status: 0, body: null }; const res = { status(c) { out.status = c; return res; }, json(o) { out.body = o; return res; }, end() { return res; } };
      await require('../api/stripe-webhook.js')(req, res); return out;
    };
    return await fn({ s, call, hook, setNow: t => { now = t; } });
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved); global.fetch = realFetch; Date.now = realNow; clear();
  }
}
const who = { business: 'Main Street Bakery', name: 'Pat Doe', email: 'pat@bakery.test', phone: '', agree: true };
const order = (b, ip) => ({ body: Object.assign({ action: 'order' }, who, b), ip });
const creativeFor = (s, ref, placements, status) => {
  const id = 'cr' + crypto.randomBytes(5).toString('hex');
  s.kv.set('tsn:cr:' + id, JSON.stringify({ id, ref, headline: 'Fresh bread daily', status: status || 'approved', placements }));
  const set = s.sets.get('tsn:cr:ref:' + ref) || new Set(); set.add(id); s.sets.set('tsn:cr:ref:' + ref, set);
  return id;
};

test('contents: what each package holds, from the catalog; boards picked by the advertiser', () => {
  assert.deepStrictEqual(P.placementsFor('A', ['deals']).placements, ['card:deals', 'line:deals']);
  assert.deepStrictEqual(P.placementsFor('B', ['jobs', 'events']).placements, ['card:news', 'card:jobs', 'card:events', 'line:jobs']);
  assert.deepStrictEqual(P.placementsFor('C', 'events,deals').placements, ['card:news', 'card:jobs', 'card:deals', 'card:events', 'card:classifieds', 'line:events', 'line:deals', 'rail:left', 'rail:right']);
  for (const [k, b] of [['A', []], ['A', ['jobs', 'deals']], ['B', ['jobs']], ['B', ['jobs', 'jobs']], ['C', ['jobs', 'news']], ['D', ['jobs']], ['E', ['jobs']]]) assert.ok(P.placementsFor(k, b).error, k + b);
  for (const k of P.SELF_SERVE) for (const p of P.placementsFor(k, ['jobs', 'deals'].slice(0, P.PICKS[k])).placements) assert.ok(CP.PLACEMENTS.includes(p), p);
  assert.deepStrictEqual(P.SELF_SERVE, ['A', 'B', 'C'], 'D stays by proposal');
  const info = P.publicInfo();
  assert.deepStrictEqual(Object.keys(info.packages), ['A', 'B', 'C']);
  for (const k of ['A', 'B', 'C']) assert.deepStrictEqual([info.packages[k].cents, info.packages[k].days], [C.PACKAGES[k].cents, 30]);
  assert.strictEqual(C.ADDONS.sponsoredFeature.status, 'not_available');
});

test('dates: start 3–90 days ahead (Chicago), 30 days long', () => {
  assert.deepStrictEqual(P.flight('A', '2026-10-21', NOW), { start: '2026-10-21', end: '2026-11-19' });
  for (const d of ['2026-10-20', '2026-10-18', '2027-01-17', '2026-13-01', '', 'x']) assert.ok(P.flight('A', d, NOW).error, d);
  assert.ok(!P.flight('A', '2027-01-16', NOW).error);
});

test('holds: unpaid orders hold 7 days (14 once invoiced), paid until activated; cancelled, active and refunded hold nothing', () => {
  const at = new Date(NOW).toISOString();
  assert.ok(P.holds({ status: 'pending_payment', at }, NOW + 6 * DAY));
  assert.ok(!P.holds({ status: 'pending_payment', at }, NOW + 7 * DAY));
  assert.ok(P.holds({ status: 'invoiced', at, invoicedAt: at }, NOW + 13 * DAY));
  assert.ok(!P.holds({ status: 'invoiced', at, invoicedAt: at }, NOW + 14 * DAY));
  assert.ok(P.holds({ status: 'paid', at }, NOW + 60 * DAY));
  for (const st of ['active', 'cancelled', 'refunded']) assert.ok(!P.holds({ status: st, at }, NOW), st);
});

test('graceful payment: no key, a placeholder key, or no store means invoice by hand, never Stripe', async () => {
  for (const key of ['', 'sk_test_placeholder', 'placeholder', 'sk_live_short']) {
    await withStore({ STRIPE_SECRET_KEY: key }, async () => { assert.strictEqual(require('../api/_packages.js').cardReady(), false, key || '(none)'); });
  }
  await withStore({ STRIPE_SECRET_KEY: 'sk_test_' + 'a'.repeat(24) }, async () => { assert.strictEqual(require('../api/_packages.js').cardReady(), true); });
});

test('order without Stripe: saved as pending payment, a lead with the same reference, creative upload opens; checkout says invoice', async () => {
  await withStore({}, async ({ s, call }) => {
    const info = await call('GET');
    assert.strictEqual(info.body.card, false);
    const av = await call('GET', { query: { pkg: 'B', boards: 'jobs,events', start: '2026-10-25' } });
    assert.deepStrictEqual([av.body.ok, av.body.end], [true, '2026-11-23']);
    const r = await call('POST', order({ pkg: 'B', boards: ['jobs', 'events'], start: '2026-10-25' }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.ref, P.REF_RE);
    const rec = JSON.parse(s.kv.get('tsn:pkg:' + r.body.ref));
    assert.deepStrictEqual([rec.status, rec.pkg, rec.cents, rec.start, rec.end, rec.priceVersion], ['pending_payment', 'B', 59900, '2026-10-25', '2026-11-23', C.PRICE_VERSION]);
    assert.ok(s.sets.get('tsn:pkg:open').has(r.body.ref));
    const lead = JSON.parse(s.lists.get('tsn:ads')[0]);
    assert.deepStrictEqual([lead.ref, lead.email, lead.package, lead.interest], [r.body.ref, who.email, 'B', 'Section sponsorship']);
    assert.match(lead.message, /Pending payment/);
    // the creative upload accepts the order's reference with its email (api/_creative.js access)
    const access = await call('POST', { body: { action: 'checkout', ref: r.body.ref, email: who.email } });
    assert.deepStrictEqual([access.status, access.body.next], [409, 'creative'], 'pay after sending the ad');
    creativeFor(s, r.body.ref, [], 'pending');
    const wrong = await call('POST', { body: { action: 'checkout', ref: r.body.ref, email: 'x@y.test' } });
    assert.strictEqual(wrong.status, 404);
    const co = await call('POST', { body: { action: 'checkout', ref: r.body.ref, email: 'PAT@bakery.test' } });
    assert.deepStrictEqual([co.status, co.body.invoice, co.body.url], [200, true, undefined]);
    assert.strictEqual(s.stripeCalls.length, 0, 'Stripe is never called without a real key');
    const after = JSON.parse(s.kv.get('tsn:pkg:' + r.body.ref));
    assert.ok(after.invoiceRequested && after.status === 'pending_payment');
  });
});

test('creative access: a package reference with its email may upload (api/_creative.js)', async () => {
  await withStore({}, async ({ call }) => {
    const r = await call('POST', order({ pkg: 'A', boards: ['deals'], start: '2026-10-22' }));
    const CR = require('../api/_creative.js');
    assert.ok(typeof CR === 'function');
    const src = read('api/_creative.js');
    assert.ok(src.includes("'tsn:ads'") && /AD-\[A-Z0-9\]\{6,10\}/.test(src), 'AD- references are checked against tsn:ads');
    assert.match(r.body.ref, /^AD-[A-Z0-9]{6,10}$/);
  });
});

test('validation: contact details, agreement, packages not sold online, rate limit, honeypot', async () => {
  await withStore({}, async ({ s, call }) => {
    const bad = [[{ pkg: 'D', boards: ['jobs'], start: '2026-10-25' }, 'pkg'], [{ pkg: 'A', boards: [], start: '2026-10-25' }, 'boards'], [{ pkg: 'A', boards: ['jobs'], start: '2026-10-19' }, 'start'],
      [{ pkg: 'A', boards: ['jobs'], start: '2026-10-25', email: 'nope' }, 'email'], [{ pkg: 'A', boards: ['jobs'], start: '2026-10-25', agree: false }, 'agree'], [{ pkg: 'A', boards: ['jobs'], start: '2026-10-25', business: 'x' }, 'business']];
    for (const [b, field] of bad) { const r = await call('POST', order(b, '198.51.100.' + field.length)); assert.deepStrictEqual([r.status, r.body.field], [400, field], field); }
    const hp = await call('POST', order({ pkg: 'A', boards: ['jobs'], start: '2026-10-25', website: 'spam' }));
    assert.strictEqual(hp.body.ok, true); assert.ok(!s.lists.get('tsn:ads'), 'the honeypot saves nothing');
    for (let i = 0; i < 3; i++) assert.strictEqual((await call('POST', order({ pkg: 'A', boards: ['jobs'], start: '2026-11-0' + (i + 1) }, '192.0.2.7'))).status, 200);
    assert.strictEqual((await call('POST', order({ pkg: 'A', boards: ['jobs'], start: '2026-11-05' }, '192.0.2.7'))).status, 429);
  });
});

test('caps (PR #36): held orders and booked campaigns count; side ads hold at most two Package C at once; holds lapse', async () => {
  await withStore({}, async ({ s, call, setNow }) => {
    const c = i => call('POST', order({ pkg: 'C', boards: ['jobs', 'deals'], start: '2026-11-01' }, '10.0.0.' + i));
    assert.strictEqual((await c(1)).status, 200);
    assert.strictEqual((await c(2)).status, 200);
    const third = await c(3);
    assert.deepStrictEqual([third.status, third.body.field], [409, 'start']);
    assert.match(third.body.error, /sold out/);
    // a booked campaign counts too: 3 shares of the deals card fill it for A on deals
    for (let i = 0; i < 1; i++) {
      const id = 'cp' + 'x'.repeat(9) + i;
      s.kv.set(CP.K.rec(id), JSON.stringify({ id, status: 'active', placements: ['card:deals'], start: '2026-11-10', end: '2026-12-31' }));
      s.sets.set(CP.K.open, new Set([...(s.sets.get(CP.K.open) || []), id]));
    }
    const a = await call('GET', { query: { pkg: 'A', boards: 'deals', start: '2026-11-15' } });
    assert.strictEqual(a.body.ok, false, 'two C orders + one campaign fill card:deals in November');
    assert.ok((await call('GET', { query: { pkg: 'A', boards: 'deals', start: '2027-01-01' } })).body.ok);
    // after the 7-day hold, unpaid orders let go
    setNow(NOW + 8 * DAY);
    assert.ok((await call('GET', { query: { pkg: 'C', boards: 'jobs,deals', start: '2026-11-01' } })).body.ok);
  });
});

test('admin: list, invoiced, paid (note required), activate into a campaign with an approved creative, cancel', async () => {
  await withStore({}, async ({ s, call }) => {
    const r = await call('POST', order({ pkg: 'A', boards: ['events'], start: '2026-10-25' }));
    const ref = r.body.ref;
    assert.strictEqual((await call('GET', { admin: 'wrong' })).status, 404);
    const list = await call('GET', { admin: ADMIN });
    assert.deepStrictEqual([list.body.items.length, list.body.items[0].ref, list.body.items[0].label, list.body.items[0].holding, list.body.card], [1, ref, 'Pending payment', true, false]);
    const act = (action, extra) => call('POST', { admin: ADMIN, body: Object.assign({ action, ref }, extra) });
    assert.strictEqual((await act('activate')).status, 409, 'not paid yet');
    assert.strictEqual((await act('invoiced', { note: 'INV-1001' })).body.order.status, 'invoiced');
    assert.strictEqual((await act('paid')).status, 400, 'how it was paid is required');
    assert.strictEqual((await act('paid', { note: 'Check #42' })).body.order.paidBy, 'manual');
    const notCovering = creativeFor(s, ref, ['card:events']);
    assert.strictEqual((await act('activate', { creativeId: notCovering })).status, 400, 'the creative must be approved for every placement');
    const other = creativeFor(s, 'AD-OTHER123', ['card:events', 'line:events']);
    assert.strictEqual((await act('activate', { creativeId: other })).status, 400, 'only a creative sent for this order');
    const ok = creativeFor(s, ref, ['card:events', 'line:events']);
    const done = await act('activate', { creativeId: ok });
    assert.strictEqual(done.status, 200, JSON.stringify(done.body));
    assert.deepStrictEqual([done.body.campaign.start, done.body.campaign.end, done.body.campaign.placements, done.body.order.status], ['2026-10-25', '2026-11-23', ['card:events', 'line:events'], 'active']);
    assert.ok(s.sets.get(CP.K.open).has(done.body.campaign.id) && !s.sets.get('tsn:pkg:open').has(ref), 'the campaign now holds the shares');
    assert.strictEqual((await act('cancel', { note: 'x y z' })).status, 409, 'an active order ends through its campaign');
    const r2 = await call('POST', order({ pkg: 'A', boards: ['jobs'], start: '2026-10-25' }, '10.1.1.1'));
    assert.strictEqual((await call('POST', { admin: ADMIN, body: { action: 'cancel', ref: r2.body.ref } })).status, 400, 'a reason is required');
    assert.strictEqual((await call('POST', { admin: ADMIN, body: { action: 'cancel', ref: r2.body.ref, note: 'Changed their mind' } })).body.order.status, 'cancelled');
    const log = (await call('GET', { admin: ADMIN })).body.log.map(e => e.action);
    assert.deepStrictEqual(log.slice(0, 6), ['cancel', 'order', 'activate', 'paid', 'invoiced', 'order']);
  });
});

test('a late activation still runs 30 days from today', () => {
  const o = { ref: 'AD-LATE0001', pkg: 'A', placements: ['card:jobs', 'line:jobs'], start: '2026-10-10', end: '2026-11-08' };
  const r = P.activation(o, { id: 'craaaaaaaaaa', ref: o.ref, status: 'approved', placements: o.placements, headline: 'x' }, [], [], NOW);
  assert.deepStrictEqual([r.rec.start, r.rec.end], ['2026-10-18', '2026-11-16']);
});

test('with a real Stripe key: one-time Checkout with package metadata; the webhook marks it paid; amount checked; refund recorded', async () => {
  const session = { id: 'cs_test_pkgsession0001', url: 'https://checkout.stripe.test/pay' };
  await withStore({ STRIPE_SECRET_KEY: 'sk_test_' + 'b'.repeat(24) }, async ({ s, call, hook }) => {
    const r = await call('POST', order({ pkg: 'C', boards: ['jobs', 'deals'], start: '2026-11-01' }));
    const ref = r.body.ref;
    creativeFor(s, ref, [], 'pending');
    const co = await call('POST', { body: { action: 'checkout', ref, email: who.email } });
    assert.strictEqual(co.body.url, session.url);
    const sent = s.stripeCalls[0];
    assert.deepStrictEqual([sent.mode, sent['line_items[0][price_data][unit_amount]'], sent['metadata[type]'], sent['metadata[ref]'], sent['metadata[pkg]']], ['payment', '119900', 'package', ref, 'C']);
    assert.ok(!('subscription_data' in sent), 'one payment for 30 days, no subscription');
    assert.strictEqual(JSON.parse(s.kv.get('tsn:pkg:' + ref)).status, 'checkout');
    const ev = (id, amount) => ({ id, type: 'checkout.session.completed', data: { object: { id: session.id, payment_status: 'paid', amount_total: amount, currency: 'usd', payment_intent: 'pi_test_pkg0001', metadata: { type: 'package', ref, pkg: 'C' } } } });
    const paid = await hook(ev('evt_pkg_1', 119900));
    assert.strictEqual(paid.body.outcome, 'fulfilled');
    const rec = JSON.parse(s.kv.get('tsn:pkg:' + ref));
    assert.deepStrictEqual([rec.status, rec.paidBy, rec.paidCents], ['paid', 'stripe', 119900]);
    assert.strictEqual(JSON.parse(s.kv.get('tsn:order:' + session.id)).status, 'fulfilled');
    assert.strictEqual((await hook(ev('evt_pkg_1', 119900))).body.duplicate, true);
    const refund = await hook({ id: 'evt_pkg_r', type: 'charge.refunded', data: { object: { id: 'ch_test_1', payment_intent: 'pi_test_pkg0001', amount: 119900, amount_refunded: 119900, refunded: true } } });
    assert.strictEqual(refund.body.outcome, 'refunded');
    assert.strictEqual(JSON.parse(s.kv.get('tsn:pkg:' + ref)).status, 'refunded');
  }, session);
  // a wrong amount is never marked paid
  await withStore({ STRIPE_SECRET_KEY: 'sk_test_' + 'b'.repeat(24) }, async ({ s, call, hook }) => {
    const r = await call('POST', order({ pkg: 'A', boards: ['jobs'], start: '2026-11-01' }));
    creativeFor(s, r.body.ref, [], 'pending');
    await call('POST', { body: { action: 'checkout', ref: r.body.ref, email: who.email } });
    const out = await hook({ id: 'evt_pkg_2', type: 'checkout.session.completed', data: { object: { id: session.id, payment_status: 'paid', amount_total: 100, currency: 'usd', metadata: { type: 'package', ref: r.body.ref, pkg: 'A' } } } });
    assert.strictEqual(out.body.outcome, 'amount_mismatch');
    assert.strictEqual(JSON.parse(s.kv.get('tsn:pkg:' + r.body.ref)).status, 'checkout');
  }, session);
  // Stripe failing falls back to an invoice
  await withStore({ STRIPE_SECRET_KEY: 'sk_test_' + 'b'.repeat(24) }, async ({ s, call }) => {
    const r = await call('POST', order({ pkg: 'A', boards: ['jobs'], start: '2026-11-01' }));
    creativeFor(s, r.body.ref, [], 'pending');
    const co = await call('POST', { body: { action: 'checkout', ref: r.body.ref, email: who.email } });
    assert.deepStrictEqual([co.body.invoice, s.stripeCalls.length], [true, 1]);
  }, null);
});

test('wiring: route through inbox.js (still 8 functions), order page, panel, /advertise, creative page, admin, README', () => {
  const fns = fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.strictEqual(fns.length, 8, fns.join(','));
  const vj = JSON.parse(read('vercel.json'));
  assert.ok(vj.rewrites.some(r => r.source === '/api/packages' && r.destination === '/api/inbox?__route=packages'));
  assert.ok(read('api/inbox.js').includes("packages: () => require('./_packages.js')"));
  const op = read('public/order.html');
  for (const s of ["fetch('/api/packages')", "action: 'order'", "action: 'checkout'", '/creative.html?order=1&ref=', 'Sponsored feature:</b> coming soon', 'id="agree"', '#terms-packages']) assert.ok(op.includes(s), s);
  assert.ok(!/\$\s?\d/.test(op.replace(/<script>[\s\S]*<\/script>/, '')), 'no hardcoded prices in the order page');
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(op), 'nothing stored in the browser');
  const idx = require('./_page.js')();
  assert.ok(idx.includes("fetch('/api/packages')") && idx.includes("'/order.html?pkg=' + k") && idx.includes('Sponsored features: coming soon.'));
  assert.ok(read('data/pages/advertise.html').includes("location.href = '/order.html?pkg=' + k"));
  const cr = read('public/creative.html');
  assert.ok(cr.includes("go.href = '/order.html?ref='") && cr.includes('Continue to payment'));
  const ad = read('public/admin.html');
  for (const s of ['id="po"', "get('/api/packages')", "'Mark invoiced', 'invoiced'", "'Activate', 'activate'", 'Card payment is off']) assert.ok(ad.includes(s), s);
  assert.ok(read('README.md').includes('/api/packages'));
});
