// ship89: liking a post must not flicker or move the posted time. The browser check is e2e/like-no-shift.spec.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'app.css'), 'utf8');

test('the server answer to a like repaints hearts in place, never the whole list', () => {
  assert.ok(js.includes('d.count !== state.counts[id]) { state.counts[id] = d.count; repaintHearts(); }'));
  assert.ok(js.includes("function repaintHearts() { Array.prototype.forEach.call(document.querySelectorAll('button.like')"));
  assert.ok(!/state\.counts\[id\] = d\.count;\s*render\(\)/.test(js), 'no render() after the like answer');
});

test('paint only touches what changed: pressed state, label, count text', () => {
  assert.ok(js.includes("if (b.getAttribute('aria-pressed') !== pr) b.setAttribute('aria-pressed', pr);"));
  assert.ok(js.includes('if (cnt.textContent !== tx) cnt.textContent = tx;'));
});

test('the meta-line reserve is always there, not only once a count shows', () => {
  assert.ok(css.includes('article.card.row.row:not(.breaking):has(> .ca):has(.acts .like) .src.src { padding-right:'));
  assert.ok(!css.includes(':has(.acts .like > span:not(:empty)) .src.src'));
});

test('the bottom-row heart is a fixed slot that fits 4 digits, tabular, with no transition', () => {
  assert.ok(css.includes('font-variant-numeric:tabular-nums'));
  assert.ok(css.includes('width:calc(var(--ico) + var(--sp-1) + 4ch)'));
  assert.ok(!css.includes('.acts.acts .like:has(> span:not(:empty)) { width:auto;'), 'no width change when a count appears');
});
