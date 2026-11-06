'use strict';
// ship101: the shared footer links to tristatemarketplace.com (anchor text is the domain). Its listings show on
// Classifieds as test listings (ship105, api/_market.js, test/ship105-market.test.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'data/pages/index.html'), 'utf8');

test('ship101: the footer links to tristatemarketplace.com after the site links', () => {
  const links = index.slice(index.indexOf('<div class="legal-links">'), index.indexOf('</div>', index.indexOf('<div class="legal-links">')));
  assert.match(links, /<a class="legal-link" href="\/unsubscribe\.html">Unsubscribe<\/a><a class="legal-link" href="https:\/\/www\.tristatemarketplace\.com\/" rel="noopener">tristatemarketplace\.com<\/a>$/);
  assert.strictEqual((index.match(/tristatemarketplace\.com/g) || []).length, 2);
});

test('ship101: still eight functions', () => {
  assert.strictEqual(fs.readdirSync(path.join(root, 'api')).filter(n => n.endsWith('.js') && !n.startsWith('_')).length, 8);
});
