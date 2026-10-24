// ship62: southeast Missouri is out of coverage ("I don't want Missouri", Sam, 2026-10-23). No Missouri county, region,
// scope, page or source anywhere; Missouri stories stay out of area for the Tri-State feed. No network and no Redis.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'KV_URL', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'UPSTASH_REDIS_URL', 'EXTRA_FEEDS'].forEach(k => delete process.env[k]);
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const reg = require('../api/_sources.js');
const N = require('../api/news.js');
const S = require('../api/_scope.js');
const RT = require('../public/routes.js');

const GONE = ['kbsi', 'wcjbanner', 'gn-perrymo', 'gn-carterripley', 'gn-butler', 'gn-stoddard', 'gn-scott', 'gn-msnm'];
const MO_COUNTIES = ['mo-perry', 'mo-bollinger', 'mo-cape-girardeau', 'mo-wayne', 'mo-carter', 'mo-ripley', 'mo-butler', 'mo-stoddard', 'mo-scott', 'mo-mississippi', 'mo-new-madrid'];

test('the Missouri-only sources are gone from every registry file, batch and evidence record', () => {
  const all = reg.FILES.flatMap(f => f.sources).concat(reg.BATCHES.flatMap(b => b.sources));
  for (const id of GONE) {
    assert.ok(!all.some(s => s.id === id), id);
    assert.ok(!fs.existsSync(path.join(root, 'data/sources/evidence', id + '.json')), id + ' evidence');
  }
  for (const s of all) {
    assert.ok(!(s.counties || []).some(c => /^mo-/.test(c)), s.id);
    assert.doesNotMatch(s.url, /kbsi23\.com|waynecojournalbanner\.com|semissourian\.com|darnews\.com/, s.id);
  }
  // every batch switched on still has none of them
  const on = reg.registry(reg.FILES.concat(reg.activeBatches({ EXPANDED_SOURCES_ENABLED: 'true', SOURCE_BATCHES: 'b1,b2,b3' })));
  for (const id of GONE) assert.ok(!on.some(s => s.id === id), id);
  assert.deepEqual(reg.validate(reg.FILES.concat(reg.BATCHES)), []);
});

test('no Missouri county, region, scope or page', () => {
  const M = JSON.parse(read('data/geography/target-counties.json'));
  for (const id of MO_COUNTIES) {
    assert.ok(!M.counties.some(c => c.id === id), id);
    assert.ok(!S.BY_ID.has(id), id);
    assert.ok(S.parse('county:' + id).error, id);
  }
  assert.ok(S.parse('state:mo').error);
  assert.equal(S.fromPath('/news/missouri'), null);
  assert.equal(RT.geo('/news/missouri'), null);
  assert.ok(!('mo' in RT.STATE_SLUGS));
  const geo = JSON.parse(read('public/geo-data.json'));
  assert.ok(!geo.counties.some(c => c.state === 'MO') && !geo.regions.some(r => /missouri/i.test(r.id + r.name)));
  assert.ok(!Object.keys(JSON.parse(read('data/geography/coverage.json')).depth).some(k => /^mo-/.test(k)));
  assert.doesNotMatch(read('public/index.html'), /Missouri/);
});

test('Missouri stories stay out of area for the Tri-State feed', () => {
  const it = (t, s) => ({ title: t, summary: s || '', link: 'https://www.kfvs12.com/2026/10/23/x/' });
  const kfvs = N.SOURCES.find(s => s.id === 'kfvs');
  assert.ok(kfvs && kfvs.geo, 'KFVS12 stays (it covers southern Illinois and western Kentucky) and is geo-filtered');
  for (const t of ['Cape Girardeau police investigate shooting', 'Sikeston, Mo. council votes on budget', 'Poplar Bluff man charged after chase',
    'Missouri lawmakers pass new budget', 'Perryville, Mo. plant to add 200 jobs'])
    assert.equal(N.passesFilters(it(t), kfvs, false), false, t);
  for (const t of ['Missouri man arrested in Cape Girardeau', 'Crash in Missouri closes I-55', 'Sikeston, Mo. woman hurt in crash']) assert.equal(N.outOfArea(it(t)), true, t);
  // a local story that also names Missouri is still local
  assert.equal(N.passesFilters(it('Carbondale man arrested in Missouri after chase'), kfvs, false), true);
  assert.equal(N.passesFilters(it('Carbondale council approves budget'), kfvs, false), true);
});
