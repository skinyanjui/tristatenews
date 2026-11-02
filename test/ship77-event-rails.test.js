'use strict';
// ship77: every day on the Events tab is a side-scroller, the same component as "Featured & popular this week".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const js = read('public/assets/app.js'), css = read('public/assets/app.css');
const fn = (name) => { const i = js.indexOf('function ' + name + '('); assert.ok(i > 0, name); return js.slice(i, js.indexOf('\n  function ', i + 10)); };

test('one shared scroller: popular and each day use evxScroller with evxCard, arrows and keyboard access', () => {
  const s = fn('evxScroller');
  for (const k of ["el('div', 'evx-rail')", "el('div', 'evx-arrows')", 'rail.tabIndex = 0', "rail.appendChild(evxCard(it, b))", 'rail.scrollBy(', "'Scroll back'", "'Scroll forward'"]) assert.ok(s.includes(k), k);
  const r = fn('renderEvents');
  assert.strictEqual((r.match(/evxScroller\(/g) || []).length, 2, 'popular + days');
  assert.ok(r.includes("evxScroller('evx-sec evx-pop'"));
  assert.ok(r.includes("evxScroller('evx-day', h,"));
  assert.ok(!r.includes('evxRow('), 'no vertical rows in day groups');
  assert.ok(!js.includes('function evxRow('), 'ship79: search uses the event card too');
});

test('day scrollers: filtered items only, empty days skipped, the ad sits between scrollers', () => {
  const r = fn('renderEvents');
  assert.ok(r.includes('groups.forEach(function (d) {'));
  assert.ok(r.includes('byDay[d], b)'));
  assert.ok(!/rail\.appendChild\(ac\)|g\.appendChild\(ac\)/.test(r), 'never inside a scroller');
});

test('css: rails snap and scroll inside, day spans the width, focus ring visible', () => {
  assert.ok(/\.evx-rail \{[^}]*overflow-x:auto/.test(css));
  assert.ok(/\.evx-rail \{[^}]*scroll-snap-type:x mandatory/.test(css));
  assert.ok(css.includes('.evx-day { grid-template-columns:minmax(0, 1fr); }'));
  assert.ok(css.includes('.evx-rail:focus-visible'));
});
