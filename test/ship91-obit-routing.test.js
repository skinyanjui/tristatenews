// ship91: death notices in county weeklies' news feeds go to Obituaries (not News), deduped against obituary feeds.
const test = require('node:test');
const assert = require('node:assert');
for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'REDIS_URL', 'EXTRA_FEEDS']) delete process.env[k];
const N = require('../api/news.js');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'app.js'), 'utf8');
const ago = h => new Date(Date.now() - h * 36e5).toISOString();

// as /api/news served them on 2026-11-04
const LIVE = [
  ['spencerco', 'Martha Nell DeWitt, 81', 'https://spencercountyonline.com/martha-nell-dewitt-81/', 'Martha Nell DeWitt, 81, passed away on November 3, 2026, at Deaconess Gateway Hospital in Newburgh.She was born on June 28, 1945, the daughter of Sherman and Em'],
  ['spencerco', 'William A. Stewart, 73, Hawesville, KY', 'https://spencercountyonline.com/william-a-stewart-73-hawesville-ky/', 'William (Bill) Allan Stewart 73 of Hawesville, KY, passed away peacefully on November 1, 2026.'],
  ['poseynews', 'Rita E. McKinney', 'https://www.theposeycountynews.com/post/rita-e-mckinney', 'Rita E. Reich McKinney, 92, of Mt. Vernon, Ind., passed away October 30, 2026 at Mt. Vernon Nursing and Rehabilitation. She was born August 3, 1934 in Mt. Verno'],
  ['poseynews', 'Chasity Harnishfeger', 'https://www.theposeycountynews.com/post/chasity-harnishfeger', 'Chasity Caroline (Brandenstein) Harnishfeger, 43, of Poseyville, Ind., born December 9, 1982, to Russell Keith and Tamara Lou (Bridges) Brandenstein in Evansvil'],
  ['leadernews', 'Gayle Travis Parson, Sr.', 'https://ky-leadernews.com/gayle-travis-parson-sr/', 'BREMEN- Gayle Travis Parsons Sr., 76, of Bremen went home to be with Jesus on November 2, 2026 at Riverside Care and Rehabilitation Center, surrounded by his fa'],
  ['leadernews', 'Patricia Kathleen Ledbetter', 'https://ky-leadernews.com/patricia-kathleen-ledbetter/', 'Greenville \u2013 Patricia Kathleen Ledbetter, 87, of Greenville, died Friday, October 30, 2026 at 1:46p.m. at her residence in Greenville.'],
];
const it = (sid, title, link, summary) => ({ title, link, summary, image: 'https://x.example/p.jpg', published: ago(3), source: sid, sourceId: sid });

test('the live death notices are obituaries', () => {
  for (const [sid, t, l, s] of LIVE) assert.equal(N.looksLikeObit(it(sid, t, l, s)), true, t);
});

test('URL paths /obituaries/ and /obits/ are obituaries', () => {
  for (const l of ['https://paper.example/obituaries/jane-doe/', 'https://paper.example/obits/jane-doe', 'https://paper.example/news/obituaries-2026/x'])
    assert.equal(N.looksLikeObit({ title: 'A story', summary: '', link: l }), true, l);
  assert.equal(N.looksLikeObit({ title: 'A story', summary: '', link: 'https://paper.example/news/obitsforce-robotics' }), false);
});

test('real news headlines do not match', () => {
  const no = [
    ['Foster to continue as PVA', 'Muhlenberg County PVA Foster, 54, of Greenville will continue in the role.'],
    ['New Harmony Bridge funds face another uncertain lag', 'By Lois Mittino Gray All is not lost for getting possible federal funding.'],
    ['PC 4-H recognizes members, volunteers at annual banquet', 'Celeste and Isaac Eisterhold display their Volunteer Service Awards.'],
    ['Bob Jones', 'Bob Jones, 45, of Henderson, was arrested Tuesday and charged with burglary.'],
    ['Tracy Lawrence', 'Tracy Lawrence, 58, of Nashville, will perform at the Victory Theatre on Thursday.'],
    ['Sarah Miller', 'Sarah Miller, 17, of Boonville, was named Student of the Month. She was born in Evansville.'],
    ['Owensboro Health', 'Owensboro Health opens a new clinic.'],
    ['Evansville Otters', 'The Otters, 2025 champions, announced their schedule.'],
    ['Mayor Stephanie Terry', 'Mayor Stephanie Terry, 50, of Evansville, spoke Tuesday.'],
    ['Henderson County Fair, 2026', 'The fair returns in July.'],
    ['Class of 1976, 50', 'The reunion is set.'],
    ['Election results: Smith, 62%', 'Smith won the race.'],
    ['Jasper man, 34, arrested after chase', 'Police say.'],
  ];
  for (const [title, summary] of no) assert.equal(N.looksLikeObit({ title, summary, link: 'https://news.example.com/story' }), false, title);
});

test('a notice from a news feed goes to Obituaries as ob-<source>, not to News, with no picture', () => {
  const spencerco = { id: 'spencerco', name: 'Spencer County Online', area: 'Rockport', url: 'https://spencercountyonline.com/feed/' };
  const [sid, t, l, s] = LIVE[0];
  const out = N.combine([{ source: spencerco, items: [it(sid, t, l, s), it(sid, 'Rockport council approves sewer project', 'https://spencercountyonline.com/sewer/', 'The council voted 4-1.')] }], Date.now());
  assert.deepEqual(out.filter(i => !i.isObit).map(i => i.title), ['Rockport council approves sewer project']);
  const ob = out.filter(i => i.isObit);
  assert.equal(ob.length, 1); assert.equal(ob[0].sourceId, 'ob-spencerco'); assert.equal(ob[0].image, ''); assert.equal(ob[0].source, 'spencerco');
});

test('police, events and obituary sources are not rerouted', () => {
  const [, t, l, s] = LIVE[0];
  for (const kind of ['police', 'courts', 'events', 'obits']) assert.equal(N.obitRoute(it('x', t, l, s), { id: 'x', kind }), null, kind);
});

test('the same person from a paper and the Messenger-Inquirer obituary feed shows once (Parson / Parsons Sr.)', () => {
  assert.equal(N.obitKey('Gayle Travis Parson, Sr.'), N.obitKey('Gayle Travis Parsons Sr.'));
  assert.equal(N.obitKey('Patricia Kathleen Ledbetter'), N.obitKey('Patricia Kathleen Ledbetter'));
  assert.notEqual(N.obitKey('John Adams'), N.obitKey('Jane Adams'));
  const leader = { id: 'leadernews', name: 'Leader-News', area: 'Central City' };
  const mi = { id: 'ob-messinq', name: 'Messenger-Inquirer', kind: 'obits', area: 'Owensboro' };
  const [sid, t, l, s] = LIVE[4];
  const out = N.combine([
    { source: mi, items: [Object.assign(it('ob-messinq', 'Gayle Travis Parsons Sr.', 'https://news.google.com/rss/articles/x', ''), { isObit: true })] },
    { source: leader, items: [it(sid, t, l, s), it(sid, LIVE[5][1], LIVE[5][2], LIVE[5][3])] },
  ], Date.now());
  const ob = out.filter(i => i.isObit).map(i => i.title);
  assert.equal(ob.filter(x => /Parsons? Sr/.test(x)).length, 1, ob.join(' | '));
  assert.ok(ob.includes('Patricia Kathleen Ledbetter'));
  assert.equal(out.filter(i => !i.isObit).length, 0, 'nothing left in News');
});

test('the page treats ob-<id> as an obituary source (Obituaries tab, no ads there)', () => {
  assert.ok(app.includes("/^ob-/.test(id || '') ? 'obits' : 'news'"));
});
