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

test('ship113: Jobs and Deals use the existing listings board (no extra function)', () => {
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

test('ship113: labeled Jobs and Deals samples cover types, photos, logos, coupons and featured; no listing writes', () => {
  assert.match(js, /BOARD_SAMPLES = \{ on: true/);
  assert.match(js, /function boardSamples\(kind\)/);
  assert.match(js, /function boardPic\(/);
  assert.match(js, /function boardLogo\(/);
  assert.match(js, /sample: true/);
  assert.match(js, /el\('span', 'mk-tag', 'Sample'\)/);
  assert.match(js, /if \(it\.feed \|\| it\.sample\) return out/);
  assert.match(js, /el\('a', 'ad-cta', 'Advertise a job'\)/);
  assert.match(js, /it\.sample[\s\S]*?ap\.href = '\/advertise'/);
  assert.match(js, /else if \(href\) \{ ap = el\('a', 'ad-cta', 'Apply'\)/);
  assert.match(js, /real\.concat\(boardSamples\(kind\)\)/);
  for (const t of ['Full-time', 'Part-time', 'Seasonal', 'Contract']) assert.match(js, new RegExp("jobType: '" + t + "'"));
  for (const c of ['Healthcare', 'Trades & construction', 'Retail & food service', 'Warehouse & driving', 'Office & admin', 'Education', 'Other'])
    assert.match(js, new RegExp("category: '" + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'"));
  for (const c of ['Food & drink', 'Shopping', 'Services', 'Entertainment', 'Auto'])
    assert.ok((js.match(new RegExp("category: '" + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g')) || []).length >= 1, c);
  assert.match(js, /it\.imgData = boardPic/);
  assert.match(js, /it\.logo = boardLogo/);
  assert.match(js, /code: 'WREN2'/);
  assert.match(js, /featured: true/);
  assert.match(js, /it\.sample \? \['Sample featured placement'\] : \['Featured \\u00B7 Paid'\]/);
  assert.ok((js.match(/id: 'sjob\d+'/g) || []).length >= 7, 'enough jobs to place the in-listing ad');
  assert.ok((js.match(/id: 'sdeal\d+'/g) || []).length >= 7, 'enough deals to place the in-listing ad');
  assert.ok(!/fetch\('\/api\/listings'[\s\S]{0,200}BOARD_SAMPLES/.test(js));
  assert.ok(!/method: 'POST'[\s\S]{0,120}it\.sample/.test(js));
});

test('ship113: Jobs and Deals board controls share classifieds 44px tap targets; nav --ctl stays 32px', () => {
  assert.match(css, /#cl, #jb, #dl, #ev \{ --cl-tap: 44px; \}/);
  assert.match(css, /--ctl: 32px;/);
  assert.match(css, /#jb \.cl-bar > \.cl-go/);
  assert.match(css, /#dl \.cl-bar > \.cl-go/);
  assert.match(css, /#jb \.cl-chip/);
  assert.match(css, /#dl \.cl-chip/);
  assert.ok(!/:root \{[^}]*--ctl:\s*44px/.test(css));
});
