// The seed script against a throwaway local Upstash-style /pipeline server (never production).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { execFile } = require('child_process');
const path = require('path');

function fakeUpstash() {
  const kv = new Map(), hashes = new Map();
  const run = c => {
    const [op, key, ...a] = c; const h = hashes.get(key) || new Map();
    switch (String(op).toUpperCase()) {
      case 'SET': kv.set(key, a[0]); return { result: 'OK' };
      case 'GET': return { result: kv.has(key) ? kv.get(key) : null };
      case 'HSET': for (let i = 0; i < a.length; i += 2) h.set(a[i], a[i + 1]); hashes.set(key, h); return { result: a.length / 2 };
      case 'HKEYS': return { result: [...h.keys()] };
      case 'HDEL': a.forEach(f => h.delete(f)); return { result: a.length };
      default: return { error: 'unsupported ' + op };
    }
  };
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(JSON.parse(b).map(run))); }); });
  return { srv, kv, hashes };
}
const seed = (env, args) => new Promise((ok, no) => execFile(process.execPath, [path.join(__dirname, '../scripts/seed-alert-sources.js')].concat(args), { env: Object.assign({}, process.env, env) }, (e, out, err) => e ? no(new Error(err || e.message)) : ok(out)));

test('seed is idempotent and removes stale entries', async () => {
  const f = fakeUpstash(); await new Promise(r => f.srv.listen(0, '127.0.0.1', r));
  const env = { UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:' + f.srv.address().port, UPSTASH_REDIS_REST_TOKEN: 'test' };
  try {
    const dry = await seed(env, []);
    assert.match(dry, /Dry run/); assert.equal(f.hashes.size, 0, 'dry run writes nothing');
    f.hashes.set('tsn:alerts:sources', new Map([['old-source', '{}']]));
    await seed(env, ['--apply']);
    const first = JSON.stringify([...f.hashes.get('tsn:alerts:sources')].sort());
    await seed(env, ['--apply']);
    const second = JSON.stringify([...f.hashes.get('tsn:alerts:sources')].sort());
    assert.equal(first, second);
    assert.equal(f.hashes.get('tsn:alerts:sources').has('old-source'), false);
    assert.ok(f.hashes.get('tsn:alerts:sources').has('nws-alerts'));
    assert.equal(JSON.parse(f.kv.get('tsn:alerts:tiers')).tiers.length, 7);
  } finally { f.srv.close(); }
});
