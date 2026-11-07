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

test('ship112: disclosure keeps test/sample labels and does not claim copied prices were checked', () => {
  assert.match(js, /Some are samples\. TRISTATENOW has not checked these listings; open one to see the amount and details on that site\./);
  assert.match(js, /el\('span', 'mk-tag', 'Test listing'\)/);
  assert.match(js, /'From tristatemarketplace\.com'/);
  assert.ok(!/Prices and details are as posted there/.test(js));
  assert.ok(!/verified listing/i.test(js));
  assert.match(js, /A sample, not a real business/);
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
  assert.match(css, /#cl \{ --cl-tap: 44px; \}/);
  assert.match(css, /--ctl: 32px;/);
  assert.match(css, /#cl \.cl-bar \.ev-town select\.ui-select/);
  assert.match(css, /#cl \.cl-bar > \.cl-go/);
  assert.match(css, /#cl \.cl-chip \{ min-height:var\(--cl-tap\); \}/);
  assert.match(css, /#cl \.spon, #cl \.spon-house/);
  assert.match(css, /#cl \.mk-amt/);
  assert.ok(!/:root \{[^}]*--ctl:\s*44px/.test(css));
});

test('ship112: still eight Vercel functions; no extra feeds or store in this change', () => {
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.match(read('api/listings.js'), /market: \(\) => require\('\.\/_market\.js'\)/);
});
