#!/usr/bin/env node
// Refresh the Census extracts in data/geography/census/ that scripts/build-geo.js reads. Run it only when moving to a
// new Census vintage; the extracts are committed, so a normal build never needs the network.
//
//   node scripts/extract-census.js --raw <dir> [--geocode]
//
// <dir> holds the downloaded national files (names as published by the Census Bureau):
//   2025_Gaz_place_national.txt     https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip
//   2025_Gaz_counties_national.txt  https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_counties_national.zip
//   2025_Gaz_state_national.txt     https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_state_national.zip
//   st17_il_place_by_county2020.txt, st18_in_…, st21_ky_…, st29_mo_…  https://www2.census.gov/geo/docs/reference/codes2020/place_by_cou/
// Places that exist in the 2025 Gazetteer but not in the 2020 place-by-county files (new CDPs and places) get their
// county from the Census Geocoder (point-in-county for the Gazetteer internal point). --geocode asks the Geocoder;
// without it the previous answers in census/place_county_geocoder_2025.txt are reused.
//
// Outputs (verbatim Census rows, header kept, unless noted):
//   census/2025_Gaz_place_extract.txt        places with any part in a target county
//   census/place_by_county2020_extract.txt   every county row of those places
//   census/place_county_geocoder_2025.txt    Geocoder answers for 2025-only places near the area
//   census/2025_Gaz_state_extract.txt        all states (postal code and name)
//   census/raw-sources.json                  URL, vintage and sha256 of each national file used
//   census/2025_namesakes.txt                derived: for each local name, how many places and counties elsewhere in the
//                                            U.S. share it (from the two national Gazetteer files)
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'data', 'geography');
const OUT = path.join(DIR, 'census');
const { baseName, nameKey } = require('./build-geo.js');

function readTable(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const d = lines[0].includes('\t') ? '\t' : '|';
  const head = lines[0].split(d).map(s => s.trim());
  return { header: lines[0].replace(/\s+$/, ''), rows: lines.slice(1).map(l => ({ line: l.replace(/\s+$/, ''), r: Object.fromEntries(l.split(d).map((v, i) => [head[i], v.trim()])) })) };
}
const write = (name, lines) => fs.writeFileSync(path.join(OUT, name), lines.join('\n') + '\n');

async function main() {
  const args = process.argv.slice(2);
  const raw = args[args.indexOf('--raw') + 1];
  if (!raw || args.indexOf('--raw') < 0) { console.error('usage: node scripts/extract-census.js --raw <dir> [--geocode]'); process.exit(2); }
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'target-counties.json'), 'utf8'));
  const target = new Set(manifest.counties.map(c => c.fips));

  const pbc = ['st17_il', 'st18_in', 'st21_ky', 'st29_mo'].flatMap(s => readTable(path.join(raw, s + '_place_by_county2020.txt')).rows);
  const pbcHeader = readTable(path.join(raw, 'st17_il_place_by_county2020.txt')).header;
  const countiesOf = new Map();
  for (const { r } of pbc) { const g = r.STATEFP + r.PLACEFP; if (!countiesOf.has(g)) countiesOf.set(g, new Set()); countiesOf.get(g).add(r.STATEFP + r.COUNTYFP); }

  const gaz = readTable(path.join(raw, '2025_Gaz_place_national.txt'));
  const geoFile = path.join(OUT, 'place_county_geocoder_2025.txt');
  const geoHeader = 'GEOID|NAME|INTPTLAT|INTPTLONG|COUNTY_GEOID|COUNTY_NAME|BENCHMARK|VINTAGE';
  const cached = fs.existsSync(geoFile) ? readTable(geoFile).rows : [];
  const geocoded = new Map(cached.map(({ line, r }) => [r.GEOID, { line, r }]));
  const near = r => +r.INTPTLAT > 36.0 && +r.INTPTLAT < 39.4 && +r.INTPTLONG > -91.4 && +r.INTPTLONG < -85.9;
  for (const { r } of gaz.rows) {
    if (!['IL', 'IN', 'KY', 'MO'].includes(r.USPS) || countiesOf.has(r.GEOID) || !near(r)) continue;
    if (!geocoded.has(r.GEOID) && args.includes('--geocode')) {
      const u = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=' + r.INTPTLONG + '&y=' + r.INTPTLAT + '&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json';
      const c = (await (await fetch(u)).json()).result.geographies.Counties[0];
      geocoded.set(r.GEOID, { r: { GEOID: r.GEOID, COUNTY_GEOID: c.GEOID }, line: [r.GEOID, r.NAME, r.INTPTLAT, r.INTPTLONG, c.GEOID, c.NAME, 'Public_AR_Current', 'Current_Current'].join('|') });
    }
  }
  for (const [g, { r }] of geocoded) if (!countiesOf.has(g)) countiesOf.set(g, new Set([r.COUNTY_GEOID]));
  const inArea = g => countiesOf.has(g) && [...countiesOf.get(g)].some(f => target.has(f));

  const places = gaz.rows.filter(({ r }) => inArea(r.GEOID));
  write('2025_Gaz_place_extract.txt', [gaz.header].concat(places.map(x => x.line)));
  const keep = new Set(places.map(x => x.r.GEOID));
  write('place_by_county2020_extract.txt', [pbcHeader].concat(pbc.filter(({ r }) => keep.has(r.STATEFP + r.PLACEFP)).map(x => x.line)));
  write('place_county_geocoder_2025.txt', [geoHeader].concat([...geocoded.values()].sort((a, b) => a.r.GEOID < b.r.GEOID ? -1 : 1).map(x => x.line)));
  const states = readTable(path.join(raw, '2025_Gaz_state_national.txt'));
  write('2025_Gaz_state_extract.txt', [states.header].concat(states.rows.map(x => x.line)));

  // Namesakes: local names (places and county base names) and how often they occur outside the target area.
  const counties = readTable(path.join(raw, '2025_Gaz_counties_national.txt')).rows;
  const countyBase = n => n.replace(/ (County|Parish|Borough|Census Area|City and Borough|Municipality|Municipio|city)$/, '');
  const local = new Set(places.map(({ r }) => nameKey(baseName(r.NAME))).concat(manifest.counties.map(c => nameKey(c.name))));
  const elsewhere = new Map([...local].map(k => [k, { places: 0, counties: 0, states: new Set() }]));
  for (const { r } of gaz.rows) { const k = nameKey(baseName(r.NAME)); if (elsewhere.has(k) && !keep.has(r.GEOID)) { elsewhere.get(k).places++; elsewhere.get(k).states.add(r.USPS); } }
  for (const { r } of counties) { const k = nameKey(countyBase(r.NAME)); if (elsewhere.has(k) && !target.has(r.GEOID)) { elsewhere.get(k).counties++; elsewhere.get(k).states.add(r.USPS); } }
  write('2025_namesakes.txt', ['NAME_KEY|PLACES_ELSEWHERE|COUNTIES_ELSEWHERE|STATES'].concat([...elsewhere].sort().map(([k, v]) => [k, v.places, v.counties, [...v.states].sort().join(',')].join('|'))));
  const G = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/';
  const P = 'https://www2.census.gov/geo/docs/reference/codes2020/place_by_cou/';
  const RAW = [['2025_Gaz_place_national.txt', G + '2025_Gaz_place_national.zip', '2025'], ['2025_Gaz_counties_national.txt', G + '2025_Gaz_counties_national.zip', '2025'],
    ['2025_Gaz_state_national.txt', G + '2025_Gaz_state_national.zip', '2025']]
    .concat(['st17_il', 'st18_in', 'st21_ky', 'st29_mo'].map(s => [s + '_place_by_county2020.txt', P + s + '_place_by_county2020.txt', '2020']));
  const sha = f => require('crypto').createHash('sha256').update(fs.readFileSync(path.join(raw, f))).digest('hex');
  const retrieved = args.includes('--retrieved') ? args[args.indexOf('--retrieved') + 1] : new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(OUT, 'raw-sources.json'), JSON.stringify({
    publisher: 'U.S. Census Bureau', retrieved,
    geocoder: { url: 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates', benchmark: 'Public_AR_Current', vintage: 'Current_Current', layer: 'Counties', queried: '2026-10-18' },
    files: RAW.map(([file, url, vintage]) => ({ file, url, vintage, sha256: sha(file) })),
  }, null, 2) + '\n');
  console.log('places', places.length, 'geocoded', geocoded.size, 'names', elsewhere.size);
}
main().catch(e => { console.error(e); process.exit(1); });
