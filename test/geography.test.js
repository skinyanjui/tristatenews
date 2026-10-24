// The reviewed county manifest (data/geography/target-counties.json): counts, identities, Census checks, tiers,
// memberships and the place-name collisions the classifier will have to handle.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'data', 'geography');
const M = JSON.parse(fs.readFileSync(path.join(DIR, 'target-counties.json'), 'utf8'));
const OPT = JSON.parse(fs.readFileSync(path.join(DIR, 'optional-counties.json'), 'utf8'));
const C = M.counties;
const byId = new Map(C.map(c => [c.id, c]));
const STATE_FIPS = { IL: '17', IN: '18', KY: '21' };

// The brief's exact lists.
const CORE = { IL: 'Clay Edwards Gallatin Hamilton Lawrence Richland Saline Wabash Wayne White', IN: 'Daviess Dubois Gibson Knox Martin Perry Pike Posey Spencer Vanderburgh Warrick', KY: 'Daviess Hancock Henderson Hopkins McLean Muhlenberg Ohio Union Webster' };
const EXT = { IL: 'Jefferson|Perry|Franklin|Jackson|Williamson|Union|Johnson|Pope|Hardin|Alexander|Pulaski|Massac', KY: 'Fulton|Hickman|Carlisle|Ballard|McCracken|Graves|Livingston|Marshall|Calloway|Crittenden|Lyon|Trigg|Caldwell|Christian|Todd' }; // southeast Missouri removed (ship62)
const OPTIONAL = ['IN Crawford', 'IN Orange', 'KY Breckinridge', 'KY Grayson'];
const pairs = (o, sep) => Object.entries(o).flatMap(([s, v]) => v.split(sep).map(n => s + ' ' + n)).sort();
const slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const of = tier => C.filter(c => c.tier === tier);
const count = (list, f) => list.reduce((m, c) => (m[f(c)] = (m[f(c)] || 0) + 1, m), {});

function readExtract(file) {
  const lines = fs.readFileSync(path.join(DIR, file), 'utf8').trim().split('\n');
  const d = lines[0].includes('\t') ? '\t' : '|';
  const h = lines[0].split(d).map(s => s.trim());
  return lines.slice(1).map(l => Object.fromEntries(l.split(d).map((v, i) => [h[i], v.trim()])));
}
const GAZ = readExtract('census/2025_Gaz_counties_extract.txt');
const NAT = readExtract('census/national_county2020_extract.txt');

test('counts: core 30, extended 27, total 57; IL 22, IN 11, KY 24; no Missouri', () => {
  assert.equal(of('tri_state_core').length, 30);
  assert.equal(of('extended').length, 27);
  assert.equal(C.length, 57);
  assert.deepEqual(count(C, c => c.state), { IL: 22, IN: 11, KY: 24 });
  assert.deepEqual(count(of('tri_state_core'), c => c.state), { IL: 10, IN: 11, KY: 9 });
  assert.deepEqual(count(of('extended'), c => c.state), { IL: 12, KY: 15 });
  assert.deepEqual(M.invariants, { core: 30, extended: 27, total: 57, byState: { IL: 22, IN: 11, KY: 24 } });
});

test('the county lists are exactly the brief\'s', () => {
  assert.deepEqual(of('tri_state_core').map(c => c.state + ' ' + c.name).sort(), pairs(CORE, ' '));
  assert.deepEqual(of('extended').map(c => c.state + ' ' + c.name).sort(), pairs(EXT, '|'));
  assert.deepEqual(OPT.counties.map(c => c.state + ' ' + c.name).sort(), OPTIONAL);
});

test('ids are <st>-<slug>, unique, and state/county pairs and FIPS are unique', () => {
  for (const c of C.concat(OPT.counties)) assert.equal(c.id, c.state.toLowerCase() + '-' + slug(c.name));
  for (const key of [c => c.id, c => c.state + '|' + c.name, c => c.fips]) {
    const all = C.concat(OPT.counties).map(key);
    assert.equal(new Set(all).size, all.length);
  }
  assert.ok(byId.has('ky-mccracken') && byId.has('il-alexander'));
});

test('FIPS format: 5 digits = the state code + the 3-digit county code', () => {
  for (const c of C.concat(OPT.counties)) {
    assert.match(c.fips, /^\d{5}$/, c.id);
    assert.equal(c.stateFips, STATE_FIPS[c.state], c.id);
    assert.match(c.countyFips, /^\d{3}$/, c.id);
    assert.equal(c.fips, c.stateFips + c.countyFips, c.id);
  }
});

test('the committed Census extracts match their recorded sha256 and every county matches them', () => {
  for (const [file, hash] of Object.entries(M.censusExtracts)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, file))).digest('hex'), hash, file);
  }
  const all = C.concat(OPT.counties);
  assert.equal(GAZ.length, all.length);
  assert.equal(NAT.length, all.length);
  for (const c of all) {
    const g = GAZ.find(r => r.GEOID === c.fips);
    const n = NAT.find(r => r.STATEFP + r.COUNTYFP === c.fips);
    assert.ok(g && n, c.id + ' in both extracts');
    assert.equal(g.USPS, c.state); assert.equal(g.NAME, c.fullName); assert.equal(c.fullName, c.name + ' County');
    assert.equal(g.ANSICODE, c.ansiCode); assert.equal(n.COUNTYNS, c.ansiCode);
    assert.equal(n.STATE, c.state); assert.equal(n.COUNTYNAME, c.fullName); assert.equal(n.FUNCSTAT, 'A');
    assert.equal(Number(g.INTPTLAT), c.centroid.lat); assert.equal(Number(g.INTPTLONG), c.centroid.lon);
    assert.equal(c.centroid.kind, 'census_internal_point');
  }
});

test('sources: Census URLs and vintages recorded; every reference resolves', () => {
  const S = M.sources;
  assert.match(S['census-gazetteer-2025'].url, /^https:\/\/www2\.census\.gov\/geo\/docs\/maps-data\/data\/gazetteer\/2025_Gazetteer\//);
  assert.match(S['census-national-county-2020'].url, /^https:\/\/www2\.census\.gov\/geo\/docs\/reference\/codes2020\//);
  for (const [id, s] of Object.entries(S)) {
    assert.ok(s.retrieved && /^\d{4}-\d{2}-\d{2}$/.test(s.retrieved), id);
    if (!['brief-2026-10', 'editorial-regions-2026-10'].includes(id)) assert.match(s.url, /^https:\/\//, id);
  }
  for (const c of C.concat(OPT.counties)) {
    assert.ok(S[c.seat.source], c.id + ' seat source');
    for (const x of c.seat.corroboratedBy || []) assert.ok(S[x], c.id + ' ' + x);
    assert.ok(S[c.centroid.source], c.id);
    for (const x of c.verification.fipsSources) assert.ok(S[x], c.id + ' ' + x);
  }
});

test('every county is verified (FIPS, seat, centroid); an unverified field would have to carry no value', () => {
  for (const c of C.concat(OPT.counties)) {
    for (const f of ['fips', 'seat', 'centroid']) assert.ok(['verified', 'unverified'].includes(c.verification[f]), c.id + ' ' + f);
    if (c.verification.seat === 'unverified') assert.equal(c.seat.name, null, c.id);
    assert.equal(c.verification.seat, 'verified', c.id + ' seat');
    assert.equal(c.verification.fips, 'verified', c.id + ' fips');
    assert.ok(typeof c.seat.name === 'string' && c.seat.name.length > 1, c.id);
    // inside the four-state study area
    assert.ok(c.centroid.lat > 36 && c.centroid.lat < 39.5 && c.centroid.lon > -91.5 && c.centroid.lon < -85.5, c.id);
  }
});

test('exactly one tier per county; tier memberships agree with the county records', () => {
  const tiers = M.groups.filter(g => g.kind === 'tier').map(g => g.id).sort();
  assert.deepEqual(tiers, ['extended', 'tri_state_core']);
  for (const c of C) {
    const t = M.members.filter(m => m.countyId === c.id && tiers.includes(m.groupId));
    assert.equal(t.length, 1, c.id);
    assert.equal(t[0].groupId, c.tier, c.id);
  }
});

test('no Missouri: no county, member, region, source or Census row (southeast Missouri removed in ship62)', () => {
  assert.equal(C.filter(c => c.state === 'MO' || c.fips.startsWith('29')).length, 0);
  assert.ok(!M.members.some(m => m.countyId.startsWith('mo-')));
  assert.ok(!M.groups.some(g => /missouri|cape-girardeau/i.test(g.id + ' ' + g.name + ' ' + g.description)));
  assert.ok(!Object.keys(M.sources).some(k => k.startsWith('mo-')));
  assert.ok(!Object.keys(M.invariants.byState).includes('MO'));
  for (const f of ['2025_Gaz_counties_extract.txt', 'national_county2020_extract.txt', '2025_Gaz_place_extract.txt']) assert.ok(!readExtract('census/' + f).some(r => r.USPS === 'MO' || r.STATE === 'MO'), f);
  assert.ok(!readExtract('census/county_adjacency2025_extract.txt').some(r => /^29/.test(r['County GEOID']) || /^29/.test(r['Neighbor GEOID'])));
  const inGroup = g => M.members.filter(m => m.groupId === g).map(m => m.countyId);
  assert.deepEqual(inGroup('tri_state_historic').sort(), of('tri_state_core').map(c => c.id).sort());
});

test('every membership has a known group, a known county, source_reference and verified_at', () => {
  const groups = new Set(M.groups.map(g => g.id));
  for (const m of M.members) {
    assert.ok(groups.has(m.groupId), m.groupId);
    assert.ok(byId.has(m.countyId), m.countyId);
    if (m.groupId.startsWith('region:')) {
      assert.match(m.sourceReference, /^editorial judgment: /, m.countyId);
      for (const x of m.basedOn) assert.ok(M.sources[x], m.countyId + ' ' + x);
    } else assert.ok(M.sources[m.sourceReference], m.countyId + ' ' + m.sourceReference);
    assert.match(m.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(m.membershipType);
  }
  const keys = M.members.map(m => m.groupId + '|' + m.countyId);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate memberships');
  // Editorial regions: six, overlapping, members by editorial judgment (see test/regions.test.js).
  const regions = M.groups.filter(g => g.kind === 'editorial_region');
  assert.equal(regions.length, 6);
  for (const g of regions) {
    assert.equal(g.overlapping, true);
    assert.equal(g.membershipStatus, 'editorial_judgment', g.id);
    assert.ok(M.members.some(m => m.groupId === g.id), g.id);
  }
});

test('optional and historical counties stay out of the 57 and out of every group', () => {
  assert.equal(OPT.counties.length, 4);
  for (const c of OPT.counties) {
    assert.equal(c.tier, 'optional_historical');
    assert.ok(!byId.has(c.id) && !C.some(x => x.fips === c.fips), c.id);
    assert.ok(!M.members.some(m => m.countyId === c.id), c.id);
  }
});

test('collisions: same-named counties are distinct records', () => {
  const ids = name => C.filter(c => c.name === name).map(c => c.id).sort();
  assert.deepEqual(ids('Perry'), ['il-perry', 'in-perry']);
  assert.deepEqual(ids('Wayne'), ['il-wayne']);
  assert.deepEqual(ids('Union'), ['il-union', 'ky-union']);
  assert.deepEqual(ids('Daviess'), ['in-daviess', 'ky-daviess']);
  assert.equal(new Set(['il-perry', 'in-perry'].map(id => byId.get(id).fips)).size, 2);
  assert.equal(byId.get('il-perry').tier, 'extended');
  assert.equal(byId.get('in-perry').tier, 'tri_state_core');
});

test('collisions: shared seat names resolve to different counties by state', () => {
  const seats = name => C.filter(c => c.seat.name === name).map(c => c.id).sort();
  assert.deepEqual(seats('Benton'), ['il-franklin', 'ky-marshall']);
  assert.deepEqual(seats('Princeton'), ['in-gibson', 'ky-caldwell']);
  assert.deepEqual(seats('Marion'), ['il-williamson', 'ky-crittenden']);
  assert.deepEqual(seats('Mount Vernon'), ['il-jefferson', 'in-posey']);
  assert.deepEqual(seats('Greenville'), ['ky-muhlenberg']);
  assert.deepEqual(seats('Washington'), ['in-daviess']);
  assert.deepEqual(seats('Jackson'), []); // Jackson County IL is il-jackson (seat Murphysboro)
  assert.equal(byId.get('il-jackson').seat.name, 'Murphysboro');
  assert.deepEqual(seats('Louisville'), ['il-clay']); // not Louisville KY, which is outside the area
  assert.deepEqual(seats('Elizabethtown'), ['il-hardin']); // not Elizabethtown KY
  assert.equal(byId.get('il-jefferson').seat.asPublished, 'Mt. Vernon');
});
