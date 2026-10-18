// The local dev server (server.js) must not use real Redis unless TSN_ALLOW_LIVE_REDIS=1.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { devStore, LIVE_VARS } = require('../scripts/dev-store.js');
const MEM = 'http://127.0.0.1:3000/_internal_redis';

test('KV and Upstash credentials are dropped in favor of the in-memory store', () => {
  for (const set of [{ KV_REST_API_URL: 'https://live.example', KV_REST_API_TOKEN: 't' }, { UPSTASH_REDIS_REST_URL: 'https://live.example', UPSTASH_REDIS_REST_TOKEN: 't' },
    { KV_REST_API_URL: 'https://a', KV_REST_API_TOKEN: 'x', UPSTASH_REDIS_REST_URL: 'https://b', KV_URL: 'rediss://c', REDIS_URL: 'redis://d', KV_REST_API_READ_ONLY_TOKEN: 'r' }]) {
    const env = Object.assign({ PATH: '/bin' }, set);
    const r = devStore(env, 3000);
    assert.equal(r.mode, 'memory'); assert.deepEqual(r.vars.sort(), Object.keys(set).sort());
    assert.equal(env.UPSTASH_REDIS_REST_URL, MEM); assert.equal(env.UPSTASH_REDIS_REST_TOKEN, 'internal_dev_token');
    for (const k of LIVE_VARS.filter(k => !k.startsWith('UPSTASH_REDIS_REST'))) assert.equal(env[k], undefined, k);
    assert.equal(env.PATH, '/bin');
  }
});

test('nothing set: in-memory store; opt-in without credentials: still in-memory', () => {
  let env = {}; assert.deepEqual(devStore(env, 3000), { mode: 'memory', vars: [] }); assert.equal(env.UPSTASH_REDIS_REST_URL, MEM);
  env = { TSN_ALLOW_LIVE_REDIS: '1' }; assert.equal(devStore(env, 3000).mode, 'memory');
});

test('TSN_ALLOW_LIVE_REDIS=1 keeps real credentials untouched; any other value does not', () => {
  const env = { TSN_ALLOW_LIVE_REDIS: '1', KV_REST_API_URL: 'https://live.example', KV_REST_API_TOKEN: 't' };
  assert.deepEqual(devStore(env, 3000), { mode: 'live', vars: ['KV_REST_API_URL', 'KV_REST_API_TOKEN'] });
  assert.equal(env.KV_REST_API_URL, 'https://live.example'); assert.equal(env.UPSTASH_REDIS_REST_URL, undefined);
  for (const v of ['true', 'yes', '0', '']) { const e = { TSN_ALLOW_LIVE_REDIS: v, KV_REST_API_URL: 'https://live.example' }; assert.equal(devStore(e, 3000).mode, 'memory', v); assert.equal(e.KV_REST_API_URL, undefined); }
});

test('server.js chooses the store before it loads any API handler and has no other store switch', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const guard = src.indexOf("require('./scripts/dev-store.js').devStore(process.env, PORT)");
  assert.ok(guard > 0, 'guard present');
  assert.ok(guard < src.indexOf("require('./api/"), 'guard runs before handlers read their env');
  assert.ok(!/if \(!process\.env\.UPSTASH_REDIS_REST_URL && !process\.env\.KV_REST_API_URL\)/.test(src), 'old pass-through check removed');
});
