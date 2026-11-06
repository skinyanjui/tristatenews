'use strict';
// ship100: the Events town picker, date chips, Add an event and categories are one grid; the dates join the town row
// from 1024px and keep their own row (unchanged spacing) below it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const js = fs.readFileSync(path.join(__dirname, '../public/assets/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/assets/app.css'), 'utf8');
const blk = css.slice(css.indexOf('/* ship100'));

test('ship100: the header sits inside the filter grid, before the date and category chips', () => {
  assert.match(js, /var fl = el\('div', 'evx-filters'\); fl\.appendChild\(evxHeader\(b\)\); fl\.appendChild\(evxDateChips\(b\)\);/);
  assert.ok(!/root\.appendChild\(evxHeader\(b\)\)/.test(js));
  assert.match(js, /cats\.setAttribute\('aria-label', 'Category'\);[\s\S]{0,200}fl\.appendChild\(cats\); root\.appendChild\(fl\);/);
});

test('ship100: below 1024px the dates keep their own row, the same --card-gap below the town as before', () => {
  assert.ok(css.indexOf('/* ship100') > css.indexOf('.sr-sec, .evx-filters { gap:var(--sp-2); }'), 'overrides the ship80 filter grid');
  assert.match(blk, /^\/\* ship100[^]*?\*\/\n\.evx-filters \{ grid-template-columns:minmax\(0, 1fr\) auto; grid-template-areas:"town add" "dates dates" "cats cats";/);
  assert.match(blk, /\.evx-filters > \.evx-head \{ display:contents; \}/);
  assert.match(blk, /\.evx-filters > \[aria-label="When"\] \{ grid-area:dates; margin-top:calc\(var\(--card-gap\) - var\(--sp-2\)\); \}/);
});

test('ship100: from 1024px town | dates | Add an event share a row; nothing scrolls the page', () => {
  const wide = blk.slice(blk.indexOf('@media (min-width:1024px)'));
  assert.ok(wide.length > 0);
  assert.match(wide, /grid-template-columns:minmax\(0, max-content\) minmax\(0, 1fr\) auto; grid-template-areas:"town dates add" "cats cats cats"; align-items:start;/);
  assert.match(wide, /\.evx-ht \{ max-width:14rem; \}/);
  assert.match(wide, /\[aria-label="When"\] \{ margin-top:0; flex-wrap:wrap; \}/);
  assert.ok(!/@media \(min-width:(?:[0-9]{3}|10[01][0-9]|102[0-3])px\)/.test(wide.split('}\n}')[0].slice(1)), 'one breakpoint');
});
