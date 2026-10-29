// The /advertise page (rates, packages, how our ads work, and the inquiry form), behind the ADS_PAGE flag.
//   GET|HEAD /advertise   (vercel.json rewrites it to /api/inbox?__route=adpage; no new function)
// ADS_PAGE:
//   unset or anything else  off: 308 (permanent) to /#advertise, which opens the site's existing Advertise form
//   preview                 the page, with noindex (X-Robots-Tag and a robots meta tag) and no caching: for review
//   on                      the page, indexable and cached briefly: sales are open
// The page lives in data/pages/advertise.html, not public/, so it can't be reached around the flag. vercel.json
// bundles that folder with api/inbox.js (includeFiles). Prices are never in the page: it reads /api/catalog.
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'pages', 'advertise.html');
let cached = null;

function mode() {
  const v = String(process.env.ADS_PAGE || '').trim().toLowerCase();
  return v === 'on' || v === 'preview' ? v : 'off';
}

function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Allow', 'GET, HEAD'); return res.status(405).send('Method not allowed'); }
  const m = mode();
  if (m === 'off') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', '/#advertise');
    return res.status(308).send('');
  }
  if (cached === null) cached = fs.readFileSync(FILE, 'utf8');
  let html = cached;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (m === 'preview') {
    html = html.replace('<!--robots-->', '<meta name="robots" content="noindex, nofollow">');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
  } else {
    html = html.replace('<!--robots-->', '');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  }
  return res.status(200).send(req.method === 'HEAD' ? '' : html);
}

module.exports = handler;
module.exports.mode = mode;
