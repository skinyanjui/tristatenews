'use strict';
// Reader-page category/filter chips stay on one horizontal row (scroll on a narrow screen).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const js = read('public/assets/app.js');
const css = read('public/assets/app.css');
const API = path.join(root, 'api');

test('ship114: Classifieds, Jobs, Deals and Events chip rows are one non-wrapping row that scrolls inside the board', () => {
  assert.match(css, /#cl, #jb, #dl, #ev \{ min-width:0; \}/);
  const row = css.slice(css.indexOf('#cl .cl-chips, #jb .cl-chips, #dl .cl-chips, #ev .cl-chips {'), css.indexOf('#cl .cl-chips::-webkit-scrollbar'));
  assert.match(row, /flex-wrap:nowrap/);
  assert.match(row, /overflow-x:auto/);
  assert.match(row, /overflow-y:hidden/);
  assert.match(row, /overscroll-behavior-x:contain/);
  assert.match(row, /max-width:100%/);
  assert.match(row, /min-width:0/);
  assert.match(row, /touch-action:pan-x/);
  assert.match(css, /#cl \.cl-chips, #jb \.cl-chips, #dl \.cl-chips \{ padding-block:2px; \}/);
  assert.match(css, /#cl \.cl-chips \.cl-chip, #jb \.cl-chips \.cl-chip, #dl \.cl-chips \.cl-chip, #ev \.cl-chips \.cl-chip \{ white-space:nowrap;/);
  assert.match(css, /#cl \.cl-chip, #jb \.cl-chip, #dl \.cl-chip, #ev \.cl-chip \{ min-height:var\(--chip-h\); \}/);
  assert.match(css, /#cl, #jb, #dl, #ev \{ --cl-tap: 44px; \}/);
  assert.ok(!/#jb \.cl-chips, #dl \.cl-chips \{ flex-wrap:wrap/.test(css));
  assert.match(css, /\.evx-filters > \[aria-label="When"\] \{ margin-top:0; flex-wrap:nowrap; min-width:0; \}/);
  assert.match(css, /\.sr-bar \{ display:flex; flex-wrap:nowrap;/);
});

test('ship114: chip row is labeled Category, scrolls sideways only, and does not add a function', () => {
  assert.match(js, /function \(v\) \{ b\.filter = v; drawBoard\(kind\); \}, 'Category'\)/);
  assert.match(js, /chipRow: function \(items, active, onPick, aria\)/);
  assert.match(js, /function scrollChipX\(el\)/);
  assert.match(js, /row\.addEventListener\('focusin'/);
  assert.match(js, /if \(on && on !== row\.querySelector\('\.cl-chip'\)\) scrollChipX\(on\)/);
  const chipRow = js.slice(js.indexOf('chipRow: function (items, active, onPick, aria)'), js.indexOf('adLink: function'));
  assert.ok(!/scrollIntoView\(/.test(chipRow), 'chipRow must not call scrollIntoView (it jumps the page)');
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
});
