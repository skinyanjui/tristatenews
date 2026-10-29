// TTLs on likes and listing indexes, and the backfill script, against a throwaway local /pipeline server.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');

function fake() {
  const z = new Map(), sets = new Map(), kv = new Map(), ttl = new Map(), log = [];
  const exists = k => z.has(k) || sets.has(k) || kv.has(k);
  const run = ([op, k, ...a]) => {
    op = String(op).toUpperCase(); log.push([op, k, ...a]);
    switch (op) {
      case 'SADD': { const s = sets.get(k) || new Set(); s.add(a[0]); sets.set(k, s); return { result: 1 }; }
      case 'SREM': { const s = sets.get(k); if (s) { s.delete(a[0]); if (!s.size) { sets.delete(k); ttl.delete(k); } } return { result: 1 }; }
      case 'SCARD': return { result: (sets.get(k) || new Set()).size };
      case 'SET': kv.set(k, a[0]); if (a[1] === 'EX') ttl.set(k, +a[2]); return { result: 'OK' };
      case 'GET': return { result: kv.get(k) || null };
      case 'INCR': kv.set(k, String((+kv.get(k) || 0) + 1)); return { result: +kv.get(k) };
      case 'ZADD': { const m = z.get(k) || new Map(); m.set(a[1], +a[0]); z.set(k, m); return { result: 1 }; }
      case 'ZREMRANGEBYSCORE': { const m = z.get(k); let n = 0; if (m) for (const [id, sc] of m) if (sc <= +a[1]) { m.delete(id); n++; } return { result: n }; }
      case 'EXPIRE': if (!exists(k)) return { result: 0 }; if (a[1] === 'NX' && ttl.has(k)) return { result: 0 }; if (a[1] === 'NX' && !ttl.has(k) || a[1] !== 'NX' && a[1] !== undefined && a[1] !== 'NX' || a.length === 1) ttl.set(k, +a[0]); return { result: 1 };
      case 'SISMEMBER': return { result: 1 };
      case 'TTL': return { result: !exists(k) ? -2 : ttl.has(k) ? ttl.get(k) : -1 };
      case 'SCAN': { const re = new RegExp('^' + a[1].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'); return { result: ['0', [...sets.keys(), ...z.keys(), ...kv.keys()].filter(x => re.test(x))] }; }
      default: return (['HGETALL','SMEMBERS'].includes(String(op).toUpperCase()) ? { result: [] } : ['EXISTS','ZREM','DEL','SADD','SREM','EXPIRE','RENAME'].includes(String(op).toUpperCase()) ? { result: String(op).toUpperCase() === 'RENAME' ? 'OK' : 0 } : { error: 'unsupported ' + op });
    }
  };
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(JSON.parse(b).map(run))); }); });
  return { srv, z, sets, kv, ttl, log };
}
const res = () => { const r = { code: 0, body: '', headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = c => { r.code = c; return r; }; r.send = b => { r.body = b; return r; }; r.end = () => r; return r; };
const fresh = (mod) => { delete require.cache[require.resolve(mod)]; return require(mod); };

test('likes refresh a 180-day TTL on every write; listing index gets a TTL and is pruned on write', async () => {
  const f = fake(); await new Promise(r => f.srv.listen(0, '127.0.0.1', r));
  process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:' + f.srv.address().port; process.env.UPSTASH_REDIS_REST_TOKEN = 't';
  try {
    const react = fresh('../api/react.js');
    await react({ method: 'POST', body: { id: 'abcd1234', uid: 'user-0001', liked: true }, query: {} }, res());
    assert.equal(f.ttl.get('tsn:likes:abcd1234'), 180 * 86400);
    f.ttl.set('tsn:likes:abcd1234', 5);
    const r2 = res(); await react({ method: 'POST', body: { id: 'abcd1234', uid: 'user-0002', liked: true }, query: {} }, r2);
    assert.equal(f.ttl.get('tsn:likes:abcd1234'), 180 * 86400, 'TTL pushed back by the next write');
    assert.equal(JSON.parse(r2.body).count, 2);
    const listings = fresh('../api/listings.js');
    f.z.set('tsn:ls:index', new Map([['oldone', Date.now() - 40 * 864e5]]));
    const body = { adult: true, kind: 'item', uid: 'user-0001', title: 'Oak table', price: '$40', town: 'Evansville, IN', desc: 'Solid oak, seats four.', contact: '812-555-0100', category: 'Furniture', condition: 'Good' };
    const r = res(); await listings({ method: 'POST', body, query: {}, headers: {} }, r);
    assert.equal(r.code, 200, r.body);
    assert.equal(f.ttl.get('tsn:ls:index'), 37 * 86400);
    assert.equal(f.z.get('tsn:ls:index').has('oldone'), false, 'expired id pruned on write');
    assert.equal(f.z.get('tsn:ls:index').size, 1);
    assert.equal(listings.indexTtl('event'), 409 * 86400);
    assert.equal(listings.indexTtl('job'), 52 * 86400);
  } finally { f.srv.close(); delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; }
});

test('backfill: dry run writes nothing; --apply sets missing TTLs once and keeps existing ones', async () => {
  const f = fake(); await new Promise(r => f.srv.listen(0, '127.0.0.1', r));
  const env = Object.assign({}, process.env, { UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:' + f.srv.address().port, UPSTASH_REDIS_REST_TOKEN: 't' });
  const go = args => new Promise((ok, no) => execFile(process.execPath, [path.join(__dirname, '../scripts/backfill-ttls.js')].concat(args), { env }, (e, out, err) => e ? no(new Error(err || e.message)) : ok(out)));
  f.sets.set('tsn:likes:aaaa1111', new Set(['u1'])); f.sets.set('tsn:likes:bbbb2222', new Set(['u2'])); f.ttl.set('tsn:likes:bbbb2222', 999);
  f.z.set('tsn:ev:index', new Map([['past', Date.now() - 10 * 864e5], ['soon', Date.now() + 5 * 864e5]]));
  f.kv.set('tsn:nl:subs-like-string', 'x');
  try {
    const dry = await go([]);
    assert.match(dry, /Dry run/); assert.match(dry, /without TTL: 1/);
    assert.equal(f.log.filter(c => ['EXPIRE', 'ZREMRANGEBYSCORE'].includes(c[0])).length, 0, 'dry run never writes');
    await go(['--apply']);
    assert.equal(f.ttl.get('tsn:likes:aaaa1111'), 180 * 86400);
    assert.equal(f.ttl.get('tsn:likes:bbbb2222'), 999, 'existing TTL kept');
    assert.equal(f.ttl.get('tsn:ev:index'), 409 * 86400);
    assert.deepEqual([...f.z.get('tsn:ev:index').keys()], ['soon'], 'only already-expired event ids pruned');
    const before = JSON.stringify([...f.ttl]);
    await go(['--apply']);
    assert.equal(JSON.stringify([...f.ttl]), before, 'second run changes nothing');
  } finally { f.srv.close(); }
});
