// Official alerts for the single Breaking slot (see public/breaking.js for the tiers and ranking).
//   GET /api/alerts             -> { updatedAt, alerts: [candidate...], sources: [{id, ok, count, ...}] }  (no error text)
//   GET /api/alerts?refresh=1   with  Authorization: Bearer <CRON_SECRET>  forces a refresh (GitHub Action); this answer
//                               keeps each feed's error so the workflow can warn about it.
// Only official, machine-readable feeds that were verified with curl on 2026-10-17 are used. Everything else
// is listed as "no feed found" in the alert-sources registry (scripts/alert-sources.json), not guessed here.
// Cached in Upstash Redis when configured (keys under tsn:alerts:*) and at Vercel's edge for 60 s, so the NWS
// API sees at most about one request a minute no matter how many people have the page open.
const B = require('../public/breaking.js');
const { same } = require('./_safe.js');

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const stored = () => !!(URL_ && TOKEN);
const K = {
  snapshot: 'tsn:alerts:snapshot',      // JSON {updatedAt, alerts, sources}; EX 900
  lock: 'tsn:alerts:lock',              // NX EX 20 while one request refreshes
  active: 'tsn:alerts:active',          // ZSET member=alert key, score=end ms (pruned on every write)
  alert: k => 'tsn:alert:' + k,         // JSON alert; EX = seconds until that alert ends (3 h if no end)
  src: id => 'tsn:alerts:src:' + id,    // per-source state {items, lastTry, lastOk, fails, error}; EX 7 d
  sources: 'tsn:alerts:sources',        // HASH id -> JSON registry entry (scripts/seed-alert-sources.js)
  tiers: 'tsn:alerts:tiers',            // JSON tier config {version, nwsOverrides}; no TTL
};
const FRESH_MS = 60e3;
// NWS asks for a User-Agent that identifies the app and a contact. Set NWS_USER_AGENT in Vercel to add an email.
const UA = process.env.NWS_USER_AGENT || '(tristatenewss.vercel.app, tristatenews-alerts)';

// NWS forecast zones and counties for the metro (looked up with api.weather.gov/points on 2026-10-17; all NWS Paducah).
// Vanderburgh INZ086/INC163, Warrick INZ087/INC173, Posey INZ085/INC129, Gibson INZ081/INC051,
// Henderson KY KYZ018/KYC101, Daviess KY (Owensboro) KYZ019/KYC059. Override with NWS_ZONES (comma list).
const NWS_ZONES = (process.env.NWS_ZONES || 'INZ081,INZ085,INZ086,INZ087,KYZ018,KYZ019,INC051,INC129,INC163,INC173,KYC059,KYC101').replace(/\s+/g, '');
const BBOX = [-88.1, 37.5, -86.9, 38.5]; // lon/lat box around the metro, for road feeds

const FEEDS = [
  { id: 'nws', name: 'National Weather Service', everyMin: 0, type: 'nws', url: 'https://api.weather.gov/alerts/active?status=actual&zone=' + NWS_ZONES },
  // Henderson Water Utility (CivicPlus Alert Center, Boil Water Advisory category)
  { id: 'hwu-bwa', name: 'Henderson Water Utility', everyMin: 5, type: 'rss', tier: 4, label: 'Boil-water advisory', link: 'https://hkywater.org/226/Boil-Water-Advisories', url: 'https://hkywater.org/RSSFeed.aspx?ModID=63&CID=Boil-Water-Advisory-BWA-4' },
  { id: 'hwu-road', name: 'Henderson Water Utility', everyMin: 5, type: 'rss', keyword: true, url: 'https://hkywater.org/RSSFeed.aspx?ModID=63&CID=Road-Closure-5' },
  // Owensboro Municipal Utilities boil-water advisories (WordPress post type feed)
  { id: 'omu-bwa', name: 'Owensboro Municipal Utilities', everyMin: 5, type: 'rss', tier: 4, label: 'Boil-water advisory', link: 'https://omu.org/advisories/', url: 'https://omu.org/advisories/feed/' },
  // Henderson County and City of Henderson alert centers (CivicPlus): keyword-classified
  { id: 'hendco-alerts', name: 'Henderson County, Ky.', everyMin: 5, type: 'rss', keyword: true, url: 'https://www.hendersoncountyky.gov/RSSFeed.aspx?ModID=63&CID=All-0' },
  { id: 'hendcity-alerts', name: 'City of Henderson', everyMin: 5, type: 'rss', keyword: true, url: 'https://www.hendersonky.gov/RSSFeed.aspx?ModID=63&CID=All-0' },
  // Other official sites with news feeds: keyword-classified only
  // daviessky.org sits behind Cloudflare, which answers 403 to Vercel's servers only (same URL, User-Agent and Node fetch
  // answer 200 from other networks), so it is a network block on the county's side, not a dead feed or a UA problem.
  { id: 'daviessco', name: 'Daviess County Fiscal Court', disabled: '2026-10-17: HTTP 403 from Vercel on every run (Cloudflare block of Vercel IPs; 200 elsewhere). Replaced by owensboro-city. Delete this flag to re-enable.', everyMin: 15, type: 'rss', keyword: true, url: 'https://www.daviessky.org/feed/' },
  // City of Owensboro and Owensboro Police news releases (Revize CMS RSS, verified 2026-10-17). The feed has no dates and
  // relative links: undated items are timed from when this feed first saw them, and items already there on the first
  // load are a baseline that never shows (so old releases cannot reach the Breaking slot).
  { id: 'owensboro-city', name: 'City of Owensboro', everyMin: 15, type: 'rss', keyword: true, undated: true, base: 'https://owensboro.org/', url: 'https://owensboro.org/rss.xml' },
  { id: 'warricksheriff', name: 'Warrick County Sheriff', everyMin: 15, type: 'rss', keyword: true, url: 'https://warricksheriff.com/feed/' },
  { id: 'epd', name: 'Evansville Police Department', everyMin: 15, type: 'rss', keyword: true, url: 'https://evansvillepolice.com/feed/' },
  { id: 'gibsonco', name: 'Gibson County, Ind.', disabled: '2026-10-17: stale, newest item is old COVID-testing info. Delete this flag to re-enable.', everyMin: 15, type: 'rss', keyword: true, url: 'https://gibsoncounty-in.gov/feed/' },
  { id: 'poseyco', name: 'Posey County, Ind.', everyMin: 15, type: 'rss', keyword: true, url: 'https://www.poseycountyin.gov/feed/' },
  // Work zone data exchange (WZDx) feeds, keyless. Planned work zones only (no crash/incident data).
  { id: 'indot-wzdx', name: 'INDOT', everyMin: 10, type: 'wzdx', link: 'https://511in.org/', url: 'https://in.carsprogram.org/carsapi_v1/api/wzdx' },
  { id: 'kytc-wzdx', name: 'KYTC', everyMin: 10, type: 'wzdx', link: 'https://goky.ky.gov/', url: 'https://storage.googleapis.com/kytc-its-2020-openrecords/public/feeds/WZDx/kytc_wzdx_v4.1.geojson' },
];

async function redis(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(commands), signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error('store ' + r.status);
  return r.json();
}
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const hash = s => require('crypto').createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

const ent = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function rssItems(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const t = tag => { const x = m[0].match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i')); return x ? x[1] : ''; };
    out.push({ title: ent(t('title')), link: ent(t('link')), guid: ent(t('guid')), published: ent(t('pubDate')) || ent(t('dc:date')), summary: ent(t('description')).slice(0, 300) });
  }
  return out;
}

async function get(url, accept) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: accept || '*/*' }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r;
}

function inBox(geom) {
  const pts = []; const walk = c => { if (typeof c[0] === 'number') pts.push(c); else c.forEach(walk); };
  try { walk(geom.coordinates); } catch (e) { return false; }
  return pts.some(p => p[0] >= BBOX[0] && p[0] <= BBOX[2] && p[1] >= BBOX[1] && p[1] <= BBOX[3]);
}
const MAJOR_ROAD = /^(I[- ]?69|US[- ]?41)\b/i;

// One feed -> candidates (shape documented in public/breaking.js).
async function loadFeed(f, now, prev) {
  if (f.type === 'nws') {
    const g = await (await get(f.url, 'application/geo+json')).json();
    return (g.features || []).map(x => B.fromNws(x.properties)).filter(Boolean);
  }
  if (f.type === 'rss') {
    const items = rssItems(await (await get(f.url, 'application/rss+xml, application/xml, text/xml')).text());
    if (f.base) items.forEach(it => { try { it.link = it.link ? new URL(it.link, f.base).href : ''; } catch (e) { it.link = ''; } });
    // First-seen times for feeds without dates, kept in the feed's state (seen: { itemKey: ms }); 0 = baseline, never shown.
    const seenBefore = prev && prev.seen, seen = {};
    // (Revize gives every item the same <guid>0.00</guid>, so undated feeds are keyed by link.)
    const itemKey = it => f.id + ':' + hash((f.undated ? '' : it.guid) || it.link || it.title);
    if (f.undated) items.forEach(it => { const k = itemKey(it); seen[k] = seenBefore ? (k in seenBefore ? seenBefore[k] : now) : 0; });
    const out = items.map(it => {
      let c = null;
      if (f.tier) { if (!/\b(lifted|rescinded|cancel+ed)\b/i.test(it.title)) c = { tier: f.tier, label: f.label }; }
      else if (f.keyword) c = B.classifyOfficial(it);
      if (!c) return null;
      let start = Date.parse(it.published);
      if (isNaN(start) && f.undated) start = seen[itemKey(it)] || NaN;
      return { key: itemKey(it), kind: 'alert', official: true, tier: c.tier, label: c.label, title: it.title, summary: it.summary,
        source: f.name, sourceId: f.id, link: it.link || f.link || '', start: isNaN(start) ? null : start, end: null, sent: isNaN(start) ? null : start };
    }).filter(Boolean);
    if (f.undated) out.seen = seen;
    return out;
  }
  if (f.type === 'wzdx') {
    const g = await (await get(f.url, 'application/geo+json, application/json')).json();
    const out = [];
    for (const x of g.features || []) {
      const p = x.properties || {}, cd = p.core_details || p;
      const roads = (cd.road_names || []).filter(Boolean), desc = String(cd.description || '');
      if (!roads.some(r => MAJOR_ROAD.test(r)) || !inBox(x.geometry || {})) continue;
      const full = p.vehicle_impact === 'all-lanes-closed' || /^\s*(road |bridge )?closed\b|\bfull closure\b|\broad closed\b|\bbridge closed\b/i.test(desc);
      if (!full) continue;
      const start = Date.parse(p.start_date), end = Date.parse(p.end_date);
      if (isNaN(end) || end <= now) continue;
      const road = roads.find(r => MAJOR_ROAD.test(r));
      const twin = /twin bridges|ohio river/i.test(desc) && /41/.test(road);
      out.push({ key: f.id + ':' + hash(x.id || p.road_event_id || cd.data_source_id + desc + p.start_date), kind: 'alert', official: true, tier: 5,
        label: twin ? 'Twin Bridges closure' : road.replace(/^US[- ]?/i, 'US-').replace(/^I[- ]?/i, 'I-') + ' closure',
        title: road + (cd.direction && cd.direction !== 'unknown' ? ' ' + cd.direction : '') + ': ' + (desc || 'closed').slice(0, 160),
        summary: '', source: f.name, sourceId: f.id, link: f.link, start: isNaN(start) ? null : start, end, sent: isNaN(start) ? null : start });
    }
    return out;
  }
  return [];
}

async function refresh(prev, now, disabled, nwsOverrides) {
  const states = {}, report = [];
  await Promise.all(FEEDS.filter(f => !f.disabled && !disabled.has(f.id)).map(async f => {
    const p = prev[f.id] || null;
    if (p && f.everyMin && p.lastTry && now - Date.parse(p.lastTry) < f.everyMin * 6e4 - 15e3) { states[f.id] = p; report.push({ id: f.id, ok: !p.error, count: (p.items || []).length, error: p.error || null, cached: true }); return; }
    const t0 = Date.now();
    try {
      const items = await loadFeed(f, now, p);
      states[f.id] = { items, lastTry: new Date(now).toISOString(), lastOk: new Date(now).toISOString(), fails: 0, error: null };
      if (items.seen) states[f.id].seen = items.seen;
      report.push({ id: f.id, ok: true, count: items.length, error: null, ms: Date.now() - t0 });
    } catch (e) {
      const err = String(e && e.message || e).slice(0, 120);
      // keep the last good items for a failed feed, but only those still active
      states[f.id] = { items: ((p && p.items) || []).filter(c => B.isActive(c, now)), lastTry: new Date(now).toISOString(), lastOk: p && p.lastOk || null, fails: ((p && p.fails) || 0) + 1, error: err };
      if (p && p.seen) states[f.id].seen = p.seen;
      report.push({ id: f.id, ok: false, count: states[f.id].items.length, error: err, ms: Date.now() - t0 });
    }
  }));
  let alerts = [].concat(...Object.values(states).map(s => s.items || []));
  if (nwsOverrides) alerts = alerts.map(c => c.sourceId === 'nws' && nwsOverrides[c.label] ? Object.assign({}, c, { tier: nwsOverrides[c.label] }) : c);
  alerts = alerts.filter(c => B.isActive(c, now)).sort((a, b) => a.tier - b.tier || (b.start || 0) - (a.start || 0));
  return { states, snapshot: { updatedAt: new Date(now).toISOString(), alerts, sources: report.sort((a, b) => a.id < b.id ? -1 : 1) } };
}

async function build(force) {
  const now = Date.now();
  if (!stored()) return (await refresh({}, now, new Set(), null)).snapshot;
  let snap = null, prev = {}, disabled = new Set(), overrides = null;
  try {
    // Two billed commands: one MGET for the snapshot, the tier config and every feed's state, and the registry HGETALL.
    const keys = [K.snapshot, K.tiers].concat(FEEDS.map(f => K.src(f.id)));
    const out = await redis([['MGET'].concat(keys), ['HGETALL', K.sources]]);
    const v = out && out[0] && out[0].result;
    if (!Array.isArray(v) || v.length !== keys.length) throw new Error('store MGET ' + ((out && out[0] && out[0].error) || 'bad reply'));
    snap = parse(v[0]);
    const h = (out[1] && out[1].result) || [];
    for (let i = 0; i < h.length; i += 2) { const x = parse(h[i + 1]); if (x && x.enabled === false && x.feedId) disabled.add(x.feedId); }
    const tc = parse(v[1]); overrides = tc && tc.nwsOverrides || null;
    FEEDS.forEach((f, i) => { prev[f.id] = parse(v[2 + i]); });
  } catch (e) { return (await refresh({}, now, new Set(), null)).snapshot; } // store down: fetch live, don't fail the page
  if (!force && snap && now - Date.parse(snap.updatedAt) < FRESH_MS) return snap;
  try { const l = await redis([['SET', K.lock, '1', 'NX', 'EX', '20']]); if (!(l[0] && l[0].result === 'OK') && snap && !force) return snap; } catch (e) { /* carry on */ }
  const { states, snapshot } = await refresh(prev, now, disabled, overrides);
  const cmds = [['SET', K.snapshot, JSON.stringify(snapshot), 'EX', '900'], ['ZREMRANGEBYSCORE', K.active, '-inf', String(now)], ['DEL', K.lock]];
  for (const [id, st] of Object.entries(states)) cmds.push(['SET', K.src(id), JSON.stringify(st), 'EX', String(7 * 86400)]);
  // Each alert keeps its own SET with its own TTL; the active index gets one ZADD with every score/member pair
  // (one billed command instead of one per alert, same resulting set).
  const zadd = ['ZADD', K.active];
  for (const c of snapshot.alerts) {
    const end = B.endOf(c), ttl = Math.max(60, Math.ceil((end - now) / 1000)), k = hash(c.key);
    cmds.push(['SET', K.alert(k), JSON.stringify(c), 'EX', String(ttl)]);
    zadd.push(String(end), k);
  }
  if (zadd.length > 2) cmds.push(zadd);
  try { await redis(cmds); } catch (e) { /* serve anyway */ }
  return snapshot;
}

// Public answers carry no error text (PR 1.3); the stored snapshot and the forced (secret) answer keep it.
const publicAlerts = snap => Object.assign({}, snap, { sources: (snap.sources || []).map(s => { const o = Object.assign({}, s); delete o.error; return o; }) });

module.exports = async function (req, res) {
  const secret = process.env.CRON_SECRET || '';
  const force = !!(req.query && req.query.refresh) && !!secret && same(req.headers.authorization || '', 'Bearer ' + secret);
  try {
    const snap = await build(force);
    res.setHeader('Cache-Control', force ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=60, max-age=30');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(JSON.stringify(force ? Object.assign({ ok: snap.sources.every(s => s.ok || s.cached) }, snap) : publicAlerts(snap)));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'alerts temporarily unavailable', alerts: [] });
  }
};
module.exports.FEEDS = FEEDS;
module.exports.KEYS = K;
module.exports.loadFeed = loadFeed;
module.exports.rssItems = rssItems;
module.exports.refresh = refresh;
module.exports.publicAlerts = publicAlerts;
