// Paid "Featured" placement for a community post (job, deal, event or item), paid through Stripe Checkout.
//   GET  /api/checkout                      -> { configured, prices: { job: {cents, days}, ... } }
//   POST /api/checkout {id, kind, uid}      -> { url }   (the poster only; redirect the browser to url)
// Needs STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for api/stripe-webhook.js). Without them the page hides the button.
// SITE_URL sets where Stripe sends people back to (defaults to the request's host).
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const KEY = process.env.STRIPE_SECRET_KEY || '';
const PRICES = {
  job: { cents: 2900, days: 30, label: 'Featured job' },
  deal: { cents: 1900, days: 14, label: 'Featured deal' },
  event: { cents: 1500, days: 7, label: 'Featured event' },
  item: { cents: 500, days: 7, label: 'Featured listing' }
};
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
  const configured = !!(KEY && URL_ && TOKEN);
  if (req.method === 'GET') return send(200, { configured, prices: PRICES });
  if (req.method !== 'POST') return send(405, { error: 'method' });
  if (!configured) return send(200, { configured: false });
  try {
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } } b = b || {};
    const price = PRICES[b.kind];
    if (!price || !ID_RE.test(String(b.id)) || !UID_RE.test(String(b.uid))) return send(400, { error: 'bad request' });
    const g = await pipeline([['GET', rec(b.id)]]);
    let o = null; try { o = JSON.parse(g[0].result); } catch (_) {}
    if (!o) return send(404, { error: 'That post has expired.' });
    if (o.uid !== b.uid) return send(403, { error: 'not yours' });
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
      'metadata[kind]': b.kind,
      'metadata[days]': String(price.days),
      success_url: site + '/?featured=ok',
      cancel_url: site + '/?featured=cancel'
    });
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    if (!r.ok || !d.url) return send(502, { error: 'Couldn’t start checkout. Try again in a moment.' });
    return send(200, { url: d.url });
  } catch (e) {
    return send(502, { error: 'Couldn’t start checkout. Try again in a moment.' });
  }
}
module.exports = handler;
module.exports.PRICES = PRICES;
