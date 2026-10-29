// The tab pages ("/", /events, /obituaries, /jobs, /deals, /classifieds, /institutions), served by api/news.js so each
// one arrives with its own <title>, description, canonical, og:title/description/url and robots in the HTML, for
// crawlers and link previews that don't run JavaScript. vercel.json rewrites each path to
// /api/news?__route=tabpage&p=/<tab> (no new function; data/pages/index.html is bundled with api/news.js).
// The head comes from the same table the page's own script uses (public/routes.js ROUTES, TSNRoutes.apply), so the
// server-side head and the client-side one always agree. A path that isn't a tab gets the site's not-found page.
// The shell lives in data/pages/, not public/: Vercel serves a static file before any rewrite, so a public/index.html
// would always win over this handler for "/".
// First stories in the HTML (PR ship69): News ("/"), Obituaries and Institutions also carry the tab's first stories
// from the current snapshot, pre-rendered and as JSON (api/_cards.js), and drop the /api/news preload (the page
// draws from the embedded stories, then loads the full answer). No fresh snapshot, a slow store or any error: the
// plain shell, as before (never a 500).
'use strict';
const fs = require('fs');
const path = require('path');
const RT = require('../public/routes.js');
const C = require('./_cards.js');
const INDEX = path.join(__dirname, '..', 'data', 'pages', 'index.html');
const EMBED = { news: 1, obits: 1, institution: 1 }; // the tabs whose list is /api/news stories
const STORE_WAIT_MS = 1500;
const LIST = '<div id="list" class="list" aria-busy="true"></div>';
const PRELOAD = '<link rel="preload" href="/api/news" as="fetch" crossorigin>\n';
let html = null;

const { esc } = require('./_html.js');

// data/pages/index.html with its head pointed at route r (what TSNRoutes.apply(document, r) does in the browser).
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

// The page with the tab's first stories in it, or null to serve the plain shell. view: the /api/news answer.
function withStories(h, r, view, now) {
  if (!view || !EMBED[r.cat] || h.indexOf(LIST) < 0) return null;
  const p = C.pick(view, r.cat, now);
  if (!p) return null;
  const list = '<div id="list" class="list' + (r.cat === 'news' ? ' news-one' : '') + '" aria-busy="false">' + C.cards(p, now) + '</div>' +
    '\n  <script type="application/json" id="tsn-data">' + C.jsonScript(Object.assign({ cat: r.cat }, p.data)) + '</script>';
  return h.replace(PRELOAD, '').replace(LIST, () => list);
}

function storeView() {
  let t;
  const wait = new Promise(res => { t = setTimeout(() => res(null), STORE_WAIT_MS); });
  return Promise.race([require('./news.js').homeView(), wait]).then(v => { clearTimeout(t); return v; }, () => { clearTimeout(t); return null; });
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Allow', 'GET, HEAD'); return res.status(405).send('Method not allowed'); }
  const q = req.query || {};
  const p = String(Array.isArray(q.p) ? q.p[0] : q.p || '');
  const r = RT.ROUTES.find(x => x.path === RT.norm(p));
  if (!r) return require('./_notfound.js')(req, res);
  const shell = page(r);
  let out = null;
  if (EMBED[r.cat] && req.method === 'GET') {
    try { out = withStories(shell, r, await storeView(), Date.now()); } catch (e) { console.error('tab page stories failed', e && e.message); out = null; }
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // With stories: the same short cache as /api/news (NEWS_CACHE), so the embedded stories are at most ~2 minutes behind.
  // Embedding tab without stories (no fresh snapshot yet): a short cache, so the stories show up soon.
  res.setHeader('Cache-Control', out ? require('./news.js').NEWS_CACHE
    : EMBED[r.cat] ? 'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
    : 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
  if (!r.index) res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(200).send(req.method === 'HEAD' ? '' : (out || shell));
}

module.exports = handler;
module.exports.page = page;
module.exports.withStories = withStories;
module.exports.EMBED = EMBED;
