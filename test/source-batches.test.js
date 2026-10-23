const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const reg = require('../api/_sources.js');
const { robotsAllows } = require('../scripts/verify-source.js');
const LOC = require('../api/_location.js');
const before = require('./fixtures/sources-ba8b34a.json');

const b1 = reg.BATCHES.find(b => b.batch === 'b1');
const b2 = reg.BATCHES.find(b => b.batch === 'b2');
const b3 = reg.BATCHES.find(b => b.batch === 'b3');
const isGoogle = u => /^https:\/\/news\.google\.com\//.test(u);
const ALL = reg.BATCHES.flatMap(b => b.sources);
const ev = id => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/sources/evidence', id + '.json'), 'utf8'));

test('batch flag off (default, or flag without SOURCE_BATCHES) leaves the registry exactly as before', () => {
  for (const env of [{}, { EXPANDED_SOURCES_ENABLED: 'false', SOURCE_BATCHES: 'b1' }, { EXPANDED_SOURCES_ENABLED: 'true' }, { SOURCE_BATCHES: 'b1' }, { EXPANDED_SOURCES_ENABLED: 'true', SOURCE_BATCHES: 'b9' }, { EXPANDED_SOURCES_ENABLED: 'false', SOURCE_BATCHES: 'b1,b2' }, { EXPANDED_SOURCES_ENABLED: 'false', SOURCE_BATCHES: 'b1,b2,b3' }, { SOURCE_BATCHES: 'b3' }]) {
    assert.deepStrictEqual(reg.activeBatches(env), [], JSON.stringify(env));
    assert.deepStrictEqual(reg.registry(reg.FILES.concat(reg.activeBatches(env))), reg.registry());
  }
  assert.ok(!reg.SOURCES.some(s => ALL.some(b => b.id === s.id)), 'test env has no batch sources');
  assert.strictEqual(reg.registry().length, Array.isArray(before) ? before.length : reg.registry().length);
});

test('flag on appends the listed batches (b1, b2, b3 or any mix) after the base list, without registry-only fields', () => {
  const on = reg.registry(reg.FILES.concat(reg.activeBatches({ EXPANDED_SOURCES_ENABLED: 'true', SOURCE_BATCHES: ' b1 ,b9' })));
  const base = reg.registry();
  assert.deepStrictEqual(on.slice(0, base.length), base);
  assert.deepStrictEqual(on.slice(base.length).map(s => s.id), b1.sources.map(s => s.id));
  const only2 = reg.registry(reg.FILES.concat(reg.activeBatches({ EXPANDED_SOURCES_ENABLED: 'true', SOURCE_BATCHES: 'b2' })));
  assert.deepStrictEqual(only2.slice(base.length).map(s => s.id), b2.sources.map(s => s.id));
  const only3 = reg.registry(reg.FILES.concat(reg.activeBatches({ EXPANDED_SOURCES_ENABLED: 'true', SOURCE_BATCHES: 'b3' })));
  assert.deepStrictEqual(only3.slice(base.length).map(s => s.id), b3.sources.map(s => s.id));
  const two = reg.registry(reg.FILES.concat(reg.activeBatches({ EXPANDED_SOURCES_ENABLED: 'true', SOURCE_BATCHES: 'b2,b1' })));
  assert.deepStrictEqual(two.slice(base.length).map(s => s.id), b1.sources.concat(b2.sources).map(s => s.id), 'b3 stays off unless listed');
  const both = reg.registry(reg.FILES.concat(reg.activeBatches({ EXPANDED_SOURCES_ENABLED: 'true', SOURCE_BATCHES: 'b3,b2,b1' })));
  assert.deepStrictEqual(both.slice(base.length).map(s => s.id), ALL.map(s => s.id), 'b1, b2 then b3, in seq order');
  assert.strictEqual(new Set(both.map(s => s.id)).size, both.length, 'no duplicate ids');
  assert.strictEqual(new Set(both.map(s => s.url)).size, both.length, 'no duplicate feeds');
  for (const s of on) for (const k of ['seq', 'note', 'batch', 'site', 'counties', 'review', 'fallback']) assert.ok(!(k in s), s.id + ' ' + k);
  for (const s of both.slice(base.length)) if (isGoogle(s.url)) assert.strictEqual(s.rateGroup, 'gnews', s.id + ' keeps its rate group');
});

test('batches are valid together with the base files; seq continues 65.. without gaps across b1, b2 and b3', () => {
  assert.deepStrictEqual(reg.validate(reg.FILES.concat(reg.BATCHES)), []);
  assert.deepStrictEqual(ALL.map(s => s.seq), ALL.map((_, i) => 65 + i));
  assert.deepStrictEqual(reg.BATCHES.map(b => b.batch), ['b1', 'b2', 'b3']);
  const counties = new Set(LOC.COUNTIES ? LOC.COUNTIES.map(c => c.id) : []);
  for (const b of reg.BATCHES) for (const s of b.sources) {
    assert.strictEqual(s.batch, b.batch);
    assert.ok(/^https:\/\//.test(s.site), s.id);
    assert.ok(Array.isArray(s.counties) && s.counties.length, s.id);
    if (counties.size) for (const c of s.counties) assert.ok(counties.has(c), s.id + ' ' + c);
    // b1 and b2 use publisher feeds only; a Google News url (b3) must carry a fallback label and the gnews rate group
    if (isGoogle(s.url)) {
      assert.strictEqual(b.batch, 'b3', s.id);
      assert.ok(['google_news_site', 'google_news_towns'].includes(s.fallback), s.id);
      assert.strictEqual(s.rateGroup, 'gnews', s.id);
    } else assert.ok(!s.fallback && !s.localSection, s.id);
    if (/^mo-/.test(s.counties[0])) assert.ok(s.counties.every(c => /^mo-/.test(c)), s.id + ' Missouri entries claim only Missouri counties');
  }
});

test('every batch source has a verified evidence record with the plan shape', () => {
  for (const s of ALL) {
    const r = ev(s.id);
    assert.strictEqual(r.sourceId, s.id);
    assert.strictEqual(r.feedUrl, s.url);
    assert.strictEqual(r.decision, 'verified', s.id + ' ' + (r.reasons || []).join(','));
    assert.ok(!Number.isNaN(Date.parse(r.checkedAt)));
    assert.strictEqual(r.observed.status, 200);
    assert.ok(r.observed.accepted > 0 && r.activity.last30d > 0, s.id);
    if (s.fallback) {
      // news.google.com/robots.txt disallows /rss/search; a labeled fallback records that as a warning, not a pass
      assert.strictEqual(r.fallback, s.fallback, s.id);
      assert.strictEqual(r.checks.robots.allowsFeed, false, s.id);
      assert.ok((r.warnings || []).some(w => /^google_news_robots:/.test(w)), s.id);
      assert.strictEqual(r.checks.links.via, 'google_news', s.id);
    } else {
      assert.strictEqual(r.checks.robots.allowsFeed, true, s.id);
      assert.ok(r.checks.links.ownSiteShare >= 80, s.id);
      assert.ok(!r.fallback && !(r.warnings || []).length, s.id);
    }
    assert.ok(Array.isArray(r.coverageEvidence) && r.coverageEvidence.some(c => s.counties.includes(c.countyId)), s.id);
    assert.ok(r.reviewer && r.review && 'licensing' in r.review, s.id);
  }
});

test('robotsAllows: longest match wins, allow beats equal disallow, wildcards and $', () => {
  const t = 'User-agent: *\nDisallow: /search\nAllow: /search/?f=rss\n\nUser-agent: BadBot\nDisallow: /';
  assert.strictEqual(robotsAllows(t, '/search/?f=rss&t=article'), true);
  assert.strictEqual(robotsAllows(t, '/search/?q=x'), false);
  assert.strictEqual(robotsAllows(t, '/feed/'), true);
  assert.strictEqual(robotsAllows('', '/anything'), true);
  assert.strictEqual(robotsAllows('User-agent: *\nDisallow: /*.xml$', '/rss.xml'), false);
  assert.strictEqual(robotsAllows('User-agent: *\nDisallow: /*.xml$', '/rss.xml?x=1'), true);
  assert.strictEqual(robotsAllows('User-agent: *\nDisallow:', '/x'), true);
});

test('batches add no outlet that the base registry already fetches (same id or same feed host)', () => {
  const h = u => new URL(u).hostname.replace(/^www\./, '');
  const baseHosts = new Set(reg.registry().filter(s => !/news\.google\.com/.test(s.url)).map(s => h(s.url)));
  for (const s of ALL) assert.ok(isGoogle(s.url) || !baseHosts.has(h(s.url)), s.id);
  const baseUrls = new Set(reg.registry().flatMap(s => [s.url].concat(s.altUrls || [])));
  for (const s of ALL) assert.ok(!baseUrls.has(s.url), s.id + ' is not a base feed or fallback');
  const ids = ALL.map(s => s.id), urls = ALL.map(s => s.url);
  assert.strictEqual(new Set(ids).size, ids.length, 'no id in two batches');
  assert.strictEqual(new Set(urls).size, urls.length, 'no feed in two batches');
});

test('gap report: the batches give every claimed county a home source; base-only report is unchanged by batches', () => {
  const { gaps } = require('../scripts/source-gaps.js');
  const base = gaps({ baseOnly: true }), all = gaps();
  assert.strictEqual(all.rows.length, 68);
  for (const s of ALL) for (const c of s.counties) assert.ok(all.rows.find(r => r.id === c).sources > 0, c);
  assert.ok(all.without.length < base.without.length);
  assert.ok(all.without.every(r => base.without.some(b => b.id === r.id)));
  // batch 3 (2026-10-22): 38 of 68 counties had no home source with b1 and b2; 12 remain
  assert.strictEqual(all.without.length, 12);
  assert.deepStrictEqual(all.without.filter(r => r.tier === 'tri_state_core').map(r => r.id).sort(), ['il-gallatin', 'il-richland']);
});

test('evidence folder holds exactly one record per batch source (no orphans)', () => {
  const files = fs.readdirSync(path.join(__dirname, '..', 'data/sources/evidence')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
  assert.deepStrictEqual(files, ALL.map(s => s.id).sort());
});
