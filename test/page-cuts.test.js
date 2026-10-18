// Ship 20 cuts: no News sponsor line, no web-address line on cards, no tab counts, no fixed bottom bar,
// and the footer says "Headlines link to the original publisher" once with one Legal link.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const legal = fs.readFileSync(path.join(root, 'public/legal.html'), 'utf8');
const sponsors = JSON.parse(fs.readFileSync(path.join(root, 'public/sponsors.json'), 'utf8'));
const count = (s, re) => (s.match(re) || []).length;

test('the page script still parses', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length > 0);
  scripts.forEach(src => assert.doesNotThrow(() => new Function(src)));
});

test('no sponsor line on News/All and no sample news sponsor', () => {
  assert.ok(!/sp-news/.test(html));
  assert.ok(!/UI\.sponsor\('news'/.test(html));
  assert.ok(!('news' in sponsors.slots));
  assert.ok(sponsors.slots.events && sponsors.rails.left.length, 'Events sponsor bar and side rails stay');
});

test('news cards have no web-address line; tabs have no counts', () => {
  assert.ok(!/el\('span', 'lnk'\)/.test(html) && !/\.lnk\b/.test(html));
  const tabs = html.slice(html.indexOf('function renderTabs()'), html.indexOf("tabsEl.addEventListener('keydown'"));
  assert.ok(tabs.length > 100);
  assert.ok(!/'n'/.test(tabs) && !/String\(n\)/.test(tabs) && !/\.tab \.n\b/.test(html));
});

test('no fixed bottom bar and no space reserved for it', () => {
  assert.ok(!/sfoot/.test(html));
  assert.ok(!/padding:16px 16px 96px/.test(html));
});

test('footer: Legal, Advertise, Submit news and Unsubscribe once each; attribution once', () => {
  const foot = html.slice(html.indexOf('<div class="legal-foot">'), html.indexOf('</main>'));
  assert.strictEqual(count(html, /href="\/legal\.html"/g), 1);
  assert.strictEqual(count(html, /href="\/unsubscribe\.html"/g), 1);
  assert.ok(/id="adOpen">Advertise</.test(foot) && /id="snOpen">Submit news</.test(foot));
  assert.strictEqual(count(html, /link to the original publisher/gi), 1);
  assert.strictEqual(count(html, /link to their publishers/gi), 0);
  assert.ok(/accusation, not a conviction/.test(foot));
});

test('legal text matches: no bottom bar, Advertise is in the footer', () => {
  assert.ok(!/bottom bar|sticky bar|fixed bar/i.test(legal));
  assert.ok(/“Advertise” in the footer/.test(legal));
});
