// ship87: the like count beside the heart on event pictures (only when > 0), inside the same backdrop as a 32px pill.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public/assets/app.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public/assets/app.js'), 'utf8');

test('count shows only when not empty, as a pill on the heart backdrop', () => {
  assert.ok(css.includes('.evc.evc .evc-pic.evc-pic > .like.evc-like:has(> span:not(:empty)) { width:auto; min-width:var(--card-tap); padding:0 var(--sp-3) 0 var(--sp-2); gap:var(--sp-1); }'));
  assert.ok(css.includes('.evc.evc .evc-pic.evc-pic > .like.evc-like > span:not(:empty) { position:relative; width:auto; height:auto; overflow:visible; clip:auto;'));
  assert.ok(css.includes('.evc.evc .evc-pic > .like.evc-like > span { font-size:13px; font-weight:600; font-variant-numeric:tabular-nums; color:inherit; }'));
  assert.ok(js.includes("tx = s.n > 0 ? String(s.n) : ''") && js.includes("if (cnt.textContent !== tx) cnt.textContent = tx;"), 'empty (hidden) at zero');
  assert.ok(js.includes("(s.n ? ' (' + s.n + ' like' + (s.n === 1 ? '' : 's') + ')' : '')"), 'the count stays in the accessible name');
});
