// Advertising and sponsorship inquiries (the "Advertise" page).
//   POST /api/advertise {business, name, email, phone, interest, message, website} -> { ok, ref }
//   GET  /api/advertise  with header x-admin-key (LISTINGS_ADMIN_KEY) -> the latest 100 inquiries
// Stored in Upstash Redis and/or emailed through Resend (RESEND_API_KEY + TIPS_TO_EMAIL), like api/submit.js.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';
const RESEND = process.env.RESEND_API_KEY || '', TO = process.env.TIPS_TO_EMAIL || '';
const FROM = process.env.TIPS_FROM_EMAIL || 'Tri-State News <onboarding@resend.dev>';
const INTERESTS = ['Featured job or deal', 'Section sponsorship', 'Newsletter sponsorship', 'Something else'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?1?[\s.-]*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}$/;
const DAILY_PER_IP = 5;
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function validate(b) {
  const business = clean(b.business, 80).replace(/\s+/g, ' '), name = clean(b.name, 60).replace(/\s+/g, ' ');
  const email = clean(b.email, 80), phone = clean(b.phone, 20), message = clean(b.message, 1500);
  const interest = INTERESTS.includes(b.interest) ? b.interest : INTERESTS[3];
  if (business.length < 2) return { error: 'Add your business name.', field: 'business' };
  if (name.length < 2) return { error: 'Add your name.', field: 'name' };
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.', field: 'email' };
  if (phone && !PHONE_RE.test(phone)) return { error: 'Enter a phone number like 812-555-0142, or leave it blank.', field: 'phone' };
  return { business, name, email, phone, interest, message };
}
async function pipeline(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('store ' + r.status);
  return r.json();
}
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (c, o) => res.status(c).json(o);
  const stored = !!(URL_ && TOKEN), mail = !!(RESEND && TO);
  try {
    if (req.method === 'GET') {
      if (!ADMIN || req.headers['x-admin-key'] !== ADMIN || !stored) return send(404, { error: 'not found' });
      const out = await pipeline([['LRANGE', 'tsn:ads', '0', '99']]);
      return send(200, { items: ((out[0] && out[0].result) || []).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean) });
    }
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
    if (!stored && !mail) return send(503, { error: 'This form isn’t open yet. Please check back soon.' });
    let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } } body = body || {};
    if (body.website) return send(200, { ok: true, ref: 'AD-' + Date.now().toString(36).toUpperCase().slice(-6) });
    const v = validate(body);
    if (v.error) return send(400, { error: v.error, field: v.field });
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || 'x';
    if (stored) {
      const rl = await pipeline([['INCR', 'tsn:ad:rl:' + ip], ['EXPIRE', 'tsn:ad:rl:' + ip, '86400', 'NX']]);
      if ((Number(rl[0] && rl[0].result) || 0) > DAILY_PER_IP) return send(429, { error: 'You’ve sent a few already today. Try again tomorrow.' });
    }
    const ref = 'AD-' + Date.now().toString(36).toUpperCase().slice(-6) + Math.random().toString(36).slice(2, 4).toUpperCase();
    let done = false;
    if (stored) { await pipeline([['LPUSH', 'tsn:ads', JSON.stringify({ ref, at: new Date().toISOString(), ...v })], ['LTRIM', 'tsn:ads', '0', '299']]); done = true; }
    if (mail) {
      try {
        const html = '<h2>' + esc(v.business) + ' · ' + esc(v.interest) + '</h2><p>' + esc(v.name) + ' · ' + esc(v.email) + (v.phone ? ' · ' + esc(v.phone) : '') + '</p><p style="white-space:pre-wrap">' + esc(v.message || '(no message)') + '</p><p>Reference ' + ref + '</p>';
        const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + RESEND, 'content-type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [TO], reply_to: v.email, subject: '[Advertising] ' + v.business + ' · ' + v.interest, html }), signal: AbortSignal.timeout(8000) });
        if (r.ok) done = true; else if (!stored) throw new Error('mail');
      } catch (e) { if (!stored) throw e; }
    }
    return done ? send(200, { ok: true, ref }) : send(502, { error: 'Couldn’t send that. Try again.' });
  } catch (e) {
    return send(502, { error: 'Couldn’t send that. Try again in a moment.' });
  }
}
module.exports = handler;
module.exports.validate = validate;
