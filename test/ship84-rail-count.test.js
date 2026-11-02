// ship84: each Events day rail shows its total at the right end of the header, number first ("1 event", "12 events").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const js = read('public/assets/app.js'), css = read('public/assets/app.css');

test('count text: number first, singular for one', () => {
  const m = js.match(/function evxCount\(n\) \{[^\n]*\}/);
  assert.ok(m);
  const evxCount = new Function(m[0] + '; return evxCount;')();
  assert.equal(evxCount(1), '1 event');
  assert.equal(evxCount(0), '0 events');
  assert.equal(evxCount(12), '12 events');
});

test('wired: the total is in the header row between heading and arrows, and in the rail name', () => {
  assert.ok(js.includes("function evxScroller(cls, heading, label, list, b, count) {"));
  assert.ok(js.includes("if (count != null) sh.appendChild(el('span', 'evx-ct', evxCount(count)));"));
  assert.ok(js.indexOf("sh.appendChild(el('span', 'evx-ct'") < js.indexOf('sh.appendChild(ar); sec.appendChild(sh);'), 'count before the arrows');
  assert.ok(js.includes("evxDayLabel(d) + ', ' + evxCount(dayCount[d]), byDay[d], b, dayCount[d]);"));
  assert.ok(!js.includes("h.appendChild(el('small', null, String(dayCount[d])));"), 'no bare number beside the date');
  assert.ok(!css.includes('.evx-day h3 small'));
});

test('layout: heading | total | arrows, total right-aligned on one line', () => {
  assert.ok(css.includes('.evx-sh.evx-sh { grid-template-columns:minmax(0, 1fr) auto auto; align-items:center; }'));
  assert.ok(css.includes('.evx-sh > .evx-ct { justify-self:end; white-space:nowrap;'));
  assert.ok(css.includes('@media (max-width:639px) { .evx-sh.evx-sh { grid-template-columns:minmax(0, 1fr) auto; } }'), 'phones: on the gutter');
  assert.ok(css.includes('.evx-sh .evx-ct { font-size:13px; font-weight:500; color:var(--text-muted); }'));
});
