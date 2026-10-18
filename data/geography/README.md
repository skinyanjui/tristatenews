# Geography manifest

Reviewed, version-controlled county data for the 68-county expansion (plan PR 2.1), and the locality and alias
tables generated from it (PR 2.2). This folder is not served (the site only serves `public/`). The read-only
`/api/counties` and `/api/regions` (PR 2.3) answer from the generated `api/_geo.js`; no route uses the locality
lookups yet.

| File | What it holds |
| --- | --- |
| `target-counties.json` | The 68 counties (30 `tri_state_core`, 38 `extended`), their sources, groups and memberships |
| `optional-counties.json` | Crawford and Orange IN, Breckinridge and Grayson KY. Not part of the 68, not routed, not indexed |
| `census/2025_Gaz_counties_extract.txt` | The 72 rows for these counties, copied verbatim from the Census 2025 Gazetteer counties file |
| `census/national_county2020_extract.txt` | The same 72 rows from the Census national county FIPS file (codes2020) |
| `census/county_adjacency2025_extract.txt` | Census 2025 county adjacency rows between these counties, used to check region memberships |
| `alias-review.json` | Editorial review input: always-ambiguous names, common words, and the few `distinctive` overrides |
| `communities.json` | **Generated.** Census places with any part in a target county, with every target county they touch |
| `locality-aliases.json` | **Generated.** Place and county aliases with `ambiguous`, `requiresState` and the reasons for each |
| `census/2025_Gaz_place_extract.txt` | The 481 places' rows, verbatim from the Census 2025 Gazetteer places file |
| `census/place_by_county2020_extract.txt` | Every county row of those places, verbatim from the Census 2020 place-by-county files (codes2020/place_by_cou) |
| `census/place_county_geocoder_2025.txt` | Census Geocoder county for 2025 places not in the 2020 file (Public_AR_Current / Current_Current, 2026-10-18) |
| `census/2025_Gaz_state_extract.txt` | State postal codes and names, verbatim from the 2025 Gazetteer states file |
| `census/raw-sources.json` | URL, vintage, retrieval date and sha256 of each national Census file the extracts came from |
| `census/2025_namesakes.txt` | Derived: for each local name, the number of places and counties outside the area with that name (2025 Gazetteer, national) |

`scripts/build-geo.js` writes the two generated files above plus `api/_geo.js` (server lookups, not a function)
and `public/geo-data.json` (a small client copy that no page loads yet). `node scripts/build-geo.js --check` and
`test/geo-build.test.js` fail when a generated file is stale. `scripts/extract-census.js --raw <dir>` refreshes the
Census extracts from the national downloads when moving to a new vintage.

## Where each field comes from

- **FIPS, Census name, ANSI code:** Census 2025 Gazetteer counties file, checked against the national county
  FIPS file (2020) and the 2024 Gazetteer. All three agree for every county.
- **Centroid:** the Gazetteer's internal point (`INTPTLAT`, `INTPTLONG`). It is a point inside the county,
  not the geometric centroid; `centroid.kind` says so.
- **County seat:** the state's own publication: Illinois Blue Book 2025-2026 (Secretary of State), IN.gov
  county profiles, the Kentucky Department for Libraries and Archives county chart, and the Missouri Official
  Manual 2025-2026. `seat.corroboratedBy` lists a second state source where one was checked and agrees.
  `seat.asPublished` keeps the source's spelling when it abbreviates (`Mt. Vernon` is stored as `Mount Vernon`).
- **Tier and the historic Tri-State label:** Sam's expansion brief. Missouri is extended only and never a member
  of `tri_state_core` or `tri_state_historic`.

Every source has its URL, retrieval date and a sha256 of the downloaded file in `sources`. The extracts'
own sha256 values are in `censusExtracts`, and the tests check them.

## Rules

- Never fill a value from memory or Wikipedia. A field that can't be verified gets
  `verification.<field> = "unverified"` and no value.
- Each membership needs `sourceReference` and `verifiedAt`. Region memberships also list `basedOn` source ids.
- Statistical (OMB/Census metro areas) and broadcast or publisher geographies are separate groups, added later.
- Change a county only with a new `manifestVersion` and passing tests: `npm test` (or
  `node --test test/geography.test.js`).

## Editorial regions

**These regions are an editorial judgment, not official or statistical boundaries.** They group counties the
way readers and newsrooms think about the area, using county-seat geography and Census adjacency, never where a
publisher is based. Every target county has exactly one **primary** region; a few border counties also have a
**secondary** one. Each membership's `sourceReference` gives the reasoning (seat, distance from the hub county's
Census internal point, the neighbors it borders in that region, the brief's guidance). Missouri counties are
only in Cape Girardeau & SE Missouri and are never part of the historic Tri-State.

| Region (`region:<id>`) | Hub | Primary | Secondary |
| --- | --- | --- | --- |
| Evansville metro & Ohio River (`evansville-ohio-river`) | Vanderburgh IN | Vanderburgh, Warrick, Posey, Gibson IN; Henderson KY | Spencer IN; Union KY; Gallatin, White IL |
| Owensboro & Western Kentucky (`owensboro-western-ky`) | Daviess KY | Daviess, Hancock, McLean, Ohio KY | Muhlenberg KY |
| Madisonville & Western Coal Fields (`madisonville-coal-fields`) | Hopkins KY | Hopkins, Webster, Muhlenberg, Union, Christian, Todd, Caldwell, Crittenden KY | none |
| Vincennes, Jasper & SW Indiana (`vincennes-jasper-sw-indiana`) | Knox, Dubois IN | Knox, Daviess, Dubois, Pike, Martin, Perry, Spencer IN | Lawrence IL |
| Southern Illinois / Little Egypt (`southern-illinois`) | Williamson IL | All 22 Illinois counties | none |
| Paducah, Murray & far western KY (`paducah-murray-far-western-ky`) | McCracken, Calloway KY | McCracken, Graves, Calloway, Marshall, Ballard, Carlisle, Hickman, Fulton, Livingston, Lyon, Trigg KY | Massac, Pulaski, Alexander IL |
| Cape Girardeau & SE Missouri (`cape-girardeau-se-missouri`) | Cape Girardeau MO | All 11 Missouri counties | none |

### Southern Illinois subregions

Southern Illinois is the largest region (22 counties, about 75 to 95 miles from the hub at its edges) and covers two
news markets, so it has two child groups (`kind: editorial_subregion`, `parent: region:southern-illinois`). Each
Illinois county is in exactly one of them; both are contiguous by Census adjacency. They are editorial judgment too.

| Subregion (`region:southern-illinois:<id>`) | Hub | Counties |
| --- | --- | --- |
| East: Wabash & Ohio valleys (`east`) | White IL | Clay, Richland, Lawrence, Wayne, Edwards, Wabash, Hamilton, White, Saline, Gallatin, Hardin, Pope |
| West: Carbondale, Marion, Mount Vernon & Cairo (`west`) | Williamson IL | Jefferson, Perry, Franklin, Jackson, Williamson, Union, Johnson, Alexander, Pulaski, Massac |

The east looks to Evansville, Mount Carmel, Carmi and Harrisburg and holds all ten Illinois `tri_state_core`
counties; the west is the Carbondale-Marion-Mount Vernon area down to Cairo and Metropolis, all `extended`. The
hub is the county whose internal point is nearest the subregion's mean internal point.

Changing a region is an editorial decision: edit the members, give the reason in `sourceReference`, bump
`manifestVersion`, and update the tables above and `test/regions.test.js`.

## Localities and aliases

**Communities** are Census places only (incorporated places and CDPs), never a hand-typed list. A place's counties
come from the 2020 place-by-county relationship file, so a place that spans counties keeps all of them (Carbondale is
Jackson and Williamson IL; Cape Girardeau is Cape Girardeau and Scott MO). `partlyOutside` marks places that also
reach a county outside the 68 (Centralia). Places new since 2020 (mostly 2025 CDPs) take the county that contains
their internal point from the Census Geocoder; for those `countyIdsComplete` is false.

**Aliases** cover each place name (with Mount/Mt./Mt and Saint/St./St spellings), each county as "X County" and
"X Co.", and a bare county name only when no place or county anywhere in the U.S. shares it ("Vanderburgh").

- `ambiguous` when the name has two or more candidates in the area (Marion IL/KY, Mount Vernon IN/IL, Princeton,
  Benton, Greenville, Perry/Wayne/Union/Daviess County, Jackson MO vs Jackson County IL), is a state name
  (Washington), is a reviewed common word or surname (Clay, Murray, Providence), or is listed in `alwaysAmbiguous`
  (Washington, Marion, Mount Vernon). An ambiguous name resolves only with a state qualifier or a county named in
  the same text that leaves one candidate. A feed's own state never resolves it.
- `requiresState` when the name is ambiguous or has namesakes elsewhere (Henderson, Carbondale). These resolve with
  a qualifier, or bare in a feed from the candidate's state. A `distinctive` entry in `alias-review.json` can lift
  `requiresState` (Evansville, Paducah) but can never lift `ambiguous`; the build fails if one tries.

## Read-only API

`/api/counties` and `/api/regions` are served by `api/news.js` (vercel.json rewrites them to
`/api/news?__route=counties|regions`; the handlers are in `api/_geoapi.js`), so the function count stays at 8. They
answer GET and HEAD only (405 otherwise), read nothing but `api/_geo.js`, never touch Redis or the network, and are
cacheable: `Cache-Control: public, max-age=300, s-maxage=86400, stale-while-revalidate=604800` plus a strong ETag
(`If-None-Match` gets 304). They are not behind a flag: they change nothing a reader sees and no page calls them yet.

| Request | Answer |
| --- | --- |
| `GET /api/counties` | All 68 counties: id, state, name, fullName, FIPS, tier, `historicTriState`, seat (with source id), Census internal point, `regions {primary, secondary[], subregion}`; plus `tiers` and `sources` |
| `?state=IL\|IN\|KY\|MO`, `?tier=tri_state_core\|extended`, `?region=<id>`, `?id=<id>[,<id>]` | Filters, combinable. A region filter includes secondary members and accepts subregions (`southern-illinois:east`). Unknown values: 400 with `allowed`; unknown ids: 404 |
| `GET /api/regions` | The 7 regions and 2 Southern Illinois subregions: name, kind, parent, hub, states, `counties {primary[], secondary[]}`, subregions |
| `GET /api/regions?id=<id>` | One region or subregion (404 if unknown) |

Missouri counties are `extended`, `historicTriState: false`, and nothing in their entries says Tri-State.
