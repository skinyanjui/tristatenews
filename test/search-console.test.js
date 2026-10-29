// Google Search Console verification for https://tristatenewss.vercel.app/ (URL-prefix property): the meta tag in the
// head of the home page (and the other public content pages), the static HTML verification file, and robots.txt
// pointing at both sitemaps. Static files in public/ are served before vercel.json rewrites, so the catch-all
// not-found rewrite never sees /googlebe8f034f797fc4e7.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const TAG = '<meta name="google-site-verification" content="imgrimRmsdx3n0xLUgcG6A2o24uvOpP_ApcVkTKElNY" />';

test('verification meta tag is in the <head> of the home page and the public content pages, once', () => {
  for (const f of ['data/pages/index.html', 'public/legal.html', 'public/newsletter.html', 'public/unsubscribe.html', 'public/order.html', 'data/pages/advertise.html', 'data/pages/404.html']) {
    const h = read(f), head = h.slice(0, h.indexOf('</head>'));
    assert.equal(head.split(TAG).length - 1, 1, f);
  }
  // county and state pages are index.html with a rewritten head: the tag survives
  process.env.REGIONAL_ROUTES_ENABLED = 'true';
  const G = require('../api/_geopage.js'), S = require('../api/_scope.js');
  assert.ok(G.page(S.parse('county:ky-henderson')).html.includes(TAG));
});

test('the HTML verification file is static, exact, and not shadowed by a rewrite', () => {
  assert.equal(read('public/googlebe8f034f797fc4e7.html'), 'google-site-verification: googlebe8f034f797fc4e7.html');
  const vj = JSON.parse(read('vercel.json'));
  for (const r of vj.rewrites.concat(vj.redirects || [])) assert.ok(!/google/.test(r.source), r.source);
});

test('robots.txt lists both sitemaps, which stay routed', () => {
  const r = read('public/robots.txt');
  assert.match(r, /^Sitemap: https:\/\/tristatenewss\.vercel\.app\/sitemap\.xml$/m);
  assert.match(r, /^Sitemap: https:\/\/tristatenewss\.vercel\.app\/sitemap-regions\.xml$/m);
  assert.ok(fs.existsSync(path.join(root, 'public/sitemap.xml')));
  const vj = JSON.parse(read('vercel.json')), rw = vj.rewrites.map(x => x.source);
  assert.ok(rw.indexOf('/sitemap-regions.xml') >= 0 && rw.indexOf('/sitemap-regions.xml') < rw.indexOf('/:path*'));
});
