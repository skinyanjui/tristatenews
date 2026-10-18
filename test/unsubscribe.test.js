// Newsletter unsubscribe endpoint, against a throwaway local /pipeline server.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

function fake() {
  const sets = new Map(), kv = new Map(), log = [];
  const run = ([op, k, ...a]) => {
    op = String(op).toUpperCase(); log.push([op, k, ...a]);
    switch (op) {
      case 'SADD': { const s = sets.get(k) || new Set(); const n = s.has(a[0]) ? 0 : 1; s.add(a[0]); sets.set(k, s); return { result: n }; }
      case 'SREM': { const s = sets.get(k); const n = s && s.delete(a[0]) ? 1 : 0; return { result: n }; }
      case 'INCR': kv.set(k, (kv.get(k) || 0) + 1); return { result: kv.get(k) };
      case 'EXPIRE': return { result: 1 };
      default: return { error: 'unsupported ' + op };
    }
  };
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(JSON.parse(b).map(run))); }); });
  return { srv, sets, kv, log };
}
const res = () => { const r = { code: 0, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = c => { r.code = c; return r; }; r.json = o => { r.body = o; return r; }; return r; };
const fresh = (mod) => { delete require.cache[require.resolve(mod)]; return require(mod); };
async function withStore(fn, env = {}) {
  const f = fake(); await new Promise(r => f.srv.listen(0, '127.0.0.1', r));
  const saved = { ...process.env };
  Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:' + f.srv.address().port, UPSTASH_REDIS_REST_TOKEN: 't', RESEND_API_KEY: '', RESEND_AUDIENCE_ID: '', NEWSLETTER_SECRET: '', CRON_SECRET: '' }, env);
  try { await fn(f, fresh('../api/unsubscribe.js')); } finally { process.env = saved; f.srv.close(); }
}
const call = async (h, body, { ip = '1.2.3.4', query = {}, method = 'POST' } = {}) => { const r = res(); await h({ method, body, query, headers: { 'x-forwarded-for': ip } }, r); return r; };

test('removes a subscribed address and answers the same for an unknown one', () => withStore(async (f, h) => {
  f.sets.set('tsn:nl:subs', new Set(['reader@example.com', 'other@example.com']));
  const a = await call(h, { email: '  Reader@Example.com ' });
  const b = await call(h, { email: 'never@example.com' }, { ip: '5.6.7.8' });
  assert.equal(a.code, 200); assert.equal(b.code, 200);
  assert.deepEqual(a.body, b.body, 'response must not reveal whether the address was on the list');
  assert.equal(a.body.message, h.DONE);
  assert.deepEqual([...f.sets.get('tsn:nl:subs')], ['other@example.com']);
  assert.equal(a.headers['Cache-Control'], 'no-store');
}));

test('rejects bad input and non-POST methods', () => withStore(async (f, h) => {
  assert.equal((await call(h, { email: 'nope' })).code, 400);
  assert.equal((await call(h, { email: 'a b@example.com' })).code, 400);
  assert.equal((await call(h, {}, { method: 'GET', query: { email: 'reader@example.com' } })).code, 405);
  assert.ok(!f.log.some(c => c[0] === 'SREM'));
}));

test('honeypot gets the normal answer and touches nothing', () => withStore(async (f, h) => {
  f.sets.set('tsn:nl:subs', new Set(['reader@example.com']));
  const r = await call(h, { email: 'reader@example.com', website: 'http://spam' });
  assert.equal(r.code, 200); assert.equal(r.body.message, h.DONE);
  assert.equal(f.log.length, 0);
  assert.ok(f.sets.get('tsn:nl:subs').has('reader@example.com'));
}));

test('rate limit: 5 a day per connection, then 429', () => withStore(async (f, h) => {
  for (let i = 0; i < 5; i++) assert.equal((await call(h, { email: 'x' + i + '@example.com' })).code, 200);
  const r = await call(h, { email: 'x9@example.com' });
  assert.equal(r.code, 429);
  assert.equal((await call(h, { email: 'x9@example.com' }, { ip: '9.9.9.9' })).code, 200, 'other connections are unaffected');
  assert.ok(f.log.some(c => c[0] === 'EXPIRE' && c[1] === 'tsn:nl:unrl:1.2.3.4' && c[2] === '86400'));
}));

test('one-click (RFC 8058) needs a valid token; typed requests do not', () => withStore(async (f, h) => {
  f.sets.set('tsn:nl:subs', new Set(['reader@example.com']));
  const tok = h.tokenFor('Reader@example.com');
  assert.match(tok, /^[0-9a-f]{32}$/);
  assert.ok(h.validToken('reader@example.com', tok));
  assert.ok(!h.validToken('other@example.com', tok));
  assert.ok(!h.validToken('reader@example.com', 'zz'));
  const bad = await call(h, { 'List-Unsubscribe': 'One-Click' }, { query: { email: 'reader@example.com', token: '0'.repeat(32) } });
  assert.equal(bad.code, 400);
  assert.ok(f.sets.get('tsn:nl:subs').has('reader@example.com'));
  const ok = await call(h, { 'List-Unsubscribe': 'One-Click' }, { query: { email: 'reader@example.com', token: tok } });
  assert.equal(ok.code, 200);
  assert.ok(!f.sets.get('tsn:nl:subs').has('reader@example.com'));
  assert.equal(h.link('reader@example.com', 'https://x.test/'), 'https://x.test/unsubscribe.html?email=reader%40example.com&token=' + tok);
}, { NEWSLETTER_SECRET: 'test-secret' }));

test('without a secret, links carry no token and one-click is refused', () => withStore(async (f, h) => {
  assert.equal(h.tokenFor('reader@example.com'), '');
  assert.equal(h.link('reader@example.com', 'https://x.test'), 'https://x.test/unsubscribe.html?email=reader%40example.com');
  assert.equal((await call(h, { 'List-Unsubscribe': 'One-Click', email: 'reader@example.com', token: '' })).code, 400);
}));

test('503 when the store is not configured', async () => {
  const saved = { ...process.env };
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.KV_REST_API_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; delete process.env.KV_REST_API_TOKEN;
  try { const h = fresh('../api/unsubscribe.js'); assert.equal((await call(h, { email: 'reader@example.com' })).code, 503); } finally { process.env = saved; }
});

test('listings POST requires the 18+ confirmation', () => withStore(async (f) => {
  const listings = fresh('../api/listings.js');
  const lres = () => { const r = { code: 0, body: '' }; r.setHeader = () => {}; r.status = c => { r.code = c; return r; }; r.send = b => { r.body = b; return r; }; r.end = () => r; return r; };
  const body = { kind: 'item', uid: 'user-0001', title: 'Oak table', price: '$40', town: 'Evansville, IN', desc: 'Solid oak, seats four.', contact: '812-555-0100', category: 'Furniture', condition: 'Good' };
  for (const adult of [undefined, false, 'true']) {
    const r = lres(); await listings({ method: 'POST', body: { ...body, adult }, query: {}, headers: {} }, r);
    assert.equal(r.code, 400, 'adult=' + adult); assert.equal(JSON.parse(r.body).field, 'adult');
  }
}));
