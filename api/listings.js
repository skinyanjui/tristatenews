// Community board: classifieds (kind 'item'), local deals/coupons (kind 'deal') and events (kind 'event').
// Items and deals expire after 30 days (deals also on their end date); events drop off after their date.
// Stored in Upstash Redis (same variables as api/react.js). Without it the page shows only links.
//   GET    /api/listings?img=<id>             -> the listing's photo (JPEG)
//   GET    /api/listings?kind=item|deal|event        -> { configured, items: [...] }   newest first
//   POST   /api/listings  {title,price,town,desc,contact,uid}  -> { ok, item }
//   POST   /api/listings  {action:'report', id, uid}           -> hides a listing after 3 reports
//   DELETE /api/listings?id=...&uid=...                        -> the poster removes their own listing
// Set LISTINGS_ADMIN_KEY to remove any listing: DELETE with header x-admin-key.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';
const DAYS = 30, MAX_SHOWN = 60, DAILY_PER_UID = 3, DAILY_PER_IP = 8, REPORTS_TO_HIDE = 3;
const ID_RE = /^[a-z0-9]{6,20}$/;
const UID_RE = /^[a-zA-Z0-9_-]{8,48}$/;
const indexFor = kind => kind === 'deal' ? 'tsn:dl:index' : kind === 'event' ? 'tsn:ev:index' : 'tsn:ls:index';
const kindOf = v => v === 'deal' ? 'deal' : v === 'event' ? 'event' : 'item';
const todayChi = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const rec = id => 'tsn:ls:' + id;
const imgKey = id => 'tsn:ls:img:' + id;
const JPEG_RE = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/;
const MAX_PHOTO = 190000, MAX_LOGO = 14000; // base64 characters
// A photo or logo must be a JPEG data URL (the page re-encodes uploads through a canvas) of limited size.
function goodImage(v, max) {
  if (typeof v !== 'string' || v.length > max) return '';
  const m = JPEG_RE.exec(v);
  if (!m || m[1].length < 100) return '';
  const head = Buffer.from(m[1].slice(0, 8), 'base64');
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff ? v : '';
}

async function pipeline(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error('store ' + r.status);
  return r.json();
}

const CATS = { item: ['Furniture', 'Electronics', 'Vehicles', 'Tools', 'Home & garden', 'Clothing', 'Sports & outdoors', 'Toys & kids', 'Other'], deal: ['Food & drink', 'Shopping', 'Services', 'Entertainment', 'Auto', 'Other'], event: ['Music', 'Food & drink', 'Family', 'Sports', 'Arts', 'Community', 'Other'] };
const CONDS = ['New', 'Like new', 'Good', 'Fair'];
const PHONE_RE = /^\+?1?[\s.-]*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const hasLink = t => /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|info|biz|xyz|ru|top|shop|site)\b)/i.test(t);

function validate(b, kind) {
  const title = clean(b.title, 80), price = clean(b.price, 12), town = clean(b.town, 40), desc = clean(b.desc, 300), contact = clean(b.contact, 80);
  const category = CATS[kind].includes(b.category) ? b.category : 'Other';
  if (title.length < 3) return { error: kind === 'deal' ? 'Describe the offer.' : kind === 'event' ? 'Add an event name.' : 'Add a title (at least 3 characters).', field: 'title' };
  if (!town) return { error: 'Choose a town.', field: 'town' };
  if (hasLink(title + ' ' + desc) || /https?:\/\/|www\./i.test(contact)) return { error: 'Links aren’t allowed.', field: 'title' };
  if (kind === 'event') {
    const date = clean(b.date, 10), time = clean(b.time, 5), place = clean(b.place, 60);
    const t = Date.parse(date + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(t) || date < todayChi() || t > Date.now() + 365 * 864e5) return { error: 'Pick a date from today to a year out.', field: 'date' };
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'Enter a time like 6:30 PM.', field: 'time' };
    if (contact && contact.length < 5) return { error: 'Add a phone number or email, or leave it blank.', field: 'contact' };
    return { title, town, desc, contact, category, date, time, place };
  }
  if (kind === 'deal') {
    const business = clean(b.business, 50);
    if (business.length < 2) return { error: 'Add the business name.', field: 'business' };
    const code = clean(b.code, 20).toUpperCase(), ends = clean(b.ends, 10);
    if (code && !/^[A-Z0-9-]{2,20}$/.test(code)) return { error: 'Coupon codes use letters, numbers and dashes.', field: 'code' };
    if (ends) {
      const t = Date.parse(ends + 'T12:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ends) || !Number.isFinite(t) || ends < todayChi() || t > Date.now() + 120 * 864e5) return { error: 'Pick an end date from today to 4 months out.', field: 'ends' };
    }
    if (contact.length < 5) return { error: 'Add the address or phone number.', field: 'contact' };
    return { title, business, town, desc, contact, code, ends, category };
  }
  if (!PHONE_RE.test(contact) && !EMAIL_RE.test(contact)) return { error: 'Enter a phone number like 812-555-0142 or an email address.', field: 'contact' };
  if (price && !/^(free|\$?\s?\d[\d,]*(\.\d{2})?(\s?(obo|firm))?)$/i.test(price)) return { error: 'Price should look like $50, $1,200 or Free.', field: 'price' };
  const condition = CONDS.includes(b.condition) ? b.condition : '';
  return { title, price, town, desc, contact, category, condition };
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const send = (code, obj) => res.status(code).send(JSON.stringify(obj));
  if (!URL_ || !TOKEN) return send(200, { configured: false, items: [] });
  try {
    let body = {};
    if (req.method === 'POST') {
      try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (_) { return send(400, { error: 'bad request' }); }
    }
    const now = Date.now();
    const kind = kindOf(req.method === 'GET' || req.method === 'DELETE' ? (req.query && req.query.kind) : body.kind);
    const INDEX = indexFor(kind);

    if (req.method === 'GET' && req.query && req.query.img) {
      const id = String(req.query.img);
      if (!ID_RE.test(id)) return send(400, { error: 'bad request' });
      const g = await pipeline([['GET', imgKey(id)]]);
      const m = g[0] && g[0].result ? JPEG_RE.exec(g[0].result) : null;
      if (!m) { res.setHeader('Cache-Control', 'no-store'); return res.status(404).end(); }
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      return res.status(200).send(Buffer.from(m[1], 'base64'));
    }

    if (req.method === 'GET') {
      const cutoff = kind === 'event' ? now - 2 * 864e5 : now - DAYS * 864e5;
      const idx = await pipeline([['ZREMRANGEBYSCORE', INDEX, '-inf', String(cutoff)], [kind === 'event' ? 'ZRANGE' : 'ZREVRANGE', INDEX, '0', String(MAX_SHOWN - 1)]]);
      const ids = (idx[1] && idx[1].result || []).filter(x => ID_RE.test(x));
      if (!ids.length) return send(200, { configured: true, items: [] });
      const got = await pipeline(ids.map(id => ['GET', rec(id)]));
      const items = [];
      got.forEach((g, i) => {
        if (!g || !g.result) return;
        try { const o = JSON.parse(g.result); items.push({ id: ids[i], title: o.title, price: o.price, town: o.town, desc: o.desc, contact: o.contact, at: o.at, code: o.code, ends: o.ends, category: o.category, condition: o.condition, business: o.business, date: o.date, time: o.time, place: o.place, img: !!o.img, logo: o.logo || '' }); } catch (_) {}
      });
      const today = todayChi();
      return send(200, { configured: true, items: items.filter(x => (!x.ends || x.ends >= today) && (!x.date || x.date >= today)) });
    }

    if (req.method === 'POST' && body.action === 'report') {
      if (!ID_RE.test(String(body.id)) || !UID_RE.test(String(body.uid))) return send(400, { error: 'bad request' });
      const rip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || body.uid;
      const out = await pipeline([['SADD', 'tsn:ls:rep:' + body.id, rip], ['EXPIRE', 'tsn:ls:rep:' + body.id, String(DAYS * 86400)], ['SCARD', 'tsn:ls:rep:' + body.id]]);
      if ((Number(out[2] && out[2].result) || 0) >= REPORTS_TO_HIDE) await pipeline([['DEL', rec(body.id)], ['DEL', imgKey(body.id)], ['ZREM', 'tsn:ls:index', body.id], ['ZREM', 'tsn:dl:index', body.id], ['ZREM', 'tsn:ev:index', body.id]]);
      return send(200, { ok: true });
    }

    if (req.method === 'POST') {
      if (!UID_RE.test(String(body.uid))) return send(400, { error: 'bad request' });
      const v = validate(body, kind);
      if (v.error) return send(400, { error: v.error, field: v.field });
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || 'x';
      const rl = await pipeline([['INCR', 'tsn:ls:rl:' + kind + body.uid], ['EXPIRE', 'tsn:ls:rl:' + kind + body.uid, '86400', 'NX'], ['INCR', 'tsn:ls:rlip:' + ip], ['EXPIRE', 'tsn:ls:rlip:' + ip, '86400', 'NX']]);
      if ((Number(rl[0] && rl[0].result) || 0) > DAILY_PER_UID || (Number(rl[2] && rl[2].result) || 0) > DAILY_PER_IP) return send(429, { error: 'You’ve posted a few items today. Try again tomorrow.' });
      const id = now.toString(36) + Math.random().toString(36).slice(2, 8);
      const photo = goodImage(body.img, MAX_PHOTO), logo = kind === 'deal' ? goodImage(body.logo, MAX_LOGO) : '';
      const item = { ...v, at: new Date(now).toISOString(), uid: body.uid, img: !!photo, logo };
      const score = kind === 'event' ? Date.parse(v.date + 'T12:00:00Z') : now;
      const ttl = kind === 'event' ? Math.min(400 * 86400, Math.max(86400, Math.ceil((score + 2 * 864e5 - now) / 1000))) : v.ends ? Math.min(DAYS * 86400, Math.max(86400, Math.ceil((Date.parse(v.ends + 'T23:59:59Z') + 864e5 - now) / 1000))) : DAYS * 86400;
      const cmds = photo ? [['SET', imgKey(id), photo, 'EX', String(ttl)]] : [];
      await pipeline(cmds.concat([['SET', rec(id), JSON.stringify(item), 'EX', String(ttl)], ['ZADD', INDEX, String(score), id]]));
      return send(200, { ok: true, item: { id, title: v.title, price: v.price, town: v.town, desc: v.desc, contact: v.contact, at: item.at, code: v.code, ends: v.ends, category: v.category, condition: v.condition, business: v.business, date: v.date, time: v.time, place: v.place, img: !!photo, logo } });
    }

    if (req.method === 'DELETE') {
      const id = String((req.query && req.query.id) || ''), uid = String((req.query && req.query.uid) || '');
      if (!ID_RE.test(id)) return send(400, { error: 'bad request' });
      const admin = ADMIN && req.headers['x-admin-key'] === ADMIN;
      if (!admin) {
        if (!UID_RE.test(uid)) return send(400, { error: 'bad request' });
        const g = await pipeline([['GET', rec(id)]]);
        let o = null; try { o = JSON.parse(g[0].result); } catch (_) {}
        if (!o || o.uid !== uid) return send(403, { error: 'not yours' });
      }
      await pipeline([['DEL', rec(id)], ['DEL', imgKey(id)], ['ZREM', 'tsn:ls:index', id], ['ZREM', 'tsn:dl:index', id], ['ZREM', 'tsn:ev:index', id]]);
      return send(200, { ok: true });
    }
    return send(405, { error: 'method' });
  } catch (e) {
    // reading degrades quietly (the page just shows no community posts); a failed write must say so
    return req.method === 'GET' ? send(200, { configured: false, items: [] }) : send(502, { error: 'Couldn’t save that right now. Try again in a moment.' });
  }
}

module.exports = handler;
module.exports.validate = validate;
module.exports.goodImage = goodImage;
