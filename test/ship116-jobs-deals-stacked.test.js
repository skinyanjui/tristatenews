'use strict';
// Jobs/Deals are compact stacked cards with a full-width View button and a local detail dialog.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const js = read('public/assets/app.js');
const css = read('public/assets/app.css');
const API = path.join(root, 'api');
const fnOf = name => {
  const i = js.indexOf('  function ' + name + '(');
  assert.ok(i > 0, name);
  return js.slice(i, js.indexOf('\n  }\n', i));
};

test('ship116: Jobs and Deals cards are stacked, not the news footer row', () => {
  const job = fnOf('jobCard');
  const deal = fnOf('dealCard');
  assert.ok(!/UI\.row\(/.test(job), 'jobCard is a stacked card');
  assert.ok(!/UI\.row\(/.test(deal), 'dealCard is a stacked card');
  assert.match(job, /el\('article', 'job row-job'/);
  assert.match(deal, /el\('article', 'deal row-deal'/);
  assert.match(job, /View job/);
  assert.match(deal, /View deal/);
  assert.match(js, /Demo listing/);
  assert.match(job, /viewBtn\('View job', it, 'job'/);
  assert.match(deal, /viewBtn\('View deal', it, 'deal'/);
  assert.match(css, /#jb \.job-view, #dl \.deal-view \{/);
  const btn = css.slice(css.indexOf('#jb .job-view, #dl .deal-view {'), css.indexOf('#jb .job-view, #dl .deal-view {') + 280);
  assert.match(btn, /width:100%/);
  assert.match(btn, /min-height:var\(--cl-tap\)/);
  assert.match(css, /#jb \.job, #dl \.deal \{[^}]*height:auto/);
  assert.match(css, /#jb \.job-title, #dl \.deal-offer \{[^}]*overflow-wrap:anywhere/);
  assert.ok(!/#jb \.job[^{]*\{[^}]*overflow:\s*hidden/.test(css));
  assert.match(css, /#cl \.cl-chips, #jb \.cl-chips, #dl \.cl-chips, #ev \.cl-chips \{[\s\S]*?flex-wrap:nowrap/);
});

test('ship116: View opens a local dialog; samples cannot apply or redeem; real CTAs only when they work', () => {
  const det = fnOf('boardDetails');
  assert.match(det, /el\('dialog', 'bd-sheet'/);
  assert.match(det, /showModal/);
  assert.match(det, /back\.focus/);
  assert.match(det, /This is a demo listing/);
  assert.match(det, /Advertise a job/);
  assert.match(det, /ap\.href = '\/advertise'/);
  assert.ok(!/Apply/.test(det.split('it.sample')[1].split('else')[0]) || /it\.sample/.test(det));
  assert.match(det, /if \(it\.sample\)/);
  assert.match(det, /else if \(href\) \{[\s\S]*Apply/);
  assert.match(det, /Copy code/);
  assert.match(det, /Get offer/);
  assert.match(det, /navigator\.clipboard/);
  assert.ok(!/Featured \\u00B7 Paid/.test(fnOf('kick').split('it.sample')[0]) || /it\.sample \? \['Sample featured placement'\] : \['Featured \\u00B7 Paid'\]/.test(js));
  assert.match(js, /it\.sample \? \['Sample featured placement'\] : \['Featured \\u00B7 Paid'\]/);
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.ok((js.match(/id: 'sjob\d+'/g) || []).length >= 8);
  assert.ok((js.match(/id: 'sdeal\d+'/g) || []).length >= 8);
});
