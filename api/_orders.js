// Order records for paid placements, and the admin's read-only view of them.
//   GET /api/orders  with header x-admin-key (LISTINGS_ADMIN_KEY) -> { orders, attention, totals }
// (vercel.json rewrites /api/orders to /api/listings?__route=orders; no new function.)
//
// Keys (Upstash Redis). Money records never expire:
//   tsn:order:<session id>   one order: created by api/_checkout.js with a 30-day TTL while unpaid; the webhook
//                            rewrites it without a TTL once a payment arrives (fulfilled or not)
//   tsn:order:pi:<pi>        payment intent -> session id, for refunds and disputes (no TTL)
//   tsn:order:ch:<id>        a refund (charge id) or dispute (dispute id) Stripe sent for a payment we have no
//                            order for (no TTL)
//   tsn:order:rm-<post>-<t>  a post removed while Featured (reports, admin, or its poster) (no TTL)
//   tsn:orders               sorted set of every record above, by time
//   tsn:orders:attention     sorted set of the ones an admin must act on (refund due, amount mismatch, dispute,
//                            partial refund, unmatched refund); a full refund through Stripe takes one off
// Order status: created -> fulfilled | needs_refund | amount_mismatch | needs_review | payment_failed,
//               then refunded | partially_refunded | disputed.
// Removal records: needs_review (removed by reports or the admin while Featured) | removed_by_poster.
const STORE = require('./_store.js'); // the one Redis helper (pipeline, stored)
const { same } = require('./_safe.js');
const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';

const ORDER = id => 'tsn:order:' + id;
const PI = pi => 'tsn:order:pi:' + pi;
const ORDERS = 'tsn:orders', ATTENTION = 'tsn:orders:attention';
const NEEDS_ATTENTION = ['needs_refund', 'amount_mismatch', 'needs_review', 'partially_refunded', 'disputed', 'refund_unmatched', 'dispute_unmatched'];
const MAX_SHOWN = 100;

// Commands that write a money record (no TTL) and list it; on the attention list when its status needs an admin.
function recordCmds(key, rec, now) {
  const cmds = [['SET', ORDER(key), JSON.stringify(rec)], ['ZADD', ORDERS, String(now), key]];
  cmds.push(NEEDS_ATTENTION.includes(rec.status) ? ['ZADD', ATTENTION, String(now), key] : ['ZREM', ATTENTION, key]);
  return cmds;
}

// A post that is still Featured is being removed: keep a record so the paid time isn't lost silently.
// reason: 'reports' | 'admin' | 'poster'. The Terms (legal.html, Featured posts) owe the unused part back when we
// remove a paid post for anything other than a breach of the Terms, so a removal by reports or the admin goes on the
// attention list for a decision (needs_review); a poster deleting their own post is recorded but owes nothing.
function removalCmds(id, post, reason, now) {
  if (!post || !(Number(post.featuredUntil) > now)) return [];
  const key = 'rm-' + id + '-' + now.toString(36);
  return recordCmds(key, { type: 'post_removed', listing: id, title: String(post.title || '').slice(0, 120), reason, featuredUntil: Number(post.featuredUntil), orders: Object.keys(post.featuredOrders || {}), at: new Date(now).toISOString(), status: reason === 'poster' ? 'removed_by_poster' : 'needs_review' }, now);
}

const pipeline = STORE.pipeline;

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const send = (c, o) => res.status(c).send(JSON.stringify(o));
  if (req.method !== 'GET' || !ADMIN || !same(req.headers['x-admin-key'], ADMIN) || !STORE.stored()) return send(404, { error: 'not found' });
  try {
    const idx = await pipeline([['ZREVRANGE', ORDERS, '0', String(MAX_SHOWN - 1)], ['ZREVRANGE', ATTENTION, '0', String(MAX_SHOWN - 1)]]);
    const ids = (idx[0] && idx[0].result) || [], att = (idx[1] && idx[1].result) || [];
    const all = [...new Set(ids.concat(att))];
    const got = all.length ? await pipeline([['MGET', ...all.map(ORDER)]]) : [{ result: [] }];
    const byId = new Map();
    ((got[0] && got[0].result) || []).forEach((v, i) => { try { if (v) byId.set(all[i], Object.assign({ key: all[i] }, JSON.parse(v))); } catch (_) {} });
    const orders = ids.map(k => byId.get(k)).filter(Boolean), attention = att.map(k => byId.get(k)).filter(Boolean);
    const paid = orders.filter(o => o.paidCents > 0);
    const totals = { orders: paid.length, paidCents: paid.reduce((n, o) => n + o.paidCents, 0), refundedCents: paid.reduce((n, o) => n + (Number(o.refundedCents) || 0), 0), attention: attention.length };
    return send(200, { orders, attention, totals });
  } catch (e) {
    require('./_log.js').fail('orders', e);
    return send(502, { error: 'store unavailable' });
  }
}

module.exports = handler;
Object.assign(module.exports, { ORDER, PI, ORDERS, ATTENTION, NEEDS_ATTENTION, recordCmds, removalCmds });
