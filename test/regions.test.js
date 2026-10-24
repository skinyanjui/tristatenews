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
const REGION_IDS = new Set(REGIONS.map(g => g.id));
const RM = M.members.filter(m => REGION_IDS.has(m.groupId)); // top-level regions; subregions are tested below
const SUBS = M.groups.filter(g => g.kind === 'editorial_subregion');
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
  'paducah-murray-far-western-ky': { primary: 'ky-ballard ky-calloway ky-carlisle ky-fulton ky-graves ky-hickman ky-livingston ky-lyon ky-marshall ky-mccracken ky-trigg', secondary: 'il-alexander il-massac il-pulaski' }
};
const split = s => (s ? s.split(' ') : []).sort();

test('every target county has exactly one primary region', () => {
  for (const c of M.counties) assert.equal(primaryOf(c.id).length, 1, c.id);
  assert.equal(RM.filter(m => m.membershipType === 'primary').length, 57);
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

test('no Missouri region or member (southeast Missouri removed in ship62)', () => {
  assert.ok(!REGIONS.some(g => /missouri|cape-girardeau/.test(g.id)));
  assert.ok(!RM.some(m => m.countyId.startsWith('mo-')));
});

test('Case A: same-named counties land in the right state\'s region', () => {
  const p = id => primaryOf(id)[0].slice(7);
  assert.equal(p('il-perry'), 'southern-illinois');
  assert.equal(p('in-perry'), 'vincennes-jasper-sw-indiana');
  assert.equal(p('il-wayne'), 'southern-illinois');
  assert.equal(p('il-union'), 'southern-illinois');
  assert.equal(p('ky-union'), 'madisonville-coal-fields');
  assert.equal(p('in-daviess'), 'vincennes-jasper-sw-indiana');
  assert.equal(p('ky-daviess'), 'owensboro-western-ky');
  for (const name of ['Perry', 'Wayne', 'Union', 'Daviess']) {
    const regions = M.counties.filter(c => c.name === name).map(c => p(c.id));
    assert.equal(new Set(regions).size, regions.length, name + ' counties share a primary region');
  }
});

// Southern Illinois is 22 counties. It splits into two editorial subregions, child groups of the region, so a reader
// filter can narrow to the eastern river counties or the Carbondale-Marion-Mount Vernon side without leaving the region.
test('Southern Illinois subregions: east and west partition the region\'s 22 counties', () => {
  assert.deepEqual(SUBS.map(g => g.id).sort(), ['region:southern-illinois:east', 'region:southern-illinois:west']);
  const sub = id => M.members.filter(m => m.groupId === id).map(m => m.countyId).sort();
  assert.deepEqual(sub('region:southern-illinois:east'), split('il-clay il-edwards il-gallatin il-hamilton il-hardin il-lawrence il-pope il-richland il-saline il-wabash il-wayne il-white'));
  assert.deepEqual(sub('region:southern-illinois:west'), split('il-alexander il-franklin il-jackson il-jefferson il-johnson il-massac il-perry il-pulaski il-union il-williamson'));
  for (const id of members('southern-illinois')) {
    const in_ = SUBS.filter(g => M.members.some(m => m.groupId === g.id && m.countyId === id));
    assert.equal(in_.length, 1, id + ' is in exactly one subregion');
  }
  for (const g of SUBS) {
    assert.equal(g.parent, 'region:southern-illinois');
    assert.ok(REGION_IDS.has(g.parent));
    assert.equal(g.overlapping, false);
    assert.equal(g.membershipStatus, 'editorial_judgment');
    for (const m of M.members.filter(x => x.groupId === g.id)) {
      assert.equal(m.membershipType, 'primary', m.countyId);
      assert.ok(members('southern-illinois', 'primary').includes(m.countyId), m.countyId + ' is a Southern Illinois primary');
      assert.match(m.sourceReference, /^editorial judgment: county seat /, m.countyId);
      assert.ok(m.sourceReference.includes(byId.get(m.countyId).seat.name), m.countyId);
      assert.ok(m.basedOn.includes('census-county-adjacency-2025') && m.basedOn.every(x => M.sources[x]), m.countyId);
      assert.match(m.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test('Southern Illinois subregions are contiguous by Census adjacency and hold their hubs', () => {
  for (const g of SUBS) {
    const ids = M.members.filter(m => m.groupId === g.id).map(m => m.countyId);
    const seen = new Set([ids[0]]), stack = [ids[0]];
    while (stack.length) for (const n of ADJ.get(stack.pop()) || []) if (ids.includes(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    assert.equal(seen.size, ids.length, g.id + ' is one connected piece');
    for (const h of g.hubCountyIds) assert.ok(ids.includes(h), g.id + ' hub ' + h);
  }
  // The split follows the markets: Marion, Carbondale and Mount Vernon in the west; the Wabash and Ohio river towns east.
  const subOf = id => SUBS.find(g => M.members.some(m => m.groupId === g.id && m.countyId === id)).id.split(':')[2];
  for (const id of ['il-williamson', 'il-jackson', 'il-jefferson', 'il-alexander', 'il-massac']) assert.equal(subOf(id), 'west', id);
  for (const id of ['il-white', 'il-wabash', 'il-gallatin', 'il-wayne', 'il-saline']) assert.equal(subOf(id), 'east', id);
});
