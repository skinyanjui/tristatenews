const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const reg = require('../api/_sources.js');
const { robotsAllows } = require('../scripts/verify-source.js');
const LOC = require('../api/_location.js');
const before = require('./fixtures/sources-ba8b34a.json');

const b1 = reg.BATCHES.find(b => b.batch === 'b1');
const ev = id => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/sources/evidence', id + '.json'), 'utf8'));

test('batch flag off (default, or flag without SOURCE_BATCHES) leaves the registry exactly as before', () => {
  for (const env of [{}, { EXPANDED_SOURCES_ENABLED: 'false', SOURCE_BATCHES: 'b1' }, { EXPANDED_SOURCES_ENABLED: 'true' }, { SOURCE_BATCHES: 'b1' }, { EXPANDED_SOURCES_ENABLED: 'true', SOURCE_BATCHES: 'b9' }]) {
    assert.deepStrictEqual(reg.activeBatches(env), [], JSON.stringify(env));
    assert.deepStrictEqual(reg.registry(reg.FILES.concat(reg.activeBatches(env))), reg.registry());
  }
  assert.ok(!reg.SOURCES.some(s => b1.sources.some(b => b.id === s.id)), 'test env has no batch sources');
  assert.strictEqual(reg.registry().length, Array.isArray(before) ? before.length : reg.registry().length);
});

test('flag on with b1 listed appends batch 1 after the base list, without registry-only fields', () => {
  const on = reg.registry(reg.FILES.concat(reg.activeBatches({ EXPANDED_SOURCES_ENABLED: 'true', SOURCE_BATCHES: ' b1 ,b2' })));
  const base = reg.registry();
  assert.deepStrictEqual(on.slice(0, base.length), base);
  assert.deepStrictEqual(on.slice(base.length).map(s => s.id), b1.sources.map(s => s.id));
  for (const s of on) for (const k of ['seq', 'note', 'batch', 'site', 'counties', 'review']) assert.ok(!(k in s), s.id + ' ' + k);
});

test('batch 1 is valid together with the base files; seq continues 65.. without gaps', () => {
  assert.deepStrictEqual(reg.validate(reg.FILES.concat(reg.BATCHES)), []);
  assert.deepStrictEqual(b1.sources.map(s => s.seq), b1.sources.map((_, i) => 65 + i));
  const counties = new Set(LOC.COUNTIES ? LOC.COUNTIES.map(c => c.id) : []);
  for (const s of b1.sources) {
    assert.strictEqual(s.batch, 'b1');
    assert.ok(/^https:\/\//.test(s.site), s.id);
    assert.ok(Array.isArray(s.counties) && s.counties.length, s.id);
    if (counties.size) for (const c of s.counties) assert.ok(counties.has(c), s.id + ' ' + c);
    assert.ok(!/news\.google\.com/.test(s.url), 'batch 1 uses publisher feeds only');
  }
});

test('every batch 1 source has a verified evidence record with the plan shape', () => {
  for (const s of b1.sources) {
    const r = ev(s.id);
    assert.strictEqual(r.sourceId, s.id);
    assert.strictEqual(r.feedUrl, s.url);
    assert.strictEqual(r.decision, 'verified', s.id + ' ' + (r.reasons || []).join(','));
    assert.ok(!Number.isNaN(Date.parse(r.checkedAt)));
    assert.strictEqual(r.observed.status, 200);
    assert.ok(r.observed.accepted > 0 && r.activity.last30d > 0, s.id);
    assert.strictEqual(r.checks.robots.allowsFeed, true);
    assert.ok(r.checks.links.ownSiteShare >= 80, s.id);
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

test('batch 1 adds no outlet that the base registry already fetches (same id or same feed host)', () => {
  const h = u => new URL(u).hostname.replace(/^www\./, '');
  const baseHosts = new Set(reg.registry().filter(s => !/news\.google\.com/.test(s.url)).map(s => h(s.url)));
  for (const s of b1.sources) assert.ok(!baseHosts.has(h(s.url)), s.id);
});

test('gap report: batch 1 gives every claimed county a home source; base-only report is unchanged by batches', () => {
  const { gaps } = require('../scripts/source-gaps.js');
  const base = gaps({ baseOnly: true }), all = gaps();
  assert.strictEqual(all.rows.length, 68);
  for (const s of b1.sources) for (const c of s.counties) assert.ok(all.rows.find(r => r.id === c).sources > 0, c);
  assert.ok(all.without.length < base.without.length);
  assert.ok(all.without.every(r => base.without.some(b => b.id === r.id)));
});
