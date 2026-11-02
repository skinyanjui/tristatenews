'use strict';
// ship78: event cards keep their own design and share one fixed bottom row (time or Happening now, heart, share, Tickets/Details).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const js = read('public/assets/app.js'), css = read('public/assets/app.css');
const fn = (name) => { const i = js.indexOf('function ' + name + '('); assert.ok(i > 0, name); return js.slice(i, js.indexOf('\n  function ', i + 10)); };

test('evxCard: picture/date tile on top, category, title, day and venue up front; one bottom row with time or live, acts, button', () => {
  const c = fn('evxCard');
  for (const k of ["evxPic(it, 'evc-pic')", "el('span', 'evr-cat', it.category)", "evxTitle(it, 'h4')", "'evt-when'", "'evt-where'", "el('div', 'evt-foot evc-foot')", 'tm.appendChild(liveTag())', 'evxTime(it)', 'right.appendChild(acts)', 'go = evxGo(it)', 'right.appendChild(go)']) assert.ok(c.includes(k), k);
  assert.ok(c.indexOf('right.appendChild(acts)') < c.indexOf('right.appendChild(go)'), 'heart and share, then the button');
  assert.ok(!c.includes('UI.row('), 'not the news row template');
});

test('css: equal-height cards, bottom row pinned and non-wrapping, 24px controls with 40px tap areas, 2-line title', () => {
  const i = css.indexOf('/* ship78:'), j = css.indexOf('\n\n', i);
  assert.ok(i > 0 && i < css.indexOf('/* ---------- ship74/ship75'), 'with the event card rules, before the shared row and spacing blocks');
  const b = css.slice(i, j);
  assert.ok(b.includes('.evx-rail { align-items:stretch; }'));
  assert.ok(/\.evc\.evc \{[^}]*display:flex; flex-direction:column/.test(b));
  assert.ok(/\.evc-foot \{[^}]*margin-top:auto[^}]*flex-wrap:nowrap/.test(b));
  assert.ok(/\.evc-foot \.ev-go \{[^}]*height:var\(--ico\); min-height:0[^}]*font-weight:var\(--row-wt\)/.test(b));
  assert.ok(b.includes('--ico:24px') && b.includes('--row-wt:500'));
  assert.ok(b.includes('.evc-foot .ev-go::after { content:""; position:absolute; inset:-8px -4px; }'), '24 + 16 = 40px tap');
  assert.ok(b.includes('::after { content:""; position:absolute; inset:-8px -6px; }'), 'heart/share 40px tap');
  assert.ok(b.includes('-webkit-line-clamp:2'));
});
