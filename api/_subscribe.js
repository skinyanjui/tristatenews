// Email newsletter signup.
//   POST /api/subscribe {email, website}  -> { ok }
//   GET  /api/subscribe  with header x-admin-key (LISTINGS_ADMIN_KEY) -> { count, emails }
// Subscribers are kept in Upstash Redis (set tsn:nl:subs). If RESEND_API_KEY and RESEND_AUDIENCE_ID are set, each
// new subscriber is also added to that Resend audience so a broadcast can be sent from Resend.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const { same } = require('./_safe.js');
const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';
const RESEND = process.env.RESEND_API_KEY || '', AUDIENCE = process.env.RESEND_AUDIENCE_ID || '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAILY_PER_IP = 5;

async function pipeline(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('store ' + r.status);
  return r.json();
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (c, o) => res.status(c).json(o);
  if (!URL_ || !TOKEN) return send(503, { error: 'Signups aren’t open yet. Please check back soon.' });
  try {
    if (req.method === 'GET') {
      if (!ADMIN || !same(req.headers['x-admin-key'], ADMIN)) return send(404, { error: 'not found' });
      const out = await pipeline([['SMEMBERS', 'tsn:nl:subs']]);
      const emails = (out[0] && out[0].result) || [];
      return send(200, { count: emails.length, emails });
    }
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } } b = b || {};
    if (b.website) return send(200, { ok: true }); // honeypot
    const email = String(b.email || '').trim().toLowerCase().slice(0, 80);
    if (!EMAIL_RE.test(email) || /[<>"'\s,;]/.test(email)) return send(400, { error: 'Enter a valid email address.' });
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || 'x';
    const rl = await pipeline([['INCR', 'tsn:nl:rl:' + ip], ['EXPIRE', 'tsn:nl:rl:' + ip, '86400', 'NX']]);
    if ((Number(rl[0] && rl[0].result) || 0) > DAILY_PER_IP) return send(429, { error: 'Too many attempts today. Try again tomorrow.' });
    const add = await pipeline([['SADD', 'tsn:nl:subs', email]]);
    const isNew = Number(add[0] && add[0].result) === 1;
    if (isNew && RESEND && AUDIENCE) {
      try { await fetch('https://api.resend.com/audiences/' + encodeURIComponent(AUDIENCE) + '/contacts', { method: 'POST', headers: { authorization: 'Bearer ' + RESEND, 'content-type': 'application/json' }, body: JSON.stringify({ email, unsubscribed: false }), signal: AbortSignal.timeout(8000) }); } catch (_) {}
    }
    return send(200, { ok: true });
  } catch (e) {
    return send(502, { error: 'Couldn’t sign you up. Try again in a moment.' });
  }
}
module.exports = handler;
