// Wide screens: a wider page (--page-max steps up past 1440px) with tall side ads in the margins, only on the board
// tabs; the vertical sample units use the samples switch in sponsors.json; News (with Police & courts) and
// Obituaries get none.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../public/adslots.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('public/index.html');
const css = html.slice(html.indexOf('/* ---------- wide screens'), html.lastIndexOf('</style>'));
const NOW = Date.parse('2026-10-21T18:00:00Z');
const ON = { on: true, ads: [{ name: 'Ninebark Bakehouse', text: 'a' }, { name: 'Marrow Creek Orchard', text: 'b' }, { name: 'Quillfeather Books', text: 'c' }, { name: 'Tinmouth Bicycle Works', text: 'd' }] };

test('railFill: vertical samples on both rails of the four boards and News; never on Obituaries', () => {
  for (const tab of ['jobs', 'deals', 'events', 'classifieds', 'news']) for (const side of ['left', 'right']) {
    const f = A.railFill(tab, side, [], NOW, ON);
    assert.equal(f.type, 'sample', tab + ' ' + side); assert.ok(A.validSample(f.ad));
  }
  assert.notEqual(A.railFill('jobs', 'left', [], NOW, ON).ad.name, A.railFill('jobs', 'right', [], NOW, ON).ad.name);
  for (const tab of ['obits', 'safety', 'all', 'institution', 'saved', 'submit', '', undefined, '__proto__'])
    for (const side of ['left', 'right']) assert.equal(A.railFill(tab, side, [{ name: 'Real', url: 'https://real.test/' }], NOW, ON), null, String(tab));
  assert.equal(A.railFill('jobs', 'top', [], NOW, ON), null);
});

test('railFill: real ads first (two at most), then samples, then the house unit (right) or nothing (left)', () => {
  const real = { name: 'Real', url: 'https://real.test/' };
  assert.deepEqual(A.railFill('jobs', 'left', [real, real, real], NOW, ON), { type: 'direct', ads: [real, real] });
  assert.equal(A.railFill('jobs', 'left', [{ name: 'Bad', url: 'http://x.test/' }], NOW, ON).type, 'sample', 'an invalid ad never fills a rail');
  const off = { on: false, ads: ON.ads };
  assert.deepEqual(A.railFill('jobs', 'right', [], NOW, off), { type: 'house' });
  assert.deepEqual(A.railFill('jobs', 'left', [], NOW, off), { type: 'none' });
  assert.equal(JSON.parse(read('public/sponsors.json')).samples.on, true, 'the existing switch drives them');
});

test('wider page: one width token for nav, tabs and main; rails sized and placed from it; hidden under 1360px', () => {
  assert.ok(css.includes(':root { --page-max:960px; --rail-w:160px; --rail-gap:24px; --news-max:960px; }'));
  for (const w of ['1440', '1680', '1920', '2560']) assert.ok(css.includes('@media (min-width:' + w + 'px) { :root { --page-max:'), w);
  assert.ok(css.includes('.nav-in, .nav-tabs, main { max-width:var(--page-max); }'));
  assert.ok(css.includes('.rail-l { left:calc(50% - var(--page-max) / 2 - var(--rail-gap) - var(--rail-w)); }'));
  assert.ok(css.includes('.rail-ad.rail-sky { min-height:min(600px, calc(100vh - 140px));'), 'skyscraper height, never taller than the screen');
  assert.ok(html.includes('.rail { display:none; }') && html.includes('body:not([data-ads]) .rail { display:none !important; }'));
  // the widest page plus both rails still fits each breakpoint
  const steps = [[1360, 960, 160, 24], [1440, 1056, 160, 24], [1680, 1280, 160, 24], [1920, 1440, 160, 32], [2560, 1760, 300, 48]];
  for (const [vw, page, rail, gap] of steps) assert.ok(page + 2 * (rail + gap) <= vw, vw + 'px');
});

test('no stretching: more columns on Obituaries and the boards, News one column, Breaking spans; card tokens kept', () => {
  assert.ok(css.includes('.list { grid-template-columns:1fr 1fr; gap:var(--card-gap);'));
  assert.ok(css.includes('.list.news-one { grid-template-columns:1fr;'), 'but News stays one story per row');
  assert.ok(css.includes('.list > .card.breaking, .list > :not(.card) { grid-column:1 / -1; }'), 'still one Breaking card, full width');
  assert.ok(css.includes('.deal-grid, .job-grid { grid-template-columns:1fr 1fr 1fr; }'));
  assert.ok(css.includes('gap:var(--card-gap)'));
  assert.ok(html.includes('if (SPONSORS) UI.rails(state.cat);'), 'rails follow the tab');
});

test('width tokens in index.html match the fit table', () => {
  assert.ok(html.includes('@media (min-width:1440px) { :root { --page-max:1056px; } }'), '1440: 160x600 side ads, not 120x600');
  assert.ok(html.includes('@media (min-width:1680px) { :root { --page-max:1280px; } }'));
  assert.ok(html.includes('@media (min-width:2560px) { :root { --page-max:1760px; --rail-w:300px; --rail-gap:48px; } }'));
  assert.ok(!/--rail-w:120px/.test(html), 'no 120px side ads');
  assert.ok(html.includes('@media (min-width:1920px) { :root { --page-max:1440px; --rail-gap:32px; } }'));
});
