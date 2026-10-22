#!/usr/bin/env node
// County page depth measurement and the index gate (plan PR 6.4, D10).
//   node scripts/build-sitemap.js --measure   fetch every feed once, here, without Redis (run it with the env -u rules),
//                                             classify the stories and write data/geography/coverage.json
//   node scripts/build-sitemap.js             print the regional sitemap the site would serve from that file
// Run --measure with EXPANDED_SOURCES_ENABLED=true SOURCE_BATCHES=b1,b2 to measure what readers would get with the
// verified batches on. /sitemap-regions.xml (api/_geopage.js) lists the 4 state pages and only the county pages whose
// measured depth (distinct local stories in 14 days) is at least DEPTH_MIN; the others are served with noindex.
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'data', 'geography', 'coverage.json');

async function measure() {
  if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL) { console.error('Refusing to run with a Redis store configured. Use the env -u rules.'); process.exit(2); }
  const news = require('../api/news.js');
  const S = require('../api/_scope.js');
  const { snapshot } = await news.refreshAll({});
  const now = Date.parse(snapshot.updatedAt);
  const depth = S.depth(snapshot, news.SOURCES, now);
  const batches = require('../api/_sources.js').activeBatches().map(b => b.batch);
  const def = S.view(snapshot, S.parse(''), news.SOURCES);
  const batchIds = new Set(require('../api/_sources.js').BATCHES.flatMap(b => b.sources).map(s => s.id));
  const rec = {
    $comment: 'Written by scripts/build-sitemap.js --measure. Distinct local stories per county in the 14 days before measuredAt, from one fetch of every feed on the build box (no Redis). County pages index only at >= min.',
    measuredAt: snapshot.updatedAt, windowDays: S.DEPTH_DAYS, min: S.DEPTH_MIN, batches,
    sources: news.SOURCES.length, items: snapshot.items.length,
    defaultView: { items: def.items.length, batchItems: snapshot.items.filter(i => batchIds.has(i.sourceId)).length, batchItemsInDefault: def.items.filter(i => batchIds.has(i.sourceId)).length },
    depth,
  };
  fs.writeFileSync(OUT, JSON.stringify(rec, null, 2) + '\n');
  const pass = Object.entries(depth).filter(([, n]) => n >= S.DEPTH_MIN);
  console.log('measured ' + rec.items + ' items from ' + rec.sources + ' sources; ' + pass.length + ' of 68 counties pass the gate (>= ' + S.DEPTH_MIN + ')');
  console.log('default view: ' + JSON.stringify(rec.defaultView));
}

if (require.main === module) {
  if (process.argv.includes('--measure')) measure().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
  else process.stdout.write(require('../api/_geopage.js').sitemap());
}
