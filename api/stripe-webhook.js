// Stripe webhook: when a Featured payment completes, mark the post featured.
// Add an endpoint in Stripe pointing at https://<site>/api/stripe-webhook for the event "checkout.session.completed"
// and set STRIPE_WEBHOOK_SECRET to its signing secret.
const crypto = require('crypto');
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const ID_RE = /^[a-z0-9]{6,20}$/;
const KINDS = { job: 1, deal: 1, event: 1, item: 1 };

async function pipeline(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('store ' + r.status);
  return r.json();
}
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

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!SECRET || !URL_ || !TOKEN) return res.status(503).end();
  try {
    const raw = await readRaw(req);
    if (!verify(raw, req.headers['stripe-signature'], SECRET)) return res.status(400).end();
    const ev = JSON.parse(raw.toString('utf8'));
    if (ev.type === 'checkout.session.completed' && ev.data && ev.data.object) {
      const s = ev.data.object, m = s.metadata || {};
      if (s.payment_status === 'paid' && ID_RE.test(String(m.id)) && KINDS[m.kind]) {
        const once = await pipeline([['SET', 'tsn:stripe:evt:' + ev.id, '1', 'NX', 'EX', '604800']]);
        if (once[0] && once[0].result === 'OK') {
          const g = await pipeline([['GET', 'tsn:ls:' + m.id]]);
          let o = null; try { o = JSON.parse(g[0].result); } catch (_) {}
          if (o) {
            const days = Math.min(60, Math.max(1, Number(m.days) || 7));
            o.featuredUntil = Math.max(Date.now(), Number(o.featuredUntil) || 0) + days * 864e5;
            await pipeline([['SET', 'tsn:ls:' + m.id, JSON.stringify(o), 'KEEPTTL']]);
          }
        }
      }
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    return res.status(500).end();
  }
}
module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.verify = verify;
