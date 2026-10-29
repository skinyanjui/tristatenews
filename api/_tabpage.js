// The tab pages (/events, /obituaries, /jobs, /deals, /classifieds, /institutions), served by api/news.js so each one
// arrives with its own <title>, description, canonical, og:title/description/url and robots in the HTML, for
// crawlers and link previews that don't run JavaScript. vercel.json rewrites each path to
// /api/news?__route=tabpage&p=/<tab> (no new function; public/index.html is already bundled with api/news.js).
// The head comes from the same table the page's own script uses (public/routes.js ROUTES, TSNRoutes.apply), so the
// server-side head and the client-side one always agree. "/" (News) is public/index.html served as a static file,
// whose head is already the News route's. A path that isn't a tab gets the site's not-found page.
'use strict';
const fs = require('fs');
const path = require('path');
const RT = require('../public/routes.js');
const INDEX = path.join(__dirname, '..', 'public', 'index.html');
let html = null;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// public/index.html with its head pointed at route r (what TSNRoutes.apply(document, r) does in the browser).
function page(r) {
  if (html === null) html = fs.readFileSync(INDEX, 'utf8');
  const url = RT.ORIGIN + (r.path === '/' ? '/' : r.path);
  let h = html
    .replace(/<title>[^<]*<\/title>/, () => '<title>' + esc(r.title) + '</title>')
    .replace(/(<meta name="description" content=")[^"]*/, (m, a) => a + esc(r.desc))
    .replace(/(<link rel="canonical" href=")[^"]*/, (m, a) => a + esc(url))
    .replace(/(<meta property="og:title" content=")[^"]*/, (m, a) => a + esc(r.title))
    .replace(/(<meta property="og:description" content=")[^"]*/, (m, a) => a + esc(r.desc))
    .replace(/(<meta property="og:url" content=")[^"]*/, (m, a) => a + esc(url));
  if (!r.index) h = h.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex">');
  return h;
}

function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Allow', 'GET, HEAD'); return res.status(405).send('Method not allowed'); }
  const q = req.query || {};
  const p = String(Array.isArray(q.p) ? q.p[0] : q.p || '');
  const r = RT.ROUTES.find(x => x.path === RT.norm(p));
  if (!r) return require('./_notfound.js')(req, res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  if (!r.index) res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(200).send(req.method === 'HEAD' ? '' : page(r));
}

module.exports = handler;
module.exports.page = page;
