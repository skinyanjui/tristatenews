// ship83: one icon family (flag, share, heart: 20px glyph, 2px stroke, 24px box, also the heart on event pictures),
// one card action button everywhere, and visible copy spelled out (no "5h ago", "Sat", "Nov", "KY", "/hr").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const css = read('public/assets/app.css'), js = read('public/assets/app.js');

test('icons: one glyph size, stroke and box for flag, share and both hearts', () => {
  const i = css.indexOf('/* ship83: one icon family.');
  assert.ok(i > 0);
  const b = css.slice(i);
  assert.match(b, /:is\(\.like, \.share, \.cl-ico\) \{ box-sizing:border-box; width:var\(--ico, 24px\);[^}]*height:var\(--ico, 24px\);[^}]*align-items:center; justify-content:center;/);
  assert.match(b, /:is\(\.like, \.share, \.cl-ico\) svg, \.evc\.evc \.evc-pic\.evc-pic > \.like\.evc-like svg \{ width:20px; height:20px; stroke-width:2;/);
  assert.match(b, /\[aria-pressed="true"\] svg \{ fill:currentColor; \}/, 'liked = filled');
  assert.match(b, /\.like\.evc-like::before \{ inset:var\(--sp-1\); \}/, 'one backdrop circle on pictures');
  assert.ok(css.includes('.like.like[aria-pressed="true"], .evc.evc .evc-pic > .like.evc-like[aria-pressed="true"] { color:var(--react-on); }'));
});

test('icons: the glyphs are redrawn to the same reach and centred in the 24 grid', () => {
  assert.ok(js.includes("var ICON_HEART = [['path', { d: 'M12 21C6.5 17.2 2.5 13.6 2.5 8.8A5 5 0 0 1 12 6.4a5 5 0 0 1 9.5 2.4c0 4.8-4 8.4-9.5 12.2Z' }]];"));
  assert.ok(js.includes('b.appendChild(svg(ICON_HEART));'), 'UI.heart uses it');
  assert.ok(js.includes("var ICON_FLAG = [['path', { d: 'M5.5 21.5V3h13l-3 4.75 3 4.75h-13' }]]"));
  assert.ok(js.includes("['circle', { cx: 17.5, cy: 5.25, r: 2.75 }], ['circle', { cx: 6.5, cy: 12, r: 2.75 }], ['circle', { cx: 17.5, cy: 18.75, r: 2.75 }]"));
});

test('one action button: Tickets/Details, Apply and the obituary buttons share font, height, padding and radius', () => {
  for (const sel of ['.evc.evc .evc-foot.evc-foot .ev-go', 'article.card.row.row:has(> .ca) .src.src .ad-cta', '.ob-acts.ob-acts .ob-act > a']) {
    assert.ok(css.includes(sel + ', ') || css.includes(', ' + sel), sel);
  }
  assert.match(css, /\.ob-act > a \{ font-family:inherit; font-size:13px; font-weight:500; color:var\(--foreground\); background:transparent;/);
  assert.match(css, /\.ob-act > a \{ position:relative; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; height:var\(--ico, 24px\); min-height:0; margin:0; padding:0 var\(--sp-2\); gap:0; border:1\.5px solid; border-radius:9999px;/);
  assert.ok(!/\.src \.ad-cta \{[^}]*color:var\(--blue\)/.test(css), 'Apply is no longer a blue text link');
  assert.ok(css.includes('.ob-acts.ob-acts .ob-long { display:inline; }'), 'obituary buttons always show their full names');
});

test('words: relative times, dates, states and pay are spelled out in visible copy', () => {
  for (const f of ['public/assets/app.js', 'api/_cards.js']) {
    const s = read(f);
    assert.ok(s.includes("' minute ago' : ' minutes ago'") && s.includes("' hour ago' : ' hours ago'"), f);
    assert.ok(!/'m ago'|'h ago'/.test(s), f);
  }
  for (const f of ['public/assets/app.js', 'public/assets/lib.js', 'public/featured.js', 'public/breaking.js', 'api/_cards.js'])
    assert.ok(!/(weekday|month): 'short'/.test(read(f)), f);
  assert.ok(!/'Flowers', 'flowers'|'Tree', 'tree'/.test(js));
  const m = js.match(/function spell\(s\) \{[\s\S]*?\n  \}/);
  assert.ok(m);
  const STATES = { IN: 'Indiana', KY: 'Kentucky', IL: 'Illinois' };
  const spell = new Function('STATES', m[0] + '; return spell;')(STATES);
  assert.equal(spell('Evansville, IN'), 'Evansville, Indiana');
  assert.equal(spell('Henderson, KY · Marion, IL'), 'Henderson, Kentucky · Marion, Illinois');
  assert.equal(spell('Vanderburgh Co. fair'), 'Vanderburgh County fair');
  assert.equal(spell('Mt. Vernon, IN'), 'Mount Vernon, Indiana');
  assert.equal(spell('$16/hr · Full-time'), '$16 an hour · Full-time');
  assert.equal(spell('DRIVE IN movie'), 'DRIVE IN movie', 'only a state after a comma');
  assert.ok(js.includes("k.textContent = spell(o.kicker);") && js.includes("return spell(bits.filter(Boolean).join(' \\u00B7 '));"));
});

test('240px event cards keep "Happening now" whole: controls one small step apart', () => {
  assert.ok(css.includes('  .evx-rail .evc.evc .evc-foot.evc-foot > .evc-right { gap:var(--sp-1); }'));
});
