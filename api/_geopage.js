// County and state pages (plan PR 6.2-6.4), behind REGIONAL_ROUTES_ENABLED (api/_flags.js). Served by api/news.js:
//   /news/<state>             -> /api/news?__route=geopage&p=/news/<state>            (vercel.json rewrites)
//   /news/<state>/<county>    -> /api/news?__route=geopage&p=/news/<state>/<county>
//   /sitemap-regions.xml      -> /api/news?__route=geopage&sitemap=1
// Flag off, or a path that isn't one of our 4 states or 68 counties: the site's not-found page (404), exactly what
// these paths returned before. Flag on: public/index.html with the head pointed at the page (title, description,
// canonical, og:url), and noindex unless the county passes the depth gate (D10: >= DEPTH_MIN distinct local stories in
// 14 days, from the committed measurement data/geography/coverage.json that scripts/build-sitemap.js writes).
// The page itself reads its scope from the path (public/routes.js geo()). Nothing here touches Redis.
'use strict';
const fs = require('fs');
const path = require('path');
const FLAGS = require('./_flags.js');
const S = require('./_scope.js');
const ORIGIN = 'https://tristatenewss.vercel.app';
const INDEX = path.join(__dirname, '..', 'public', 'index.html');
let html = null, coverage;

function cov() {
  if (coverage === undefined) { try { coverage = require('../data/geography/coverage.json'); } catch (_) { coverage = null; } }
  return coverage;
}
// Indexable: a state page always (it rolls up every county); a county page only past the depth gate.
function indexable(scope) {
  if (scope.kind === 'state') return true;
  const c = cov();
  return !!(c && c.depth && c.depth[scope.countyIds[0]] >= (c.min || S.DEPTH_MIN));
}
function meta(scope) {
  const where = scope.label;
  const title = where + ' news · Tri-State News';
  const st = scope.kind === 'state' ? scope.state : scope.countyIds[0].slice(0, 2);
  const desc = scope.kind === 'state'
    ? 'Local news from ' + where + ' counties we cover, gathered from local newsrooms and official sources.'
    : 'Local news from ' + where + ', gathered from local newsrooms and official sources' + (st === 'mo' ? ' in southeast Missouri.' : ' in the region.');
  return { title, desc, url: ORIGIN + S.pathOf(scope), index: indexable(scope) };
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function page(scope) {
  if (html === null) html = fs.readFileSync(INDEX, 'utf8');
  const m = meta(scope);
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
function sitemap() {
  const urls = [];
  for (const st of Object.keys(S.STATES)) {
    urls.push(ORIGIN + '/news/' + S.SLUGS[st]);
    for (const c of S.COUNTIES.filter(x => x.state === st)) { const sc = S.parse('county:' + c.id); if (indexable(sc)) urls.push(ORIGIN + S.pathOf(sc)); }
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => '  <url><loc>' + u + '</loc><changefreq>hourly</changefreq><priority>0.6</priority></url>').join('\n') + '\n</urlset>\n';
}

function handler(req, res) {
  const q = req.query || {};
  if (!FLAGS.on('REGIONAL_ROUTES_ENABLED')) return require('./_notfound.js')(req, res);
  if (q.sitemap) {
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(sitemap());
  }
  const scope = S.fromPath(String(Array.isArray(q.p) ? q.p[0] : q.p || ''));
  if (!scope) return require('./_notfound.js')(req, res);
  const p = page(scope);
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=900');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!p.meta.index) res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(200).send(req.method === 'HEAD' ? '' : p.html);
}

module.exports = handler;
module.exports.page = page;
module.exports.sitemap = sitemap;
module.exports.indexable = indexable;
