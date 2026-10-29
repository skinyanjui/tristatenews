// Email newsletter signup, double opt-in (ads Phase 7).
//   POST /api/subscribe {email, website}            -> { ok, pending: true, emailSent, message }
//        saves a PENDING signup: tsn:nl:pend:<sha256(token)> = email (expires in CONFIRM_DAYS) and the pending zset.
//        The confirmation email (link /newsletter?confirm=<token>) goes out through Resend when RESEND_API_KEY and
//        NEWSLETTER_FROM are set. Without them the signup is still saved as pending (the admin sees the count) and
//        nothing crashes; the reader is told we'll confirm by email once our mail is set up. The answer is the same
//        for a new, pending or already-confirmed address, so the form can't be used to check who subscribes.
//   POST /api/subscribe {action:'confirm', token}  -> { ok, confirmed }   the reader pressed "Confirm" on /newsletter
//        moves the address to the list: tsn:nl:subs (who gets the newsletter) and tsn:nl:confirmed (verified)
//   GET  /api/subscribe  with x-admin-key           -> { count, emails, counts, provider, gate }
//        emails: the verified addresses (the CSV); counts: pending / verified / legacy / unsubscribed
//   GET  /api/subscribe?preview=1  with x-admin-key -> this week's issue (HTML) with the sponsor slot block; never sends
//   POST /api/subscribe {action:'test', to}  with x-admin-key -> sends ONE test copy to `to` if the provider is set up
//
// Sets: tsn:nl:subs (mailing list: confirmed + legacy signups from before double opt-in), tsn:nl:confirmed (clicked a
// confirmation link: the count the newsletter-sponsor gate uses), tsn:nl:unsubs (left the list), tsn:nl:pending (zset
// email -> time). Tokens are random; only their SHA-256 is stored.
const crypto = require('crypto');
const STORE = require('./_store.js'); // the one Redis helper (pipeline, stored)
const { same } = require('./_safe.js');
const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';
const RESEND = process.env.RESEND_API_KEY || '', AUDIENCE = process.env.RESEND_AUDIENCE_ID || '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAILY_PER_IP = 5, CONFIRM_DAYS = 7, TEST_PER_DAY = 10;
const K = { subs: 'tsn:nl:subs', confirmed: 'tsn:nl:confirmed', unsubs: 'tsn:nl:unsubs', pending: 'tsn:nl:pending', pend: h => 'tsn:nl:pend:' + h, rec: e => 'tsn:nl:sub:' + e, rl: ip => 'tsn:nl:rl:' + ip, cool: h => 'tsn:nl:cool:' + h };
// One confirmation email per address per day, whoever asks (signup bombing from many IPs can't flood an inbox).
const EMAIL_COOLDOWN = 86400;
const MESSAGES = {
  sent: 'Almost done: check your inbox and tap the link to confirm. It expires in ' + CONFIRM_DAYS + ' days.',
  failed: 'Thanks! We’ve saved your sign-up, but couldn’t send the confirmation email just now. We’ll send it soon; nothing goes out until you confirm.',
  saved: 'Thanks! We’ve saved your sign-up. Our confirmation emails aren’t switched on yet, so we’ll email you a link to confirm before you get any newsletter.',
};
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const site = () => String(process.env.SITE_URL || 'https://tristatenewss.vercel.app').replace(/\/$/, '');
const norm = e => String(e || '').trim().toLowerCase().slice(0, 80);
const validEmail = e => EMAIL_RE.test(e) && !/[<>"'\s,;]/.test(e);
// What sending needs. Confirmation emails need the first two; issues need all (api/newsletter.js missingForSend).
function provider() {
  const missing = [];
  if (!process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!process.env.NEWSLETTER_FROM) missing.push('NEWSLETTER_FROM');
  const confirmReady = missing.length === 0;
  if (!process.env.NEWSLETTER_POSTAL_ADDRESS) missing.push('NEWSLETTER_POSTAL_ADDRESS');
  if (!process.env.NEWSLETTER_SECRET && !process.env.CRON_SECRET) missing.push('NEWSLETTER_SECRET');
  return { name: 'Resend', confirmReady, issueReady: missing.length === 0, missing };
}
const { esc } = require('./_html.js');

// The confirmation email: one link, why they got it, and an unsubscribe link and header like every newsletter.
function confirmEmail(email, token) {
  const unsub = require('./unsubscribe.js');
  const link = site() + '/newsletter?confirm=' + token, u = unsub.link(email, site()), postal = process.env.NEWSLETTER_POSTAL_ADDRESS || '';
  const html = '<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#171717;max-width:560px;margin:0 auto;padding:24px">' +
    '<h1 style="font-size:20px">Confirm your Tri-State News subscription</h1><p>Tap the button to start getting our weekly email of local headlines and events.</p>' +
    '<p><a href="' + esc(link) + '" style="display:inline-block;padding:12px 18px;background:#0b6b86;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Confirm my subscription</a></p>' +
    '<p style="color:#666;font-size:13px">The link works for ' + CONFIRM_DAYS + ' days. If you didn’t sign up, ignore this email and you won’t hear from us again.</p>' +
    '<p style="color:#666;font-size:12px"><a href="' + esc(u) + '" style="color:#666">Unsubscribe</a>' + (postal ? '<br>' + esc(postal) : '') + '</p></body></html>';
  const text = 'Confirm your Tri-State News subscription:\n' + link + '\n\nThe link works for ' + CONFIRM_DAYS + ' days. If you didn’t sign up, ignore this email.\n\nUnsubscribe: ' + u + (postal ? '\n' + postal : '') + '\n';
  return { from: process.env.NEWSLETTER_FROM, to: [email], subject: 'Confirm your Tri-State News subscription', html, text,
    headers: { 'List-Unsubscribe': '<' + site() + '/api/unsubscribe?' + u.split('?')[1] + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}
async function resend(body) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return r.ok;
}

const pipeline = STORE.pipeline;
// Verified (confirmed) subscribers: what the newsletter-sponsor gate counts (api/_catalog.js newsletterEligibility).
async function verifiedCount() {
  if (!STORE.stored()) return 0;
  const g = await pipeline([['SCARD', K.confirmed]]);
  return Number(g[0] && g[0].result) || 0;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (c, o) => res.status(c).json(o);
  if (!STORE.stored()) return send(503, { error: 'Signups aren’t open yet. Please check back soon.' });
  const now = Date.now();
  const isAdmin = () => !!ADMIN && same(req.headers['x-admin-key'], ADMIN);
  try {
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } } b = b || {};
    if (req.method === 'GET') {
      if (!isAdmin()) return send(404, { error: 'not found' });
      const q = req.query || {};
      if (q.preview) return send(200, await require('./newsletter.js').preview(now));
      const out = await pipeline([['ZREMRANGEBYSCORE', K.pending, '0', String(now - CONFIRM_DAYS * 864e5)], ['SMEMBERS', K.confirmed], ['SCARD', K.subs], ['SCARD', K.unsubs], ['ZCARD', K.pending]]);
      const emails = ((out[1] && out[1].result) || []).slice().sort();
      const list = Number(out[2] && out[2].result) || 0;
      const C = require('./_catalog.js');
      return send(200, { count: emails.length, emails, counts: { pending: Number(out[4] && out[4].result) || 0, verified: emails.length, legacy: Math.max(0, list - emails.length), unsubscribed: Number(out[3] && out[3].result) || 0 },
        provider: provider(), gate: { verified: emails.length, min: C.NEWSLETTER_MIN_VERIFIED } });
    }
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
    if (b.action === 'test') { // admin: one test copy of this week's issue to one address; never the list
      if (!isAdmin()) return send(404, { error: 'not found' });
      const to = norm(b.to);
      if (!validEmail(to)) return send(400, { error: 'Enter the address to send the test to.' });
      const p = provider();
      if (!p.issueReady) return send(409, { error: 'Email isn’t set up: missing ' + p.missing.join(', ') + '. Nothing was sent.', missing: p.missing });
      const rl = await pipeline([['INCR', 'tsn:nl:testrl'], ['EXPIRE', 'tsn:nl:testrl', '86400', 'NX']]);
      if ((Number(rl[0] && rl[0].result) || 0) > TEST_PER_DAY) return send(429, { error: 'That’s enough test sends for today.' });
      const m = await require('./newsletter.js').testMessage(to, now);
      return (await resend(m)) ? send(200, { ok: true, sentTo: to }) : send(502, { error: 'The email service didn’t accept it.' });
    }
    if (b.action === 'confirm') {
      const t = String(b.token || '');
      if (!/^[0-9a-f]{64}$/.test(t)) return send(400, { error: 'This confirmation link isn’t valid.' });
      const g = await pipeline([['GET', K.pend(hash(t))]]);
      const email = g[0] && g[0].result;
      if (!email) return send(404, { error: 'This link has expired or was already used. Sign up again and we’ll send a new one.' });
      await pipeline([['DEL', K.pend(hash(t))], ['ZREM', K.pending, email], ['SADD', K.subs, email], ['SADD', K.confirmed, email], ['SREM', K.unsubs, email],
        ['SET', K.rec(email), JSON.stringify({ confirmedAt: new Date(now).toISOString() })]]);
      if (RESEND && AUDIENCE) {
        try { await fetch('https://api.resend.com/audiences/' + encodeURIComponent(AUDIENCE) + '/contacts', { method: 'POST', headers: { authorization: 'Bearer ' + RESEND, 'content-type': 'application/json' }, body: JSON.stringify({ email, unsubscribed: false }), signal: AbortSignal.timeout(5000) }); } catch (_) { /* the list in Redis is what counts */ }
      }
      return send(200, { ok: true, confirmed: true });
    }
    const p = provider();
    if (b.website) return send(200, { ok: true, pending: true, emailSent: p.confirmReady, message: p.confirmReady ? MESSAGES.sent : MESSAGES.saved }); // honeypot
    const email = norm(b.email);
    if (!validEmail(email)) return send(400, { error: 'Enter a valid email address.' });
    const ip = require('./_ip.js').clientIp(req) || 'x';
    const rl = await pipeline([['INCR', K.rl(ip)], ['EXPIRE', K.rl(ip), '86400', 'NX'], ['SISMEMBER', K.confirmed, email]]);
    if ((Number(rl[0] && rl[0].result) || 0) > DAILY_PER_IP) return send(429, { error: 'Too many attempts today. Try again tomorrow.' });
    const already = Number(rl[2] && rl[2].result) === 1;
    // Cooling down: the answer is the same as a send (it doesn't reveal that someone asked for this address today).
    if (!already) { const c = await pipeline([['SET', K.cool(hash(email)), '1', 'NX', 'EX', String(EMAIL_COOLDOWN)]]); if (!(c[0] && c[0].result === 'OK')) return send(200, { ok: true, pending: true, emailSent: p.confirmReady, message: p.confirmReady ? MESSAGES.sent : MESSAGES.saved }); }
    let emailSent = false;
    if (!already) { // a confirmed reader gets no new email; the answer below is the same
      const token = crypto.randomBytes(32).toString('hex');
      await pipeline([['SET', K.pend(hash(token)), email, 'EX', String(CONFIRM_DAYS * 86400)], ['ZADD', K.pending, String(now), email]]);
      if (p.confirmReady) { try { emailSent = await resend(confirmEmail(email, token)); } catch (_) { emailSent = false; } }
    }
    const ok = already ? p.confirmReady : emailSent;
    return send(200, { ok: true, pending: true, emailSent: ok, message: ok ? MESSAGES.sent : p.confirmReady ? MESSAGES.failed : MESSAGES.saved });
  } catch (e) {
    require('./_log.js').fail('subscribe', e);
    return send(502, { error: 'Couldn’t sign you up. Try again in a moment.' });
  }
}
module.exports = handler;
Object.assign(module.exports, { K, EMAIL_COOLDOWN, CONFIRM_DAYS, MESSAGES, hash, provider, confirmEmail, verifiedCount });
