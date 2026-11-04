// ship92: one card per story across outlets (names rule), and no sample ad twice on a page.
const test = require('node:test');
const assert = require('node:assert');
for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'REDIS_URL', 'EXTRA_FEEDS']) delete process.env[k];
const N = require('../api/news.js');
const A = require('../public/adslots.js');
const fs = require('fs');
const path = require('path');
const samples = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'sponsors.json'), 'utf8')).samples;
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'app.js'), 'utf8');

// as /api/news served them on 2026-11-04 (times UTC)
const LIVE = [
  ['owtimes', 'Kuegel defeats Castlen to become Daviess County judge-executive', '2026-11-04T06:26:41Z'],
  ['messinq', 'Kuegel upsets Castlen for judge-executive seat', '2026-11-04T06:15:00Z'],
  ['owtimes', 'Foster wins re-election as Daviess County PVA', '2026-11-04T06:14:19Z'],
  ['weht', 'Daviess County elects new judge executive', '2026-11-04T04:45:22Z'],
  ['messinq', 'Foster to continue as PVA', '2026-11-04T04:30:00Z'],
  ['weht', 'Timmy Dunn to serve as Henderson County Judge-Executive', '2026-11-04T04:17:36Z'],
  ['wfie', 'Daviess County voters choose Judge Executive, Owensboro Commission seats', '2026-11-04T04:01:52Z'],
  ['wfie', 'Henderson County elects new judge executive for first time in 10 years', '2026-11-04T03:22:43Z'],
  ['messinq', 'Kuegel upsets Castlen to win judge-executive race', '2026-11-04T02:00:00Z'],
  ['owtimes', 'King unseats Payne in DCPS District 2 school board race', '2026-11-04T05:00:00Z'],
  ['owtimes', 'Johnson, Luckett win re-election to OPS school board', '2026-11-04T05:05:00Z'],
  ['messinq', 'King unseats Payne on DCPS board; Luckett, Johnson reelected to OPS board', '2026-11-04T05:10:00Z'],
  ['owtimes', 'Payne wins open District Court seat; Quattrocchi retains judgeship', '2026-11-04T05:20:00Z'],
  ['messinq', 'Payne, Quattrocchi elected to district court seats', '2026-11-04T05:25:00Z'],
  ['degypt', 'Mike Bost defeats Fortier, remains in Congress', '2026-11-04T05:30:00Z'],
  ['weht', 'Mike Bost releases statement after election victory', '2026-11-04T05:40:00Z'],
];
const now = Date.parse('2026-11-04T16:00:00Z');
const src = id => ({ id, name: id, area: 'Owensboro' });
const run = rows => {
  const by = {};
  rows.forEach(([sid, title, at]) => { (by[sid] = by[sid] || []).push({ title, link: 'https://' + sid + '.example.com/' + encodeURIComponent(title), summary: '', image: '', published: new Date(at).toISOString(), source: sid, sourceId: sid }); });
  return N.combine(Object.keys(by).map(id => ({ source: src(id), items: by[id] })), now).filter(i => !i.isObit && !i.isEvent);
};

test('the live duplicates collapse to one card each, the earliest report', () => {
  const t = run(LIVE).map(i => i.sourceId + ': ' + i.title);
  assert.deepEqual(t.filter(x => /Kuegel/.test(x)), ['messinq: Kuegel upsets Castlen to win judge-executive race']);
  assert.deepEqual(t.filter(x => /Foster/.test(x)), ['messinq: Foster to continue as PVA']);
  assert.equal(t.filter(x => /Quattrocchi/.test(x)).length, 1);
});

test('different stories that share words or a name stay apart', () => {
  const t = run(LIVE).map(i => i.title);
  for (const keep of ['Daviess County elects new judge executive', 'Timmy Dunn to serve as Henderson County Judge-Executive',
    'Henderson County elects new judge executive for first time in 10 years', 'Daviess County voters choose Judge Executive, Owensboro Commission seats',
    'King unseats Payne in DCPS District 2 school board race', 'Johnson, Luckett win re-election to OPS school board',
    'King unseats Payne on DCPS board; Luckett, Johnson reelected to OPS board', 'Mike Bost defeats Fortier, remains in Congress',
    'Mike Bost releases statement after election victory']) assert.ok(t.includes(keep), keep);
  const no = [
    ['Timmy Dunn to serve as Henderson County Judge-Executive', 'Kuegel to serve as Daviess County Judge-Executive'],
    ['Foster wins re-election as Daviess County PVA', 'Foster care program expands in Daviess County'],
    ['Evansville Otters beat Washington Wild Things', 'Evansville Otters sign new pitcher'],
    ['Smith named Henderson police chief', 'Smith, Jones to face off for Owensboro mayor'],
    ['Payne wins open District Court seat; Quattrocchi retains judgeship', 'King unseats Payne in DCPS District 2 school board race'],
    ['Evansville Police Department Hosts Annual Toy Drive', 'Owensboro Police Department Hosts Annual Food Drive'],
  ];
  for (const [a, b] of no) assert.equal(N.sameNames(N.titleNames(a), N.titleNames(b)), false, a + ' / ' + b);
});

test('the names rule only joins stories within 36 hours', () => {
  const t = run([['owtimes', 'Foster wins re-election as Daviess County PVA', '2026-11-04T06:00:00Z'], ['messinq', 'Foster to continue as PVA', '2026-11-02T06:00:00Z']]);
  assert.equal(t.length, 2);
});

test('no sample twice on a page: News feed cards stop once the samples run out', () => {
  const day = Date.UTC(2026, 10, 4, 18);
  const rails = ['left', 'right'].map(s => A.railFill('news', s, [], day, samples).ad.name);
  const feed = []; for (let n = 0; n < 12; n++) { const f = A.fill('news', {}, day, samples, n); feed.push(f.type === 'sample' ? f.ad.name : f.type); }
  const shown = feed.filter(x => x !== 'none');
  assert.equal(new Set(shown.concat(rails)).size, shown.length + rails.length, 'all different: ' + shown.concat(rails).join(', '));
  assert.equal(shown.length + rails.length, samples.ads.length, 'every sample once');
  assert.ok(feed.slice(shown.length).every(x => x === 'none'), 'the rest are empty');
  // an empty slot draws nothing: the page's newsAd hands it to adRow, which returns null for anything but a valid ad or a sample
  assert.ok(app.includes("if (!isS && !(window.TSNAds && TSNAds.validAd(ad))) return null;"));
});

test('real paid ads are unchanged by the position', () => {
  const ad = { name: 'Real Co', text: 'Real words', url: 'https://real.example.com/' };
  const a = A.fill('news', { news: [ad] }, Date.UTC(2026, 10, 4, 18), samples, 0), b = A.fill('news', { news: [ad] }, Date.UTC(2026, 10, 4, 18), samples, 11);
  assert.equal(a.type, 'direct'); assert.deepEqual(a, b);
});
