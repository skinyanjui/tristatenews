// Listings from tristatemarketplace.com for the Classifieds tab, shown while the site is being tested (the owner
// approved showing them, samples included). Served by api/listings.js: vercel.json rewrites /api/market to
// /api/listings?__route=market.
//   GET /api/market -> { ok, stale, fetchedAt, source: { name, url }, items: [{ id, url, title, price, town, desc,
//                        srcCategory, category, image }] }
// The site has no feed or API, so this reads only what it publishes for everyone: /sitemap.xml for the listing URLs
// and each public /listing/<slug> page (robots.txt allows both). From a page it keeps the title, category pill, town,
// price, photo and description as printed there; nothing is invented and no seller name or contact is copied.
// Bounded: at most MAX_LISTINGS pages, CONCURRENCY at a time, each with its own timeout, all within DEADLINE_MS.
// Cached: the last good result is kept in memory and, with a store, in Redis (KEY) for STALE_DAYS; it is served as
// is for FRESH_MS. After that window a copy still younger than STALE_DAYS is returned at once (stale:true) and a
// crawl continues after the answer (Vercel waitUntil, same hook as api/news.js) so the reader is not held for the
// sitemap and listing pages. A crawl that fails keeps that copy as stale and is not retried for FRESH_MS. With no
// good result at all the answer waits for the bounded crawl, then ok:false and an empty list (never sample data).
'use strict';
const STORE = require('./_store.js');

const ORIGIN = 'https://www.tristatemarketplace.com';
const SOURCE = { name: 'tristatemarketplace.com', url: ORIGIN + '/' };
const HOSTS = ['www.tristatemarketplace.com', 'tristatemarketplace.com', 'tristatemarketplace.vercel.app'];
const USER_AGENT = 'Mozilla/5.0 (compatible; TriStateNews/1.1; +https://tristatenewss.vercel.app)';
const MAX_LISTINGS = 40, CONCURRENCY = 6, PAGE_TIMEOUT_MS = 5000, DEADLINE_MS = 9000, MAX_BYTES = 1500000;
const FRESH_MS = 30 * 60 * 1000, STALE_DAYS = 3, KEY = 'tsn:mk:last', LOCK_KEY = 'tsn:mk:lock', LOCK_TTL_S = 20;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

// The site's category pills, mapped onto the Classifieds categories (api/listings.js CATS.item); the rest are Other.
const CAT_MAP = {
  cars: 'Vehicles', trucks: 'Vehicles', motorcycles: 'Vehicles', trailers: 'Vehicles', boats: 'Vehicles', rvs: 'Vehicles', 'auto parts': 'Vehicles',
  furniture: 'Furniture', electronics: 'Electronics', appliances: 'Home & garden', tools: 'Tools', 'lawn and garden': 'Home & garden',
  'home and garden': 'Home & garden', 'farm equipment': 'Tools', clothing: 'Clothing', sports: 'Sports & outdoors',
  'music gear': 'Other', 'baby and kids': 'Toys & kids', kids: 'Toys & kids', toys: 'Toys & kids'
};
const category = c => CAT_MAP[String(c || '').toLowerCase()] || 'Other';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function text(s) {
  return String(s || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m))
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);
const first = (html, re) => { const m = re.exec(html); return m ? m[1] : ''; };

// Listing slugs from the sitemap, in its order, without repeats.
function parseSitemap(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    let u; try { u = new URL(text(m[1])); } catch (_) { continue; }
    const p = /^\/listing\/([^/]+)\/?$/.exec(u.pathname);
    if (u.protocol === 'https:' && HOSTS.includes(u.hostname) && p && SLUG_RE.test(p[1]) && !out.includes(p[1])) out.push(p[1]);
  }
  return out;
}

// One public listing page -> the fields it prints, or null when it has no title.
function parseListing(html, slug) {
  html = String(html || '');
  const title = clip(text(first(html, /<h1[^>]*class="[^"]*\bdtitle\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/)) || text(first(html, /<title>([\s\S]*?)<\/title>/)).replace(/\s*\|\s*Tristate Market\s*$/i, ''), 100);
  if (title.length < 3) return null;
  const meta = first(html, /<div class="metarow">([\s\S]*?)<\/div>/);
  const srcCategory = clip(text(first(meta, /<span class="pill"[^>]*>([\s\S]*?)<\/span>/)), 40);
  const town = clip(text(first(meta, /<span class="muted metaplace">([\s\S]*?)<\/span><\/span>/) || first(meta, /<span class="muted metaplace">([\s\S]*?)<\/span>/)).split(' · ')[0], 50);
  const price = clip(text(first(html, /<span class="dprice">([\s\S]*?)<\/span>/)), 30);
  let desc = text(first(html, /<meta name="description" content="([^"]*)"/));
  const lead = [price, town].filter(Boolean).join(' · ');
  if (lead && desc.indexOf(lead + '. ') === 0) desc = desc.slice(lead.length + 2);
  else if (lead && desc === lead) desc = '';
  let image = text(first(html, /<div class="hero"><img[^>]*\ssrc="([^"]+)"/));
  if (image) { try { const u = new URL(image, ORIGIN); image = u.protocol === 'https:' && HOSTS.includes(u.hostname) ? ORIGIN + u.pathname + u.search : ''; } catch (_) { image = ''; } }
  return { id: 'mk-' + slug, url: ORIGIN + '/listing/' + slug, title, price, town, desc: clip(desc, 300), srcCategory, category: category(srcCategory), image };
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function dedupe(items) {
  const seen = new Set();
  return items.filter(x => { const k = norm(x.title) + '|' + norm(x.town.split(',')[0]); if (seen.has(x.id) || seen.has(k)) return false; seen.add(x.id); seen.add(k); return true; });
}

async function get(url, fetchImpl, signal) {
  const ctl = new AbortController(), stop = () => ctl.abort();
  const t = setTimeout(stop, PAGE_TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', stop, { once: true });
  try {
    const r = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xml' }, redirect: 'follow', signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const body = await r.text();
    if (body.length > MAX_BYTES) throw new Error('too large');
    return body;
  } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', stop); }
}

// Live read: the sitemap, then up to MAX_LISTINGS pages. Throws when the sitemap fails or no page parses.
async function crawl(fetchImpl) {
  const all = new AbortController(), deadline = setTimeout(() => all.abort(), DEADLINE_MS);
  try {
    const slugs = parseSitemap(await get(ORIGIN + '/sitemap.xml', fetchImpl, all.signal)).slice(0, MAX_LISTINGS);
    if (!slugs.length) throw new Error('no listings in the sitemap');
    const out = new Array(slugs.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < slugs.length && !all.signal.aborted) {
        const i = next++;
        try { out[i] = parseListing(await get(ORIGIN + '/listing/' + slugs[i], fetchImpl, all.signal), slugs[i]); } catch (_) { /* one bad page is skipped */ }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const items = dedupe(out.filter(Boolean));
    if (!items.length) throw new Error('no listing pages could be read');
    return items;
  } finally { clearTimeout(deadline); }
}

let mem = null, inflight = null, failAt = 0;

function waitUntil(promise) {
  try {
    const ctx = globalThis[Symbol.for('@vercel/request-context')];
    const c = ctx && typeof ctx.get === 'function' ? ctx.get() : null;
    if (c && typeof c.waitUntil === 'function') return c.waitUntil(promise);
  } catch (_) { /* fall through */ }
  return promise;
}

async function readStored() {
  if (!STORE.stored()) return null;
  try { const g = await STORE.pipeline([['GET', KEY]]); const o = JSON.parse((g[0] && g[0].result) || 'null'); return o && Array.isArray(o.items) && o.at ? o : null; } catch (_) { return null; }
}
async function writeStored(o) {
  if (!STORE.stored()) return;
  try { await STORE.pipeline([['SET', KEY, JSON.stringify(o), 'EX', String(STALE_DAYS * 86400)]]); } catch (_) { /* the memory copy still serves */ }
}
async function takeLock() {
  if (!STORE.stored()) return true;
  try {
    const out = await STORE.pipeline([['SET', LOCK_KEY, String(Date.now()), 'NX', 'EX', String(LOCK_TTL_S)]]);
    return !!(out[0] && !out[0].error && out[0].result);
  } catch (_) { return true; }
}
async function dropLock() {
  if (!STORE.stored()) return;
  try { await STORE.pipeline([['DEL', LOCK_KEY]]); } catch (_) { /* the TTL still frees it */ }
}

function startCrawl(fetchImpl, now) {
  if (inflight) return inflight;
  inflight = (async () => {
    const locked = await takeLock();
    if (!locked) return mem;
    try {
      const items = await crawl(fetchImpl);
      mem = { at: now, items };
      failAt = 0;
      await writeStored(mem);
      return mem;
    } finally { await dropLock(); }
  })().catch(e => { failAt = now; require('./_log.js').fail('market', e); return null; })
    .finally(() => { inflight = null; });
  return inflight;
}

// { ok, stale, refreshing, at, items } — fresh cache; else last-good at once plus a background crawl; else wait for
// a cold crawl; else ok:false.
async function load(opts) {
  opts = opts || {};
  const now = opts.now || Date.now(), fetchImpl = opts.fetch || fetch;
  const after = typeof opts.background === 'function' ? opts.background : waitUntil;
  if (!mem) mem = await readStored();
  if (mem && now - mem.at < FRESH_MS) return { ok: true, stale: false, refreshing: false, at: mem.at, items: mem.items };
  const cool = failAt && now - failAt < FRESH_MS;
  if (mem && now - mem.at < STALE_DAYS * 864e5) {
    if (!cool) after(startCrawl(fetchImpl, now).catch(() => {}));
    return { ok: true, stale: true, refreshing: !cool, at: mem.at, items: mem.items };
  }
  try {
    const got = await startCrawl(fetchImpl, now);
    if (got && Array.isArray(got.items) && got.items.length) return { ok: true, stale: false, refreshing: false, at: got.at, items: got.items };
    return { ok: false, stale: false, refreshing: false, at: 0, items: [] };
  } catch (e) {
    return { ok: false, stale: false, refreshing: false, at: 0, items: [] };
  }
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Cache-Control', 'no-store'); return res.status(405).send(JSON.stringify({ error: 'method' })); }
  const r = await load();
  res.setHeader('Cache-Control', r.ok && !r.stale ? 'public, max-age=0, s-maxage=1800, stale-while-revalidate=86400, stale-if-error=86400' : 'public, max-age=0, s-maxage=60');
  return res.status(200).send(JSON.stringify({ ok: r.ok, stale: r.stale, refreshing: !!r.refreshing, fetchedAt: r.at ? new Date(r.at).toISOString() : null, source: SOURCE, items: r.items }));
}

module.exports = handler;
module.exports.parseSitemap = parseSitemap;
module.exports.parseListing = parseListing;
module.exports.dedupe = dedupe;
module.exports.category = category;
module.exports.load = load;
module.exports.reset = () => { mem = null; inflight = null; failAt = 0; };
module.exports.pending = () => inflight;
module.exports.LIMITS = { MAX_LISTINGS, CONCURRENCY, PAGE_TIMEOUT_MS, DEADLINE_MS, FRESH_MS, STALE_DAYS };
module.exports.LOCK = { KEY: LOCK_KEY, TTL_S: LOCK_TTL_S };
