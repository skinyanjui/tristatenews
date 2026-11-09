'use strict';
// ship120: social-feed news cards on large screens; phones stay stacked photo-led with 44px taps.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const css = read('public/assets/app.css');
const js = read('public/assets/app.js');
const cards = read('api/_cards.js');

function block(re) {
  const m = css.match(re);
  assert.ok(m, String(re));
  return m[0];
}

test('ship120: large-screen news cards are a social feed; 44px taps stay for coarse pointers', () => {
  assert.match(css, /@media \(min-width:900px\) \{\s*:root \{ --news-max:600px; \}/);
  assert.match(css, /@media \(min-width:900px\) \{[\s\S]*\.list\.news-one \{ max-width:var\(--news-max\)/);
  assert.match(css, /@media \(min-width:900px\) \{[\s\S]*\.ns-pic \{[\s\S]*max-height:320px/);
  assert.match(css, /@media \(min-width:900px\) \{[\s\S]*width:calc\(100% - 24px\)/);
  assert.match(css, /@media \(min-width:900px\) \{[\s\S]*border-radius:12px; border:1px solid var\(--gray-200\)/);
  assert.match(css, /@media \(min-width:900px\) \{[\s\S]*article\.card\.news-story h2 \{ font-size:15px/);
  assert.match(css, /@media \(min-width:900px\) \{[\s\S]*\.ns-src \.av \{[\s\S]*width:40px; height:40px/);
  assert.match(css, /\.ns-more \{ display:none; \}/);
  assert.match(css, /@media \(min-width:900px\) \{[\s\S]*\.ns-more \{ display:block/);
  const fine = block(/@media \(min-width:900px\) and \(pointer:fine\) \{[\s\S]*?min-height:40px[\s\S]*?\}/);
  assert.match(fine, /min-height:40px/);
  assert.match(fine, /pointer:fine/);
  assert.doesNotMatch(css, /min-height:34px/);
  assert.equal((css.match(/@media \(min-width:900px\) and \(pointer:coarse\)/) || []).length, 0);
  const baseFoot = css.slice(css.indexOf('article.card.news-story .ns-foot :is(.like, .share, .cm-btn, .sv-btn) {'));
  assert.match(baseFoot.slice(0, 400), /min-height:44px/);
  assert.match(css, /article\.card\.news-story \.ns-pic \{ display:block; width:100%;[\s\S]*aspect-ratio:16\/9/);
  assert.match(js, /function moreBtn\(it\)/);
  assert.match(js, /if \(!big\) card\.appendChild\(moreBtn\(it\)\)/);
  assert.match(cards, /class="ns-more"/);
  assert.match(cards, /Open at publisher/);
  assert.match(js, /Open at publisher/);
});

test('ship120: compact rules do not apply below 900px; sheet and comments keep 44px', () => {
  assert.match(css, /\.st-sheet \.st-x \{ width:44px; height:44px; min-height:44px/);
  assert.match(css, /dialog\.cm-sheet \.st-x, dialog\.sv-sheet \.st-x \{[\s\S]*min-height:44px/);
  assert.match(css, /\.cm-post \{[\s\S]*min-height:44px/);
  const api = fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.equal(api.length, 8);
});
