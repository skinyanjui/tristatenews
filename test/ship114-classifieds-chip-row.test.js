'use strict';
// Classifieds category chips stay on one horizontal row (scroll on a narrow screen). Jobs/Deals still wrap.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const js = read('public/assets/app.js');
const css = read('public/assets/app.css');
const API = path.join(root, 'api');

test('ship114: Classifieds category chips are one non-wrapping row that scrolls inside the board', () => {
  assert.match(css, /#cl \{ min-width:0; \}/);
  assert.match(css, /#cl > \.cl-chips \{/);
  const row = css.slice(css.indexOf('#cl > .cl-chips {'), css.indexOf('#cl > .cl-chips::-webkit-scrollbar'));
  assert.match(row, /flex-wrap:nowrap/);
  assert.match(row, /overflow-x:auto/);
  assert.match(row, /overflow-y:hidden/);
  assert.match(row, /overscroll-behavior-x:contain/);
  assert.match(row, /max-width:100%/);
  assert.match(row, /min-width:0/);
  assert.match(row, /touch-action:pan-x/);
  assert.match(css, /#cl > \.cl-chips \.cl-chip \{ white-space:nowrap;/);
  assert.match(css, /#cl \.cl-chip, #jb \.cl-chip, #dl \.cl-chip \{ min-height:var\(--cl-tap\); \}/);
  assert.match(css, /#cl, #jb, #dl \{ --cl-tap: 44px; \}/);
  assert.ok(!/#cl \.cl-chips, #jb \.cl-chips, #dl \.cl-chips \{ flex-wrap:wrap/.test(css));
  assert.match(css, /#jb \.cl-chips, #dl \.cl-chips \{ flex-wrap:wrap; overflow:visible; \}/);
});

test('ship114: chip row is labeled Category, keeps the pressed chip in view, and does not add a function', () => {
  assert.match(js, /function \(v\) \{ b\.filter = v; drawBoard\(kind\); \}, 'Category'\)/);
  assert.match(js, /chipRow: function \(items, active, onPick, aria\)/);
  assert.match(js, /row\.addEventListener\('focusin'/);
  assert.match(js, /scrollIntoView\(\{ inline: 'nearest', block: 'nearest' \}\)/);
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.ok(!/BOARD_SAMPLES/.test(js));
});
