// Advertiser creatives: upload, admin review, and the approved ads the page shows.
//   POST /api/creative  {ref, email | token, headline, text, cta, dest, image}   an advertiser submits a creative
//        -> { ok, id, status: 'pending' }. Access needs one of: an advertising inquiry reference (AD-...) with the
//        email used on that inquiry, a paid order (the Stripe checkout id, cs_...), or a signed upload token the admin
//        issued for a reference. Nobody can upload anonymously.
//   GET  /api/creative?live=1                        the approved creatives, by placement (public; cached briefly)
//   GET  /api/creative?img=<id>                      an approved creative's image (public); pending or rejected
//                                                    images only with x-admin-key
//   GET  /api/creative       with x-admin-key       every creative (newest 100), the pending queue and the audit log
//   POST /api/creative  {action:'approve', id, reason, placements[]} | {action:'reject', id, reason} |
//                       {action:'withdraw', id, reason} | {action:'token', ref}   with x-admin-key
// (vercel.json rewrites /api/creative to /api/inbox?__route=creative; no new function.)
//
// Nothing is ever served until an admin approves it with a reason, and every approve, reject and withdraw is
// written to the audit log. Only approved creatives fill the in-listing card, sponsor lines and side ads
// (public/adslots.js reads /api/creative?live=1; raw ads in sponsors.json are ignored).
//
// Storage (Upstash Redis, like listing photos; no new service): a creative's image is a still JPEG, PNG or WebP of at
// most MAX_IMAGE_BYTES, kept as a data URL beside its record.
//   tsn:cr:<id>        record (pending: 60-day TTL; approved: no TTL; rejected/withdrawn: record kept 1 year, image deleted)
//   tsn:cr:img:<id>    the image (same TTL as the record; deleted on reject or withdraw)
//   tsn:cr:index       sorted set of every creative by time; tsn:cr:pending  the review queue
//   tsn:cr:live        set of approved, placed creative ids
//   tsn:cr:audit       list of review actions (newest first, last 1000; no TTL)
//   tsn:cr:rl:<ip>     uploads per connection per day; tsn:cr:ref:<ref>  creatives per reference (MAX_PER_REF open)
const crypto = require('crypto');
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const { same } = require('./_safe.js');
const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';
// Upload tokens are HMACs keyed by CREATIVE_TOKEN_SECRET, else derived from the admin key (so rotating it voids them).
const TOKEN_KEY = process.env.CREATIVE_TOKEN_SECRET || (ADMIN ? crypto.createHmac('sha256', ADMIN).update('tsn-creative-token').digest('hex') : '');

const MAX_IMAGE_BYTES = 300 * 1024, MIN_W = 300, MIN_H = 150, MAX_SIDE = 4000;
const HEADLINE = [3, 60], TEXT = [0, 140], REASON = [3, 300];
const CTAS = ['Visit website', 'Call now', 'Get directions', 'Shop now', 'Learn more'];
const CTA_DEST = { 'Visit website': 'url', 'Shop now': 'url', 'Learn more': 'url', 'Call now': 'tel', 'Get directions': 'map' };
const BOARDS = ['jobs', 'deals', 'events', 'classifieds'];
const PLACEMENTS = BOARDS.map(b => 'card:' + b).concat(BOARDS.map(b => 'line:' + b), ['rail:left', 'rail:right']);
const DAILY_PER_IP = 10, MAX_PER_REF = 5, PENDING_TTL = 60 * 86400, CLOSED_TTL = 365 * 86400, TOKEN_DAYS = 14, AUDIT_KEEP = 1000;
const ID_RE = /^cr[a-z0-9]{10}$/;
const AD_REF_RE = /^AD-[A-Z0-9]{6,10}$/, ORDER_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Link shorteners and redirectors: a destination there could send readers anywhere, so it's refused.
const REDIRECT_HOSTS = ['bit.ly', 'bitly.com', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'buff.ly', 'is.gd', 'v.gd', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc', 'rb.gy',
  'lnkd.in', 'trib.al', 'dlvr.it', 'fb.me', 'l.facebook.com', 'lm.facebook.com', 'l.instagram.com', 'out.reddit.com', 'href.li', 'linktr.ee', 'shorte.st', 'adf.ly', 'bl.ink', 'short.io', 'maps.app.goo.gl', 'g.co', 'youtu.be'];
const REDIRECT_PATHS = [/^\/url\b/i, /^\/redirect\b/i, /^\/out\b/i, /^\/away\b/i, /^\/link\b/i, /^\/r\//i, /^\/go\//i, /^\/exit\b/i];
const REDIRECT_PARAMS = /^(url|u|q|redirect|redirect_uri|redirect_url|redir|return|returnto|return_to|next|goto|dest|destination|target|to|link|continue|out|forward|r)$/i;
// Map and directions links: https on these hosts and paths only.
const MAP_HOSTS = { 'www.google.com': /^\/maps(\/|$)/, 'google.com': /^\/maps(\/|$)/, 'maps.google.com': /^\//, 'maps.apple.com': /^\//, 'www.bing.com': /^\/maps(\/|$)/, 'bing.com': /^\/maps(\/|$)/, 'www.openstreetmap.org': /^\//, 'openstreetmap.org': /^\// };

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n + 1);
const LINK_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|us|info|biz|ly|me)\b/i;

// The destination for a CTA type -> { dest, destType } or { error }.
function destination(raw, cta) {
  const want = CTA_DEST[cta];
  const v = String(raw == null ? '' : raw).trim();
  if (!v || v.length > 400) return { error: 'Add a destination.' };
  if (want === 'tel') {
    const digits = v.replace(/^tel:/i, '').replace(/[\s().-]/g, '');
    const m = /^(\+?1)?(\d{10})$/.exec(digits);
    if (!m || /^[01]/.test(m[2])) return { error: 'Enter a U.S. phone number, like 812-555-0142.' };
    return { dest: 'tel:+1' + m[2], destType: 'tel' };
  }
  let u;
  try { u = new URL(v); } catch (_) { return { error: 'Enter a full web address starting with https://.' }; }
  if (u.protocol !== 'https:') return { error: 'Links must start with https://.' };
  if (u.username || u.password || u.port) return { error: 'That web address isn’t allowed.' };
  const host = u.hostname.toLowerCase();
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) || /^xn--/.test(host.split('.').pop())) return { error: 'That web address isn’t allowed.' };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return { error: 'That web address isn’t allowed.' };
  if (REDIRECT_HOSTS.some(h => host === h || host.endsWith('.' + h))) return { error: 'Use the final web address, not a link shortener or redirect.' };
  if (REDIRECT_PATHS.some(re => re.test(u.pathname))) return { error: 'Use the final web address, not a redirect link.' };
  for (const [k, val] of u.searchParams) if (REDIRECT_PARAMS.test(k) && /^(https?:|\/\/|%2f%2f|www\.)/i.test(val)) return { error: 'Use the final web address, not a redirect link.' };
  let decoded = u.pathname + u.search;
  try { for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(decoded); i++) decoded = decodeURIComponent(decoded); } catch (_) { return { error: 'That web address isn’t allowed.' }; }
  // Another web address inside this one is a redirect. (Map links may use // for an empty start point: /maps/dir//Place.)
  if ((want === 'map' ? /https?:|%2f%2f/i : /https?:|\/\/|%2f%2f/i).test(decoded)) return { error: 'Use the final web address, not a redirect link.' };
  if (want === 'map') {
    const path = MAP_HOSTS[host];
    if (!path || !path.test(u.pathname)) return { error: 'For directions, use a Google Maps, Apple Maps, Bing Maps or OpenStreetMap link.' };
    return { dest: u.href, destType: 'map' };
  }
  return { dest: u.href, destType: 'url' };
}

// A still image as a data URL -> { type, bytes, w, h } or { error }. JPEG, PNG or WebP; no animation.
function image(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''));
  if (!m) return { error: 'Upload a JPEG, PNG or WebP image.' };
  if (m[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return { error: 'The image must be ' + (MAX_IMAGE_BYTES / 1024) + ' KB or smaller.' };
  const b = Buffer.from(m[2], 'base64');
  if (b.length > MAX_IMAGE_BYTES) return { error: 'The image must be ' + (MAX_IMAGE_BYTES / 1024) + ' KB or smaller.' };
  if (b.length < 100) return { error: 'That image is empty or damaged.' };
  let dim = null;
  if (m[1] === 'png') {
    if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a || b.toString('ascii', 12, 16) !== 'IHDR') return { error: 'That isn’t a PNG image.' };
    dim = { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    for (let i = 8; i + 8 <= b.length;) { const len = b.readUInt32BE(i), t = b.toString('ascii', i + 4, i + 8); if (t === 'acTL') return { error: 'Animated images aren’t allowed.' }; if (t === 'IDAT' || t === 'IEND') break; i += 12 + len; }
  } else if (m[1] === 'jpeg') {
    if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return { error: 'That isn’t a JPEG image.' };
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1];
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0xff) { i += mk === 0xff ? 1 : 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if ((mk >= 0xc0 && mk <= 0xcf) && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) { dim = { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; break; }
      if (mk === 0xda) break;
      i += 2 + len;
    }
  } else {
    if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return { error: 'That isn’t a WebP image.' };
    const c = b.toString('ascii', 12, 16);
    if (c === 'VP8X') { if (b[20] & 0x02) return { error: 'Animated images aren’t allowed.' }; dim = { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }; }
    else if (c === 'VP8 ') dim = { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    else if (c === 'VP8L') { const v = b.readUInt32LE(21); dim = { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
    if (b.includes(Buffer.from('ANIM'))) return { error: 'Animated images aren’t allowed.' };
  }
  if (!dim || !dim.w || !dim.h) return { error: 'That image is empty or damaged.' };
  if (dim.w < MIN_W || dim.h < MIN_H) return { error: 'The image must be at least ' + MIN_W + '×' + MIN_H + ' pixels.' };
  if (dim.w > MAX_SIDE || dim.h > MAX_SIDE) return { error: 'The image can be at most ' + MAX_SIDE + ' pixels on a side.' };
  return { type: m[1], bytes: b.length, w: dim.w, h: dim.h };
}

// The advertiser's text, CTA, destination and image -> the fields to store, or { error, field }.
function validate(b) {
  const headline = clean(b.headline, HEADLINE[1]), text = clean(b.text, TEXT[1]);
  if (headline.length < HEADLINE[0]) return { error: 'Add a headline.', field: 'headline' };
  if (headline.length > HEADLINE[1]) return { error: 'Keep the headline to ' + HEADLINE[1] + ' characters.', field: 'headline' };
  if (text.length > TEXT[1]) return { error: 'Keep the text to ' + TEXT[1] + ' characters.', field: 'text' };
  if (LINK_RE.test(headline) || LINK_RE.test(text)) return { error: 'Put the web address in the destination, not the text.', field: LINK_RE.test(headline) ? 'headline' : 'text' };
  if (!CTAS.includes(b.cta)) return { error: 'Pick a button.', field: 'cta' };
  const d = destination(b.dest, b.cta);
  if (d.error) return { error: d.error, field: 'dest' };
  const im = image(b.image);
  if (im.error) return { error: im.error, field: 'image' };
  return { headline, text, cta: b.cta, dest: d.dest, destType: d.destType, image: { type: im.type, bytes: im.bytes, w: im.w, h: im.h } };
}

// Signed upload tokens: <ref>.<expiry base36>.<hmac>.
function tokenFor(ref, now) {
  if (!TOKEN_KEY) return '';
  const exp = Math.floor((now || Date.now()) / 1000 + TOKEN_DAYS * 86400).toString(36);
  return ref + '.' + exp + '.' + crypto.createHmac('sha256', TOKEN_KEY).update(ref + '.' + exp).digest('hex').slice(0, 32);
}
function tokenRef(token, now) {
  const m = /^([A-Za-z0-9_-]{4,220})\.([a-z0-9]{1,10})\.([a-f0-9]{32})$/.exec(String(token || ''));
  if (!m || !TOKEN_KEY) return '';
  if (parseInt(m[2], 36) * 1000 < (now || Date.now())) return '';
  const want = crypto.createHmac('sha256', TOKEN_KEY).update(m[1] + '.' + m[2]).digest('hex').slice(0, 32);
  return same(m[3], want) ? m[1] : '';
}

async function pipeline(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('store ' + r.status);
  const out = await r.json();
  if (Array.isArray(out) && out.some(x => x && x.error)) throw new Error('store command');
  return out;
}
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (_) { return null; } };
const K = { rec: id => 'tsn:cr:' + id, img: id => 'tsn:cr:img:' + id, index: 'tsn:cr:index', pending: 'tsn:cr:pending', live: 'tsn:cr:live', audit: 'tsn:cr:audit', rl: ip => 'tsn:cr:rl:' + ip, ref: r => 'tsn:cr:ref:' + r };

// Who may upload: -> { ref, refType } or null.
async function access(b, now) {
  const viaToken = b.token ? tokenRef(b.token, now) : '';
  if (b.token) return viaToken ? { ref: viaToken, refType: 'token' } : null;
  const ref = String(b.ref || '').trim();
  if (ORDER_RE.test(ref)) {
    const g = await pipeline([['GET', 'tsn:order:' + ref]]);
    const o = parse(g[0] && g[0].result);
    return o && Number(o.paidCents) > 0 && !['refunded', 'disputed', 'payment_failed'].includes(o.status) ? { ref, refType: 'order' } : null;
  }
  if (AD_REF_RE.test(ref.toUpperCase()) && EMAIL_RE.test(String(b.email || '').trim())) {
    const g = await pipeline([['LRANGE', 'tsn:ads', '0', '299']]);
    const email = String(b.email).trim().toLowerCase(), want = ref.toUpperCase();
    const hit = ((g[0] && g[0].result) || []).map(parse).some(x => x && x.ref === want && String(x.email || '').toLowerCase() === email);
    return hit ? { ref: want, refType: 'inquiry' } : null;
  }
  return null;
}

// The public shape of an approved creative.
const pub = c => ({ id: c.id, name: c.headline, text: c.text, cta: c.cta, url: c.dest, destType: c.destType, img: '/api/creative?img=' + c.id, w: c.image.w, h: c.image.h });
function livePlan(list) {
  const out = { cards: {}, slots: {}, rails: { left: [], right: [] } };
  BOARDS.forEach(b => { out.cards[b] = []; out.slots[b] = []; });
  list.filter(c => c && c.status === 'approved').sort((a, b) => (a.approvedAt < b.approvedAt ? -1 : 1)).forEach(c => (c.placements || []).forEach(p => {
    const [kind, where] = p.split(':');
    if (kind === 'card' && out.cards[where]) out.cards[where].push(pub(c));
    else if (kind === 'line' && out.slots[where]) out.slots[where].push(pub(c));
    else if (kind === 'rail' && out.rails[where]) out.rails[where].push(pub(c));
  }));
  return out;
}

async function handler(req, res) {
  const send = (c, o, cache) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', cache || 'no-store'); return res.status(c).send(JSON.stringify(o)); };
  if (!URL_ || !TOKEN) return send(req.method === 'GET' && req.query && req.query.live ? 200 : 503, req.method === 'GET' && req.query && req.query.live ? { configured: false, cards: {}, slots: {}, rails: { left: [], right: [] } } : { error: 'Creative uploads aren’t open yet.' });
  const admin = !!ADMIN && same(req.headers['x-admin-key'], ADMIN);
  const now = Date.now();
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      if (q.live) {
        const ids = (await pipeline([['SMEMBERS', K.live]]))[0].result || [];
        const recs = ids.length ? (await pipeline([['MGET', ...ids.map(K.rec)]]))[0].result || [] : [];
        return send(200, Object.assign({ configured: true }, livePlan(recs.map(parse))), 'public, max-age=60, s-maxage=60');
      }
      if (q.img) {
        const id = String(q.img);
        if (!ID_RE.test(id)) return send(404, { error: 'not found' });
        const g = await pipeline([['GET', K.rec(id)], ['GET', K.img(id)]]);
        const c = parse(g[0] && g[0].result), data = g[1] && g[1].result;
        if (!c || !data || (c.status !== 'approved' && !admin)) return send(404, { error: 'not found' });
        const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data);
        if (!m) return send(404, { error: 'not found' });
        res.setHeader('Content-Type', m[1]);
        res.setHeader('Cache-Control', c.status === 'approved' ? 'public, max-age=300, s-maxage=3600' : 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        return res.status(200).send(Buffer.from(m[2], 'base64'));
      }
      if (!admin) return send(404, { error: 'not found' });
      const g = await pipeline([['ZREVRANGE', K.index, '0', '99'], ['ZRANGE', K.pending, '0', '99'], ['LRANGE', K.audit, '0', '99']]);
      const ids = [...new Set(((g[0] && g[0].result) || []).concat((g[1] && g[1].result) || []))];
      const recs = ids.length ? ((await pipeline([['MGET', ...ids.map(K.rec)]]))[0].result || []).map(parse) : [];
      const byId = new Map(recs.filter(Boolean).map(c => [c.id, c]));
      return send(200, { items: ((g[0] && g[0].result) || []).map(i => byId.get(i)).filter(Boolean), pending: ((g[1] && g[1].result) || []).map(i => byId.get(i)).filter(Boolean), audit: ((g[2] && g[2].result) || []).map(parse).filter(Boolean), placements: PLACEMENTS, ctas: CTAS });
    }
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } } b = b && typeof b === 'object' ? b : {};

    if (b.action) { // admin review
      if (!admin) return send(404, { error: 'not found' });
      if (b.action === 'token') {
        const ref = String(b.ref || '').trim();
        if (!/^[A-Za-z0-9_-]{4,80}$/.test(ref)) return send(400, { error: 'bad reference' });
        return send(200, { token: tokenFor(ref, now), days: TOKEN_DAYS });
      }
      if (!['approve', 'reject', 'withdraw'].includes(b.action) || !ID_RE.test(String(b.id))) return send(400, { error: 'bad request' });
      const reason = clean(b.reason, REASON[1]);
      if (reason.length < REASON[0] || reason.length > REASON[1]) return send(400, { error: 'Give a reason (3 to 300 characters).', field: 'reason' });
      const g = await pipeline([['GET', K.rec(b.id)]]);
      const c = parse(g[0] && g[0].result);
      if (!c) return send(404, { error: 'not found' });
      const from = c.status;
      const allowed = { approve: ['pending'], reject: ['pending'], withdraw: ['approved'] }[b.action];
      if (!allowed.includes(from)) return send(409, { error: 'This creative is ' + from + '.' });
      let placements = [];
      if (b.action === 'approve') {
        placements = [...new Set(Array.isArray(b.placements) ? b.placements.map(String) : [])];
        if (!placements.length || placements.some(p => !PLACEMENTS.includes(p))) return send(400, { error: 'Pick where it runs.', field: 'placements' });
      }
      const to = { approve: 'approved', reject: 'rejected', withdraw: 'withdrawn' }[b.action];
      const at = new Date(now).toISOString();
      const entry = { at, id: c.id, ref: c.ref, action: b.action, from, to, reason, placements };
      const rec = Object.assign({}, c, { status: to, reviewedAt: at, reason, history: (c.history || []).concat([{ at, action: b.action, reason }]) });
      if (to === 'approved') Object.assign(rec, { approvedAt: at, placements });
      else rec.placements = [];
      const cmds = [['LPUSH', K.audit, JSON.stringify(entry)], ['LTRIM', K.audit, '0', String(AUDIT_KEEP - 1)]]; // the audit entry is written first
      if (to === 'approved') cmds.push(['SET', K.rec(c.id), JSON.stringify(rec)], ['PERSIST', K.img(c.id)], ['SADD', K.live, c.id], ['ZREM', K.pending, c.id]);
      else cmds.push(['SET', K.rec(c.id), JSON.stringify(rec), 'EX', String(CLOSED_TTL)], ['DEL', K.img(c.id)], ['SREM', K.live, c.id], ['ZREM', K.pending, c.id], ['SREM', K.ref(c.ref), c.id]);
      await pipeline(cmds);
      return send(200, { ok: true, id: c.id, status: to });
    }

    // an advertiser's upload
    const who = await access(b, now);
    if (!who) return send(403, { error: 'Check your reference and the email you used on your inquiry, or the upload link we sent you.' });
    const v = validate(b);
    if (v.error) return send(400, v);
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || 'x';
    const rl = await pipeline([['INCR', K.rl(ip)], ['EXPIRE', K.rl(ip), '86400', 'NX'], ['SCARD', K.ref(who.ref)]]);
    if (Number(rl[0] && rl[0].result) > DAILY_PER_IP) return send(429, { error: 'Too many uploads today. Try again tomorrow.' });
    if (Number(rl[2] && rl[2].result) >= MAX_PER_REF) return send(429, { error: 'This reference already has ' + MAX_PER_REF + ' creatives waiting or running. Ask us to retire one first.' });
    const id = 'cr' + crypto.randomBytes(8).toString('hex').slice(0, 10);
    const rec = Object.assign({ id, ref: who.ref, refType: who.refType, status: 'pending', at: new Date(now).toISOString(), placements: [], history: [] }, v);
    await pipeline([
      ['SET', K.img(id), String(b.image), 'EX', String(PENDING_TTL)],
      ['SET', K.rec(id), JSON.stringify(rec), 'EX', String(PENDING_TTL)],
      ['ZADD', K.index, String(now), id], ['ZADD', K.pending, String(now), id],
      ['SADD', K.ref(who.ref), id], ['EXPIRE', K.ref(who.ref), String(CLOSED_TTL)]
    ]);
    return send(200, { ok: true, id, status: 'pending' });
  } catch (e) {
    return send(502, { error: 'Couldn’t save that. Try again.' });
  }
}

module.exports = handler;
Object.assign(module.exports, { validate, destination, image, tokenFor, tokenRef, livePlan, CTAS, PLACEMENTS, MAX_IMAGE_BYTES });
