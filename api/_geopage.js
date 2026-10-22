// County and state pages (plan PR 6.2-6.4), behind REGIONAL_ROUTES_ENABLED (api/_flags.js). Served by api/news.js:
//   /news/<state>             -> /api/news?__route=geopage&p=/news/<state>            (vercel.json rewrites)
//   /news/<state>/<county>    -> /api/news?__route=geopage&p=/news/<state>/<county>
//   /sitemap-regions.xml      -> /api/news?__route=geopage&sitemap=1
// Flag off, or a path that isn't one of our 4 states or 68 counties: the site's not-found page (404), exactly what
// these paths returned before. Flag on: public/index.html with the head pointed at the page (title, description,
// canonical, og:url), and noindex unless the county passes the depth gate (D10: >= DEPTH_MIN distinct local stories in
// 14 days). The gate reads the rolling per-county record each refresh maintains (tsn:geo:depth, api/_depthrec.js):
// one GET, cached in this instance for 5 minutes (pages are also CDN-cached). When the record is missing, empty or
// the store is unreachable, it falls back to the committed measurement data/geography/coverage.json
// (scripts/build-sitemap.js --measure). The page itself reads its scope from the path (public/routes.js geo()).
'use strict';
const fs = require('fs');
const path = require('path');
const FLAGS = require('./_flags.js');
const S = require('./_scope.js');
const ORIGIN = 'https://tristatenewss.vercel.app';
const INDEX = path.join(__dirname, '..', 'public', 'index.html');
const D = require('./_depthrec.js');
let html = null, cached = null;
const GATE_MS = 5 * 6e4;

// The current gate: the rolling record when there is one, else coverage.json. Never throws.
async function loadGate(now) {
  now = now || Date.now();
  if (cached && now - cached.t < GATE_MS) return cached.g;
  let rec = null;
  const news = require('./news.js');
  if (news.stored()) { try { const out = await news.redis([['GET', D.KEY]]); rec = out && out[0] && !out[0].error ? out[0].result : null; } catch (_) { rec = null; } }
  const g = D.gate(rec, now);
  cached = { t: now, g };
  return g;
}
function resetGate() { cached = null; }
// Indexable: a state page always (it rolls up every county); a county page only past the depth gate.
function indexable(scope, gate) {
  if (scope.kind === 'state') return true;
  const g = gate || D.gate(null);
  return (g.depth[scope.countyIds[0]] || 0) >= g.min;
}
function meta(scope, gate) {
  const where = scope.label;
  const title = where + ' news · Tri-State News';
  const st = scope.kind === 'state' ? scope.state : scope.countyIds[0].slice(0, 2);
  const desc = scope.kind === 'state'
    ? 'Local news from ' + where + ' counties we cover, gathered from local newsrooms and official sources.'
    : 'Local news from ' + where + ', gathered from local newsrooms and official sources' + (st === 'mo' ? ' in southeast Missouri.' : ' in the region.');
  return { title, desc, url: ORIGIN + S.pathOf(scope), index: indexable(scope, gate) };
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function page(scope, gate) {
  if (html === null) html = fs.readFileSync(INDEX, 'utf8');
  const m = meta(scope, gate);
  let h = html
    .replace(/<title>[^<]*<\/title>/, '<title>' + esc(m.title) + '</title>')
    .replace(/(<meta name="description" content=")[^"]*/, '$1' + esc(m.desc))
    .replace(/(<link rel="canonical" href=")[^"]*/, '$1' + esc(m.url))
    .replace(/(<meta property="og:title" content=")[^"]*/, '$1' + esc(m.title))
    .replace(/(<meta property="og:description" content=")[^"]*/, '$1' + esc(m.desc))
    .replace(/(<meta property="og:url" content=")[^"]*/, '$1' + esc(m.url));
  if (!m.index) h = h.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex">');
  return { html: h, meta: m };
}
function sitemap(gate) {
  const urls = [];
  for (const st of Object.keys(S.STATES)) {
    urls.push(ORIGIN + '/news/' + S.SLUGS[st]);
    for (const c of S.COUNTIES.filter(x => x.state === st)) { const sc = S.parse('county:' + c.id); if (indexable(sc, gate)) urls.push(ORIGIN + S.pathOf(sc)); }
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => '  <url><loc>' + u + '</loc><changefreq>hourly</changefreq><priority>0.6</priority></url>').join('\n') + '\n</urlset>\n';
}

async function handler(req, res) {
  const q = req.query || {};
  if (!FLAGS.on('REGIONAL_ROUTES_ENABLED')) return require('./_notfound.js')(req, res);
  if (q.sitemap) {
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(sitemap(await loadGate()));
  }
  const scope = S.fromPath(String(Array.isArray(q.p) ? q.p[0] : q.p || ''));
  if (!scope) return require('./_notfound.js')(req, res);
  const p = page(scope, await loadGate());
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=900');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!p.meta.index) res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(200).send(req.method === 'HEAD' ? '' : p.html);
}

module.exports = handler;
module.exports.page = page;
module.exports.sitemap = sitemap;
module.exports.indexable = indexable;
module.exports.loadGate = loadGate;
module.exports.resetGate = resetGate;
