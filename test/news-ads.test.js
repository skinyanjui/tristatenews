// In-feed ads on News: News is one story per row at every width; a card about every 6th story, never directly before or
// after a Police & courts item, never first or last, none in search, beside Breaking or on Obituaries.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../public/adslots.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('public/index.html');
const NOW = Date.parse('2026-10-21T18:00:00Z');
const ON = { on: true, ads: [{ name: 'Ninebark Bakehouse', text: 'a' }, { name: 'Marrow Creek Orchard', text: 'b' }] };
const none = n => Array(n).fill(false);
// The rule every slot must keep: not first or last, neither neighbour a Police & courts item, `every` apart.
function check(flags, slots, every) {
  let prev = -Infinity;
  for (const p of slots) {
    assert.ok(p > 0 && p < flags.length, 'not first or last: ' + p);
    assert.ok(!flags[p - 1] && !flags[p], 'next to police at ' + p);
    assert.ok(p - prev >= every, 'spacing ' + prev + '→' + p); prev = p;
  }
}

test('newsSlots: one story per row, every 6th story at every width (no two-column rule)', () => {
  assert.equal(A.NEWS_EVERY, 6);
  assert.equal(A.NEWS_EVERY_WIDE, undefined, 'the every-10th two-column cadence is gone');
  assert.deepEqual(A.newsSlots(none(30), 6), [6, 12, 18, 24]);
  assert.deepEqual(A.newsSlots(none(30)), [6, 12, 18, 24], 'defaults to NEWS_EVERY');
  assert.deepEqual(A.newsSlots(none(6), 6), [], 'never after the last story');
  assert.deepEqual(A.newsSlots(none(7), 6), [6]);
  assert.deepEqual(A.newsSlots([], 6), []);
});

test('newsSlots: shifts past Police & courts items one story at a time', () => {
  const f = none(30); f[5] = true;                // story right before slot 6
  let s = A.newsSlots(f, 6); assert.equal(s[0], 7); check(f, s, 6);
  const g = none(30); g[6] = g[7] = true;         // stories right after slot 6
  s = A.newsSlots(g, 6); assert.equal(s[0], 9); check(g, s, 6);
  const h = none(30); h[11] = true;               // second slot shifts, the next keeps its spacing from it
  s = A.newsSlots(h, 6); assert.deepEqual(s, [6, 13, 19, 25]); check(h, s, 6);
});

test('newsSlots: random feeds always keep the rules; an all-police feed gets no ads', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 300; k++) {
    const flags = Array.from({ length: 1 + Math.floor(rnd() * 60) }, () => rnd() < 0.25);
    check(flags, A.newsSlots(flags, 6), 6);
  }
  assert.deepEqual(A.newsSlots(Array(30).fill(true), 6), []);
});

test('fill(news): samples while unsold, real campaigns when present, nothing on Obituaries', () => {
  assert.equal(A.fill('news', [], NOW, ON).type, 'sample');
  assert.equal(A.fill('news', [], NOW, { on: false, ads: [] }).type, 'house');
  assert.equal(A.fill('obits', [], NOW, ON), null);
  assert.ok(!A.AD_TABS.includes('obits'));
});

test('page wiring: News only, no search, Breaking first and ad-free, full-row ad card, no house unit in the feed', () => {
  const r = html.slice(html.indexOf('var slots = {};'), html.indexOf('if (rest.length > shown.length)'));
  assert.match(r, /state\.cat === 'news' && !state\.q\.trim\(\)/);
  assert.match(r, /k === 'police' \|\| k === 'courts'/);
  assert.doesNotMatch(r, /matchMedia|cols/, 'no column-dependent cadence');
  assert.match(r, /TSNAds\.NEWS_EVERY\)/);
  assert.equal(html.split("listEl.classList.toggle('news-one', state.cat === 'news')").length, 3, 'set when the list and its loading skeleton render');
  assert.ok(!html.includes("matchMedia('(min-width:1440px)')"), 'no re-render on the two-column breakpoint');
  assert.ok(html.indexOf('brk.forEach') < html.indexOf('var slots = {};'), 'Breaking renders before the feed');
  const n = html.slice(html.indexOf('newsAd: function'), html.indexOf('adCard: function'));
  assert.match(n, /f\.type === 'house'\) return null/);
  assert.match(n, /UI\.adCard\('news'\)/);
  assert.ok(!html.includes('.list > .ad-card.ad-feed { max-width:none; }'), 'the feed card is a sized unit now (public/adsizes.js)');
  assert.match(html, /return UI\.sized\(sa, place\);/);
});

test('policy text: News ads, never next to Police & courts, none on Obituaries', () => {
  const legal = read('public/legal.html'), doc = read('docs/legal-review.md');
  assert.ok(legal.includes('never directly before or after a Police &amp; courts item'));
  assert.ok(legal.includes('There are no ads on Institutions, Obituaries'));
  assert.ok(!legal.includes('no ads on News'));
  assert.match(doc, /## Ads on News/); assert.match(doc, /^27\. /m);
});

test('layout: News is one column at every width, centered at a readable max width; other boards keep their columns', () => {
  const css = html.slice(html.indexOf('/* ---------- wide screens'), html.lastIndexOf('</style>'));
  assert.ok(css.includes('.list.news-one { grid-template-columns:1fr; max-width:var(--news-max); margin-left:auto; margin-right:auto; }'));
  assert.ok(html.includes('--news-max:960px;'));
  assert.ok(css.includes('.deal-grid, .job-grid { grid-template-columns:1fr 1fr 1fr; }'), 'jobs/deals unchanged');
  assert.ok(css.includes('.evx-day { grid-template-columns:1fr 1fr; }'), 'events unchanged');
  assert.ok(!read('public/legal.html').includes('two columns') && !read('README.md').includes('every 10th'));
});
