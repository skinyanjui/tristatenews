// M1: one Redis helper (api/_store.js) used by every endpoint; never a real store.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const VARS = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
const S = require('../api/_store.js');

async function serve(reply, status = 200) {
  const srv = http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => { r.statusCode = status; r.end(JSON.stringify(reply(JSON.parse(b)))); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return srv;
}
function withEnv(env, fn) { const saved = {}; VARS.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; }); Object.assign(process.env, env); return Promise.resolve().then(fn).finally(() => VARS.forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; })); }

test('env order: UPSTASH_* first, then KV_REST_API_*; read on every call', () => withEnv({}, () => {
  assert.equal(S.stored(), false);
  process.env.KV_REST_API_URL = 'http://kv'; process.env.KV_REST_API_TOKEN = 'k';
  assert.equal(S.stored(), true); assert.equal(S.config().url, 'http://kv');
  process.env.UPSTASH_REDIS_REST_URL = 'http://up'; process.env.UPSTASH_REDIS_REST_TOKEN = 'u';
  assert.equal(S.config().url, 'http://up'); assert.equal(S.config().token, 'u');
  assert.equal(S.TIMEOUT_MS, 8000);
}));

test('pipeline: results returned; per-result error, HTTP error and no config all throw without the URL or token', async () => {
  await withEnv({}, () => assert.rejects(S.pipeline([['GET', 'a']]), /not configured/));
  const ok = await serve(cmds => cmds.map(() => ({ result: 1 })));
  const bad = await serve(cmds => cmds.map((c, i) => (i === 1 ? { error: 'WRONGTYPE' } : { result: 1 })));
  const down = await serve(() => ({ error: 'nope' }), 500);
  try {
    const at = s => ({ UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:' + s.address().port + '/', UPSTASH_REDIS_REST_TOKEN: 'secret-tok' });
    await withEnv(at(ok), async () => assert.deepEqual(await S.pipeline([['GET', 'a'], ['GET', 'b']]), [{ result: 1 }, { result: 1 }]));
    for (const [s, re] of [[bad, /store command 1 \(SET\) failed/], [down, /store HTTP 500/]]) {
      await withEnv(at(s), async () => {
        const e = await S.pipeline([['GET', 'a'], ['SET', 'b', 'c']]).catch(x => x);
        assert.match(e.message, re); assert.doesNotMatch(e.message, /127\.0\.0\.1|secret-tok/);
      });
    }
  } finally { [ok, bad, down].forEach(s => s.close()); }
});

test('no other file talks to the store directly', () => {
  const api = path.join(__dirname, '..', 'api');
  for (const f of fs.readdirSync(api).filter(f => f.endsWith('.js') && f !== '_store.js')) {
    const s = fs.readFileSync(path.join(api, f), 'utf8');
    assert.doesNotMatch(s, /\/pipeline'|process\.env\.(UPSTASH_REDIS_REST|KV_REST_API)_/, f);
  }
});
