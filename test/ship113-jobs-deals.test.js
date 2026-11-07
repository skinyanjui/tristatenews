'use strict';
// Jobs and Deals are live reader boards (same listings API as classifieds). No env/dashboard gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const RT = require('../public/routes.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const js = read('public/assets/app.js');
const css = read('public/assets/app.css');
const html = read('data/pages/index.html');
const vercel = JSON.parse(read('vercel.json'));
const API = path.join(root, 'api');

test('ship113: Jobs and Deals are in the tab row, routes, sitemap and page sections', () => {
  const cats = [...js.match(/var CATS = \[([\s\S]*?)\];/)[1].matchAll(/id: '([a-z]+)'/g)].map(m => m[1]);
  assert.ok(cats.includes('jobs') && cats.includes('deals'));
  assert.equal(RT.byPath('/jobs').cat, 'jobs');
  assert.equal(RT.byPath('/deals').cat, 'deals');
  assert.equal(RT.byCat('jobs').index, true);
  assert.equal(RT.byCat('deals').index, true);
  const sitemap = read('public/sitemap.xml');
  assert.ok(sitemap.includes(RT.ORIGIN + '/jobs'));
  assert.ok(sitemap.includes(RT.ORIGIN + '/deals'));
  assert.match(html, /id="jb"[^>]*aria-label="Jobs"/);
  assert.match(html, /id="dl"[^>]*aria-label="Deals"/);
  const rw = vercel.rewrites.find(r => r.destination === '/api/news?__route=tabpage&p=/:tab');
  assert.match(rw.source, /jobs/);
  assert.match(rw.source, /deals/);
});

test('ship113: Jobs and Deals use the existing listings board (no extra function, no invented posts)', () => {
  assert.match(js, /function renderJobs\(\)/);
  assert.match(js, /function renderDeals\(\)/);
  assert.match(js, /drawBody\('job', 'Local jobs', 'Post a job'\)/);
  assert.match(js, /drawBody\('deal', 'Local deals and coupons', 'Post a deal'\)/);
  assert.match(js, /loadBoard\('job'\)/);
  assert.match(js, /loadBoard\('deal'\)/);
  assert.match(js, /Nothing posted yet\. Be the first\./);
  assert.match(js, /kind: kind, title: els.title.value/);
  assert.match(js, /adult: F\.adult\.input\.checked/);
  assert.match(js, /18 or older/);
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.match(read('api/listings.js'), /kindOf = v => v === 'deal'/);
  assert.match(read('api/listings.js'), /v === 'job' \? 'job'/);
  assert.ok(!/JOBS_ENABLED|DEALS_ENABLED|BOARDS_ENABLED/.test(js + read('api/_flags.js') + read('api/listings.js')));
});

test('ship113: Jobs and Deals board controls share classifieds 44px tap targets; nav --ctl stays 32px', () => {
  assert.match(css, /#cl, #jb, #dl \{ --cl-tap: 44px; \}/);
  assert.match(css, /--ctl: 32px;/);
  assert.match(css, /#jb \.cl-bar > \.cl-go/);
  assert.match(css, /#dl \.cl-bar > \.cl-go/);
  assert.match(css, /#jb \.cl-chip/);
  assert.match(css, /#dl \.cl-chip/);
  assert.ok(!/:root \{[^}]*--ctl:\s*44px/.test(css));
});
