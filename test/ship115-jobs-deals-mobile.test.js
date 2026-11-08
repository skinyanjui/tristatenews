'use strict';
// Jobs/Deals phone footers wrap instead of spilling past the card. Chip rows stay one nowrap scroller.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public/assets/app.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/assets/app.js'), 'utf8');
const API = path.join(root, 'api');

test('ship115: Jobs and Deals src footers wrap so CTA and coupons stay in the card; chips stay nowrap', () => {
  const start = css.indexOf('#jb .row-job .src, #dl .row-deal .src {');
  assert.ok(start >= 0, 'Jobs/Deals .src wrap rule');
  const blk = css.slice(start, start + 720);
  assert.match(blk, /flex-wrap:wrap/);
  assert.match(blk, /height:auto/);
  assert.match(blk, /overflow:visible/);
  assert.match(css, /#jb \.row-job \.src \.ad-cta, #dl \.row-deal \.src \.ad-cta, #dl \.row-deal \.src \.deal-code/);
  assert.match(css, /article\.card\.row\.row:not\(\.breaking\):has\(> \.ca\) \.src \{[^}]*flex-wrap:nowrap/);
  assert.match(css, /#cl \.cl-chips, #jb \.cl-chips, #dl \.cl-chips, #ev \.cl-chips \{[\s\S]*?flex-wrap:nowrap/);
  assert.ok(!/html\s*\{[^}]*overflow-x:\s*hidden/.test(css));
  assert.ok(!/body\s*\{[^}]*overflow-x:\s*hidden/.test(css));
  assert.ok(!/#jb \.row-job \.src[^}]*overflow:\s*hidden/.test(css));
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.match(js, /BOARD_SAMPLES = \{ on: true/);
  assert.ok((js.match(/id: 'sjob\d+'/g) || []).length >= 8);
  assert.ok((js.match(/id: 'sdeal\d+'/g) || []).length >= 8);
});
