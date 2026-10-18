// Weekly email digest: top local headlines and upcoming events, sent to the newsletter list through Resend.
//   GET|POST /api/newsletter                 dry run (default): JSON summary + the email HTML, nothing is sent
//   GET|POST /api/newsletter?format=html     dry run, answers the email itself as text/html (open it in a browser)
//   POST     /api/newsletter?send=1          sends this week's issue
// Every call needs  Authorization: Bearer <CRON_SECRET>.
//
// Nothing is sent unless ALL of these hold (so a stray call cannot mail the list):
//   ?send=1, NEWSLETTER_ENABLED=true in Vercel, RESEND_API_KEY, NEWSLETTER_FROM (an address on a domain verified
//   in Resend) and NEWSLETTER_POSTAL_ADDRESS (CAN-SPAM requires a postal address in every commercial email).
// The GitHub workflow .github/workflows/newsletter.yml only calls ?send=1 when the repo variable NEWSLETTER_ENABLED
// is 'true' as well.
//
// List: the Redis set tsn:nl:subs (api/subscribe.js). Each recipient gets their own email with their own
// unsubscribe link (require('./unsubscribe.js').link) in the footer and in List-Unsubscribe / List-Unsubscribe-Post
// (RFC 8058 one-click, handled by api/unsubscribe.js).
// One issue per ISO week (Chicago time): recipients are recorded in tsn:nl:issue:<week>:sent as each batch of up to
// 100 is accepted by Resend, so a retry or a second call that week only mails whoever was not reached yet.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const { same } = require('./_safe.js');
const unsub = require('./unsubscribe.js');

const TZ = 'America/Chicago';
const HEADLINES = 10, PER_SOURCE = 2, EVENTS = 8, BATCH = 100;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const site = () => String(process.env.SITE_URL || 'https://tristatenewss.vercel.app').replace(/\/$/, '');
const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } };

async function redis(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('store ' + r.status);
  return (await r.json()).map(x => x && x.result);
}
async function getJson(path) {
  const r = await fetch(site() + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(path + ' HTTP ' + r.status);
  return r.json();
}

// ISO week in Chicago time, e.g. "2026-W42": the issue id.
function isoWeek(now) {
  const [y, m, d] = new Date(now).toLocaleDateString('en-CA', { timeZone: TZ }).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d)), day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, '0');
}
// A Chicago wall-clock date and time ('2026-11-03', '18:30') as epoch ms, right on both sides of DST changes.
function chicagoMs(date, time) {
  const [y, m, d] = String(date).split('-').map(Number), [hh, mm] = String(time || '12:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = t => { const z = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' }).formatToParts(t).find(p => p.type === 'timeZoneName').value;
    const x = /GMT([+-])(\d+)(?::(\d+))?/.exec(z); return x ? (x[1] === '-' ? -1 : 1) * (+x[2] * 60 + (+x[3] || 0)) : 0; };
  return guess - off(guess - off(guess) * 6e4) * 6e4;
}
const fmtDay = t => new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
const fmtTime = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

// news: the /api/news body; listings: the /api/listings?kind=event body (or null).
function pick(news, listings, now) {
  const kind = {}; (news.sources || []).forEach(s => { kind[s.id] = s.kind || 'news'; });
  const weekAgo = now - 7 * 864e5, per = {}, headlines = [];
  // News sources only: no Police & courts items (arrests need their "not convicted" context on the site), no obituaries.
  const stories = (news.items || []).filter(i => !i.isEvent && !i.isObit && (kind[i.sourceId] || 'news') === 'news' && safeUrl(i.link))
    .filter(i => { const t = Date.parse(i.published); return t > weekAgo && t <= now + 36e5; })
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  for (const i of stories) {
    if (headlines.length >= HEADLINES) break;
    if ((per[i.sourceId] = (per[i.sourceId] || 0) + 1) > PER_SOURCE) continue;
    if (headlines.some(h => h.title.toLowerCase() === i.title.toLowerCase())) continue;
    headlines.push({ title: i.title, link: safeUrl(i.link), source: i.source, summary: String(i.summary || '').slice(0, 180) });
  }
  const weekOut = now + 7 * 864e5, events = [];
  for (const i of news.items || []) {
    const t = Date.parse(i.published);
    if (i.isEvent && t >= now - 3 * 36e5 && t <= weekOut && safeUrl(i.link)) events.push({ title: i.title, at: t, place: i.venue || i.area || '', link: safeUrl(i.link), timed: true });
  }
  for (const e of (listings && listings.items) || []) {
    const t = chicagoMs(e.date, e.time);
    if (t >= now - 3 * 36e5 && t <= weekOut) events.push({ title: e.title, at: t, place: [e.place, e.town].filter(Boolean).join(', '), link: site() + '/events', timed: !!e.time });
  }
  events.sort((a, b) => a.at - b.at);
  const seen = new Set();
  return { headlines, events: events.filter(e => { const k = e.title.toLowerCase() + fmtDay(e.at); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, EVENTS) };
}

function render(issue, email) {
  const u = unsub.link(email, site()), base = site(), postal = process.env.NEWSLETTER_POSTAL_ADDRESS || '';
  const a = (href, text, style) => '<a href="' + esc(href) + '" style="color:#0b6b86;text-decoration:none;' + (style || '') + '">' + esc(text) + '</a>';
  const h = issue.headlines.map(x => '<tr><td style="padding:10px 0;border-bottom:1px solid #ebebeb">' + a(x.link, x.title, 'font-weight:600;font-size:16px;line-height:22px') +
    '<div style="color:#666;font-size:13px;line-height:18px;margin-top:2px">' + esc(x.source) + '</div></td></tr>').join('');
  const ev = issue.events.map(x => '<tr><td style="padding:8px 12px 8px 0;vertical-align:top;white-space:nowrap;color:#c2410c;font:600 13px/18px ui-monospace,Menlo,monospace">' + esc(fmtDay(x.at)) +
    (x.timed ? '<br><span style="color:#666;font-weight:500">' + esc(fmtTime(x.at)) + '</span>' : '') + '</td><td style="padding:8px 0;border-bottom:1px solid #ebebeb">' + a(x.link, x.title, 'font-weight:600') +
    (x.place ? '<div style="color:#666;font-size:13px;line-height:18px">' + esc(x.place) + '</div>' : '') + '</td></tr>').join('');
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + esc(issue.subject) + '</title></head>' +
    '<body style="margin:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171717">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e0e0e0;border-radius:6px"><tr><td style="padding:24px">' +
    '<div style="font-weight:600;font-size:20px;color:#0b6b86">' + a(base + '/', 'Tri-State News', 'color:#0b6b86') + '</div>' +
    '<div style="color:#666;font-size:13px;margin:4px 0 16px">Week of ' + esc(issue.weekOf) + '</div>' +
    (h ? '<h2 style="font-size:15px;margin:16px 0 4px;text-transform:uppercase;letter-spacing:.04em;color:#444">Top headlines</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + h + '</table>' : '') +
    (ev ? '<h2 style="font-size:15px;margin:24px 0 4px;text-transform:uppercase;letter-spacing:.04em;color:#444">Coming up</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + ev + '</table>' +
      '<p style="margin:12px 0 0">' + a(base + '/events', 'All events \u2192') + '</p>' : '') +
    '<p style="margin:24px 0 0">' + a(base + '/news', 'More local news \u2192') + '</p>' +
    '</td></tr></table>' +
    '<p style="max-width:600px;color:#666;font-size:12px;line-height:18px;margin:16px auto 0">Headlines link to the original publishers. You get this because you signed up at ' + a(base + '/', base.replace(/^https?:\/\//, '')) + '.<br>' +
    a(u, 'Unsubscribe', 'color:#666;text-decoration:underline') + ' \u00b7 ' + a(base + '/legal.html', 'Privacy and terms', 'color:#666;text-decoration:underline') +
    (postal ? '<br>' + esc(postal) : '') + '</p></td></tr></table></body></html>';
  const text = 'Tri-State News, week of ' + issue.weekOf + '\n\nTOP HEADLINES\n' + issue.headlines.map(x => '- ' + x.title + ' (' + x.source + ')\n  ' + x.link).join('\n') +
    (issue.events.length ? '\n\nCOMING UP\n' + issue.events.map(x => '- ' + fmtDay(x.at) + (x.timed ? ' ' + fmtTime(x.at) : '') + ': ' + x.title + (x.place ? ', ' + x.place : '') + '\n  ' + x.link).join('\n') : '') +
    '\n\nUnsubscribe: ' + u + (postal ? '\n' + postal : '') + '\n';
  const oneClick = base + '/api/unsubscribe?' + u.split('?')[1];
  return { html, text, headers: { 'List-Unsubscribe': '<' + oneClick + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

async function buildIssue(now) {
  const [news, listings] = await Promise.all([getJson('/api/news'), getJson('/api/listings?kind=event').catch(() => null)]);
  const p = pick(news, listings, now);
  const weekOf = new Date(now).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ });
  const top = p.headlines[0];
  return Object.assign(p, { week: isoWeek(now), weekOf, subject: 'Tri-State this week' + (top ? ': ' + top.title.slice(0, 70) : '') });
}

function missingForSend() {
  const need = [];
  if (process.env.NEWSLETTER_ENABLED !== 'true') need.push('NEWSLETTER_ENABLED=true');
  if (!process.env.RESEND_API_KEY) need.push('RESEND_API_KEY');
  if (!process.env.NEWSLETTER_FROM) need.push('NEWSLETTER_FROM');
  if (!process.env.NEWSLETTER_POSTAL_ADDRESS) need.push('NEWSLETTER_POSTAL_ADDRESS');
  if (!process.env.NEWSLETTER_SECRET && !process.env.CRON_SECRET) need.push('NEWSLETTER_SECRET');
  if (!URL_ || !TOKEN) need.push('KV_REST_API_URL/KV_REST_API_TOKEN');
  return need;
}

async function send(issue) {
  const sentKey = 'tsn:nl:issue:' + issue.week + ':sent', lock = 'tsn:nl:lock';
  const [got] = await redis([['SET', lock, '1', 'NX', 'EX', '300']]);
  if (got !== 'OK') return { status: 409, body: { error: 'another send is running' } };
  try {
    const [subs, done] = await redis([['SMEMBERS', 'tsn:nl:subs'], ['SMEMBERS', sentKey]]);
    const already = new Set(done || []), todo = (subs || []).filter(e => !already.has(e)).sort();
    let sent = 0;
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      const body = chunk.map(email => { const m = render(issue, email); return { from: process.env.NEWSLETTER_FROM, to: [email], subject: issue.subject, html: m.html, text: m.text, headers: m.headers }; });
      const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST',
        headers: { authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'content-type': 'application/json', 'idempotency-key': 'tsn-nl-' + issue.week + '-' + chunk[0] + '-' + chunk.length },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      if (!r.ok) { const t = (await r.text()).slice(0, 200); return { status: 502, body: { error: 'Resend HTTP ' + r.status, detail: t, sent, remaining: todo.length - sent } }; }
      await redis([['SADD', sentKey].concat(chunk), ['EXPIRE', sentKey, String(10 * 86400)]]);
      sent += chunk.length;
      if (i + BATCH < todo.length) await new Promise(ok => setTimeout(ok, 600)); // Resend's default limit is 2 requests/s
    }
    return { status: 200, body: { ok: true, week: issue.week, sent, skippedAlreadySent: already.size, subscribers: (subs || []).length } };
  } finally { try { await redis([['DEL', lock]]); } catch (e) { /* lock expires on its own */ } }
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET || '';
  if (!secret || !same(req.headers.authorization || '', 'Bearer ' + secret)) return res.status(404).json({ error: 'not found' });
  const q = req.query || {}, wantSend = String(q.send || '') === '1';
  try {
    const now = Date.now(), issue = await buildIssue(now);
    if (!wantSend) {
      const m = render(issue, 'preview@example.com');
      if (q.format === 'html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(200).send(m.html); }
      let subscribers = null; try { if (URL_ && TOKEN) [subscribers] = await redis([['SCARD', 'tsn:nl:subs']]); } catch (e) { /* preview anyway */ }
      return res.status(200).json({ dryRun: true, week: issue.week, subject: issue.subject, headlines: issue.headlines.length, events: issue.events.length, subscribers, wouldSend: missingForSend().length === 0, missingForSend: missingForSend(), headers: m.headers, html: m.html, text: m.text });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'sending needs POST' });
    const miss = missingForSend();
    if (miss.length) return res.status(409).json({ error: 'not sending: newsletter is not enabled or not configured', missing: miss });
    if (!issue.headlines.length) return res.status(409).json({ error: 'not sending: no headlines this week' });
    const out = await send(issue);
    return res.status(out.status).json(out.body);
  } catch (e) {
    return res.status(502).json({ error: String(e && e.message || e).slice(0, 200) });
  }
}
module.exports = handler;
module.exports.pick = pick;
module.exports.render = render;
module.exports.isoWeek = isoWeek;
module.exports.chicagoMs = chicagoMs;
module.exports.missingForSend = missingForSend;
