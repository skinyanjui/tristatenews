// The not-found page: any path that isn't a file, a function or another rewrite (vercel.json, last rewrites).
//   /api/<unknown>  -> /api/inbox?__route=notfound&api=1   JSON {"error":"not found"}, 404
//   anything else   -> /api/inbox?__route=notfound         data/pages/404.html, 404, noindex, no ads
// Vercel checks the filesystem before rewrites, so real files and functions are never sent here. No new function:
// it rides on api/inbox.js, which already bundles data/pages/** (includeFiles).
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'pages', '404.html');
let cached = null;

function page() {
  if (cached === null) cached = fs.readFileSync(FILE, 'utf8');
  return cached;
}

function isApi(req) {
  const q = req.query || {};
  if (q.api === '1') return true;
  try { return /^\/api(\/|$)/.test(new URL(req.url || '/', 'http://x').pathname) && !q.__route; } catch (_) { return false; }
}

function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (isApi(req)) { res.setHeader('Cache-Control', 'no-store'); return res.status(404).json({ error: 'not found' }); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'HEAD') res.setHeader('Allow', 'GET, HEAD');
  return res.status(404).send(req.method === 'HEAD' ? '' : page());
}

module.exports = handler;
module.exports.page = page;
