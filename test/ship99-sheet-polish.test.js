const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const js = fs.readFileSync(path.join(__dirname, '../public/assets/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/assets/app.css'), 'utf8');
const blk = css.slice(css.indexOf('/* ship99'), css.indexOf('.st-sheet .st-nav { transition:none !important; } }'));
const spacing = css.indexOf('/* ---------- card spacing');

test('ship99: the swipe springs, follows the finger, honours reduced motion and flicks', () => {
  assert.match(js, /SPRING = 'cubic-bezier\(\.22,1\.18,\.36,1\)'/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /if \(busy\) return false;/);
  assert.match(js, /lastX/);
  assert.match(js, /el\('div', 'st-grab'\)/);
});

test('ship99: heart, share and N of M share one row above Continue', () => {
  assert.match(js, /var bar = el\('div', 'st-bar'\); bar\.appendChild\(ar\);/);
  assert.match(js, /pos\.setAttribute\('aria-label', 'Story ' \+ \(i \+ 1\) \+ ' of ' \+ list\.length\)/);
  assert.ok(!/st-why|Why this is here/.test(js));
});

test('ship99: polish CSS sits at top level before card spacing and uses spacing tokens', () => {
  assert.ok(css.indexOf('/* ship99') > 0 && blk.length > 0 && css.indexOf('/* ship99') < spacing);
  assert.match(blk, /\.st-bar \{ display:flex;[^}]*justify-content:space-between;/);
  assert.match(blk, /\.st-acts\.st-acts\.st-acts :is\(\.like, \.share\) \{ height:44px; min-height:44px;/);
  assert.match(blk, /\.st-acts\.st-acts\.st-acts \.like \{[^}]*width:calc\(44px \+ 4ch\); min-width:calc\(44px \+ 4ch\);/);
  assert.match(blk, /\.st-sheet h2 \{ font-size:24px; line-height:30px; font-weight:700;/);
  assert.match(blk, /\.st-sheet\.st-sheet:has\(\.st-pic\) \.st-bd \{ padding:var\(--sp-6\); \}/);
  assert.ok(!/--sp-5\b/.test(blk));
  for (const m of blk.matchAll(/(?:padding|margin|gap)(?:-[a-z]+)?:([^;}]*)/g)) assert.ok(!/\d+px/.test(m[1].replace(/calc\([^)]*env\([^)]*\)\)/g, '').replace(/\b0px\b/g, '')), m[0]);
  // the block opens at top level, not inside the phone media query
  const before = css.slice(0, css.indexOf('/* ship99'));
  assert.strictEqual((before.match(/\{/g) || []).length, (before.match(/\}/g) || []).length);
});
