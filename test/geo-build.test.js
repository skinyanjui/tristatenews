// The generated locality tables (scripts/build-geo.js): up to date, built only from the committed Census extracts,
// limited to the 57 target counties, with multi-county places and recorded vintages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { build, OUTPUTS, INPUTS, baseName, nameKey, forms } = require('../scripts/build-geo.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const M = JSON.parse(read('data/geography/target-counties.json'));
const OPT = JSON.parse(read('data/geography/optional-counties.json'));
const P = JSON.parse(read(OUTPUTS.communities));
const A = JSON.parse(read(OUTPUTS.aliases));
const GEO = require('../api/_geo.js');
const table = f => { const [h, ...rows] = read('data/geography/census/' + f).trim().split('\n'); const k = h.split('|'); return rows.map(r => Object.fromEntries(r.split('|').map((v, i) => [k[i], v]))); };

test('generated files match the generator output (run node scripts/build-geo.js after changing an input)', () => {
  const out = build();
  assert.deepEqual(Object.keys(out).sort(), Object.values(OUTPUTS).sort());
  for (const [f, s] of Object.entries(out)) assert.ok(read(f) === s, f + ' is stale');
  for (const f of INPUTS) assert.equal(GEO.inputs[f], crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex'), f);
  assert.equal(GEO.manifestVersion, M.manifestVersion);
});

test('every community is a 2025 Gazetteer place in a target county, never an optional one', () => {
  const gaz = new Map(table('2025_Gaz_place_extract.txt').map(r => [r.GEOID, r]));
  const ids = new Set(M.counties.map(c => c.id)), opt = new Set(OPT.counties.map(c => c.id));
  assert.equal(P.count, P.communities.length);
  assert.equal(P.communities.length, gaz.size);
  for (const p of P.communities) {
    const g = gaz.get(p.geoid);
    assert.ok(g, p.id);
    assert.equal(p.censusName, g.NAME); assert.equal(p.state, g.USPS); assert.equal(p.funcstat, g.FUNCSTAT);
    assert.deepEqual(p.internalPoint, { lat: +g.INTPTLAT, lon: +g.INTPTLONG, source: 'census-gazetteer-2025' });
    assert.ok(p.countyIds.length >= 1, p.id);
    for (const c of p.countyIds) { assert.ok(ids.has(c), p.id + ' ' + c); assert.ok(!opt.has(c), p.id + ' ' + c); assert.equal(c.slice(0, 2), p.state.toLowerCase(), p.id); }
    assert.ok(['census-place-by-county-2020', 'census-geocoder-2025'].includes(p.countySource));
    assert.equal(p.countyIdsComplete, p.countySource === 'census-place-by-county-2020');
  }
  assert.equal(new Set(P.communities.map(p => p.id)).size, P.communities.length, 'unique ids');
});

test('multi-county places keep every target county from the Census relationship file', () => {
  const by = id => P.communities.find(p => p.id === id);
  assert.deepEqual(by('il-carbondale').countyIds, ['il-jackson', 'il-williamson']);
  assert.ok(!P.communities.some(p => p.state === 'MO' || p.countyIds.some(id => id.startsWith('mo-'))), 'no Missouri places (removed in ship62)');
  assert.deepEqual(by('il-grayville').countyIds, ['il-edwards', 'il-white']);
  assert.equal(by('il-carbondale').partlyOutside, false);
  assert.equal(by('il-centralia').partlyOutside, true, 'Centralia also lies in counties outside the area');
  const rel = new Map();
  for (const r of table('place_by_county2020_extract.txt')) { const g = r.STATEFP + r.PLACEFP; rel.set(g, (rel.get(g) || 0) + 1); }
  for (const p of P.communities.filter(x => x.countySource === 'census-place-by-county-2020')) {
    assert.ok(p.countyIds.length <= rel.get(p.geoid), p.id);
    assert.equal(p.countyIds.length < rel.get(p.geoid), p.partlyOutside, p.id);
  }
  assert.ok(P.communities.filter(p => p.countyIds.length > 1).length >= 12);
});

test('places new since 2020 take their county from the Census Geocoder answer', () => {
  const geo = new Map(table('place_county_geocoder_2025.txt').map(r => [r.GEOID, r]));
  const fips = new Map(M.counties.map(c => [c.fips, c.id]));
  for (const r of geo.values()) assert.deepEqual([r.BENCHMARK, r.VINTAGE], ['Public_AR_Current', 'Current_Current']);
  for (const p of P.communities.filter(x => x.countySource === 'census-geocoder-2025')) assert.deepEqual(p.countyIds, [fips.get(geo.get(p.geoid).COUNTY_GEOID)], p.id);
});

test('sources and vintages are recorded', () => {
  assert.match(P.sources.places, /2025 Gazetteer/);
  assert.match(P.sources.placeCounties, /2020 place-by-county/);
  assert.match(P.sources.placeCountiesNew, /Public_AR_Current.*Current_Current.*2026-10-18/);
  assert.match(A.sources.namesakes, /2025_Gaz_place_national.*2025_Gaz_counties_national/);
  assert.match(A.sources.stateNames, /2025 Gazetteer/);
  for (const k of ['ambiguous', 'requiresState', 'distinctive']) assert.ok(A.rules[k], k);
  const raw = JSON.parse(read('data/geography/census/raw-sources.json'));
  assert.equal(raw.publisher, 'U.S. Census Bureau');
  assert.deepEqual(raw.files.map(f => f.vintage), ['2025', '2025', '2025', '2020', '2020', '2020']);
  for (const f of raw.files) { assert.match(f.url, /^https:\/\/www2\.census\.gov\//, f.file); assert.match(f.sha256, /^[0-9a-f]{64}$/, f.file); }
  assert.deepEqual([raw.geocoder.benchmark, raw.geocoder.vintage], ['Public_AR_Current', 'Current_Current']);
});

test('name helpers', () => {
  assert.equal(baseName('Evansville city'), 'Evansville');
  assert.equal(baseName('Grand Rivers CDP'), 'Grand Rivers');
  assert.equal(nameKey('Mt. Vernon'), 'mount vernon');
  assert.equal(nameKey('St. Francisville'), 'saint francisville');
  assert.deepEqual(forms('mount vernon'), ['mount vernon', 'mt vernon', 'mt. vernon']);
  assert.deepEqual(forms('saint meinrad'), ['saint meinrad', 'st meinrad', 'st. meinrad']);
});

test('the client copy is small and is not loaded by any page yet', () => {
  const c = JSON.parse(read(OUTPUTS.client));
  assert.equal(c.counties.length, 57);
  assert.ok(Buffer.byteLength(read(OUTPUTS.client)) < 20000);
  assert.ok(c.regions.some(r => r.id === 'region:southern-illinois:east' && r.parent === 'region:southern-illinois'));
  for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter(f => /\.(html|js)$/.test(f))) {
    assert.ok(!read('public/' + f).includes('geo-data.json'), f);
  }
});
