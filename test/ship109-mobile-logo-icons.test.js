// ship109: the circular T icon (red line above the T) as the phone home logo and as the site icon; the time under the
// borderless temperature on phones; desktop unchanged. Browser checks: e2e/mobile-logo.spec.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const I = require('../scripts/build-icons.js');

test('the home link carries the icon artwork, hidden from screen readers, after the wordmark', () => {
  const h = read('data/pages/index.html');
  assert.ok(h.includes('<a class="brand" id="home" href="/" aria-label="TRISTATENOW home">TRISTATE<span class="brand-now">NOW</span><svg class="brand-card" viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
    '<circle class="bc-bg" cx="32" cy="32" r="32"/><path class="bc-acc" d="' + I.ART.accent + '"/><path class="bc-t" d="' + I.ART.t + '"/></svg></a>'));
});

test('CSS: phones get the 44px circular icon and the time under the temperature; desktop keeps the wordmark', () => {
  const css = read('public/assets/app.css');
  const m = css.slice(css.indexOf('.brand-card { display:none; }'));
  assert.ok(m.startsWith('.brand-card { display:none; }'), 'no icon by default');
  assert.ok(m.includes('.bc-bg { fill:#111; } .bc-t { fill:#fff; } .bc-acc { fill:var(--wordmark-now); }'), 'the red line follows the wordmark red token');
  const phone = m.slice(m.indexOf('@media (max-width:639px) {'), m.indexOf('\n}\n') + 2);
  for (const s of ['.nav-in .brand { width:44px; height:44px;', 'font-size:0;', 'border-radius:50%; }', '.brand-card { display:block; width:32px; height:32px; border-radius:50%; }',
    '[data-theme="dark"] .brand-card { box-shadow:0 0 0 1px var(--border); }', '.nav-in .clk { position:absolute; top:29px; right:calc(var(--gutter) + 4px); pointer-events:none; }',
    '.wx-btn { height:40px; min-height:40px;', 'border:0; background:transparent; }']) assert.ok(phone.includes(s), s);
  assert.ok(css.includes(':root { --wordmark:#000; --wordmark-now:#e80101; }') && css.includes('[data-theme="dark"] { --wordmark:#fff; --wordmark-now:#ff2b2b; }'));
});

test('icons: favicon.svg is the generated artwork with a dark-scheme variant; ICO has 16/32/48; PNG sizes', () => {
  assert.equal(read('public/favicon.svg'), I.FAVICON);
  assert.ok(I.FAVICON.includes('<circle class="c" cx="32" cy="32" r="32"/>') && I.FAVICON.includes('@media (prefers-color-scheme:dark)'));
  assert.ok(!I.FAVICON.includes('#0b6b86'), 'the old teal square is gone');
  const ico = fs.readFileSync(path.join(root, 'public/favicon.ico'));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 3]);
  for (const [i, px] of [16, 32, 48].entries()) {
    const e = 6 + 16 * i, off = ico.readUInt32LE(e + 12);
    assert.equal(ico[e], px);
    assert.equal(ico.toString('latin1', off + 1, off + 4), 'PNG');
    assert.deepEqual([ico.readUInt32BE(off + 16), ico.readUInt32BE(off + 20)], [px, px]);
  }
  for (const [f, px] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512]]) {
    const b = fs.readFileSync(path.join(root, 'public', f));
    assert.equal(b.toString('latin1', 1, 4), 'PNG', f);
    assert.deepEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [px, px], f);
    assert.equal(I.PNGS[f][0], px, f);
  }
  for (const g of Object.values(I.GRID)) assert.match(g.accent + g.t, /^[MhvHVz0-9 -]+$/, 'whole-pixel paths');
});

test('heads and manifest point at the new icons; OG artwork and the 8 functions are unchanged', () => {
  const m = JSON.parse(read('public/manifest.webmanifest'));
  assert.deepEqual(m.icons, [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }]);
  assert.equal(m.theme_color, '#111111');
  for (const f of ['data/pages/index.html', 'data/pages/404.html', 'data/pages/advertise.html', 'public/legal.html', 'public/newsletter.html', 'public/unsubscribe.html', 'public/order.html'])
    assert.ok(read(f).includes('<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">'), f);
  assert.ok(read('data/pages/index.html').includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png">'));
  assert.ok(read('data/pages/index.html').includes('content="https://www.tristatenow.com/og-image.jpg"'));
  assert.equal(fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
});
