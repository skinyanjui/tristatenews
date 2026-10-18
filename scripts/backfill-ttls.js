#!/usr/bin/env node
// One-time backfill: gives existing keys that have NO expiry the TTL the current code now sets on write.
// Idempotent: only keys whose TTL is -1 (no expiry) are touched, with EXPIRE ... NX, so a second run changes nothing.
//   node scripts/backfill-ttls.js            dry run: lists what it would do, writes nothing
//   node scripts/backfill-ttls.js --apply    writes, using UPSTASH_REDIS_REST_URL / _TOKEN (or KV_REST_API_*)
// Covers:
//   tsn:likes:*                               180 days (api/react.js LIKE_TTL; refreshed on every like/unlike)
//   tsn:ls:index tsn:dl:index tsn:ob:index    30 + 7 days   } api/listings.js indexTtl(); also prunes ids past the
//   tsn:jb:index                              45 + 7 days   } same cutoff the GET path uses (those listing records
//   tsn:ev:index                              402 + 7 days  } have already expired on their own TTL)
// Leaves alone on purpose: tsn:nl:subs (subscribers), tsn:tips / tsn:ads (capped lists, admin inbox).
const { LIKE_TTL } = require('../api/react.js');
const { indexTtl } = require('../api/listings.js');

const apply = process.argv.includes('--apply');
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const INDEXES = { 'tsn:ls:index': 'item', 'tsn:dl:index': 'deal', 'tsn:ob:index': 'obit', 'tsn:jb:index': 'job', 'tsn:ev:index': 'event' };
const CUTOFF_DAYS = { item: 30, deal: 30, obit: 30, job: 45, event: 2 };

async function redis(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('store ' + r.status);
  const out = await r.json();
  const bad = out.find(x => x && x.error); if (bad) throw new Error('store: ' + bad.error);
  return out.map(x => x.result);
}
async function scan(match) {
  const keys = []; let cursor = '0';
  do { const [res] = await redis([['SCAN', cursor, 'MATCH', match, 'COUNT', '500']]); cursor = String(res[0]); keys.push(...res[1]); } while (cursor !== '0');
  return [...new Set(keys)];
}

async function main() {
  if (!URL_ || !TOKEN) throw new Error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL / KV_REST_API_TOKEN). Even a dry run reads the store.');
  console.log((apply ? 'APPLY' : 'Dry run (nothing written)') + ' against ' + new URL(URL_).host);
  const now = Date.now(), plan = [];
  const likes = await scan('tsn:likes:*');
  const likeTtls = likes.length ? await redis(likes.map(k => ['TTL', k])) : [];
  likes.forEach((k, i) => { if (likeTtls[i] === -1) plan.push({ key: k, ttl: LIKE_TTL }); });
  const idx = Object.keys(INDEXES), idxTtls = await redis(idx.map(k => ['TTL', k]));
  const prune = [];
  idx.forEach((k, i) => {
    const kind = INDEXES[k];
    if (idxTtls[i] === -1) plan.push({ key: k, ttl: indexTtl(kind) });
    if (idxTtls[i] !== -2) prune.push(['ZREMRANGEBYSCORE', k, '-inf', String(now - CUTOFF_DAYS[kind] * 864e5)]);
  });
  console.log('tsn:likes:* keys: ' + likes.length + ', without TTL: ' + plan.filter(p => p.key.startsWith('tsn:likes:')).length);
  idx.forEach((k, i) => console.log(k + ': TTL ' + (idxTtls[i] === -2 ? 'missing key' : idxTtls[i] === -1 ? 'none -> ' + indexTtl(INDEXES[k]) + ' s' : idxTtls[i] + ' s (kept)')));
  if (!apply) { console.log('Would set ' + plan.length + ' TTLs and prune expired ids from ' + prune.length + ' indexes. Re-run with --apply to write.'); return; }
  const cmds = plan.map(p => ['EXPIRE', p.key, String(p.ttl), 'NX']).concat(prune);
  for (let i = 0; i < cmds.length; i += 200) await redis(cmds.slice(i, i + 200));
  console.log('Set ' + plan.length + ' TTLs; pruned ' + prune.length + ' indexes.');
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
