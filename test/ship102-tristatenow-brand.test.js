'use strict';
// ship102: the reader-facing brand is TRISTATENOW (legal entity TristateNow.com). Branding only: the domain, the
// tristate scope key, TSN identifiers, the crawler user agent and geographic "Tri-State" stay as they were.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => {
  const p = d + '/' + e.name;
  return e.isDirectory() ? (['node_modules', 'sources', 'census', 'fonts', 'logos'].includes(e.name) ? [] : walk(p)) : /\.(html|js|json|md|webmanifest)$/.test(e.name) ? [p] : [];
});
const FILES = ['README.md', 'server.js', ...walk('api'), ...walk('public'), ...walk('data'), ...walk('docs')];

test('ship102: the old brand is gone everywhere readers or emails can see it', () => {
  for (const f of FILES) assert.ok(!/Tri-State News|Tristate News/i.test(read(f)), f);
  for (const f of ['data/pages/index.html', 'data/pages/404.html', 'public/legal.html', 'public/newsletter.html', 'public/unsubscribe.html'])
    assert.ok(!/>Tristate</.test(read(f)), f + ' wordmark');
});

test('ship102: header, titles, social and structured metadata say TRISTATENOW', () => {
  const index = read('data/pages/index.html');
  assert.match(index, /<a class="brand" id="home" href="\/" aria-label="TRISTATENOW home">TRISTATENOW<\/a>/);
  assert.match(index, /<title>TRISTATENOW<\/title>/);
  assert.match(index, /<meta property="og:site_name" content="TRISTATENOW">/);
  assert.match(index, /<meta property="og:title" content="TRISTATENOW">/);
  assert.match(index, /"@type":"WebSite","name":"TRISTATENOW","url":"https:\/\/www\.tristatenow\.com/);
  assert.match(index, /<p>© 2026 TRISTATENOW\. /);
  const m = JSON.parse(read('public/manifest.webmanifest'));
  assert.strictEqual(m.name, 'TRISTATENOW'); assert.strictEqual(m.short_name, 'TRISTATENOW');
  assert.match(read('public/routes.js'), /var SITE = 'TRISTATENOW';/);
  assert.match(read('public/assets/lib.js'), /var SITE = 'TRISTATENOW';/);
  assert.match(read('api/_geopage.js'), / news · TRISTATENOW'/);
  assert.match(read('data/pages/404.html'), /<title>Page not found · TRISTATENOW<\/title>/);
  for (const f of ['public/terms.html', 'public/privacy.html', 'public/copyright.html', 'public/corrections.html', 'public/accessibility.html', 'public/advertising.html', 'public/newsletter.html', 'public/unsubscribe.html', 'public/order.html', 'public/creative.html', 'data/pages/advertise.html'])
    assert.match(read(f), /<title>[^<]* · TRISTATENOW<\/title>/, f);
});

test('ship102: legal pages and emails use the brand and the TristateNow.com entity', () => {
  const legal = read('public/legal.html');
  assert.match(legal, /entity:\s+'TristateNow\.com'/);
  assert.match(legal, /<title>Legal · TRISTATENOW<\/title>/);
  assert.match(legal, /operates TRISTATENOW at https:\/\/www\.tristatenow\.com/);
  assert.match(read('api/_subscribe.js'), /subject: 'Confirm your TRISTATENOW subscription'/);
  assert.match(read('api/_submit.js'), /'TRISTATENOW <onboarding@resend\.dev>'/);
  assert.match(read('api/newsletter.js'), /'TRISTATENOW, week of '/);
});

test('ship102: branding only — domain, identifiers and geographic Tri-State are unchanged', () => {
  assert.match(read('data/pages/index.html'), /https:\/\/www\.tristatenow\.com/);
  assert.match(read('api/news.js'), /TriStateNews\/1\.1; \+https:\/\/tristatenewss\.vercel\.app/);
  assert.match(read('api/_scope.js'), /label: 'Tri-State'/);
  assert.match(read('api/_submit.js'), /'TSN-'/);
  assert.match(read('public/legal.html'), /Tri-State area/);
});

test('ship102: the display brand is all caps; mixed-case TristateNow only names the legal entity', () => {
  for (const f of FILES) {
    const left = read(f).match(/TristateNow(?!\.com| LLC)/g);
    assert.ok(!left, f + ': ' + (left || []).join(', '));
  }
  assert.match(read('data/pages/index.html'), /"name":"TRISTATENOW"/);
});
