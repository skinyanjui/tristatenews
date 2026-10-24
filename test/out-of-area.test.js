// Out-of-area network copy in local outlets' feeds (ship57). The 2026-10-22 audit found 14 News stories about an
// Oregon shooting ("an Oregon home") and a dentist killed in Mexico at the top of home: the first version of the
// check only knew "<State> man/officials..." and "in/near/from <State>". No network and no Redis.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const API = path.join(__dirname, '..', 'api');
const CLEAN = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'KV_URL', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'UPSTASH_REDIS_URL', 'EXTRA_FEEDS'];
CLEAN.forEach(k => delete process.env[k]);
const { outOfArea, passesFilters } = require(path.join(API, 'news.js'));

const it = (title, summary) => ({ title, summary: summary || '', link: 'https://www.14news.com/x' });
const WFIE = { id: 'wfie', name: '14 News', kind: 'news' };

// The four stories from the audit, as the live feed carried them on 2026-10-22.
const LEAKED = [
  it("'There are no words': Boyfriend accused of killing girlfriend, her 15-year-old son, and her mother", 'Three people found shot to death inside an Oregon home on Tuesday have been identified.'),
  it('Man executes dentist over bad work before dying in shootout with police', 'A man wanted in the killing of his dentist in Mexico died in a shootout with police two days later, authorities said.'),
  it("Man convicted of killing mother who threatened to evict him, believed she was 'possessed'", 'Ronald Joseph Kirk was convicted of killing his mother, Rosa Leyva, in Gladstone, Oregon. He is scheduled to be sentenced Nov. 4.'),
  it("'This is what I remember': Teacher speaks after surviving Oregon elementary school shooting", 'A teacher who was shot at Silver Rail Elementary School in Bend shared a message this week.'),
];

test('the four audit stories are out of area and do not pass the news filters', () => {
  for (const x of LEAKED) {
    assert.equal(outOfArea(x), true, x.title);
    assert.equal(passesFilters(x, WFIE, false), false, x.title);
  }
});

test('other out-of-area phrasings are caught', () => {
  const cases = [
    ['A Texas man is charged after a chase', ''],                                   // "<State> man" (worked before; kept)
    ['Mother, 4 young children killed in overnight Texas mobile home fire', ''],   // state + words + event
    ['Crews battle wildfire', 'The fire near a Colorado mountain town grew overnight.'],
    ['Tourists missing', 'Two Americans vanished in Mexico last week.'],            // country
    ['Mexican authorities arrest cartel leader', ''],                               // demonym + authority
    ['Plane lands safely', 'The flight was diverted to Canada after a scare.'],
    ['Officer hurt in crash', 'It happened Tuesday in Nashville, Tenn.'],           // AP dateline
    ['Rally on Friday', 'Supporters will gather in Fort Myers, Fla. on Friday.'],
    ['Footage released', 'The Mississippi Department of Public Safety released new footage.'],
    ['Deputy rescues child', 'The child had wandered into a Louisiana pond.'],
  ];
  for (const [t, s] of cases) assert.equal(outOfArea(it(t, s)), true, t + ' ' + s);
});

test('local stories that mention other places in passing are kept', () => {
  const cases = [
    ['Evansville man arrested in Florida after months on the run', 'Police in Tampa say the man, 34, was wanted in Vanderburgh County.'],
    ['Purple Aces fall at Ohio school in overtime', 'The Aces trailed a Texas transfer-led team all night.'],
    ['Screaming Eagles open season in Ohio', 'The team plays a Michigan school Saturday.'],
    ['Otters drop series finale in Washington, Pa.', ''],
    ['Reitz falls to Ohio power in state semifinal', ''],
    ['Henderson family returns from Mexico mission trip', ''],
    ['Owensboro nurse honored for Texas flood relief', ''],
    ['Ohio Co. Sheriff’s reports for Oct. 22', 'HARTFORD, Ky. — The Ohio County Sheriff’s Office released the following reports.'],
    ['OTFD open house is Saturday', 'Join the Ohio Township Fire Department for an upcoming Open House.'],
    ['Barge traffic slows on the Ohio River', 'Low water from Ohio Valley drought.'],
    ['Tennessee Valley Authority plans rate change', ''],
    ['Holland festival returns', 'Downtown Holland, Ind. hosts the annual festival this weekend.'],
    ['Washington, Ind. council approves budget', ''],
    ['Brazil man wins award', ''],                                                  // Brazil, Ind. — not a country rule
    ['Ireland church holds fish fry', ''],
    ['Indiana State Police investigate crash on I-69', ''],                         // Indiana is never "other"
    ['Missouri S&T at USI tonight', ''],
    ['Weather service: storms move in from Missouri', 'Expect rain in Mount Vernon and Princeton by noon.'],
  ];
  for (const [t, s] of cases) assert.equal(outOfArea(it(t, s)), false, t + ' ' + s);
});

test('local towns that other states share count as local unless another state follows them', () => {
  assert.equal(outOfArea(it('Henderson County deputies assist Texas officers', '')), false);
  assert.equal(outOfArea(it('Princeton family returns from Mexico mission trip', '')), false);
  assert.equal(outOfArea(it('Henderson, Nev. casino opens', '')), true);
  assert.equal(outOfArea(it('Princeton, N.J. man charged in fraud case', '')), true);
});

test('India does not match Indiana, and a bare state name alone is not enough', () => {
  assert.equal(outOfArea(it('Indiana lawmakers return for special session', '')), false);
  assert.equal(outOfArea(it('Local business ships goods to Indianapolis', '')), false);
  assert.equal(outOfArea(it('Ohio State coach speaks to boosters', '')), false);
  assert.equal(outOfArea(it('Florida trip raffle benefits food bank', '')), false);
});

test('only news kinds use the check; obituaries and events are not touched by it', () => {
  const ob = it('Jane Doe', 'Jane Doe, 80, of Lakeland, Florida, died Oct. 1 in Nashville, Tenn.');
  assert.equal(passesFilters(ob, { id: 'ob-x', kind: 'obits' }, false), true);
});

// ship60: misses reported after ship59 (14 News, Gray network copy)
test('landmarks and national parks elsewhere, "heads to <State>" and "<State>\'s" are out of area', () => {
  const cases = [
    ['Grand Canyon adds new dog to help reduce wildlife interactions with visitors', 'The Grand Canyon created a new program to reduce animal interactions with the introduction of their newest employee, Blue, the Catahoula dog.'],
    ['Trump heads to Iowa Thursday with new farm aid package', 'President Donald Trump is rolling out a new $8 billion farming package to provide one-time relief payments to farmers facing rising fertilizer and diesel costs.'],
    ['Newborn safely surrendered to Safe Haven Baby Box that has been used 3 times since it was installed', 'A newborn was safely surrendered to the Safe Haven Baby Box at Knoxville Fire Station 17 \u2014 the third surrender since Tennessee\'s first box was installed in 2023.'],
    ['Bison gores tourist', 'It happened Tuesday near Old Faithful in Yellowstone.'],
    ['Rockfall closes road', 'Crews cleared a rockfall in Yosemite on Monday.'],
    ['Hiker rescued after fall', 'Rangers at Zion National Park reached the hiker overnight.'],
    ['Visitors flock to Great Smoky Mountains for fall colors', ''],
    ['Ukulele group brings island vibes to popular vacation area', 'Ukes by the Sea performs throughout South Carolina\u2019s Grand Strand.'],
  ];
  for (const [t, s] of cases) {
    assert.equal(outOfArea(it(t, s)), true, t);
    assert.equal(passesFilters(it(t, s), WFIE, false), false, t);
  }
});

test('local parks, forests, rivers, teams and shared town names stay local', () => {
  const keep = [
    ['Mammoth Cave National Park adds new cave tour', ''],
    ['Kentucky\'s Mammoth Cave National Park sets visitor record', ''],
    ['Indiana Dunes National Park beach reopens', ''],
    ['Shawnee National Forest trail closes for repairs', ''],
    ['Hoosier National Forest seeks input on Sigler Creek project', ''],
    ['Land Between the Lakes elk viewing opens', ''],
    ['Ohio River expected to crest Friday', ''],
    ['Evansville family visits Grand Canyon on wish trip', ''],          // a local place named: stays
    ['Henderson woman heads to Texas for national title', ''],            // shared town name, bare
    ['Purple Aces travel to Missouri State', ''],                         // a local team (and "Missouri State")
    ['Zion Lutheran Church hosts fall festival', ''],                     // "Zion" alone is a church here
    ['Commissioner visits Ohio County schools', ''],                      // Ohio County, Ky.
    ['Tennessee Valley Authority plans Paradise upgrade', ''],
  ];
  for (const [t, s] of keep) assert.equal(outOfArea(it(t, s)), false, t);
  // a source's own geoTerms still count (ship58; the mechanism, with a made-up out-of-state town)
  assert.equal(outOfArea(it('Missouri\'s new law affects Sikeston schools', ''), ['sikeston']), false);
});
