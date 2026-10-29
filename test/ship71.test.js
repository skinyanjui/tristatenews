// Ship 71: dead code removed, and fresher news (the browser never reuses its own copy of /api/news; a minute at the CDN).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('/api/news 200s: max-age=0 for browsers, a one-minute CDN copy with a one-minute stale window', () => {
  const news = require('../api/news.js');
  assert.equal(news.NEWS_CACHE, 'public, max-age=0, s-maxage=60, stale-while-revalidate=60');
  const src = read('api/news.js');
  assert.match(src, /res\.setHeader\('Cache-Control', NEWS_CACHE\);\s*res\.setHeader\('Content-Type', 'application\/json/);
  assert.doesNotMatch(src, /max-age=120/);
});

test('tab pages with stories use the same short cache as /api/news', async t => {
  const news = require('../api/news.js');
  const tab = require('../api/_tabpage.js');
  const NOW = Date.now();
  const items = Array.from({ length: 30 }, (_, i) => ({ id: 'n' + i, title: 'Story ' + i, link: 'https://ex.com/' + i, summary: 'S', published: new Date(NOW - (60 + i) * 6e4).toISOString(), source: 'Ex', sourceId: 'ex' }));
  t.mock.method(news, 'homeView', async () => ({ updatedAt: new Date(NOW - 3e5).toISOString(), items, sources: [{ id: 'ex', name: 'Ex', kind: 'news' }] }));
  const out = await new Promise(resolve => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, send(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); } };
    tab({ method: 'GET', query: { p: '/' }, headers: {}, url: '/' }, res);
  });
  assert.equal(out.status, 200);
  assert.match(out.body, /id="tsn-data"/);
  assert.equal(out.headers['cache-control'], news.NEWS_CACHE);
});

test('app.js: /api/news is fetched with cache "no-cache" (reload when forced); embedded stories give way unless the answer is older', () => {
  const app = read('public/assets/app.js');
  assert.match(app, /fetch\(url, \{ cache: force \? 'reload' : 'no-cache' \}\)/);
  assert.match(app, /if \(state\.partial && older\(d\.updatedAt, state\.updatedAt\)\)/);
  const m = /function older\(a, b\) \{[^\n]*\}/.exec(app);
  const older = new Function(m[0] + '; return older;')();
  assert.equal(older('2026-10-29T15:00:00Z', '2026-10-29T15:05:00Z'), true);
  assert.equal(older('2026-10-29T15:05:00Z', '2026-10-29T15:05:00Z'), false);
  assert.equal(older('2026-10-29T15:10:00Z', '2026-10-29T15:05:00Z'), false);
  assert.equal(older(undefined, '2026-10-29T15:05:00Z'), false);
});

test('dead code stays gone', () => {
  assert.doesNotMatch(read('api/news.js'), /function mget\(/);
  assert.doesNotMatch(read('api/_location.js'), /AREA_STATES/);
  assert.doesNotMatch(read('scripts/build-geo.js'), /const stateName =/);
  const css = read('public/assets/app.css');
  for (const sel of ['.job-links', '.ev-art', '.cl-code']) assert.ok(!css.includes(sel + ' '), sel);
  const exp = { '_leads.js': ['KEEP_DAYS', 'LOG_MAX', 'cleanNote'], '_location.js': ['splitDateline', 'qualifyParens'], '_log.js': ['scrub'], '_scope.js': ['inScope', 'MAX_COUNTIES', 'MIN_CONF'] };
  for (const [f, names] of Object.entries(exp)) { const m = require('../api/' + f); for (const n of names) assert.equal(m[n], undefined, f + ' ' + n); }
});
