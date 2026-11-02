'use strict';
// ship79: one event card template for every event; the time sits flush left in the bottom row, the controls group right.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const js = read('public/assets/app.js'), css = read('public/assets/app.css');
const fn = (name) => { const i = js.indexOf('  function ' + name + '('); assert.ok(i > 0, name); return js.slice(i, js.indexOf('\n  }\n', i)); };

test('every event surface draws evxCard: scrollers, search and the board card', () => {
  assert.ok(fn('evxScroller').includes("rail.appendChild(evxCard(it, b, cls === 'evx-day'))"));
  assert.match(fn('eventCard'), /var c = evxCard\(it, b\); c\.classList\.add\('evc-solo'\)/);
  assert.ok(fn('cardBase').includes("if (kind === 'event') return eventCard(it, b);"));
  for (const gone of ['evxRow', 'evxBody', 'evxFoot']) assert.ok(!js.includes('function ' + gone + '('), gone + ' removed');
  assert.ok(!/row-event/.test(js), 'no event row variant left');
});

test('one structure for every variant: no branch changes the slots or their order', () => {
  const c = fn('evxCard');
  const order = ["evxPic(it, 'evc-pic')", "el('div', 'evt-top')", "evxTitle(it, 'h4')", "el('div', 'evt-when'", "el('div', 'evt-where'", "el('div', 'evt-foot evc-foot')", 'foot.appendChild(tm)', 'right.appendChild(acts)', 'right.appendChild(go)', 'foot.appendChild(right)'];
  let at = -1; for (const k of order) { const i = c.indexOf(k); assert.ok(i > at, 'in order: ' + k); at = i; }
  assert.ok(c.includes("tm.textContent = evxTime(it) || 'All day'") && c.includes('tm.appendChild(liveTag())'));
  assert.ok(c.includes("go = el('button', 'ev-go', 'Details')") && c.includes('evxDetails(it)'), 'a post with no link gets Details that opens it');
  assert.ok(c.includes('while (ac.acts.firstChild) acts.appendChild(ac.acts.firstChild)'), 'Report joins the right group');
  assert.ok(c.includes('if (ac.feature) body.appendChild(ac.feature)'), 'Feature under the content');
  assert.ok(c.includes('evxPostHref(it)'), 'posts get heart/share via their own link');
  assert.ok(fn('evxDetails').includes("el('dialog', 'evx-dlg')"));
  assert.ok(js.includes('setTimeout(evxOpenHash, 0);'), '/events#ev-<id> opens the post');
});

test('css: time flush left, controls grouped right, foot spans the content width, search grid of cards', () => {
  assert.ok(css.includes('.evc.evc .evc-foot > .evc-time { order:0; flex:1 1 auto; margin:0; padding:0; text-align:left; }'));
  assert.ok(/\.evc\.evc \.evc-time \{[^}]*display:block; min-width:0/.test(css), 'the time can shrink (ellipsis) instead of pushing the row');
  assert.ok(/\.evc\.evc > \.evc-body > \.evc-foot \{[^}]*align-self:stretch; justify-content:flex-start/.test(css), 'the row spans the content box, so its left is the card content edge');
  assert.ok(/\.evc-foot > \.evc-right \{[^}]*margin-left:auto[^}]*flex-wrap:nowrap/.test(css));
  assert.ok(css.includes('.ev-grid:has(> .evc) { display:grid;'));
  assert.ok(css.includes('.evc.evc.evc-solo { width:auto; min-width:0; }'));
});
