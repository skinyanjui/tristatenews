'use strict';
// ship80: one spacing scale, one gutter and max width; shared component blocks use the tokens, not stray px spacing.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public/assets/app.css'), 'utf8');
const SPACING = /(?<![\w-])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|bottom|left|right|inline|block))?\s*:([^;}]*)/g;
const strayPx = (blk) => [...blk.matchAll(SPACING)].map(m => m[0]).filter(d => /(?<![\w.-])[1-9]\d*px/.test(d));

test('the scale, gutter and content width are defined once', () => {
  assert.ok(css.includes(':root { --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-6:24px; --sp-8:32px; --sp-12:48px;'));
  assert.ok(css.includes('--content-max:var(--page-max); --card-pad:var(--sp-4); --card-gap:var(--sp-4); --card-stack:var(--sp-2); }'));
  assert.ok(css.includes(':root { --gutter:var(--sp-4); }') && css.includes(':root { --gutter:var(--sp-6); }') && css.includes(':root { --gutter:var(--sp-8); }'), 'gutter 16 / 24 (640px+) / 32 (1024px+)');
  assert.ok(css.includes('.nav-in, .nav-tabs { max-width:var(--content-max); padding-left:var(--gutter); padding-right:var(--gutter); }'), 'header and tabs share the page edges');
  assert.ok(css.includes('main { max-width:var(--content-max); padding-left:var(--gutter); padding-right:var(--gutter);'));
});

test('lists, headings, filters, forms and the footer are grids on the scale; the footer is never fixed', () => {
  assert.ok(css.includes('.list, .cl-list, .sr-sec, .evx, .evx-filters { display:grid; grid-template-columns:minmax(0, 1fr); }'));
  assert.ok(css.includes('.evx-sh, .cl-bar { display:grid; grid-template-columns:minmax(0, 1fr) auto;'));
  assert.ok(css.includes('.evc.evc { display:grid; grid-template-rows:auto 1fr; }'));
  assert.ok(css.includes('.legal-foot { display:grid; gap:var(--sp-2); margin:var(--sp-8) 0 0; padding:var(--sp-3) 0 0; }'));
  assert.ok(!/legal-foot[^{]*\{[^}]*position:fixed/.test(css));
  assert.ok(/\.evx-day h3 \{[^}]*margin:0; padding:var\(--sp-1\) 0;/.test(css), 'day headings sit on the page edge (no -4px outdent)');
});

test('no stray px padding, margin or gap in the shared row, event card and layout blocks', () => {
  const blocks = {
    row: css.slice(css.indexOf('/* ---------- ship74/ship75:'), css.indexOf('/* ---------- card spacing')),
    eventCard: css.slice(css.indexOf('/* ship78:'), css.indexOf('\n\n', css.indexOf('/* ship78:'))),
    layout: css.slice(css.indexOf('/* ---------- ship80: one layout grid'))
  };
  for (const [k, b] of Object.entries(blocks)) { assert.ok(b.length > 200, k); assert.deepStrictEqual(strayPx(b), [], k); }
});

test('leftover CSS for removed event markup is gone', () => {
  for (const c of ['evr', 'evr-body', 'evr-pic', 'evr-from', 'ev-plain', 'ev-date', 'ev-foot', 'ev-row', 'ev-desc']) assert.ok(!new RegExp('\\.' + c + '(?![\\w-])').test(css), c);
});
