// ship85: the event date badge is one horizontal pill ("NOVEMBER 1"), as tall as the heart circle and on the same inset;
// the picture-less tile puts month and day on one row too. Month stays spelled out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const js = read('public/assets/app.js'), css = read('public/assets/app.css');

test('badge: one row, 32px tall, 8px inset, pill, clear of the heart corner', () => {
  assert.ok(css.includes('.evx-badge.evx-badge { flex-direction:row; align-items:center; gap:var(--sp-1); box-sizing:border-box; height:var(--sp-8); min-width:0; max-width:calc(100% - var(--sp-12) - var(--sp-2)); padding:0 var(--sp-3); border-radius:9999px; white-space:nowrap; top:var(--sp-2); left:var(--sp-2); }'));
  assert.ok(css.includes('.evx-badge.evx-badge .evx-mo { font-size:11px; line-height:16px;'));
  assert.ok(css.includes('.evx-badge.evx-badge .evx-dd { font-size:15px; line-height:16px;'));
  assert.ok(css.includes('.evc.evc .evc-pic > .like.evc-like { top:var(--sp-1); right:var(--sp-1); }'), 'heart circle: 4 + 4 = 8px inset, 32px');
});

test('tile and badge keep the spelled-out month, hidden from screen readers (the day line reads the date)', () => {
  assert.ok(js.includes("var md = el('span', 'evx-md');"));
  assert.ok(css.includes('.evx-tile .evx-md { display:flex; align-items:baseline; gap:var(--sp-2); white-space:nowrap; }'));
  assert.equal((js.match(/el\('span', 'evx-mo', evxDate\(it\.date, \{ month: 'long' \}\)\)/g) || []).length, 2);
  assert.ok(js.includes("var t = el('div', 'evx-badge'); t.setAttribute('aria-hidden', 'true');"));
});
