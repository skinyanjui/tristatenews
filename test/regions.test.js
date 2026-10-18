// Editorial regions in data/geography/target-counties.json: every target county has one primary region,
// memberships are explicit and justified by Census adjacency, and same-named counties land where they belong.
// Regions are editorial judgment, not official boundaries.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'geography');
const M = JSON.parse(fs.readFileSync(path.join(DIR, 'target-counties.json'), 'utf8'));
const OPT = JSON.parse(fs.readFileSync(path.join(DIR, 'optional-counties.json'), 'utf8'));
const byId = new Map(M.counties.map(c => [c.id, c]));
const REGIONS = M.groups.filter(g => g.kind === 'editorial_region');
const RM = M.members.filter(m => m.groupId.startsWith('region:'));
const primaryOf = id => RM.filter(m => m.countyId === id && m.membershipType === 'primary').map(m => m.groupId);
const members = (g, type) => RM.filter(m => m.groupId === 'region:' + g && (!type || m.membershipType === type)).map(m => m.countyId).sort();

// Census adjacency among the target counties, from the committed extract.
const ADJ = new Map();
const fipsToId = new Map(M.counties.map(c => [c.fips, c.id]));
for (const line of fs.readFileSync(path.join(DIR, 'census/county_adjacency2025_extract.txt'), 'utf8').trim().split('\n').slice(1)) {
  const [, a, , b] = line.split('|');
  if (a === b || !fipsToId.has(a) || !fipsToId.has(b)) continue;
  if (!ADJ.has(fipsToId.get(a))) ADJ.set(fipsToId.get(a), new Set());
  ADJ.get(fipsToId.get(a)).add(fipsToId.get(b));
}
const borders = (a, b) => !!(ADJ.get(a) && ADJ.get(a).has(b));

const EXPECTED = {
  'evansville-ohio-river': { primary: 'in-gibson in-posey in-vanderburgh in-warrick ky-henderson', secondary: 'il-gallatin il-white in-spencer ky-union' },
  'owensboro-western-ky': { primary: 'ky-daviess ky-hancock ky-mclean ky-ohio', secondary: 'ky-muhlenberg' },
  'madisonville-coal-fields': { primary: 'ky-caldwell ky-christian ky-crittenden ky-hopkins ky-muhlenberg ky-todd ky-union ky-webster', secondary: '' },
  'vincennes-jasper-sw-indiana': { primary: 'in-daviess in-dubois in-knox in-martin in-perry in-pike in-spencer', secondary: 'il-lawrence' },
  'southern-illinois': { primary: M.counties.filter(c => c.state === 'IL').map(c => c.id).sort().join(' '), secondary: '' },
  'paducah-murray-far-western-ky': { primary: 'ky-ballard ky-calloway ky-carlisle ky-fulton ky-graves ky-hickman ky-livingston ky-lyon ky-marshall ky-mccracken ky-trigg', secondary: 'il-alexander il-massac il-pulaski' },
  'cape-girardeau-se-missouri': { primary: M.counties.filter(c => c.state === 'MO').map(c => c.id).sort().join(' '), secondary: '' }
};
const split = s => (s ? s.split(' ') : []).sort();

test('every target county has exactly one primary region', () => {
  for (const c of M.counties) assert.equal(primaryOf(c.id).length, 1, c.id);
  assert.equal(RM.filter(m => m.membershipType === 'primary').length, 68);
});

test('regions hold only target counties, never optional ones', () => {
  const opt = new Set(OPT.counties.map(c => c.id));
  for (const m of RM) { assert.ok(byId.has(m.countyId), m.countyId); assert.ok(!opt.has(m.countyId), m.countyId); }
});

test('each region\'s memberships are explicit and match the reviewed table', () => {
  assert.deepEqual(REGIONS.map(g => g.id.slice(7)).sort(), Object.keys(EXPECTED).sort());
  for (const [g, e] of Object.entries(EXPECTED)) {
    assert.deepEqual(members(g, 'primary'), split(e.primary), g + ' primary');
    assert.deepEqual(members(g, 'secondary'), split(e.secondary), g + ' secondary');
  }
  assert.ok(RM.filter(m => m.membershipType === 'secondary').length <= 12, 'secondary memberships stay few');
});

test('every membership is primary or secondary with its own reasoning, sources and date', () => {
  const keys = new Set();
  for (const m of RM) {
    assert.ok(['primary', 'secondary'].includes(m.membershipType), m.countyId);
    assert.match(m.sourceReference, /^editorial judgment: county seat /, m.countyId);
    assert.ok(m.sourceReference.includes(byId.get(m.countyId).seat.name), m.countyId + ' names its seat');
    assert.ok(m.basedOn.includes('census-county-adjacency-2025') && m.basedOn.every(x => M.sources[x]), m.countyId);
    assert.match(m.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
    const k = m.groupId + '|' + m.countyId;
    assert.ok(!keys.has(k), 'duplicate ' + k); keys.add(k);
    if (m.membershipType === 'secondary') assert.notEqual(primaryOf(m.countyId)[0], m.groupId, m.countyId + ' secondary in its own primary region');
  }
});

test('memberships follow real adjacency: each member borders a primary member of its region', () => {
  for (const g of REGIONS) {
    const prim = members(g.id.slice(7), 'primary');
    for (const id of members(g.id.slice(7))) {
      assert.ok(prim.some(p => p !== id && borders(id, p)), g.id + ': ' + id + ' borders no primary member');
    }
    for (const h of g.hubCountyIds) assert.ok(prim.includes(h), g.id + ' hub ' + h + ' is a primary member');
  }
});

test('Missouri: only Cape Girardeau & SE Missouri, never core or the historic Tri-State', () => {
  for (const c of M.counties.filter(x => x.state === 'MO')) {
    assert.deepEqual(RM.filter(m => m.countyId === c.id).map(m => m.groupId), ['region:cape-girardeau-se-missouri'], c.id);
  }
  const ids = g => M.members.filter(m => m.groupId === g).map(m => m.countyId);
  for (const g of ['tri_state_core', 'tri_state_historic']) assert.ok(!ids(g).some(id => id.startsWith('mo-')), g);
  assert.deepEqual(members('cape-girardeau-se-missouri').filter(id => !id.startsWith('mo-')), []);
});

test('Case A: same-named counties land in the right state\'s region', () => {
  const p = id => primaryOf(id)[0].slice(7);
  assert.equal(p('il-perry'), 'southern-illinois');
  assert.equal(p('in-perry'), 'vincennes-jasper-sw-indiana');
  assert.equal(p('mo-perry'), 'cape-girardeau-se-missouri');
  assert.equal(p('il-wayne'), 'southern-illinois');
  assert.equal(p('mo-wayne'), 'cape-girardeau-se-missouri');
  assert.equal(p('il-union'), 'southern-illinois');
  assert.equal(p('ky-union'), 'madisonville-coal-fields');
  assert.equal(p('in-daviess'), 'vincennes-jasper-sw-indiana');
  assert.equal(p('ky-daviess'), 'owensboro-western-ky');
  for (const name of ['Perry', 'Wayne', 'Union', 'Daviess']) {
    const regions = M.counties.filter(c => c.name === name).map(c => p(c.id));
    assert.equal(new Set(regions).size, regions.length, name + ' counties share a primary region');
  }
});
