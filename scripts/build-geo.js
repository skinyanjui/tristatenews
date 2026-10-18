#!/usr/bin/env node
// Generate the locality tables from the reviewed geography inputs. Deterministic: same inputs, same bytes.
//
//   node scripts/build-geo.js           write the outputs
//   node scripts/build-geo.js --check   exit 1 if any committed output differs from what the inputs produce
//
// Inputs (all committed):
//   data/geography/target-counties.json            the 68-county manifest, groups and regions
//   data/geography/alias-review.json               editorial review: always-ambiguous names, common words, overrides
//   data/geography/census/2025_Gaz_place_extract.txt, place_by_county2020_extract.txt, place_county_geocoder_2025.txt,
//   data/geography/census/2025_Gaz_state_extract.txt, 2025_namesakes.txt   (see scripts/extract-census.js)
// Outputs:
//   data/geography/communities.json      Census places with any part in a target county, with every target county
//   data/geography/locality-aliases.json the alias table with ambiguity flags and the reason for each flag
//   api/_geo.js                          server lookup data (not a function: api/_*.js files are helpers)
//   public/geo-data.json                 small client copy (counties, seats, internal points, regions)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'geography');
const CENSUS = path.join(DIR, 'census');
const OUTPUTS = {
  communities: 'data/geography/communities.json',
  aliases: 'data/geography/locality-aliases.json',
  geo: 'api/_geo.js',
  client: 'public/geo-data.json',
};
const INPUTS = ['data/geography/target-counties.json', 'data/geography/alias-review.json',
  'data/geography/census/2025_Gaz_place_extract.txt', 'data/geography/census/place_by_county2020_extract.txt',
  'data/geography/census/place_county_geocoder_2025.txt', 'data/geography/census/2025_Gaz_state_extract.txt',
  'data/geography/census/2025_namesakes.txt'];

// Census legal/statistical area description suffix on place names ("Evansville city", "Grand Rivers CDP").
const LSAD = /\s+(city|town|village|CDP|borough|municipality|city and borough|consolidated government|unified government|metro government|metropolitan government|urban county|corporation|comunidad|zona urbana)( \(balance\))?$/;
const baseName = n => n.replace(LSAD, '');
// Matching key: lower case, straight apostrophes, single spaces, Mt./St. spelled out.
const nameKey = n => n.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim()
  .replace(/\bmt\.?(?= )/g, 'mount').replace(/\bst\.?(?= )/g, 'saint');
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

function forms(key) { // spellings a reader might see for one key
  const out = new Set([key]);
  for (const [full, abbr] of [['mount', ['mt.', 'mt']], ['saint', ['st.', 'st']]]) {
    const re = new RegExp('\\b' + full + ' ', 'g');
    for (const f of [...out]) if (re.test(f)) for (const a of abbr) out.add(f.replace(re, a + ' '));
  }
  return [...out].sort();
}

function readTable(rel) {
  const lines = fs.readFileSync(path.join(CENSUS, rel), 'utf8').split(/\r?\n/).filter(Boolean);
  const d = lines[0].includes('\t') ? '\t' : '|';
  const head = lines[0].split(d).map(s => s.trim());
  return lines.slice(1).map(l => Object.fromEntries(l.split(d).map((v, i) => [head[i], v.trim()])));
}

function build() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'target-counties.json'), 'utf8'));
  const review = JSON.parse(fs.readFileSync(path.join(DIR, 'alias-review.json'), 'utf8'));
  const byFips = new Map(manifest.counties.map(c => [c.fips, c]));
  const states = readTable('2025_Gaz_state_extract.txt').map(r => ({ postal: r.USPS, name: r.NAME }));
  const stateName = new Map(states.map(s => [s.postal, s.name]));
  const stateKeys = new Set(states.map(s => nameKey(s.name)));
  const namesakes = new Map(readTable('2025_namesakes.txt').map(r => [r.NAME_KEY, { places: +r.PLACES_ELSEWHERE, counties: +r.COUNTIES_ELSEWHERE }]));

  // Place -> counties: the 2020 place-by-county relationship (every county a place touches), else the Geocoder answer
  // for the place's 2025 internal point (one county; whether the place spans others is unknown).
  const counties = new Map();
  for (const r of readTable('place_by_county2020_extract.txt')) {
    const g = r.STATEFP + r.PLACEFP;
    if (!counties.has(g)) counties.set(g, { source: 'census-place-by-county-2020', complete: true, fips: new Set() });
    counties.get(g).fips.add(r.STATEFP + r.COUNTYFP);
  }
  for (const r of readTable('place_county_geocoder_2025.txt')) {
    if (!counties.has(r.GEOID)) counties.set(r.GEOID, { source: 'census-geocoder-2025', complete: false, fips: new Set([r.COUNTY_GEOID]) });
  }

  const communities = [];
  const ids = new Set();
  for (const r of readTable('2025_Gaz_place_extract.txt')) {
    const c = counties.get(r.GEOID);
    if (!c) throw new Error('no county for place ' + r.GEOID + ' ' + r.NAME);
    const countyIds = [...c.fips].filter(f => byFips.has(f)).map(f => byFips.get(f).id).sort();
    if (!countyIds.length) throw new Error('place outside the target counties in extract: ' + r.GEOID);
    const name = baseName(r.NAME);
    if (name === r.NAME) throw new Error('unrecognized place name suffix: ' + r.NAME);
    let id = r.USPS.toLowerCase() + '-' + slug(name);
    if (ids.has(id)) id += '-' + countyIds[0].slice(3);
    if (ids.has(id)) throw new Error('duplicate community id ' + id);
    ids.add(id);
    communities.push({
      id, geoid: r.GEOID, name, censusName: r.NAME, state: r.USPS,
      type: / CDP$/.test(r.NAME) ? 'census_designated_place' : 'incorporated_place', funcstat: r.FUNCSTAT,
      countyIds, partlyOutside: [...c.fips].some(f => !byFips.has(f)),
      countySource: c.source, countyIdsComplete: c.complete,
      internalPoint: { lat: +r.INTPTLAT, lon: +r.INTPTLONG, source: 'census-gazetteer-2025' },
    });
  }
  communities.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name) || a.geoid.localeCompare(b.geoid));

  // Alias entries, keyed by nameKey.
  const entries = new Map();
  const entry = (key, kind) => {
    if (!entries.has(key)) entries.set(key, { alias: key, kind, forms: new Set(), refs: [] });
    return entries.get(key);
  };
  for (const p of communities) {
    const e = entry(nameKey(p.name), 'place');
    forms(nameKey(p.name)).forEach(f => e.forms.add(f));
    e.refs.push({ type: 'place', id: p.id, geoid: p.geoid, state: p.state, countyIds: p.countyIds });
  }
  const countyBase = new Map();
  for (const c of manifest.counties) {
    const k = nameKey(c.name);
    if (!countyBase.has(k)) countyBase.set(k, []);
    countyBase.get(k).push(c);
    const e = entry(k + ' county', 'county');
    forms(k + ' county').concat(forms(k + ' co.')).forEach(f => e.forms.add(f));
    e.refs.push({ type: 'county', id: c.id, state: c.state, countyIds: [c.id] });
  }
  const common = new Map(review.commonWords.map(w => [w.name, w]));
  const distinct = new Map(review.distinctive.map(w => [w.name, w]));
  const always = new Map(review.alwaysAmbiguous.map(w => [w.name, w]));
  for (const [k, cs] of countyBase) {
    const e = entries.get(k);
    if (e) { // a place shares the county's base name: the bare name may mean the county (Jackson MO vs Jackson County IL)
      for (const c of cs) if (!e.refs.some(r => r.countyIds.includes(c.id))) e.refs.push({ type: 'county', id: c.id, state: c.state, countyIds: [c.id] });
    } else if (cs.length === 1 && !stateKeys.has(k) && !common.has(k) && !always.has(k) && !(namesakes.get(k) || {}).places && !(namesakes.get(k) || {}).counties) {
      const b = entry(k, 'county'); // bare county name with no namesake anywhere in the U.S. ("Vanderburgh")
      forms(k).forEach(f => b.forms.add(f));
      b.refs.push({ type: 'county', id: cs[0].id, state: cs[0].state, countyIds: [cs[0].id] });
    }
  }
  for (const [where, m] of [['commonWords', common], ['distinctive', distinct], ['alwaysAmbiguous', always]]) {
    for (const k of m.keys()) if (!entries.has(k)) throw new Error('alias-review.json ' + where + ': "' + k + '" is not a local name');
  }

  const aliases = [...entries.values()].sort((a, b) => a.alias.localeCompare(b.alias)).map(e => {
    const base = e.kind === 'county' && e.alias.endsWith(' county') ? e.alias.slice(0, -7) : e.alias;
    const ns = namesakes.get(base) || { places: 0, counties: 0 };
    const elsewhere = e.alias.endsWith(' county') ? { places: 0, counties: ns.counties } : ns;
    const reasons = [];
    if (e.refs.length > 1) reasons.push('same_name_in_area');
    if (stateKeys.has(e.alias)) reasons.push('state_name');
    if (common.has(e.alias)) reasons.push('common_word');
    if (always.has(e.alias)) reasons.push('always_ambiguous');
    const ambiguous = reasons.length > 0;
    if (elsewhere.places + elsewhere.counties > 0) reasons.push('namesakes_elsewhere');
    if (distinct.has(e.alias) && ambiguous) throw new Error('alias-review.json distinctive: "' + e.alias + '" is ambiguous (' + reasons + ') and cannot be overridden');
    const requiresState = ambiguous || (elsewhere.places + elsewhere.counties > 0 && !distinct.has(e.alias));
    const note = (always.get(e.alias) || common.get(e.alias) || distinct.get(e.alias) || {}).reason;
    return {
      alias: e.alias, forms: [...e.forms].sort(), refs: e.refs,
      countyIds: [...new Set(e.refs.flatMap(r => r.countyIds))].sort(),
      states: [...new Set(e.refs.map(r => r.state))].sort(),
      ambiguous, requiresState, reasons, namesakesElsewhere: elsewhere,
      ...(note ? { review: note } : {}),
    };
  });

  const inputs = Object.fromEntries(INPUTS.map(f => [f, sha(fs.readFileSync(path.join(ROOT, f)))]));
  const groups = manifest.groups.map(g => ({ id: g.id, name: g.name, kind: g.kind, ...(g.parent ? { parent: g.parent } : {}) }));
  const memberOf = id => manifest.members.filter(m => m.countyId === id).map(m => m.groupId);
  const countyRows = manifest.counties.map(c => ({ id: c.id, state: c.state, name: c.name, fips: c.fips, tier: c.tier, seat: c.seat.name, lat: c.centroid.lat, lon: c.centroid.lon, groups: memberOf(c.id) }));
  // Registry detail for the read-only /api/counties and /api/regions (api/_geoapi.js).
  const registryGroups = manifest.groups.map(g => ({
    id: g.id, name: g.name, kind: g.kind, parent: g.parent || null, overlapping: !!g.overlapping,
    ...(g.membershipStatus ? { membershipStatus: g.membershipStatus } : {}), description: g.description,
    ...(g.hubCountyIds ? { hubCountyIds: g.hubCountyIds } : {}),
    members: manifest.members.filter(m => m.groupId === g.id).map(m => ({ countyId: m.countyId, type: m.membershipType })),
  }));
  const registryCounties = manifest.counties.map(c => ({
    id: c.id, state: c.state, name: c.name, fullName: c.fullName, fips: c.fips, tier: c.tier,
    seat: { name: c.seat.name, source: c.seat.source }, internalPoint: { lat: c.centroid.lat, lon: c.centroid.lon, kind: c.centroid.kind, source: c.centroid.source },
    memberships: manifest.members.filter(m => m.countyId === c.id).map(m => ({ groupId: m.groupId, type: m.membershipType })),
  }));
  const usedSources = new Set(['census-gazetteer-2025', 'census-county-adjacency-2025', 'editorial-regions-2026-10']
    .concat(manifest.counties.flatMap(c => [c.seat.source, c.centroid.source])));
  const registrySources = Object.fromEntries([...usedSources].sort().map(id => {
    const x = manifest.sources[id];
    if (!x) throw new Error('unknown source ' + id);
    return [id, Object.fromEntries(['publisher', 'title', 'url', 'vintage', 'retrieved'].filter(k => x[k]).map(k => [k, x[k]]))];
  }));
  const lines = (arr) => '[\n' + arr.map(x => '  ' + JSON.stringify(x)).join(',\n') + '\n]';

  const communitiesJson = JSON.stringify({
    schemaVersion: 1, manifestVersion: manifest.manifestVersion, generatedBy: 'scripts/build-geo.js',
    sources: {
      places: 'U.S. Census Bureau, 2025 Gazetteer Files, places (vintage 2025; census/2025_Gaz_place_extract.txt)',
      placeCounties: 'U.S. Census Bureau, 2020 place-by-county relationship files, codes2020/place_by_cou (vintage 2020; census/place_by_county2020_extract.txt)',
      placeCountiesNew: 'U.S. Census Bureau Geocoder, benchmark Public_AR_Current, vintage Current_Current, layer Counties, queried 2026-10-18 for 2025 places absent from the 2020 file (census/place_county_geocoder_2025.txt); one county per place, countyIdsComplete false',
    },
    count: communities.length, communities,
  }, null, 2) + '\n';
  const aliasesJson = JSON.stringify({
    schemaVersion: 1, manifestVersion: manifest.manifestVersion, generatedBy: 'scripts/build-geo.js',
    rules: {
      ambiguous: 'same_name_in_area OR state_name OR common_word OR always_ambiguous. An ambiguous name resolves only with a state qualifier ("Marion, Ill.") or a co-occurring county alias that picks one candidate; a feed\'s state never resolves it.',
      requiresState: 'ambiguous OR namesakes_elsewhere (the name exists outside the 68 counties, per the national 2025 Gazetteer place and county files), unless alias-review.json lists the name as distinctive. A requiresState name that is not ambiguous also resolves from the feed\'s own state.',
      distinctive: 'an override can clear requiresState for a name with namesakes elsewhere; it can never clear ambiguous.',
    },
    sources: { namesakes: 'census/2025_namesakes.txt, derived by scripts/extract-census.js from 2025_Gaz_place_national.txt and 2025_Gaz_counties_national.txt', stateNames: 'census/2025_Gaz_state_extract.txt (2025 Gazetteer, states)', review: 'data/geography/alias-review.json' },
    count: aliases.length, aliases,
  }, null, 2) + '\n';
  const geoJs = '// GENERATED by scripts/build-geo.js. Do not edit; change the inputs and run `node scripts/build-geo.js`.\n' +
    "'use strict';\n" +
    'module.exports = {\n' +
    '  manifestVersion: ' + JSON.stringify(manifest.manifestVersion) + ',\n' +
    '  inputs: ' + JSON.stringify(inputs, null, 2).replace(/\n/g, '\n  ') + ',\n' +
    '  states: ' + JSON.stringify(Object.fromEntries(states.map(s => [s.postal, s.name]))) + ',\n' +
    '  groups: ' + lines(groups).replace(/\n/g, '\n  ') + ',\n' +
    '  counties: ' + lines(countyRows).replace(/\n/g, '\n  ') + ',\n' +
    '  registry: {\n' +
    '    groups: ' + lines(registryGroups).replace(/\n/g, '\n    ') + ',\n' +
    '    counties: ' + lines(registryCounties).replace(/\n/g, '\n    ') + ',\n' +
    '    sources: ' + JSON.stringify(registrySources, null, 2).replace(/\n/g, '\n    ') + ',\n' +
    '  },\n' +
    '  aliases: ' + lines(aliases.map(a => ({ alias: a.alias, forms: a.forms, refs: a.refs.map(r => ({ type: r.type, id: r.id, state: r.state, countyIds: r.countyIds })), ambiguous: a.ambiguous, requiresState: a.requiresState, reasons: a.reasons }))).replace(/\n/g, '\n  ') + ',\n' +
    '};\n';
  const regionIds = new Set(groups.filter(g => /^editorial_(sub)?region$/.test(g.kind)).map(g => g.id));
  const clientJson = JSON.stringify({
    manifestVersion: manifest.manifestVersion,
    regions: groups.filter(g => regionIds.has(g.id)),
    counties: countyRows.map(c => ({ id: c.id, state: c.state, name: c.name, tier: c.tier, seat: c.seat, lat: c.lat, lon: c.lon, regions: c.groups.filter(g => regionIds.has(g)) })),
  }) + '\n';
  return { [OUTPUTS.communities]: communitiesJson, [OUTPUTS.aliases]: aliasesJson, [OUTPUTS.geo]: geoJs, [OUTPUTS.client]: clientJson };
}

if (require.main === module) {
  const out = build();
  if (process.argv.includes('--check')) {
    const stale = Object.keys(out).filter(f => !fs.existsSync(path.join(ROOT, f)) || fs.readFileSync(path.join(ROOT, f), 'utf8') !== out[f]);
    if (stale.length) { console.error('stale generated files (run node scripts/build-geo.js): ' + stale.join(', ')); process.exit(1); }
    console.log('generated geography files are up to date');
  } else {
    for (const [f, s] of Object.entries(out)) fs.writeFileSync(path.join(ROOT, f), s);
    console.log('wrote ' + Object.keys(out).join(', '));
  }
}

module.exports = { build, baseName, nameKey, forms, OUTPUTS, INPUTS };
