#!/usr/bin/env node
// Gap report (plan section 13): which target counties have no home source, from the registry's `area` fields
// (api/_location.js sourceCoverage) plus each batch entry's claimed `counties`. Offline; reads no env and no network.
//   node scripts/source-gaps.js            base registry + every batch file
//   node scripts/source-gaps.js --base     base registry only
const path = require('path');
const reg = require('../api/_sources.js');
const LOC = require('../api/_location.js');
const TARGET = require(path.join(__dirname, '..', 'data/geography/target-counties.json'));

function gaps(opts) {
  const o = opts || {};
  const counts = new Map(TARGET.counties.map(c => [c.id, 0]));
  const base = reg.registry().filter(s => !s.disabled);
  for (const s of base) for (const id of LOC.sourceCoverage(s).countyIds) if (counts.has(id)) counts.set(id, counts.get(id) + 1);
  if (!o.baseOnly) for (const b of reg.BATCHES) for (const s of b.sources) for (const id of s.counties || []) if (counts.has(id)) counts.set(id, counts.get(id) + 1);
  const rows = TARGET.counties.map(c => ({ id: c.id, tier: c.tier, sources: counts.get(c.id) }));
  return { rows, without: rows.filter(r => !r.sources) };
}

if (require.main === module) {
  const g = gaps({ baseOnly: process.argv.includes('--base') });
  const by = {};
  for (const r of g.without) (by[r.tier] = by[r.tier] || []).push(r.id);
  console.log('Counties without a home source: ' + g.without.length + ' of ' + g.rows.length);
  for (const [t, ids] of Object.entries(by)) console.log('  ' + t + ' (' + ids.length + '): ' + ids.join(', '));
}
module.exports = { gaps };
