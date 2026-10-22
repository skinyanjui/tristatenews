// In-feed ads on News: about every 6th story (every 10th in two columns), a full-row card, never directly before or
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
// The rule every slot must keep: on a row boundary, no police item in the row above or below, not first or last.
function check(flags, slots, every, cols) {
  let prev = -Infinity;
  for (const p of slots) {
    assert.ok(p > 0 && p < flags.length, 'not first or last: ' + p);
    assert.equal(p % cols, 0, 'row boundary: ' + p);
    for (let i = Math.max(0, p - cols); i < Math.min(flags.length, p + cols); i++) assert.ok(!flags[i], 'next to police at ' + p);
    assert.ok(p - prev >= every, 'spacing ' + prev + '→' + p); prev = p;
  }
}

test('newsSlots: one column, every 6th story', () => {
  assert.equal(A.NEWS_EVERY, 6); assert.equal(A.NEWS_EVERY_WIDE, 10);
  assert.deepEqual(A.newsSlots(none(30), 6, 1), [6, 12, 18, 24]);
  assert.deepEqual(A.newsSlots(none(6), 6, 1), [], 'never after the last story');
  assert.deepEqual(A.newsSlots(none(7), 6, 1), [6]);
  assert.deepEqual(A.newsSlots([], 6, 1), []);
});

test('newsSlots: two columns, every 10th story on a row boundary (at most one per screen)', () => {
  assert.deepEqual(A.newsSlots(none(40), 10, 2), [10, 20, 30]);
  assert.deepEqual(A.newsSlots(none(40), 9, 2), [10, 20, 30], 'rounded up to whole rows');
});

test('newsSlots: shifts past Police & courts items in one column', () => {
  const f = none(30); f[5] = true;                // story right before slot 6
  let s = A.newsSlots(f, 6, 1); assert.equal(s[0], 7); check(f, s, 6, 1);
  const g = none(30); g[6] = g[7] = true;         // stories right after slot 6
  s = A.newsSlots(g, 6, 1); assert.equal(s[0], 9); check(g, s, 6, 1);
});

test('newsSlots: shifts past Police & courts items in two columns, checking the whole row above and below', () => {
  const f = none(40); f[9] = true;                // row above slot 10
  let s = A.newsSlots(f, 10, 2); assert.equal(s[0], 12); check(f, s, 10, 2);
  const g = none(40); g[11] = true;               // row below slot 10, and the row above 12
  s = A.newsSlots(g, 10, 2); assert.equal(s[0], 14); check(g, s, 10, 2);
});

test('newsSlots: random feeds always keep the rules; an all-police feed gets no ads', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 300; k++) {
    const flags = Array.from({ length: 1 + Math.floor(rnd() * 60) }, () => rnd() < 0.25);
    check(flags, A.newsSlots(flags, 6, 1), 6, 1); check(flags, A.newsSlots(flags, 10, 2), 10, 2);
  }
  assert.deepEqual(A.newsSlots(Array(30).fill(true), 6, 1), []);
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
  assert.match(r, /min-width:1440px/);
  assert.ok(html.indexOf('brk.forEach') < html.indexOf('var slots = {};'), 'Breaking renders before the feed');
  const n = html.slice(html.indexOf('newsAd: function'), html.indexOf('adCard: function'));
  assert.match(n, /f\.type === 'house'\) return null/);
  assert.match(n, /UI\.adCard\('news'\)/);
  assert.match(html, /\.list > \.ad-card\.ad-feed \{ max-width:none; \}/);
});

test('policy text: News ads, never next to Police & courts, none on Obituaries', () => {
  const legal = read('public/legal.html'), doc = read('docs/legal-review.md');
  assert.ok(legal.includes('never directly before or after a Police &amp; courts item'));
  assert.ok(legal.includes('There are no ads on Institutions, Obituaries'));
  assert.ok(!legal.includes('no ads on News'));
  assert.match(doc, /## Ads on News/); assert.match(doc, /^27\. /m);
});
