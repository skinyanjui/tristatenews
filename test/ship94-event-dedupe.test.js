// ship94: one event listed by Ticketmaster and by the venue's own calendar is one card; the listing with a photo
// and/or a ticket link wins. Different events at one venue, or one event on two dates, stay separate.
const test = require('node:test');
const assert = require('node:assert');
const { combine } = require('../api/news.js');

const NOW = Date.parse('2026-11-04T22:00:00-06:00');
const ev = (o) => Object.assign({ isEvent: true, summary: '', image: '', link: 'https://example.org/e' }, o);
const run = (...lists) => combine(lists.map(items => ({ items })), NOW).filter(x => x.isEvent);

const UE_TM = ev({ sourceId: 'ev-tm', title: 'University of Evansville Aces Mens Basketball vs. Chicago State Cougars', published: '2026-12-01T01:00:00Z', venue: 'Ford Center \u00B7 Evansville', image: 'https://s1.ticketm.net/x.jpg', link: 'https://www.ticketmaster.com/ue-aces/event/1', fromPrice: 12 });
const UE_FORD = ev({ sourceId: 'ev-ford', title: "UE Aces Men's Basketball vs Chicago State", published: '2026-12-01T01:00:00.000Z', venue: 'Ford Center', link: 'https://gopurpleaces.com/sports/2021/6/23/ticket-information' });
const TOBY_TM = ev({ sourceId: 'ev-tm', title: 'TOBYMAC, THIRD DAY, CHRIS TOMLIN', published: '2026-11-07T01:00:00Z', venue: 'Ford Center \u00B7 Evansville, Indiana', link: 'https://www.ticketmaster.com/tobymac/event/2' });
const TOBY_FORD = ev({ sourceId: 'ev-ford', title: 'TOBYMAC, CHRIS TOMLIN, AND THIRD DAY', published: '2026-11-07T01:00:00.000Z', venue: 'Ford Center', image: 'https://fordcenter.com/toby.jpg' });

test('ship94: UE vs Chicago State (Nov 30) from Ticketmaster and the Ford Center is one event, the one with photo and tickets', () => {
  for (const order of [[UE_FORD, UE_TM], [UE_TM, UE_FORD]]) {
    const out = run([order[0]], [order[1]]);
    assert.equal(out.length, 1);
    assert.equal(out[0].sourceId, 'ev-tm');
  }
});

test('ship94: TobyMac (Nov 6): the photo beats a ticket link alone, in either order', () => {
  for (const order of [[TOBY_TM, TOBY_FORD], [TOBY_FORD, TOBY_TM]]) {
    const out = run([order[0]], [order[1]]);
    assert.equal(out.length, 1);
    assert.equal(out[0].sourceId, 'ev-ford');
  }
});

test('ship94: different events stay separate', () => {
  // same venue and time, different show
  assert.equal(run([UE_TM], [ev({ sourceId: 'ev-ford', title: 'River City Classic Aces VS USI', published: UE_TM.published, venue: 'Ford Center' })]).length, 2);
  // same show, another venue
  assert.equal(run([TOBY_TM], [ev({ ...TOBY_FORD, venue: 'Victory Theatre' })]).length, 2);
  // same show, another night
  assert.equal(run([TOBY_TM], [ev({ ...TOBY_FORD, published: '2026-11-08T01:00:00.000Z' })]).length, 2);
  // no venue on one listing: not merged on title alone
  assert.equal(run([TOBY_TM], [ev({ ...TOBY_FORD, venue: '' })]).length, 2);
});

// ---- the rest of ship94 ----
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('ship94: Advertise cards carry no "Opening soon" tag; the page says it once', () => {
  const h = read('data/pages/advertise.html');
  assert.ok(h.includes("x.purchasable ? 'Buy from your post' : '',") && h.includes("if (tag) c.appendChild(el('span', 'tag', tag));"));
  assert.ok(h.includes('id="featured-soon" hidden>Post for free now; paid Featured spots open soon.</p>'));
  assert.ok(!/'Opening soon'/.test(h));
});

test('ship94: outlet crime stories show no photo; other news keeps its picture', () => {
  const app = read('public/assets/app.js');
  const C = require('../public/crime.js');
  for (const t of ['Convicted Evansville murderer to be executed in Indiana tonight', 'Registered sex offender arrested for recording children',
    'Woman charged with hiding income to pocket $12K in illegal SNAP funds', 'Evansville man charged with rape', 'Two arrested after reported bat attack, stabbing',
    'Police investigating shooting on Lincoln Ave',
    'Woman allegedly killed by husband texted sister she was \u2018not good\u2019 days before her body was found']) assert.ok(C.crimeTitle(t), t);
  for (const t of ['Mater Dei band preps for state', 'Aces shooting woes continue', 'New Kroger Marketplace opens Thursday on Fairview Drive',
    'DNC Chairman shares party message', 'SIU to host Nov. 13 small business workshop',
    'Storm kills 3 in western Kentucky after overnight flooding', 'Pacers kill off the Heat in overtime', 'Heat wave deaths climb in the Ohio Valley']) assert.ok(!C.crimeTitle(t), t);
  assert.ok(/var pic = safe \? '' : it\.image;\s*if \(crimeStory\(it\)(?: \|\| obitStory\(it\))?\) pic = '';/.test(app), 'Police & courts still photo-free by source kind, crime/obit stories by headline');
});

test('ship94: phone headlines get up to three lines, the preview one; desktop unchanged', () => {
  const css = read('public/assets/app.css');
  const m = css.slice(css.indexOf('/* ship94:'));
  const blk = m.slice(0, m.indexOf('\n}') + 2);
  assert.ok(blk.includes('@media (max-width:599.98px) {'));
  assert.ok(/h2 \{[^}]*white-space:normal;[^}]*-webkit-line-clamp:3; line-clamp:3;/.test(blk));
  assert.ok(/\.bd p:not\(\.cl-note\) \{ -webkit-line-clamp:1; line-clamp:1; \}/.test(blk));
  assert.ok(css.indexOf('/* ship94:') < css.indexOf('/* ---------- card spacing'), 'font rules stay above the spacing-only block');
});
