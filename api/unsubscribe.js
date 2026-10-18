// Newsletter unsubscribe (the /unsubscribe.html page, and one-click links in newsletter emails).
//   POST /api/unsubscribe {email, token?, website}            -> { ok, message }
//   POST /api/unsubscribe?email=..&token=..  body "List-Unsubscribe=One-Click"   (RFC 8058 one-click from mail apps)
// Removes the address from the Redis set tsn:nl:subs (written by api/subscribe.js) and, when RESEND_API_KEY and
// RESEND_AUDIENCE_ID are set, marks it unsubscribed in that Resend audience. The answer is the same whether or not
// the address was on the list, so the endpoint can't be used to check who subscribes.
// Tokens: link(email) builds https://<site>/unsubscribe.html?email=..&token=.. with an HMAC of the address keyed by
// NEWSLETTER_SECRET (or CRON_SECRET). A token is only needed for one-click requests that come without a person on the
// page; someone who types their address on the page doesn't need one.
const crypto = require('crypto');
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const RESEND = process.env.RESEND_API_KEY || '', AUDIENCE = process.env.RESEND_AUDIENCE_ID || '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAILY_PER_IP = 5;
const DONE = 'If that address was on our newsletter list, it has been removed. You won’t get any more newsletters from us.';

const secret = () => process.env.NEWSLETTER_SECRET || process.env.CRON_SECRET || '';
const norm = e => String(e || '').trim().toLowerCase().slice(0, 80);
function tokenFor(email) { const k = secret(); return k ? crypto.createHmac('sha256', k).update('unsub:' + norm(email)).digest('hex').slice(0, 32) : ''; }
function validToken(email, t) {
  const want = tokenFor(email); t = String(t || '');
  if (!want || t.length !== want.length || !/^[0-9a-f]+$/.test(t)) return false;
  return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want));
}
function link(email, site) {
  const base = String(site || process.env.SITE_URL || 'https://tristatenewss.vercel.app').replace(/\/$/, '');
  const t = tokenFor(email);
  return base + '/unsubscribe.html?email=' + encodeURIComponent(norm(email)) + (t ? '&token=' + t : '');
}

async function pipeline(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('store ' + r.status);
  return r.json();
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (c, o) => res.status(c).json(o);
  if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
  if (!URL_ || !TOKEN) return send(503, { error: 'Unsubscribing isn’t available right now. Email us and we’ll remove you.' });
  try {
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } } b = b || {};
    const q = req.query || {};
    const oneClick = String(b['List-Unsubscribe'] || '') === 'One-Click';
    if (b.website) return send(200, { ok: true, message: DONE }); // honeypot
    const email = norm(b.email || q.email);
    if (!EMAIL_RE.test(email) || /[<>"'\s,;]/.test(email)) return send(400, { error: 'Enter a valid email address.' });
    // A mail app's one-click request has no person behind it, so it must carry a valid token.
    if (oneClick && !validToken(email, b.token || q.token)) return send(400, { error: 'This unsubscribe link isn’t valid. Enter your email on the page instead.' });
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || 'x';
    const rl = await pipeline([['INCR', 'tsn:nl:unrl:' + ip], ['EXPIRE', 'tsn:nl:unrl:' + ip, '86400', 'NX']]);
    if ((Number(rl[0] && rl[0].result) || 0) > DAILY_PER_IP) return send(429, { error: 'Too many attempts today. Try again tomorrow, or email us.' });
    await pipeline([['SREM', 'tsn:nl:subs', email]]);
    // Done for every address (listed or not) so the response time doesn't hint either way.
    if (RESEND && AUDIENCE) {
      try { await fetch('https://api.resend.com/audiences/' + encodeURIComponent(AUDIENCE) + '/contacts/' + encodeURIComponent(email), { method: 'PATCH', headers: { authorization: 'Bearer ' + RESEND, 'content-type': 'application/json' }, body: JSON.stringify({ unsubscribed: true }), signal: AbortSignal.timeout(8000) }); } catch (_) {}
    }
    return send(200, { ok: true, message: DONE });
  } catch (e) {
    return send(502, { error: 'Couldn’t do that just now. Try again in a moment, or email us.' });
  }
}
module.exports = handler;
module.exports.tokenFor = tokenFor;
module.exports.validToken = validToken;
module.exports.link = link;
module.exports.DONE = DONE;
