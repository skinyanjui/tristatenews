// News submissions ("Submit news" page in the footer).
//   POST /api/submit  {type,headline,details,town,when,name,email,phone,anon,photos[],consent,website}
//        -> { ok, ref }
//   GET  /api/submit  with header x-admin-key (LISTINGS_ADMIN_KEY) -> the latest 100 submissions
// Delivery: stored in Upstash Redis (same variables as api/react.js) and/or emailed through Resend.
//   RESEND_API_KEY + TIPS_TO_EMAIL  (optional TIPS_FROM_EMAIL, default Resend's onboarding sender)
// With neither configured the endpoint answers 503 and the page says submissions aren't open yet.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const { same } = require('./_safe.js');
const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';
const RESEND = process.env.RESEND_API_KEY || '', TO = process.env.TIPS_TO_EMAIL || '';
const FROM = process.env.TIPS_FROM_EMAIL || 'Tri-State News <onboarding@resend.dev>';
const DAILY_PER_IP = 5, MAX_KEEP = 500, MAX_PHOTO = 190000;
const TYPES = ['News tip', 'Photo or video', 'Press release', 'Correction'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?1?[\s.-]*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}$/;
const JPEG_RE = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/;
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const one = (v, n) => clean(v, n).replace(/\s+/g, ' ');
const todayChi = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function goodImage(v) {
  if (typeof v !== 'string' || v.length > MAX_PHOTO) return '';
  const m = JPEG_RE.exec(v);
  if (!m || m[1].length < 100) return '';
  const h = Buffer.from(m[1].slice(0, 8), 'base64');
  return h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff ? v : '';
}
function validate(b) {
  const type = TYPES.includes(b.type) ? b.type : 'News tip';
  const headline = one(b.headline, 120), details = clean(b.details, 3000), town = one(b.town, 40);
  const name = one(b.name, 60), email = one(b.email, 80), phone = one(b.phone, 20), when = one(b.when, 10);
  if (headline.length < 5) return { error: 'Add a short headline (at least 5 characters).', field: 'headline' };
  if (details.length < 30) return { error: 'Tell us a little more (at least 30 characters).', field: 'details' };
  if (!town) return { error: 'Choose the nearest town.', field: 'town' };
  if (when && (!/^\d{4}-\d{2}-\d{2}$/.test(when) || when > todayChi() || Date.parse(when + 'T12:00:00Z') < Date.now() - 400 * 864e5)) return { error: 'Pick a date that has already happened.', field: 'when' };
  if (name.length < 2) return { error: 'Add your name.', field: 'name' };
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.', field: 'email' };
  if (phone && !PHONE_RE.test(phone)) return { error: 'Enter a phone number like 812-555-0142, or leave it blank.', field: 'phone' };
  if (b.consent !== true) return { error: 'Please confirm the statement at the bottom.', field: 'consent' };
  const photos = (Array.isArray(b.photos) ? b.photos : []).slice(0, 2).map(goodImage).filter(Boolean);
  return { type, headline, details, town, when, name, email, phone, anon: b.anon === true, photos };
}
async function pipeline(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('store ' + r.status);
  return r.json();
}
async function sendMail(t, ref) {
  const rows = [['Type', t.type], ['Town', t.town], ['Happened', t.when || '—'], ['Name', t.name + (t.anon ? ' (do not publish name)' : '')], ['Email', t.email], ['Phone', t.phone || '—']];
  const html = '<h2>' + esc(t.headline) + '</h2><p style="white-space:pre-wrap">' + esc(t.details) + '</p><table cellpadding="4">' + rows.map(r => '<tr><td><b>' + r[0] + '</b></td><td>' + esc(r[1]) + '</td></tr>').join('') + '</table><p>Reference ' + ref + '</p>';
  const attachments = t.photos.map((p, i) => ({ filename: 'photo-' + (i + 1) + '.jpg', content: p.split(',')[1] }));
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + RESEND, 'content-type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [TO], reply_to: t.email, subject: '[' + t.type + '] ' + t.headline, html, attachments }), signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('mail ' + r.status);
}

async function handler(req, res) {
  const send = (c, o) => res.status(c).json(o);
  res.setHeader('Cache-Control', 'no-store');
  const stored = !!(URL_ && TOKEN), mail = !!(RESEND && TO);
  try {
    if (req.method === 'GET') {
      if (!ADMIN || !same(req.headers['x-admin-key'], ADMIN) || !stored) return send(404, { error: 'not found' });
      const out = await pipeline([['LRANGE', 'tsn:tips', '0', '99']]);
      return send(200, { items: ((out[0] && out[0].result) || []).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean) });
    }
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
    if (!stored && !mail) return send(503, { error: 'Submissions aren’t open yet. Please check back soon.' });
    let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } } body = body || {};
    if (body.website) return send(200, { ok: true, ref: 'TSN-' + Date.now().toString(36).toUpperCase().slice(-6) }); // honeypot: pretend success
    const v = validate(body);
    if (v.error) return send(400, { error: v.error, field: v.field });
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || 'x';
    if (stored) {
      const rl = await pipeline([['INCR', 'tsn:tip:rl:' + ip], ['EXPIRE', 'tsn:tip:rl:' + ip, '86400', 'NX']]);
      if ((Number(rl[0] && rl[0].result) || 0) > DAILY_PER_IP) return send(429, { error: 'You’ve sent a few submissions today. Try again tomorrow.' });
    }
    const ref = 'TSN-' + Date.now().toString(36).toUpperCase().slice(-6) + Math.random().toString(36).slice(2, 4).toUpperCase();
    const rec = { ref, at: new Date().toISOString(), ...v };
    let done = false;
    if (stored) { await pipeline([['LPUSH', 'tsn:tips', JSON.stringify(rec)], ['LTRIM', 'tsn:tips', '0', String(MAX_KEEP - 1)]]); done = true; }
    if (mail) { try { await sendMail(v, ref); done = true; } catch (e) { if (!stored) throw e; } }
    return done ? send(200, { ok: true, ref }) : send(502, { error: 'Couldn’t send that. Try again.' });
  } catch (e) {
    return send(502, { error: 'Couldn’t send that. Try again in a moment.' });
  }
}
module.exports = handler;
module.exports.validate = validate;
