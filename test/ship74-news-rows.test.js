// Ship 74: News story rows (CNN "Across our coverage" style): square thumbnail left only when there is a picture,
// bold section label, larger regular headline, then the source + time line. Server cards and app.js agree.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const RT = require('../public/routes.js');
const C = require('../api/_cards.js');

test('section labels from the source kind and the item category', () => {
  assert.equal(RT.sectionLabel('news'), '', 'plain News: no label');
  assert.equal(RT.sectionLabel('news', ''), '');
  assert.equal(RT.sectionLabel('news', 'Sports'), 'Sports');
  assert.equal(RT.sectionLabel('police'), 'Police & courts');
  assert.equal(RT.sectionLabel('courts', 'Sports'), 'Police & courts');
  assert.equal(RT.sectionLabel('obits'), 'Obituaries');
  assert.equal(RT.sectionLabel('events', 'Music'), 'Music');
  assert.equal(RT.sectionLabel('institution'), 'Institutions');
});

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

test('server rows: label, headline, preview, then source; sized lazy thumbnail only with a picture; police photo-free and labeled', () => {
  const h = C.cards(C.pick(view, 'news', NOW), NOW);
  const arts = h.split('<article').slice(1);
  assert.equal(arts.length, 3);
  const [a, b, c] = arts;
  assert.match(a, /<span class="kicker">Sports<\/span><h2 title="With picture">With picture<\/h2>/);
  assert.match(a, /<\/h2><p>A short preview\.<\/p><div class="src">/, 'preview under the headline, source line last');
  assert.match(a, /<img class="th"[^>]* width="112" height="112" src="https:\/\/img\.ex\/a\.jpg">/);
  assert.match(b, /<span class="kicker">Police &amp; courts<\/span>/);
  assert.doesNotMatch(b, /class="th"/); assert.match(b, /class="ca noimg"/); assert.match(b, /Charged or arrested, not convicted\./);
  assert.doesNotMatch(c, /kicker/); assert.match(c, /<div class="bd"><h2 title="Google fallback, no picture">Google fallback, no picture<\/h2><div class="src">/); assert.doesNotMatch(c, /class="th"/); assert.match(c, /class="ca noimg"/);
  // only the first picture loads eagerly (the LCP); later ones are lazy, all sized
  const pics = view.items.slice(0, 1).concat([{ ...view.items[0], id: 'a2', link: 'https://n.ex/a2', title: 'Second picture' }]);
  const two = C.cards(C.pick({ ...view, items: pics }, 'news', NOW), NOW);
  assert.match(two, /<img class="th" loading="eager"[^>]* width="112" height="112"[\s\S]*<img class="th" loading="lazy"[^>]* width="112" height="112"/);
});

test('app.js builds the same order and sizes (non-Breaking rows), keeping the Breaking card as it was', () => {
  const app = read('public/assets/app.js');
  assert.match(app, /var kick = !big && RT && RT\.sectionLabel \? RT\.sectionLabel\(kd, it\.cat\) : '';[\s\S]{0,260}?kick = DD\.part\(kick, tabL\);[^\n]*\s*if \(kick\) body\.appendChild\(el\('span', 'kicker', kick\)\);\s*var h2 = el\('h2', null, hTitle\);/);
  assert.match(app, /if \(!big\) \{ im\.width = 112; im\.height = 112; \}/);
  assert.match(app, /if \(big\) body\.insertBefore\(src, body\.firstChild\);\s*else body\.appendChild\(src\);/);
  assert.match(app, /var h2 = el\('h2', null, hTitle\); if \(!big\) h2\.title = hTitle;/);
  assert.ok(app.includes("var pic = safe ? '' : it.image;"), 'no photos on police items');
});

test('CSS: one shared row (ship75: every list); square rounded thumbnail; dividers; no fixed footer', () => {
  const css = read('public/assets/app.css');
  const blk = css.slice(css.indexOf('/* ---------- ship74/ship75:'), css.indexOf('/* ---------- card spacing'));
  assert.ok(blk.length > 200);
  for (const line of blk.split('\n').filter(l => /^\s*[.a:]/.test(l) && l.includes('{') && !/^\s*@/.test(l))) assert.match(line, /^\s*(article\.card\.row\.row(\.ad-row)?:not\(\.breaking\):has\(> \.ca\)|:is\(\.list, \.cl-list, \.evx-day, \.evx-sec\):has\(> \.card\.row\))/, line);
  assert.match(blk, /\.ca > \.th \{[^}]*width:var\(--pic\); height:var\(--pic\); aspect-ratio:1\/1; border-radius:8px; object-fit:cover;/);
  assert.match(blk, /--pic:96px/); assert.match(blk, /--pic:112px/);
  assert.match(blk, /border-bottom:1px solid var\(--gray-200\)/);
  assert.match(blk, /\.ca\.noimg \{ grid-template-columns:minmax\(0, 1fr\); \}/);
  assert.match(blk, /h2 \{ font-size:19px; line-height:28px; font-weight:500;[^}]*min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; \}/);
  assert.match(blk, /\.bd p:not\(\.cl-note\) \{ display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; overflow:hidden;/);
  assert.match(blk, /\.kicker \{[^}]*font-weight:700;/);
  assert.doesNotMatch(css, /footer[^{]*\{[^}]*position:\s*fixed/);
  // bottom line: source left (truncates), time right next to the heart + share (never truncates)
  // one fixed-height meta row at the bottom of every row: source left, time + heart + share right, one center axis
  assert.match(blk, /--meta-h:40px;/);
  assert.match(blk, /grid-template-rows:auto; row-gap:0;/, 'one grid row, so the text column reaches the bottom at every width');
  assert.match(blk, /\.src \{ box-sizing:border-box; height:var\(--meta-h\); min-height:var\(--meta-h\); margin-top:auto; padding-right:calc\(var\(--nact, 2\) \* \(var\(--ico\) \+ var\(--act-gap\)\)\); display:flex; align-items:center; flex-wrap:nowrap; min-width:0; overflow:hidden; \}/);
  assert.match(blk, /\.cf \{ position:absolute; right:0; bottom:var\(--sp-3\);[^}]*display:flex; align-items:center;[^}]*height:var\(--meta-h\);/);
  assert.match(blk, /padding:var\(--sp-4\) 0 var\(--sp-3\);/, 'the meta row and the buttons share the same bottom edge (--sp-3, ship80 tokens)');
  assert.match(blk, /\.src b \{ flex:0 1000 auto; min-width:min\(5\.5em, 40%\);/, 'the source name truncates first');
  assert.match(blk, /\.src b \{[^}]*text-overflow:ellipsis;/);
  assert.match(blk, /\.src \.when \{ flex:none; margin-left:auto;[^}]*white-space:nowrap; \}/);
});

test('News ads (our own: campaigns and samples) are drawn as story rows; no outside ad network code', () => {
  const app = read('public/assets/app.js'), css = read('public/assets/app.css');
  assert.match(app, /if \(!f \|\| f\.type === 'house'\) return null;\s*return UI\.adRow\(f\);/, 'News feed ads go through adRow');
  const m = /adRow: function \(f\) \{[\s\S]*?\n      \},/.exec(app); assert.ok(m, 'adRow exists');
  const fn = m[0];
  assert.match(fn, /el\('article', 'card row ad-row ad-feed'\)/);
  assert.match(fn, /UI\.sampleAd\('ca', ad\) : UI\.adLink\('ca', ad\)/, 'same link rules (rel=sponsored, counting) as before');
  assert.match(fn, /im\.className = 'th'; im\.width = 112; im\.height = 112;/, 'square sized thumbnail');
  assert.match(fn, /else a\.classList\.add\('noimg'\)/, 'no empty box without a picture');
  assert.match(fn, /h\.title = ad\.name/); assert.match(fn, /el\('p', null, tx\)/);
  assert.match(fn, /el\('b', 'ad-lab', isS \? 'Sample ad' : 'Sponsored'\)/, 'labeled where the source name goes');
  assert.doesNotMatch(fn, /UI\.sized|TSNSizes/, 'not forced into IAB banner sizes');
  // the row CSS applies to ad rows too (same selectors), with the label and call to action in the fixed bottom row
  const blk = css.slice(css.indexOf('/* ---------- ship74/ship75:'), css.indexOf('/* ---------- card spacing'));
  assert.match(fn, /row\.style\.setProperty\('--nact', '0'\)/, 'no buttons to make room for');
  assert.match(blk, /\.ad-row:not\(\.breaking\):has\(> \.ca\) \.src \.ad-cta \{ flex:none; margin-left:auto;/);
  // placement rules unchanged: never next to Police & courts or Breaking, none in search, none on Obituaries
  assert.match(app, /TSNAds\.newsSlots\(shown\.map\(function \(it\) \{ var k = kindOf\(it\.sourceId\); return k === 'police' \|\| k === 'courts'; \}\), TSNAds\.NEWS_EVERY\)/);
  assert.match(app, /if \(state\.cat === 'news' && !state\.q\.trim\(\) && window\.TSNAds\)/);
  assert.match(app, /var spn = kind !== 'obit' && UI\.sponsor/);
  // no third-party ad network code anywhere the site ships
  for (const f of ['public/assets/app.js', 'public/adslots.js', 'public/adsizes.js', 'data/pages/index.html'])
    assert.doesNotMatch(read(f), /adsbygoogle|googlesyndication|doubleclick|googletag|prebid|amazon-adsystem|taboola|outbrain/, f);
});

test('News rows: picture in its own centered column; heart and share are the logo size with even spacing on one fixed row', () => {
  const css = read('public/assets/app.css');
  const blk = css.slice(css.indexOf('/* ---------- ship74/ship75:'), css.indexOf('/* ---------- card spacing'));
  const S = 'article.card.row.row:not(.breaking):has(> .ca)';
  const rule = sel => { const i = blk.indexOf(S + sel + ' {'); assert.ok(i >= 0, sel); return blk.slice(i, blk.indexOf('}', i)); };
  assert.match(rule(''), /--ico:24px; --act-gap:12px;/);
  assert.match(rule(' .ca'), /grid-template-columns:var\(--pic\) minmax\(0, 1fr\)/, 'own picture column');
  assert.match(rule(' .ca.noimg'), /grid-template-columns:minmax\(0, 1fr\)/, 'full width text without a picture');
  assert.match(rule(' .ca > .th'), /align-self:center;/, 'picture vertically centered in the row');
  assert.match(rule(' .av'), /width:var\(--ico\); height:var\(--ico\)/, 'logo size');
  const btn = rule(' .acts :is(.like, .share)');
  assert.match(btn, /width:var\(--ico\); min-width:var\(--ico\); height:var\(--ico\); padding:0;/, 'heart and share = logo size');
  assert.match(rule(' .acts .like span'), /display:none/, 'no count widening the heart (it stays in the aria-label)');
  assert.match(rule(' .acts'), /gap:var\(--act-gap\); flex-wrap:nowrap;/, 'even gap heart-share');
  assert.match(rule(' .src .when'), /padding-left:var\(--act-gap\)/, 'same gap time-heart');
  assert.match(blk.slice(blk.indexOf(S + ' .src { box-sizing')), /^[^}]*padding-right:calc\(var\(--nact, 2\) \* \(var\(--ico\) \+ var\(--act-gap\)\)\); display:flex; align-items:center; flex-wrap:nowrap;/, 'room for exactly the row\'s buttons (--nact, set by UI.row) and their gaps, one row');
  assert.match(rule(' .cf'), /height:var\(--meta-h\)/);
  assert.match(blk, /@media \(max-width:389\.98px\) \{[^@]*--pic:72px; --act-gap:10px;/, 'small phones: smaller picture so the row still fits from 320px');
  assert.match(rule(' .acts :is(.like, .share)'), /inset:auto; transform:none; margin:0;/, 'not pulled out of the row by the base heart position');
});
