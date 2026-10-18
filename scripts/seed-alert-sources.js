#!/usr/bin/env node
// Loads the verified official alert sources (scripts/alert-sources.json) and the tier config into Upstash Redis.
// Idempotent: running it twice leaves the same keys; entries removed from the JSON are deleted from the hash.
//   node scripts/seed-alert-sources.js            dry run: prints the commands, writes nothing
//   node scripts/seed-alert-sources.js --apply    writes, using UPSTASH_REDIS_REST_URL / _TOKEN (or KV_REST_API_*)
// Keys written:
//   tsn:alerts:sources       HASH  id -> JSON registry entry (county, agency, type, tier, url, format, verified, ...)
//   tsn:alerts:sources:meta  JSON  { checked, count, seededAt }
//   tsn:alerts:tiers         JSON  { version, tiers, nwsOverrides }   (api/alerts.js applies nwsOverrides)
// api/alerts.js reads the hash and skips any wired feed whose entry has "enabled": false.
const fs = require('fs');
const path = require('path');
const B = require('../public/breaking.js');

const apply = process.argv.includes('--apply');
const file = path.join(__dirname, 'alert-sources.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const KEY = 'tsn:alerts:sources', META = 'tsn:alerts:sources:meta', TIERS = 'tsn:alerts:tiers';

function validate(s) {
  const need = ['id', 'county', 'agency', 'type', 'tier', 'format', 'verified'];
  const miss = need.filter(k => s[k] === undefined || s[k] === null || s[k] === '');
  if (miss.length) throw new Error('source ' + (s.id || '?') + ' is missing ' + miss.join(', '));
  if (s.wired && s.verified !== 'verified-feed') throw new Error(s.id + ' is wired but not a verified feed');
  if (s.url && !/^https?:\/\//.test(s.url)) throw new Error(s.id + ' has a bad url');
}

async function redis(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('store ' + r.status);
  const out = await r.json();
  const bad = out.find(x => x && x.error); if (bad) throw new Error('store: ' + bad.error);
  return out;
}

async function main() {
  const sources = data.sources || [];
  const ids = new Set();
  sources.forEach(s => { validate(s); if (ids.has(s.id)) throw new Error('duplicate id ' + s.id); ids.add(s.id); });
  const tiers = { version: 1, tiers: B.TIERS, nws: B.NWS, nwsOverrides: {} };
  const hset = [KEY]; sources.forEach(s => hset.push(s.id, JSON.stringify(s)));
  let stale = [];
  if (apply) {
    if (!URL_ || !TOKEN) throw new Error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL / KV_REST_API_TOKEN).');
    const cur = await redis([['HKEYS', KEY]]);
    stale = ((cur[0] && cur[0].result) || []).filter(k => !ids.has(k));
  }
  const cmds = [['HSET'].concat(hset)];
  if (stale.length) cmds.push(['HDEL', KEY].concat(stale));
  cmds.push(['SET', META, JSON.stringify({ checked: data.checked, count: sources.length, seededAt: new Date().toISOString() })]);
  cmds.push(['SET', TIERS, JSON.stringify(tiers)]);
  if (!apply) {
    console.log('Dry run (nothing written). Would send to ' + (URL_ ? new URL(URL_).host : '<no store configured>') + ':');
    cmds.forEach(c => console.log('  ' + c[0] + ' ' + c[1] + (c[0] === 'HSET' ? ' (' + (c.length - 2) / 2 + ' fields: ' + sources.map(s => s.id).join(', ') + ')' : c[0] === 'HDEL' ? ' ' + c.slice(2).join(' ') : ' <' + c[2].length + ' bytes>')));
    console.log('Wired feeds: ' + sources.filter(s => s.wired).map(s => s.id).join(', '));
    return;
  }
  console.log('Writing to ' + new URL(URL_).host + ' ...');
  await redis(cmds);
  console.log('Seeded ' + sources.length + ' sources' + (stale.length ? ', removed ' + stale.length + ' stale (' + stale.join(', ') + ')' : '') + '.');
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
