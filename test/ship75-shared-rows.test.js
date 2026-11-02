// ship75: one shared row (UI.row in app.js + the article.card.row.row CSS block) for every card list on the site.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('public/assets/app.js'), css = read('public/assets/app.css');
const P = 'article.card.row.row:not(.breaking):has(> .ca)';
const blk = css.slice(css.indexOf('/* ---------- ship74/ship75:'), css.indexOf('/* ---------- card spacing'));
const fnOf = name => { const i = app.indexOf('  function ' + name + '('); assert.ok(i > 0, name); return app.slice(i, app.indexOf('\n  }\n', i)); };

test('every card type is drawn by the one row component', () => {
  assert.match(app, /row: function \(o\) \{\s*var c = el\('article', 'card row'/);
  for (const f of ['dealCard', 'jobCard', 'obitCard', 'obitRow', 'cardBase']) assert.match(fnOf(f), /UI\.row\(\{/, f);
  assert.match(fnOf('eventCard'), /evxCard\(it, b\)/, 'events in search use the one event card (ship79)');
  assert.match(app, /var card = el\('article', big \? 'card breaking' : 'card row'\);/, 'News, Police & courts, institutions, county pages, saved');
  assert.match(read('api/_cards.js'), /'<article class="card' \+ \(big \? ' breaking' : ' row'\)/, 'server-drawn rows are the same rows');
  assert.match(app, /boardAd: function \(kind\)[\s\S]{0,300}UI\.adRow\(f\)/, 'our own board ads are rows too');
  assert.match(app, /var row = el\('article', 'card row ad-row ad-feed'\)/);
});

test('the row: picture column only with a picture, one-line headline, two-line preview, one fixed 40px bottom row, 24px icons', () => {
  const row = app.slice(app.indexOf('      row: function (o) {'), app.indexOf('      boardAd: function'));
  assert.match(row, /if \(o\.pic\) \{[\s\S]*?\} else a\.classList\.add\('noimg'\);/);
  assert.match(row, /h\.title = o\.title/);
  assert.match(row, /c\.style\.setProperty\('--nact', String\(nact\)\)/, 'room for exactly the buttons it has');
  assert.match(blk, new RegExp(P.replace(/[.()>:]/g, '\\$&') + ' \\.ca > \\.th \\{[^}]*align-self:center;'));
  assert.match(blk, /h2 \{ font-size:19px; line-height:28px; font-weight:500;[^}]*white-space:nowrap; overflow:hidden; text-overflow:ellipsis; \}/, 'one step bolder (400 -> 500), one line');
  assert.match(blk, /-webkit-line-clamp:2; line-clamp:2;/);
  assert.match(blk, /\.src \{ box-sizing:border-box; height:var\(--meta-h\);[^}]*flex-wrap:nowrap;/);
  assert.match(blk, /\.acts \.cl-ico \{[^}]*width:var\(--ico\); height:var\(--ico\);/, 'Report / Remove are 24px icons like heart and share');
  assert.match(blk, /\.bav \{ width:var\(--ico\); height:var\(--ico\);/, 'business avatars are the 24px logo size');
  assert.match(blk, /:is\(\.list, \.cl-list, \.evx-day, \.evx-sec\):has\(> \.card\.row\) \{ display:flex; flex-direction:column; gap:0; \}/, 'one row per line in every list');
  assert.doesNotMatch(css, /footer[^{]*\{[^}]*position:\s*fixed/);
});

test('bottom row matches the headline: same color and weight for name and time, icons in the headline color and a matching stroke', () => {
  const r = sel => { const i = blk.indexOf(P + sel + ' {'); assert.ok(i >= 0, sel); return blk.slice(i, blk.indexOf('}', i)); };
  assert.ok(blk.includes(P + ' { --row-ink:var(--foreground); --row-wt:500; --row-stroke:2.25; }'));
  assert.ok(blk.includes(P + ' h2 { color:var(--row-ink); font-weight:var(--row-wt); }'), 'headline uses the same tokens');
  assert.match(r(' .src :is(b:not(.ad-lab), .when)'), /color:var\(--row-ink\); font-weight:var\(--row-wt\);/);
  assert.match(r(' .acts :is(.like:not([aria-pressed="true"]), .share, .cl-ico)'), /color:var\(--row-ink\);/, 'a liked heart keeps its color');
  assert.match(r(' .acts :is(.like, .share, .cl-ico) svg'), /stroke-width:var\(--row-stroke\);/);
  assert.match(r(' .acts :is(.like, .share, .cl-ico):focus-visible'), /outline:2px solid/, 'focus stays visible');
});

test('per-type rules kept: obituaries one bottom row and no ads; police photo-free; labels only when informative; boards keep price and CTA', () => {
  assert.match(fnOf('obitRow'), /left: \[flowersLink\(it, 'span'\)\], when: w, acts: actRow\(sb, it\)/);
  assert.match(fnOf('obitCard'), /left: \[fl\]/);
  assert.match(app, /var spn = kind !== 'obit' && UI\.sponsor/);
  assert.ok(app.includes("var pic = safe ? '' : it.image;"));
  assert.match(fnOf('kick'), /filter\(Boolean\)/, 'empty label parts are dropped');
  assert.match(fnOf('cardBase'), /el\('b', 'cl-price', priceText\(it\.price\)\)/);
  assert.match(fnOf('jobCard'), /el\('a', 'ad-cta', 'Apply'\)/);
  assert.match(fnOf('dealCard'), /'deal-code'/);
});

test('phones: the county tag is hidden in the bottom row; desktop keeps it', () => {
  assert.match(css, /@media \(max-width:639\.98px\) \{ article\.card\.row\.row:not\(\.breaking\):has\(> \.ca\) \.src \.place \{ display:none; \} \}/);
  assert.match(app, /src\.appendChild\(el\('span', 'place', it\.place\)\)/, 'still drawn (shown from 640px)');
});

test('site rules: 8 functions, no Missouri', () => {
  assert.strictEqual(fs.readdirSync(path.join(__dirname, '..', 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.doesNotMatch(read('public/routes.js'), /missouri/);
});
