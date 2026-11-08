'use strict';
// ship117: photo-led news cards + preview sheet (approved concept). Not Jobs/Deals.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const js = read('public/assets/app.js');
const css = read('public/assets/app.css');
const cards = read('api/_cards.js');
const API = path.join(root, 'api');
const C = require('../api/_cards.js');
const RT = require('../public/routes.js');

const mk = js.slice(js.indexOf('function makeCard('), js.indexOf('function obitRow('));
const st = js.slice(js.indexOf('function storySheet('), js.indexOf('function hostName('));
const fnOf = name => {
  const i = js.indexOf('  function ' + name + '(');
  assert.ok(i > 0, name);
  return js.slice(i, js.indexOf('\n  }\n', i));
};

const NOW = Date.parse('2026-11-01T20:00:00Z');
const view = {
  updatedAt: '2026-11-01T19:55:00Z',
  sources: [{ id: 'n', name: 'N', kind: 'news', logo: 'https://l/n.png' }, { id: 'p', name: 'P', kind: 'police' }],
  items: [
    { id: 'a', title: 'With picture', summary: 'A short preview.', link: 'https://n.ex/a', image: 'https://img.ex/a.jpg', published: '2026-11-01T19:00:00Z', source: 'N', sourceId: 'n', cat: 'Sports' },
    { id: 'b', title: 'Annual report published', link: 'https://p.ex/b', image: 'https://img.ex/mug.jpg', published: '2026-11-01T18:00:00Z', source: 'P', sourceId: 'p', arrest: true },
    { id: 'c', title: 'Google fallback, no picture', link: 'https://n.ex/c', published: '2026-11-01T17:00:00Z', source: 'N', sourceId: 'n' }
  ]
};

test('ship117: non-Breaking news cards are stacked photo-led, not the CNN row', () => {
  assert.match(mk, /el\('article', big \? 'card breaking' : 'card news-story'/);
  assert.match(cards, /class="card news-story"/);
  assert.match(mk, /el\('div', big \? 'src' : 'ns-src'\)/);
  assert.match(mk, /el\('img', big \? 'th' : 'ns-pic'\)/);
  assert.match(mk, /im\.addEventListener\('error', function \(\) \{ im\.remove\(\)/);
  assert.ok(!/if \(!big\) \{ im\.width = 112; im\.height = 112; \}/.test(mk));
  assert.match(mk, /if \(!big\) \{ im\.width = 1200; im\.height = 675; \}/);
  assert.match(css, /article\.card\.news-story/);
  assert.match(css, /\.news-story \.ns-pic \{[^}]*width:100%/);
  assert.match(css, /\.news-story \.ns-pic \{[^}]*aspect-ratio:16\/9/);
  assert.match(css, /\.news-story \.ns-foot [^{]*min-height:44px|\.news-story \.ns-foot :is\(\.like, \.share\) \{[^}]*min-height:44px/);
  assert.ok(!/EXAMPLE STORY/.test(js + cards));
  assert.ok(!/bookmark|comment-btn|ns-comment|ns-save/.test(mk));
});

test('ship117: server first-paint matches: publisher then photo then headline; police photo-free; no-image compact', () => {
  const h = C.cards(C.pick(view, 'news', NOW), NOW);
  const arts = h.split('<article').slice(1);
  assert.equal(arts.length, 3);
  const [a, b, c] = arts;
  assert.match(a, /class="card news-story"/);
  assert.match(a, /<div class="ns-src">[\s\S]*<img class="ns-pic"/);
  assert.match(a, /<span class="kicker">Sports<\/span>/);
  assert.match(a, /<img class="ns-pic"[^>]* width="1200" height="675" src="https:\/\/img\.ex\/a\.jpg"/);
  assert.doesNotMatch(a, /width="112" height="112"/);
  assert.match(b, /class="card news-story"/);
  assert.match(b, /<span class="kicker">Police &amp; courts<\/span>/);
  assert.doesNotMatch(b, /class="ns-pic"/);
  assert.doesNotMatch(b, /mug\.jpg/);
  assert.match(b, /Charged or arrested, not convicted\./);
  assert.match(c, /class="ns-ca noimg"|class="ca ns-ca noimg"|class="ca noimg"/);
  assert.doesNotMatch(c, /class="ns-pic"/);
  assert.equal(RT.sectionLabel('news', 'Sports'), 'Sports');
});

test('ship117: sheet is publisher, photo, full-contrast summary, red Continue; swipe and focus kept', () => {
  assert.match(st, /el\('dialog', 'st-sheet'/);
  assert.match(st, /showModal/);
  assert.match(st, /back\.focus|c\.focus/);
  assert.match(st, /html\.st-open|st-open/);
  assert.match(st, /'Continue to ' \+ \(it\.source \|\| 'the story'\)/);
  assert.match(st, /go\.target = '_blank'/);
  assert.ok(!/fetch\(/.test(st));
  assert.ok(!/bookmark|st-comment/.test(st));
  assert.match(css, /\.st-sheet \.st-sum \{[^}]*color:var\(--foreground\)/);
  assert.match(css, /\.st-sheet \.st-go \{[^}]*(--wordmark-now|--red)/);
  assert.match(css, /\.st-x \{[^}]*min-height:44px|\.st-sheet \.st-x \{[^}]*width:44px/);
  assert.match(st, /ArrowRight/);
  assert.match(st, /ST_SWIPE_GO/);
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
});

test('ship117: Jobs/Deals stay stacked; news-one list keeps card gap (ads compatible)', () => {
  assert.ok(!/UI\.row\(/.test(fnOf('jobCard')));
  assert.ok(!/UI\.row\(/.test(fnOf('dealCard')));
  assert.match(css, /:is\(\.list, \.cl-list, \.evx-day, \.evx-sec\):has\(> \.card\.row\):not\(\.job-grid\):not\(\.deal-grid\):not\(\.news-one\)/);
  assert.match(js, /BOARD_SAMPLES = \{ on: true/);
});
