'use strict';
// ship80: no repeated copy on any card (public/dedupe.js, used by the page and the server's pre-rendered rows).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const D = require('../public/dedupe.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const js = read('public/assets/app.js');

test('comparisons ignore case, accents, punctuation and spacing', () => {
  assert.ok(D.same('Ford Center', 'FORD  center.'));
  assert.ok(D.same('Café Arts', 'cafe-arts'));
  assert.ok(D.same('Police & Courts', 'police and courts'));
  assert.ok(D.has('Evansville man charged after crash', 'EVANSVILLE'));
  assert.ok(!D.has('Evansvilleans rally', 'Evansville'), 'whole words only');
});

test('preview: a lead that repeats the headline goes; nothing left, or only the headline start, hides it', () => {
  assert.strictEqual(D.preview('Road closed on Hwy 41', 'Road closed on Hwy 41. Crews expect it to reopen at 5.'), 'Crews expect it to reopen at 5.');
  assert.strictEqual(D.preview('Road closed on Hwy 41', 'ROAD CLOSED ON HWY 41!'), '');
  assert.strictEqual(D.preview('Road closed on Hwy 41 after crash', 'Road closed on Hwy 41'), '');
  assert.strictEqual(D.preview('Road closed', 'Crews are on scene.'), 'Crews are on scene.');
  assert.strictEqual(D.preview('', 'Text'), 'Text');
  assert.strictEqual(D.preview('Line cook', 'Line cook wanted. Nights and weekends.'), 'Line cook wanted. Nights and weekends.', 'a sentence that merely begins with the headline words stays whole');
  assert.strictEqual(D.preview('Line cook', 'Line cook: nights and weekends'), 'nights and weekends');
});

test('labels, towns, venues and sources: shown once', () => {
  assert.strictEqual(D.part('Institutions', 'Institutions'), '', 'a label equal to the tab');
  assert.strictEqual(D.part('Evansville', 'Evansville man charged'), '', 'a town already in the title');
  assert.strictEqual(D.part('Ford Center', 'Ford Center · Evansville'), '', 'via a source already in the venue');
  assert.strictEqual(D.part('Evansville', 'Victory Theatre, Evansville'), '', 'a town already in the venue');
  assert.strictEqual(D.part('Newburgh', 'Ford Center'), 'Newburgh');
  assert.deepStrictEqual(D.parts(['Music', 'Henderson', 'music'], 'Live in Henderson tonight'), ['Music']);
});

test('ads: the label and the name are not repeated in the words', () => {
  assert.strictEqual(D.lead('Sponsored: Fresh pizza daily', 'Sponsored'), 'Fresh pizza daily');
  assert.strictEqual(D.lead('Sponsored', 'Sponsored'), '');
  assert.strictEqual(D.lead('Sponsored events all week', 'Sponsored'), 'Sponsored events all week');
  assert.strictEqual(D.lead(D.preview('Tinmouth Bicycle Works', 'Tinmouth Bicycle Works - Tune-ups, repairs'), 'Sponsored'), 'Tune-ups, repairs');
});

test('wired in: shared row, news cards (page and server), kicker labels, events, every ad surface', () => {
  assert.ok(js.includes("otx = typeof o.text === 'string' && DX ? DX.preview(o.title, o.text) : o.text"), 'UI.row preview');
  assert.ok(js.includes('DD.parts(parts, it.title)'), 'kick(): no part twice or already in the title');
  assert.ok(js.includes('kick = DD.part(kick, tabL);') && js.includes('var sum = DD.preview(hTitle, it.summary);') && js.includes('if (DD.part(it.place, hTitle, it.source))'), 'makeCard');
  const cards = read('api/_cards.js');
  assert.ok(cards.includes("require('../public/dedupe.js')") && cards.includes('DD.preview(title, it.summary)') && cards.includes('DD.part(it.place, title, it.source)') && cards.includes('DD.part(RT.sectionLabel(kd, it.cat), o.tab)'));
  assert.ok(read('api/_tabpage.js').includes("C.cards(p, now, { news: 'News', institution: 'Institutions', obits: 'Obituaries' }[r.cat] || '')"));
  assert.ok(js.includes('if (DD.part(town, place)) bits.push(town);'), 'venue already names the town');
  assert.ok(js.includes("it.feed && DD.part(it.source, it.place, evxWhere(it), it.title) ? 'via ' + it.source : ''"), 'via only when new');
  assert.ok(js.includes("var dvis = inDay ? '' : rel || (hasPic ? evxDate(it.date, { weekday: 'short' }) : '');"), 'the day line skips what the badge/tile and heading show');
  assert.ok(js.includes("el('span', 'sr-only', evxDate(it.date, { weekday: 'long', month: 'long', day: 'numeric' }))"), 'full date kept for screen readers');
  assert.ok(js.includes("t.setAttribute('aria-hidden', 'true'); // the date is read from the day line"));
  for (const k of ["UI.adText(ad, 'Sponsored')", "UI.adText(sp, 'Sponsored')", "UI.adText(sm, 'Sample ad')", "UI.adText(ad, isS ? 'Sample ad' : 'Sponsored')", "adT(f.ad, 'Sample ad')", "adT(ad, 'Sponsored')"]) assert.ok(js.includes(k), k);
  assert.ok(read('scripts/build-assets.js').includes("'dedupe.js'") && read('package.json').includes('public/dedupe.js'));
});
