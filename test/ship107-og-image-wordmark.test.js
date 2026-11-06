'use strict';
// ship107: the shared social image is the supplied artwork as public/og-image.jpg (1200x630 JPEG), declared with
// og:image (type, size, alt) and twitter:card/twitter:image on every page head that has a social card, including
// the server-built tab and county pages. The wordmark is TRISTATE + red NOW, with its own light/dark tokens.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const IMG = 'https://www.tristatenow.com/og-image.jpg';
const TAGS = [
  '<meta property="og:image" content="' + IMG + '" />',
  '<meta property="og:image:type" content="image/jpeg">',
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta property="og:image:alt" content="TRISTATENOW: Indiana, Kentucky, Illinois. tristatenow.com">',
  '<meta name="twitter:card" content="summary_large_image" />',
  '<meta name="twitter:image" content="' + IMG + '" />',
];
const SOCIAL = ['data/pages/index.html', 'data/pages/advertise.html', 'public/legal.html', 'public/newsletter.html'];
const VERIFY = ['imgrimRmsdx3n0xLUgcG6A2o24uvOpP_ApcVkTKElNY', 'rNdpvloToCD2Puowo5pr65gxFbZllFXXcpzxy0JfL9c'];

function jpegSize(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'starts as a JPEG');
  for (let i = 2; i < buf.length;) {
    const marker = buf.readUInt16BE(i), len = buf.readUInt16BE(i + 2);
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('no frame header');
}

test('ship107: og-image.jpg is a 1200x630 JPEG small enough for every card; og.png is kept', () => {
  const buf = fs.readFileSync(path.join(root, 'public/og-image.jpg'));
  assert.deepEqual(jpegSize(buf), { w: 1200, h: 630 });
  assert.ok(buf.length > 20000 && buf.length < 300000, buf.length + ' bytes');
  assert.ok(fs.existsSync(path.join(root, 'public/og.png')));
  assert.match(read('vercel.json'), /"\/\(favicon\.svg\|icon-512\.png\|og\.png\|og-image\.jpg\)"/);
});

test('ship107: every social head declares the image for Open Graph and X, and nothing points at og.png', () => {
  for (const f of SOCIAL) {
    const h = read(f);
    for (const t of TAGS) assert.equal(h.split(t).length - 1, 1, f + ': ' + t);
    for (const v of VERIFY) assert.ok(h.includes('<meta name="google-site-verification" content="' + v + '" />'), f + ' keeps ' + v);
  }
  for (const f of [...fs.readdirSync(path.join(root, 'public')).filter(x => x.endsWith('.html')).map(x => 'public/' + x), ...fs.readdirSync(path.join(root, 'data/pages')).map(x => 'data/pages/' + x)])
    assert.ok(!read(f).includes('/og.png'), f);
});

test('ship107: server-built tab and county pages carry the shared image and their own canonical', () => {
  process.env.REGIONAL_ROUTES_ENABLED = 'true';
  const T = require('../api/_tabpage.js'), G = require('../api/_geopage.js'), S = require('../api/_scope.js'), RT = require('../public/routes.js');
  const pages = [...RT.ROUTES.map(r => [T.page(r), RT.ORIGIN + (r.path === '/' ? '/' : r.path)]), [G.page(S.parse('county:ky-henderson')).html, RT.ORIGIN + '/news/kentucky/henderson']];
  for (const [h, url] of pages) {
    for (const t of TAGS) assert.ok(h.includes(t), url + ': ' + t);
    assert.ok(h.includes('<link rel="canonical" href="' + url + '">'), url);
  }
});

test('ship107: the wordmark is TRISTATE + NOW with an accessible name, on every page header', () => {
  assert.match(read('data/pages/index.html'), /<a class="brand" id="home" href="\/" aria-label="TRISTATENOW home">TRISTATE<span class="brand-now">NOW<\/span><svg class="brand-card" [^>]*aria-hidden="true"[^>]*>.*?<\/svg><\/a>/);
  for (const f of ['public/legal.html', 'public/newsletter.html', 'public/unsubscribe.html', 'data/pages/404.html'])
    assert.ok(read(f).includes('<a class="lg-brand" href="/">TRISTATE<span class="brand-now">NOW</span></a>'), f);
  assert.ok(read('data/pages/advertise.html').includes('<a class="brand" href="/">TRISTATE<span class="brand-now">NOW</span></a>'));
});

test('ship107: the wordmark colors are black/red in light, white/red in dark; the site accent is unchanged', () => {
  for (const f of ['public/assets/app.css', 'public/legal.css']) {
    const css = read(f);
    assert.ok(css.includes(':root { --wordmark:#000; --wordmark-now:#e80101; }'), f);
    assert.ok(css.includes('[data-theme="dark"] { --wordmark:#fff; --wordmark-now:#ff2b2b; }'), f);
  }
  const app = read('public/assets/app.css');
  assert.ok(app.includes('.brand { color:var(--wordmark); }') && app.includes('.brand-now { color:var(--wordmark-now); }'));
  assert.ok(app.includes('--brand:#0b6b86;') && app.includes('--brand:#4cc3dd;'), 'teal accent tokens stay');
  assert.ok(!/\.brand \{ color:var\(--brand\); \}/.test(app));
  assert.match(read('public/legal.css'), /\.lg-brand \{ color:var\(--wordmark\);/);
  const L = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const cr = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => p - q); return (y + 0.05) / (x + 0.05); };
  assert.ok(cr('#e80101', '#ffffff') >= 4.5 && cr('#ff2b2b', '#0a0a0a') >= 4.5 && cr('#ffffff', '#0a0a0a') >= 4.5);
});
