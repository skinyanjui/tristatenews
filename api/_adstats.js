// Ad counts (ads plan Phase 5.3): first-party, cookie-free daily totals of views and clicks for each campaign and
// placement, so any figure quoted to an advertiser is measured, not invented. vercel.json rewrites /api/adstats to
// /api/inbox?__route=adstats (no new function).
//   POST /api/adstats  {e:'v'|'c', cid, pl}  public, sent by navigator.sendBeacon from public/index.html: 'v' once per
//                                           page load when at least half of a campaign ad is on screen, 'c' on a click.
//                                           Always answers 204 and says nothing about whether it counted.
//   GET  /api/adstats?cid=<id>[&format=csv]  with x-admin-key  that campaign's counts by day and placement
// Counted only when ADS_CAMPAIGNS is on, the campaign exists, runs today (Chicago date) and was booked on that
// placement; obvious bots (by user agent) are skipped. Nothing about the reader is stored: no cookie, no ID, no page,
// no referrer. To keep one connection from inflating the totals, a keyed one-way hash (HMAC with a server secret) of the date and network address counts
// events for a day (the key expires after 24 hours); past the daily limit, events are ignored.
//
// Storage (Upstash Redis): tsn:adstat:<campaign id> hash of "<YYYY-MM-DD>|<placement>|v" and "...|c" counters (no TTL:
// the advertiser's report, kept like the campaign record); tsn:as:rl:<hash> the per-connection daily counter.
const crypto = require('crypto');
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const { same } = require('./_safe.js');
const camp = require('./_campaigns.js');
const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';

const EVENTS = { v: 'views', c: 'clicks' };
const DAILY_PER_CONN = 600, BODY_MAX = 300;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|fetch|curl|wget|python|scrapy|httpclient|monitor|pingdom|uptime/i;
const K = { stat: id => 'tsn:adstat:' + id, rl: h => 'tsn:as:rl:' + h };

const isBot = ua => !ua || BOT_RE.test(String(ua));
// Keyed hash (HMAC), so the code can't be reversed by trying every address: ADSTATS_SECRET, else a key derived from
// LISTINGS_ADMIN_KEY or CRON_SECRET, else a random key for this instance (the cap then applies per instance).
const HASH_KEY = process.env.ADSTATS_SECRET
  || ((process.env.LISTINGS_ADMIN_KEY || process.env.CRON_SECRET) ? crypto.createHmac('sha256', process.env.LISTINGS_ADMIN_KEY || process.env.CRON_SECRET).update('tsn-adstats-conn').digest('hex') : crypto.randomBytes(32).toString('hex'));
const connHash = (ip, day) => crypto.createHmac('sha256', HASH_KEY).update('tsn-adstats|' + day + '|' + ip).digest('hex').slice(0, 24);
const field = (day, pl, e) => day + '|' + pl + '|' + e;

// {e, cid, pl} from a beacon body (a JSON string, sent as text/plain), or null.
function parseEvent(body) {
  let b = body;
  if (typeof b === 'string') { if (b.length > BODY_MAX) return null; try { b = JSON.parse(b); } catch (_) { return null; } }
  if (!b || typeof b !== 'object') return null;
  const e = String(b.e || ''), cid = String(b.cid || ''), pl = String(b.pl || '');
  if (!EVENTS[e] || !camp.ID_RE.test(cid) || !camp.PLACEMENTS.includes(pl)) return null;
  return { e, cid, pl };
}
// Whether this campaign counts an event on this placement today.
function countable(rec, pl, now) { return !!rec && camp.runningOn(rec, camp.today(now)) && (rec.placements || []).includes(pl); }

// Hash fields -> rows by day and placement (oldest first), totals and totals per placement. Counts only, no ratios.
function report(hash) {
  const by = new Map(), tot = { views: 0, clicks: 0 }, per = {};
  Object.entries(hash || {}).forEach(([f, v]) => {
    const [day, pl, e] = f.split('|'), n = Number(v) || 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !camp.PLACEMENTS.includes(pl) || !EVENTS[e] || n <= 0) return;
    const k = day + '|' + pl, row = by.get(k) || { date: day, placement: pl, views: 0, clicks: 0 };
    row[EVENTS[e]] += n; by.set(k, row);
    tot[EVENTS[e]] += n; per[pl] = per[pl] || { views: 0, clicks: 0 }; per[pl][EVENTS[e]] += n;
  });
  const rows = [...by.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.placement < b.placement ? -1 : 1));
  return { rows, totals: tot, byPlacement: per };
}
function csv(rec, r) {
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  return ['campaign,advertiser,date,placement,views,clicks'].concat(r.rows.map(x => [rec.id, q(rec.advertiser || ''), x.date, x.placement, x.views, x.clicks].join(','))).join('\r\n') + '\r\n';
}
// Upstash HGETALL answers a flat [field, value, ...] list.
const pairs = a => { const o = {}; if (Array.isArray(a)) for (let i = 0; i + 1 < a.length; i += 2) o[a[i]] = a[i + 1]; else if (a && typeof a === 'object') Object.assign(o, a); return o; };
const parse = s => { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } };

async function pipeline(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('store ' + r.status);
  const out = await r.json();
  if (Array.isArray(out) && out.some(x => x && x.error)) throw new Error('store command');
  return out;
}

async function handler(req, res) {
  const json = (c, o) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); return res.status(c).send(JSON.stringify(o)); };
  const none = () => { res.setHeader('Cache-Control', 'no-store'); return res.status(204).end(); };
  const now = Date.now();
  if (req.method === 'POST') {
    if (!URL_ || !TOKEN || !camp.enabled() || isBot(req.headers['user-agent'])) return none();
    const ev = parseEvent(req.body);
    if (!ev) return none();
    try {
      const day = camp.today(now);
      const ip = require('./_ip.js').clientIp(req) || 'x';
      const h = connHash(ip, day);
      const g = await pipeline([['INCR', K.rl(h)], ['EXPIRE', K.rl(h), '86400', 'NX'], ['GET', camp.K.rec(ev.cid)]]);
      if ((Number(g[0] && g[0].result) || 0) > DAILY_PER_CONN) return none();
      if (!countable(parse(g[2] && g[2].result), ev.pl, now)) return none();
      await pipeline([['HINCRBY', K.stat(ev.cid), field(day, ev.pl, ev.e), '1']]);
    } catch (_) { /* a lost count is better than an error on the reader's page */ }
    return none();
  }
  if (req.method !== 'GET' || !URL_ || !TOKEN || !ADMIN || !same(req.headers['x-admin-key'], ADMIN)) return json(404, { error: 'not found' });
  const cid = String((req.query && req.query.cid) || '');
  if (!camp.ID_RE.test(cid)) return json(400, { error: 'Pick a campaign.' });
  try {
    const g = await pipeline([['GET', camp.K.rec(cid)], ['HGETALL', K.stat(cid)]]);
    const rec = parse(g[0] && g[0].result);
    if (!rec) return json(404, { error: 'not found' });
    const r = report(pairs(g[1] && g[1].result));
    if (String(req.query.format || '') === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', 'attachment; filename="' + cid + '-counts.csv"');
      return res.status(200).send(csv(rec, r));
    }
    return json(200, Object.assign({ cid, advertiser: rec.advertiser, start: rec.start, end: rec.end, placements: rec.placements, today: camp.today(now) }, r));
  } catch (_) {
    return json(502, { error: 'Couldn’t reach the store. Try again.' });
  }
}

module.exports = handler;
Object.assign(module.exports, { EVENTS, DAILY_PER_CONN, K, isBot, connHash, field, parseEvent, countable, report, csv, pairs });
