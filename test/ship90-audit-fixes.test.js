// ship90 audit: no repeated sample ad down the News feed, unique event ids, and the Advertise "opening soon" line once.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../public/adslots.js');
const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public', 'assets', 'app.js'), 'utf8');
const adv = fs.readFileSync(path.join(root, 'data', 'pages', 'advertise.html'), 'utf8');
const samples = JSON.parse(fs.readFileSync(path.join(root, 'public', 'sponsors.json'), 'utf8')).samples;

test('each News in-feed card gets a different sample, none matching a side ad', () => {
  for (let day = 0; day < 10; day++) {
    const now = Date.UTC(2026, 10, 4 + day, 18);
    const feed = [0, 1, 2, 3].map(n => A.fill('news', {}, now, samples, n).ad.name);
    assert.strictEqual(new Set(feed).size, feed.length, 'no repeats: ' + feed.join(', '));
    const rails = ['left', 'right'].map(s => A.railFill('news', s, [], now, samples).ad.name);
    rails.forEach(r => assert.ok(!feed.includes(r), r + ' is both a side ad and a feed card'));
  }
});

test('the first feed card is unchanged (nth 0 keeps the old pick)', () => {
  const now = Date.UTC(2026, 10, 4, 18);
  assert.strictEqual(A.fill('news', {}, now, samples, 0).ad.name, A.fill('news', {}, now, samples).ad.name);
  assert.strictEqual(A.nthOffset(5, 0, 8), 5);
});

test('the page passes a running index to each feed card', () => {
  assert.ok(js.includes('var ac = UI.newsAd(adN++);'));
  assert.ok(js.includes("TSNAds.fill('news', SPONSORS && SPONSORS.__cards, Date.now(), SPONSORS && SPONSORS.__samples, nth)"));
});

test('an event in "Popular this week" does not repeat the day card id', () => {
  assert.ok(js.includes("if (it.id && inDay !== false) c.id = 'ev-' + it.id;"));
});

test('Advertise says "paid Featured spots open soon" once, not on every card', () => {
  assert.strictEqual(adv.split('Post for free now; paid Featured spots open soon.').length - 1, 1);
  assert.ok(adv.includes('id="featured-soon" hidden'));
  assert.ok(adv.includes("$('featured-soon').hidden = false;"));
});
