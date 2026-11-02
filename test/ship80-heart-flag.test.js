'use strict';
// ship80: the heart on the picture's corner; the flag in its old place in the bottom row, drawn like share.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const js = read('public/assets/app.js'), css = read('public/assets/app.css');
const fn = (name) => { const i = js.indexOf('  function ' + name + '('); assert.ok(i > 0, name); return js.slice(i, js.indexOf('\n  }\n', i)); };

test('every card: heart on the picture, then flag, share, Tickets/Details in the bottom row', () => {
  const c = fn('evxCard');
  assert.ok(c.includes('c.firstChild.appendChild(evxHeart(rt))'), 'heart on the picture');
  const a = c.indexOf('acts.appendChild(ac.acts.firstChild)'), f = c.indexOf('acts.appendChild(evxFlag(it))'), s = c.indexOf('acts.appendChild(shareFor(rt))'), g = c.indexOf('right.appendChild(go)');
  assert.ok(a > 0 && f > a && s > f && g > s, 'flag (Report/Remove or feed Report) before share, button last');
  assert.ok(!js.includes('function evxReact('), 'the old heart+share row is gone');
  assert.ok(fn('evxHeart').includes("sb.classList.add('evc-like')"));
});

test('feed events: Report opens a prefilled Correction (there is no listing to flag)', () => {
  const f = fn('evxFlag');
  assert.ok(f.includes("el('button', 'cl-ico evc-flag')") && f.includes('svg(ICON_FLAG)') && f.includes("type: 'Correction'") && f.includes('openSubmit()'));
  assert.ok(js.includes('if (SN_PREFILL) {') && js.includes('els.headline.value = pf.headline; els.details.value = pf.details;'));
});

test('css: heart 24px icon, 40px tap, translucent white circle, count kept for screen readers; flag styled like share', () => {
  assert.ok(/\.evc-pic > \.like\.evc-like \{[^}]*position:absolute; top:4px; right:4px;[^}]*width:40px; height:40px/.test(css));
  assert.ok(css.includes('.evc.evc .evc-pic > .like.evc-like::before { content:""; position:absolute; inset:2px; border-radius:9999px; background:rgba(255,255,255,.85);'));
  assert.ok(css.includes('.evc.evc .evc-pic > .like.evc-like svg { position:relative; width:24px; height:24px;'));
  assert.ok(/\.evc-like span \{ position:absolute; width:1px; height:1px; overflow:hidden; clip/.test(css), 'count visually hidden, still read');
  assert.ok(css.includes('.evc.evc .evc-foot .acts :is(.cl-ico, .share) svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:2.25;'));
  assert.ok(css.includes('.evc.evc .evc-foot .acts :is(.cl-ico, .share) { border:0; background:transparent; border-radius:0; color:var(--row-ink); }'));
});
