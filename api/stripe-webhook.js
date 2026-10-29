// Stripe webhook: fulfills Featured payments and records refunds and disputes. Retry-safe: every change is applied
// first and the event is marked processed last, so if anything fails the handler answers 500 and Stripe's retry
// finishes the job; a second delivery of the same event, or a second event for the same session, changes nothing.
// In Stripe, point an endpoint at https://<site>/api/stripe-webhook for these events and set STRIPE_WEBHOOK_SECRET:
//   checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
//   charge.refunded, charge.dispute.created
// The success redirect (/?featured=ok) never activates anything; only this signed webhook does.
//
// Packages A-C (metadata type 'package', api/_packages.js): the amount must equal the price on the order; the order is
// marked paid (nothing goes live until an admin activates it with an approved creative). A full refund marks it refunded.
//
// Fulfillment (checkout.session.completed with payment_status 'paid', or async_payment_succeeded):
//   1. load the order (tsn:order:<session>; rebuilt from the session's metadata if missing; sessions from before the
//      catalog have no price_version and are "legacy": they get exactly the days they bought, as before)
//   2. the amount and currency Stripe collected must equal the order, and the order must equal the catalog price for
//      its price version (api/_catalog.js featuredPriceAt); otherwise status amount_mismatch, nothing applied
//   3. the post must still exist and the period must still have time left (public/featured.js); otherwise
//      status needs_refund, on the admin's attention list (never dropped)
//   4. apply: featuredUntil, the window stamped on the post under the session id (so it is applied once), and, when
//      the period runs past the post's own expiry, the post's TTL (and photo's) and its board index entry are
//      extended to the period's end plus a day; then the order (no TTL), then the processed marker
// Refunds: a full refund ends the unused part of that order's Featured window and marks the order refunded; a partial
// refund is recorded for the admin. Disputes are recorded for the admin (the post stays Featured).
const crypto = require('crypto');
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const CATALOG = require('./_catalog.js');
const O = require('./_orders.js');
const PKG = require('./_packages.js');
const F = require('../public/featured.js');
const ID_RE = /^[a-z0-9]{6,20}$/;
const SESSION_RE = /^cs_[A-Za-z0-9_]{1,200}$/, PI_RE = /^pi_[A-Za-z0-9_]{1,200}$/, OBJ_RE = /^[a-z]{2,4}_[A-Za-z0-9_]{1,200}$/;
const DAY = 864e5, EVENT_TTL = 30 * 86400;
// A claim outlives the function (maxDuration) but not Stripe's retry schedule: if a run dies without reaching its
// catch, the claim lapses and the next delivery processes the event.
const CLAIM_TTL = 300;
const INDEX = { item: 'tsn:ls:index', deal: 'tsn:dl:index', event: 'tsn:ev:index', job: 'tsn:jb:index' };
// How long a post stays on its board after it was posted (its index score), as api/listings.js prunes them.
const LIFE_DAYS = { item: 30, deal: 30, job: 45 };
const DONE = ['fulfilled', 'needs_refund', 'amount_mismatch', 'needs_review', 'refunded', 'partially_refunded', 'disputed'];
const HANDLED = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'charge.refunded', 'charge.dispute.created'];

async function pipeline(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('store ' + r.status);
  const out = await r.json();
  if (Array.isArray(out) && out.some(x => x && x.error)) throw new Error('store command');
  return out;
}
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (_) { return null; } };
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > 1e6) { reject(new Error('big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
// Stripe-Signature: t=<unix>,v1=<hex hmac of "t.payload">
function verify(raw, header, secret, now) {
  const parts = {}; String(header || '').split(',').forEach(p => { const i = p.indexOf('='); if (i > 0) (parts[p.slice(0, i)] = parts[p.slice(0, i)] || []).push(p.slice(i + 1)); });
  const t = Number((parts.t || [])[0]);
  if (!t || Math.abs((now || Date.now()) / 1000 - t) > 300) return false;
  const want = crypto.createHmac('sha256', secret).update(t + '.' + raw.toString('utf8')).digest();
  return (parts.v1 || []).some(v => { const got = Buffer.from(v, 'hex'); return got.length === want.length && crypto.timingSafeEqual(got, want); });
}


// The order for a session: the stored record, or one rebuilt from the session's metadata (which our checkout wrote).
function orderFor(stored, s) {
  if (stored) return stored;
  const m = s.metadata || {};
  if (m.price_version) return { session: s.id, listing: String(m.id || ''), kind: String(m.kind || ''), cents: Number(m.cents), days: Number(m.days), priceVersion: String(m.price_version), status: 'created', rebuilt: true };
  const legacy = CATALOG.featuredPriceAt('legacy', String(m.kind || ''));
  return { session: s.id, listing: String(m.id || ''), kind: String(m.kind || ''), cents: legacy ? legacy.cents : null, days: Number(m.days) || 0, priceVersion: 'legacy', legacy: true, status: 'created' };
}

async function onSession(ev, now) {
  const s = ev.data.object || {};
  if (!SESSION_RE.test(String(s.id))) return 'ignored';
  const paidEvent = ev.type === 'checkout.session.async_payment_succeeded' || (ev.type === 'checkout.session.completed' && s.payment_status === 'paid');
  const g = await pipeline([['GET', O.ORDER(s.id)]]);
  const order = orderFor(parse(g[0] && g[0].result), s);
  if (DONE.includes(order.status)) return 'already_' + order.status; // another event for this session got here first
  const pi = PI_RE.test(String(s.payment_intent)) ? s.payment_intent : null;
  const finish = (status, extra, pre) => {
    const rec = Object.assign({}, order, extra || {}, { status, updatedAt: new Date(now).toISOString() });
    if (pi) rec.paymentIntent = pi;
    const cmds = (pre || []).concat(O.recordCmds(s.id, rec, now));
    if (pi) cmds.push(['SET', O.PI(pi), s.id]);
    return pipeline(cmds).then(() => status);
  };
  if (ev.type === 'checkout.session.async_payment_failed') return finish('payment_failed');
  if (!paidEvent) return 'pending'; // completed but not paid yet (delayed payment methods): wait for async_payment_succeeded
  if (order.type === 'package' || (s.metadata || {}).type === 'package') return onPackage(s, order, finish, now);
  const paid = { paidCents: Number(s.amount_total), paidCurrency: String(s.currency || '').toLowerCase(), paidAt: new Date(now).toISOString() };
  // 2. amount and currency against the order, and the order against the catalog for its price version
  const expected = CATALOG.featuredPriceAt(order.priceVersion, order.kind);
  if (!ID_RE.test(order.listing) || !INDEX[order.kind]) return finish('needs_review', Object.assign(paid, { problem: 'bad_metadata' }));
  if (!expected || expected.cents !== order.cents || expected.days !== order.days || paid.paidCents !== order.cents || paid.paidCurrency !== CATALOG.CURRENCY) return finish('amount_mismatch', Object.assign(paid, { expectedCents: expected ? expected.cents : null }));
  // 3. the post
  const rec = 'tsn:ls:' + order.listing, img = 'tsn:ls:img:' + order.listing, index = INDEX[order.kind];
  const p = await pipeline([['GET', rec], ['PTTL', rec], ['ZSCORE', index, order.listing]]);
  const post = parse(p[0] && p[0].result);
  if (!post) return finish('needs_refund', Object.assign(paid, { problem: 'post_missing' }));
  post.featuredOrders = post.featuredOrders && typeof post.featuredOrders === 'object' ? post.featuredOrders : {};
  const already = post.featuredOrders[s.id];
  let from, until;
  if (Array.isArray(already)) { from = already[0]; until = already[1]; } // applied before a failure; finish the record only
  else if (order.legacy) { from = Math.max(now, Number(post.featuredUntil) || 0); until = from + order.days * DAY; } // as before the catalog
  else {
    const w = F.window({ kind: order.kind, date: post.date, ends: post.ends, featuredUntil: post.featuredUntil }, order.days, now, 0);
    if (!w.ok) return finish('needs_refund', Object.assign(paid, { problem: 'post_date_passed' }));
    from = w.from; until = w.until;
  }
  // 4. apply, then the order, then (in the caller) the processed marker
  const cmds = [];
  if (!Array.isArray(already)) {
    post.featuredOrders[s.id] = [from, until];
    post.featuredUntil = Math.max(Number(post.featuredUntil) || 0, until);
    cmds.push(['SET', rec, JSON.stringify(post), 'KEEPTTL']);
  }
  const ext = {};
  const pttl = Number(p[1] && p[1].result), needEnd = until + DAY;
  if (LIFE_DAYS[order.kind] && pttl >= 0 && now + pttl < needEnd) {
    const secs = String(Math.ceil((needEnd - now) / 1000));
    cmds.push(['EXPIRE', rec, secs], ['EXPIRE', img, secs]);
    ext.postExtendedTo = new Date(needEnd).toISOString();
    const score = p[2] && p[2].result != null ? Number(p[2].result) : null, minScore = needEnd - LIFE_DAYS[order.kind] * DAY;
    if (score == null || score < minScore) cmds.push(['ZADD', index, String(minScore), order.listing]);
  }
  return finish('fulfilled', Object.assign(paid, ext, { featuredFrom: from, featuredUntil: until }), cmds);
}

// A self-serve package (api/_packages.js): check the amount against the catalog, then mark the order paid. The
// campaign itself starts only when an admin activates it with an approved creative.
async function onPackage(s, order, finish, now) {
  const m = s.metadata || {}, ref = String(order.ref || m.ref || ''), pkg = String(order.pkg || m.pkg || '');
  const paid = { type: 'package', ref, pkg, paidCents: Number(s.amount_total), paidCurrency: String(s.currency || '').toLowerCase(), paidAt: new Date(now).toISOString() };
  const p = Object.prototype.hasOwnProperty.call(CATALOG.PACKAGES, pkg) ? CATALOG.PACKAGES[pkg] : null;
  if (!PKG.REF_RE.test(ref) || !p) return finish('needs_review', Object.assign(paid, { problem: 'bad_metadata' }));
  const g = await pipeline([['GET', PKG.K.rec(ref)]]);
  const po = parse(g[0] && g[0].result);
  if (!po) return finish('needs_review', Object.assign(paid, { problem: 'order_missing' }));
  const want = Number(po.cents);
  if (po.pkg !== pkg || !(want > 0) || paid.paidCents !== want || paid.paidCurrency !== CATALOG.CURRENCY) return finish('amount_mismatch', Object.assign(paid, { expectedCents: want }));
  const cmds = PKG.paidCmds(po, s, now);
  if (!cmds) return finish('needs_review', Object.assign(paid, { problem: 'order_' + po.status })); // cancelled, or paid twice
  return finish('fulfilled', paid, cmds);
}

async function lookup(pi) {
  if (!PI_RE.test(String(pi))) return null;
  const g = await pipeline([['GET', O.PI(pi)]]);
  const sid = g[0] && g[0].result;
  if (!sid) return null;
  const o = await pipeline([['GET', O.ORDER(sid)]]);
  const order = parse(o[0] && o[0].result);
  return order ? { sid, order } : null;
}
const unmatched = (status, obj, now) => pipeline(O.recordCmds('ch:' + obj.id, { type: status, charge: String(obj.charge || obj.id), paymentIntent: String(obj.payment_intent || ''), amount: Number(obj.amount) || 0, amountRefunded: Number(obj.amount_refunded) || 0, reason: obj.reason || null, at: new Date(now).toISOString(), status }, now)).then(() => status);

async function onRefund(ev, now) {
  const ch = ev.data.object || {};
  if (!OBJ_RE.test(String(ch.id))) return 'ignored';
  const found = await lookup(ch.payment_intent);
  if (!found) return unmatched('refund_unmatched', ch, now);
  const { sid, order } = found;
  const full = ch.refunded === true || Number(ch.amount_refunded) >= Number(ch.amount);
  const rec = Object.assign({}, order, { refundedCents: Number(ch.amount_refunded) || 0, refundedAt: new Date(now).toISOString(), charge: ch.id, updatedAt: new Date(now).toISOString() });
  const cmds = [];
  if (full) {
    rec.status = 'refunded';
    if (ID_RE.test(String(order.listing))) {
      const key = 'tsn:ls:' + order.listing;
      const g = await pipeline([['GET', key]]);
      const post = parse(g[0] && g[0].result);
      const win = post && post.featuredOrders && post.featuredOrders[sid];
      if (Array.isArray(win)) { // end the unused part of this order's window
        const unused = Math.max(0, win[1] - Math.max(win[0], now));
        delete post.featuredOrders[sid];
        post.featuredUntil = Math.max(now, (Number(post.featuredUntil) || 0) - unused);
        if (post.featuredUntil <= now) post.featuredUntil = now;
        cmds.push(['SET', key, JSON.stringify(post), 'KEEPTTL']);
        rec.featuredRemovedAt = new Date(now).toISOString();
      }
    }
  } else rec.status = 'partially_refunded';
  if (full && order.type === 'package' && PKG.REF_RE.test(String(order.ref))) { // the package order too; an admin ends its campaign
    const g = await pipeline([['GET', PKG.K.rec(order.ref)]]);
    cmds.push(...PKG.refundedCmds(parse(g[0] && g[0].result), now));
  }
  await pipeline(cmds.concat(O.recordCmds(sid, rec, now)));
  return rec.status;
}

async function onDispute(ev, now) {
  const dp = ev.data.object || {};
  if (!OBJ_RE.test(String(dp.id))) return 'ignored';
  const found = await lookup(dp.payment_intent);
  if (!found) return unmatched('dispute_unmatched', dp, now);
  const { sid, order } = found;
  const rec = Object.assign({}, order, { status: 'disputed', statusBeforeDispute: order.status, dispute: { id: dp.id, amount: Number(dp.amount) || 0, reason: dp.reason || null, status: dp.status || null, at: new Date(now).toISOString() }, updatedAt: new Date(now).toISOString() });
  await pipeline(O.recordCmds(sid, rec, now));
  return 'disputed';
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!SECRET || !URL_ || !TOKEN) return res.status(503).end();
  let claimed = null;
  try {
    const raw = await readRaw(req);
    if (!verify(raw, req.headers['stripe-signature'], SECRET)) return res.status(400).end();
    const ev = JSON.parse(raw.toString('utf8'));
    if (!ev || !OBJ_RE.test(String(ev.id)) || !ev.data) return res.status(400).end();
    if (!HANDLED.includes(ev.type)) return res.status(200).json({ received: true });
    // Claim the event first (SET NX), so two deliveries of it at once can't both apply it. The claim says
    // 'processing' until the outcome replaces it; if anything below fails the claim is dropped and Stripe retries.
    const evKey = 'tsn:stripe:evt:' + ev.id;
    const claim = await pipeline([['SET', evKey, 'processing', 'NX', 'EX', String(CLAIM_TTL)]]);
    if (!(claim[0] && claim[0].result === 'OK')) return res.status(200).json({ received: true, duplicate: true });
    claimed = evKey;
    const now = Date.now();
    const outcome = ev.type.startsWith('checkout.session.') ? await onSession(ev, now) : ev.type === 'charge.refunded' ? await onRefund(ev, now) : await onDispute(ev, now);
    await pipeline([['SET', evKey, String(outcome), 'EX', String(EVENT_TTL)]]); // the outcome, once everything above is stored
    return res.status(200).json({ received: true, outcome });
  } catch (e) {
    if (claimed) { try { await pipeline([['DEL', claimed]]); } catch (_) { /* the claim lapses after CLAIM_TTL */ } }
    return res.status(500).end(); // nothing marked processed: Stripe retries
  }
}
module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.verify = verify;
module.exports.HANDLED = HANDLED;
