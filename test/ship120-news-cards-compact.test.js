'use strict';
// ship120: compact news cards on large screens; phones stay stacked photo-led with 44px taps.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const css = read('public/assets/app.css');

function block(re) {
  const m = css.match(re);
  assert.ok(m, String(re));
  return m[0];
}

test('ship120: large-screen news cards cap the photo and tighten type; 44px taps stay for coarse pointers', () => {
  assert.match(css, /@media \(min-width:900px\) \{\s*:root \{ --news-max:720px; \}/);
  assert.match(css, /@media \(min-width:900px\) \{[\s\S]*\.list\.news-one \{ max-width:var\(--news-max\)/);
  assert.match(css, /@media \(min-width:900px\) \{[\s\S]*\.ns-pic \{[\s\S]*max-height:300px/);
  assert.match(css, /@media \(min-width:900px\) \{[\s\S]*article\.card\.news-story h2 \{ font-size:17px/);
  const fine = block(/@media \(min-width:900px\) and \(pointer:fine\) \{[\s\S]*?min-height:32px[\s\S]*?\}/);
  assert.match(fine, /min-height:32px/);
  assert.match(fine, /pointer:fine/);
  assert.equal((css.match(/@media \(min-width:900px\) and \(pointer:coarse\)/) || []).length, 0);
  const baseFoot = css.slice(css.indexOf('article.card.news-story .ns-foot :is(.like, .share, .cm-btn, .sv-btn) {'));
  assert.match(baseFoot.slice(0, 400), /min-height:44px/);
  assert.match(css, /article\.card\.news-story \.ns-pic \{ display:block; width:100%;[\s\S]*aspect-ratio:16\/9/);
});

test('ship120: compact rules do not apply below 900px; sheet and comments keep 44px', () => {
  assert.match(css, /\.st-sheet \.st-x \{ width:44px; height:44px; min-height:44px/);
  assert.match(css, /dialog\.cm-sheet \.st-x, dialog\.sv-sheet \.st-x \{[\s\S]*min-height:44px/);
  assert.match(css, /\.cm-post \{[\s\S]*min-height:44px/);
  const api = fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.equal(api.length, 8);
});
