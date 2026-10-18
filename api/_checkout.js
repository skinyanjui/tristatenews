// Paid "Featured" placement for a community post (job, deal, event or classified), paid through Stripe Checkout.
//   GET  /api/checkout                      -> { configured, priceVersion, prices: { job: {cents, days, label}, ... } }
//   POST /api/checkout {id, kind, uid}      -> { url }   (the poster only; redirect the browser to url)
// Prices and durations come only from api/_catalog.js (anything else in the request body, such as a price, amount,
// days or price version, is ignored), and the post's board is checked on the server, so a job can't be bought at the
// classified price. Each new order records the catalog's price version in Stripe metadata and in tsn:order:<session>.
// Needs STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for api/stripe-webhook.js). Without them the page hides the button.
// SITE_URL sets where Stripe sends people back to (defaults to the request's host).
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const KEY = process.env.STRIPE_SECRET_KEY || '';
const CATALOG = require('./_catalog.js');
// Same shape as before ({cents, days, label} per kind), now read from the catalog.
const PRICES = Object.fromEntries(Object.keys(CATALOG.FEATURED).map(k => { const p = CATALOG.featuredPrice(k); return [k, { cents: p.cents, days: p.days, label: p.label }]; }));
// The sorted-set index each board kind's posts are listed in (same as indexFor() in api/listings.js).
const INDEX = { item: 'tsn:ls:index', deal: 'tsn:dl:index', event: 'tsn:ev:index', job: 'tsn:jb:index' };
const ORDER_TTL = 90 * 86400;
const isConfigured = () => !!(KEY && URL_ && TOKEN);
const ID_RE = /^[a-z0-9]{6,20}$/;
const UID_RE = /^[a-zA-Z0-9_-]{8,48}$/;
const rec = id => 'tsn:ls:' + id;

async function pipeline(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('store ' + r.status);
  return r.json();
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const send = (c, o) => res.status(c).send(JSON.stringify(o));
  const configured = isConfigured();
  if (req.method === 'GET') return send(200, { configured, priceVersion: CATALOG.PRICE_VERSION, prices: PRICES });
  if (req.method !== 'POST') return send(405, { error: 'method' });
  if (!configured) return send(200, { configured: false });
  try {
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } } b = b || {};
    const price = CATALOG.featuredPrice(b.kind);
    if (!price || !ID_RE.test(String(b.id)) || !UID_RE.test(String(b.uid))) return send(400, { error: 'bad request' });
    const g = await pipeline([['GET', rec(b.id)], ['ZSCORE', INDEX[price.kind], b.id]]);
    let o = null; try { o = JSON.parse(g[0].result); } catch (_) {}
    if (!o) return send(404, { error: 'That post has expired.' });
    if (o.uid !== b.uid) return send(403, { error: 'not yours' });
    if (g[1] == null || g[1].result == null) return send(400, { error: 'bad request' }); // the post is not on that board
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/[^a-z0-9.:-]/gi, '');
    const site = (process.env.SITE_URL || (host ? 'https://' + host : '')).replace(/\/$/, '');
    if (!site) return send(500, { error: 'Couldn’t start checkout.' });
    const form = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(price.cents),
      'line_items[0][price_data][product_data][name]': price.label + ' · ' + price.days + ' days',
      'line_items[0][price_data][product_data][description]': String(o.title || '').slice(0, 120),
      client_reference_id: b.id,
      'metadata[id]': b.id,
      'metadata[kind]': price.kind,
      'metadata[days]': String(price.days),
      'metadata[cents]': String(price.cents),
      'metadata[price_version]': price.priceVersion,
      success_url: site + '/?featured=ok',
      cancel_url: site + '/?featured=cancel'
    });
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    if (!r.ok || !d.url) return send(502, { error: 'Couldn’t start checkout. Try again in a moment.' });
    // The order record: what was sold, at which price version. Stripe's session metadata carries the same fields,
    // so a failed write here doesn't block the payment.
    if (typeof d.id === 'string' && /^cs_[A-Za-z0-9_]{1,200}$/.test(d.id)) {
      const order = { session: d.id, listing: b.id, kind: price.kind, cents: price.cents, days: price.days, priceVersion: price.priceVersion, at: new Date().toISOString(), status: 'created' };
      try { await pipeline([['SET', 'tsn:order:' + d.id, JSON.stringify(order), 'EX', String(ORDER_TTL)]]); } catch (_) { /* metadata still records it */ }
    }
    return send(200, { url: d.url });
  } catch (e) {
    return send(502, { error: 'Couldn’t start checkout. Try again in a moment.' });
  }
}
module.exports = handler;
module.exports.PRICES = PRICES;
module.exports.INDEX = INDEX;
module.exports.isConfigured = isConfigured;
