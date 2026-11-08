'use strict';
// Classifieds empty-state, marketplace copy, wanted amounts, and classifieds-scoped control sizing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const js = read('public/assets/app.js');
const css = read('public/assets/app.css');
const API = path.join(root, 'api');

test('ship112: native empty copy distinguishes loading, marketplace present, native-only, and overall empty', () => {
  assert.match(js, /function itemEmptyState/);
  assert.match(js, /function fillItemEmpty/);
  assert.match(js, /function syncItemEmpty/);
  assert.match(js, /if \(!MK\) return \{ skip: true/);
  assert.match(js, /if \(shown\.length\) return \{ skip: true/);
  assert.match(js, /if \(MK\.ok && mkAll\.length\) return \{ skip: true/);
  assert.match(js, /No posts on TRISTATENOW yet\. Be the first\./);
  assert.match(js, /Nothing posted yet\. Be the first\./);
  assert.match(js, /paintItemFilters\(\);\s*syncItemEmpty\(\);/);
  assert.match(js, /clEl\.querySelector\(':scope > \.cl-list'\) \|\| clEl\.querySelector\('\.mk-sec'\)/);
  assert.match(js, /if \(!items\.length && kind === 'item'\) \{\s*if \(fillItemEmpty\(list, b\)\) root\.appendChild\(list\);/);
});

test('ship112: marketplace listings keep Test listing tags; no heading or description block', () => {
  assert.match(js, /el\('span', 'mk-tag', 'Test listing'\)/);
  assert.ok(!/'From tristatemarketplace\.com'/.test(js));
  assert.ok(!/Test listings from tristatemarketplace/.test(js));
  assert.ok(!/mk-note/.test(js));
  assert.ok(!/Prices and details are as posted there/.test(js));
  assert.ok(!/verified listing/i.test(js));
  assert.match(js, /A sample, not a real business/);
  assert.match(js, /Loading listings from tristatemarketplace\.com/);
  assert.match(js, /aren\\u2019t available right now/);
});

test('ship112: wanted marketplace amounts stay the printed figure; no budget or asking label', () => {
  assert.match(js, /function mkWanted\(x\) \{ return \/\^\\s\*wanted\\b\/i\.test/);
  assert.match(js, /function mkAmount/);
  assert.match(js, /mkWanted\(x\) \? 'span' : 'b'/);
  assert.match(js, /mkWanted\(x\) \? 'mk-amt' : 'cl-price'/);
  assert.match(js, /left: \[mkAmount\(x\), el\('span', 'mk-tag', 'Test listing'\)\]/);
  const chunk = js.slice(js.indexOf('function mkAmount'), js.indexOf('function mkAmount') + 280);
  assert.ok(!/budget|asking/i.test(chunk));
});

test('ship112: classifieds tap targets are 44px and scoped; --ctl stays 32px', () => {
  assert.match(css, /#cl, #jb, #dl, #ev \{ --cl-tap: 44px; \}/);
  assert.match(css, /--ctl: 32px;/);
  assert.match(css, /#cl \.cl-bar \.ev-town select\.ui-select/);
  assert.match(css, /#cl \.cl-bar > \.cl-go/);
  assert.match(css, /#cl \.cl-chip, #jb \.cl-chip, #dl \.cl-chip, #ev \.cl-chip \{ min-height:var\(--cl-tap\); \}/);
  assert.match(css, /#cl \.spon, #cl \.spon-house, #jb \.spon, #jb \.spon-house, #dl \.spon, #dl \.spon-house/);
  assert.match(css, /#cl \.mk-amt/);
  assert.ok(!/:root \{[^}]*--ctl:\s*44px/.test(css));
});

test('ship112: still eight Vercel functions; no extra feeds or store in this change', () => {
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.match(read('api/listings.js'), /market: \(\) => require\('\.\/_market\.js'\)/);
});
