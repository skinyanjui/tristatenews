'use strict';
// ship101: the shared footer links to Tristate Market (tristatemarketplace.com, the site's own brand). Classifieds do not
// import its listings: it has no feed or API, and its public pages do not mark which listings are its own samples.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'data/pages/index.html'), 'utf8');

test('ship101: the footer links to Tristate Market after the site links', () => {
  const links = index.slice(index.indexOf('<div class="legal-links">'), index.indexOf('</div>', index.indexOf('<div class="legal-links">')));
  assert.match(links, /<a class="legal-link" href="\/unsubscribe\.html">Unsubscribe<\/a><a class="legal-link" href="https:\/\/www\.tristatemarketplace\.com\/" rel="noopener">Tristate Market<\/a>$/);
  assert.strictEqual((index.match(/tristatemarketplace\.com/g) || []).length, 1);
});

test('ship101: no marketplace import (no source, no extra function)', () => {
  const src = ['api', 'data/sources', 'public/assets/app.js'].map(p => {
    const f = path.join(root, p);
    return fs.statSync(f).isDirectory() ? fs.readdirSync(f).filter(n => /\.(js|json)$/.test(n)).map(n => fs.readFileSync(path.join(f, n), 'utf8')).join('\n') : fs.readFileSync(f, 'utf8');
  }).join('\n');
  assert.ok(!/tristatemarketplace/i.test(src));
  assert.strictEqual(fs.readdirSync(path.join(root, 'api')).filter(n => n.endsWith('.js') && !n.startsWith('_')).length, 8);
});
