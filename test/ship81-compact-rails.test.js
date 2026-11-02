'use strict';
// ship81: on big screens the same event card is narrower and tighter, so each side-scroller shows more cards.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public/assets/app.css'), 'utf8');
const at = css.indexOf('/* ---------- ship81: compact event cards on big screens'), blk = css.slice(at, css.indexOf('/* ---------- ship74/ship75:'));
assert.ok(at > 0 && at < css.indexOf('/* ---------- card spacing'), 'before the spacing-only block (it sets a font size)');

test('from 1024px: a 240px card, 8px rail gap, padding on the spacing scale', () => {
  assert.ok(blk.length > 200);
  assert.ok(blk.includes('@media (min-width:1024px) {'));
  assert.ok(blk.includes('.evx-rail { gap:var(--sp-2); }'));
  assert.ok(blk.includes('.evc.evc { width:240px; }'), '4 whole cards in the 992px column (1440px+): 4 x 240 + 3 x 8 = 984');
  assert.ok(4 * 240 + 3 * 8 <= 992 && 3 * 240 + 2 * 8 <= 896, 'fits the 1440px and 1280px columns');
  assert.ok(blk.includes('.evx-rail .evc.evc > .evc-body { padding:var(--sp-2); }'));
  const spacing = [...blk.matchAll(/(?<![\w-])(?:padding|margin|gap)\s*:([^;}]*)/g)].map(m => m[0]).filter(d => /(?<![\w.-])[1-9]\d*px/.test(d));
  assert.deepStrictEqual(spacing, [], 'no stray px spacing');
});

test('same template: only sizes change (no element hidden, buttons still 24px, heart unchanged)', () => {
  assert.ok(!/display:none|visibility:hidden/.test(blk), 'nothing removed from the card');
  assert.ok(!/--ico|(?<![\w-])height:/.test(blk), 'the 24px controls keep their size');
  assert.ok(!/evc-like/.test(blk), 'heart untouched');
  assert.ok(!/ev-live[^{]*\{[^}]*font-size/.test(blk), '"Happening now" keeps its size (no shrinking to fit)');
});

test('the bottom row has room for "Happening now" (~100px) beside flag, share and the button at 240px', () => {
  // 240 - 2 border - 2 x 8 padding = 222; flag 24 + 4 + share 24 + 8 + button ~58 + 4 = 122; leaves 100.
  assert.ok(blk.includes('.evx-rail .evc.evc > .evc-body > .evc-foot { gap:var(--sp-1); }'));
  assert.ok(blk.includes('.evc.evc .evc-foot .acts { gap:var(--sp-1); }'));
  assert.ok(blk.includes('.evc.evc .evc-foot .ev-go { padding:0 var(--sp-2); font-size:12px; }'));
  assert.ok(240 - 2 - 16 - (24 + 4 + 24 + 8 + 58 + 4) >= 100);
});
