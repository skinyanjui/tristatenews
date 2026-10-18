# Geography manifest

Reviewed, version-controlled county data for the 68-county expansion (plan PR 2.1). Nothing in `api/` or
`public/` reads these files yet, and they are not served (the site only serves `public/`). The aliases table,
the generated lookups and the `/api/counties` and `/api/regions` endpoints come in PR 2.2 and PR 2.3.

| File | What it holds |
| --- | --- |
| `target-counties.json` | The 68 counties (30 `tri_state_core`, 38 `extended`), their sources, groups and memberships |
| `optional-counties.json` | Crawford and Orange IN, Breckinridge and Grayson KY. Not part of the 68, not routed, not indexed |
| `census/2025_Gaz_counties_extract.txt` | The 72 rows for these counties, copied verbatim from the Census 2025 Gazetteer counties file |
| `census/national_county2020_extract.txt` | The same 72 rows from the Census national county FIPS file (codes2020) |
| `census/county_adjacency2025_extract.txt` | Census 2025 county adjacency rows between these counties, used to check region memberships |

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

Changing a region is an editorial decision: edit the members, give the reason in `sourceReference`, bump
`manifestVersion`, and update the table above and `test/regions.test.js`.
