// Admin Sources & Coverage (api/_coverage.js via /api/news?__route=coverage): auth, report shape, the review queue,
// audited county overrides, and overrides reaching the scope filters but never the public response.
// Fake Upstash /pipeline only (global fetch stub); never a real store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..', 'api');
const CLEAN = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'UPSTASH_REDIS_URL', 'EXTRA_FEEDS', 'EXPANDED_SOURCES_ENABLED', 'SOURCE_BATCHES', 'LISTINGS_ADMIN_KEY', 'COUNTY_FILTERS_ENABLED'];
const KEY = 'test-admin-key-not-real';

function store() {
  const kv = new Map(), h = new Map(), l = new Map(), log = [];
  const run = ([op, ...a]) => {
    log.push(op);
    switch (op) {
      case 'GET': return { result: kv.has(a[0]) ? kv.get(a[0]) : null };
      case 'MGET': return { result: a.map(k => (kv.has(k) ? kv.get(k) : null)) };
      case 'SET': kv.set(a[0], a[1]); return { result: 'OK' };
      case 'HGET': return { result: (h.get(a[0]) || new Map()).get(a[1]) || null };
      case 'HSET': { const m = h.get(a[0]) || new Map(); h.set(a[0], m); m.set(a[1], a[2]); return { result: 1 }; }
      case 'HDEL': { const m = h.get(a[0]); return { result: m && m.delete(a[1]) ? 1 : 0 }; }
      case 'HGETALL': return { result: [].concat(...[...(h.get(a[0]) || new Map())]) };
      case 'LPUSH': { const x = l.get(a[0]) || []; l.set(a[0], x); x.unshift(...a.slice(1).reverse()); return { result: x.length }; }
      case 'LTRIM': { const x = l.get(a[0]) || []; l.set(a[0], x.slice(Number(a[1]), Number(a[2]) + 1)); return { result: 'OK' }; }
      case 'LRANGE': return { result: (l.get(a[0]) || []).slice(Number(a[1]), Number(a[2]) + 1) };
      default: return { error: 'ERR ' + op };
    }
  };
  return { kv, h, l, log, run };
}
function install(st) {
  const real = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url) === 'https://kv.test/pipeline') return new Response(JSON.stringify(JSON.parse(init.body).map(st.run)), { status: 200 });
    throw new Error('unexpected fetch ' + url);
  };
  return () => { global.fetch = real; };
}
function fresh(env) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k];
  CLEAN.forEach(k => delete process.env[k]);
  Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake-token' }, env || {});
  return require('../api/news.js');
}
const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = typeof b === 'string' ? JSON.parse(b) : b; return this; } });
async function call(news, method, key, body) {
  const r = res();
  await news({ method, url: '/api/coverage', query: { __route: 'coverage' }, headers: key ? { 'x-admin-key': key } : {}, body }, r);
  return r;
}
const NOW = Date.now();
const iso = h => new Date(NOW - h * 36e5).toISOString();
function seed(st, news) {
  const src = news.SOURCES.find(s => s.id === 'courier') || news.SOURCES[0];
  const items = [
    { title: 'Council approves budget for next year', link: 'https://example.com/a', source: src.name, sourceId: src.id, published: iso(2) },
    { title: 'Henderson County schools add bus route', link: 'https://example.com/b', source: src.name, sourceId: src.id, published: iso(3) },
  ];
  st.kv.set('tsn:news:snapshot', JSON.stringify({ updatedAt: iso(1), items, sources: [] }));
  st.kv.set('tsn:src:' + src.id, JSON.stringify({ items, lastTry: iso(1), lastOk: iso(1), fails: 0, error: null }));
  return { src, items };
}

test('every method answers 404 without the admin key, with a wrong key, or when no key is configured', async () => {
  const st = store(), un = install(st);
  try {
    let news = fresh({ LISTINGS_ADMIN_KEY: KEY });
    for (const m of ['GET', 'POST', 'DELETE']) for (const k of [null, 'wrong', KEY + 'x']) {
      const r = await call(news, m, k, { key: 'o0000000000000000', countyIds: ['in-dubois'] });
      assert.equal(r.code, 404, m + ' ' + k); assert.equal(r.headers['Cache-Control'], 'no-store'); assert.equal(r.headers['X-Robots-Tag'], 'noindex');
    }
    news = fresh();
    assert.equal((await call(news, 'GET', KEY)).code, 404);
    assert.equal(st.log.filter(o => o === 'HSET' || o === 'LPUSH').length, 0, 'nothing written');
  } finally { un(); }
});

test('GET reports flags, batches, source health, all 57 counties and the review queue, with no reader data', async () => {
  const st = store(), un = install(st);
  try {
    const news = fresh({ LISTINGS_ADMIN_KEY: KEY });
    const { src } = seed(st, news);
    const r = await call(news, 'GET', KEY);
    assert.equal(r.code, 200); assert.equal(r.headers['Cache-Control'], 'no-store');
    const d = r.body;
    assert.equal(d.store, true);
    assert.deepEqual(Object.keys(d.flags).sort(), require('../api/_flags.js').NAMES.slice().sort());
    assert.ok(Object.values(d.flags).every(v => typeof v === 'boolean'), 'flag states only, never values');
    assert.deepEqual(d.batches.enabled, []);
    const b2 = d.batches.files.find(b => b.id === 'b2'); assert.ok(b2.paused.includes('octimes')); assert.equal(b2.active, 0);
    const h = d.sources.find(s => s.id === src.id); assert.equal(h.status, 'ok'); assert.equal(h.items, 2);
    assert.equal(d.sources.find(s => s.id === 'octimes').status, 'paused');
    assert.equal(d.sources.find(s => s.id === 'wfiw').status, 'off', 'batch off: listed, not fetched');
    const other = d.sources.find(s => !s.batch && s.id !== src.id && s.active); assert.equal(other.status, 'not_fetched');
    assert.equal(d.counties.length, 57);
    assert.ok(!d.counties.some(c => c.state === 'MO' || /^mo-/.test(c.id)), 'no Missouri county in admin coverage');
    assert.ok(d.counties.every(c => (c.tier === 'core' || c.tier === 'extended') && typeof c.passesGate === 'boolean' && Array.isArray(c.homeSources)));
    assert.ok(d.counties.some(c => c.gap));
    assert.equal(d.gate.min, 5);
    assert.ok(Array.isArray(d.review));
    for (const row of d.review) assert.match(row.key, /^o[0-9a-f]{16}$/);
    const txt = JSON.stringify(d);
    assert.ok(!/@|fake-token|kv\.test|LISTINGS_ADMIN_KEY|test-admin-key/.test(txt), 'no emails, secrets or store details');
  } finally { un(); }
});

test('POST override validates, writes the hash and an audit entry, and can be changed and cleared', async () => {
  const st = store(), un = install(st);
  try {
    const news = fresh({ LISTINGS_ADMIN_KEY: KEY });
    const { items } = seed(st, news);
    const S = require('../api/_scope.js');
    const key = S.overrideKey(items[0]);
    assert.equal((await call(news, 'POST', KEY, { key: 'nope', countyIds: ['in-dubois'] })).code, 400);
    assert.equal((await call(news, 'POST', KEY, { key, countyIds: ['xx-nowhere'] })).code, 400);
    assert.equal((await call(news, 'POST', KEY, { key, countyIds: 'in-dubois' })).code, 400);
    assert.equal(st.log.filter(o => o === 'HSET').length, 0);
    let r = await call(news, 'POST', KEY, { key, title: items[0].title, countyIds: ['in-dubois'], note: 'Jasper <b>council</b>' });
    assert.equal(r.code, 200); assert.equal(r.body.entry.action, 'override_set'); assert.match(r.body.note, /next refresh/);
    const saved = JSON.parse(st.h.get('tsn:loc:overrides').get(key)); assert.deepEqual(saved.countyIds, ['in-dubois']);
    assert.ok(!/[<>]/.test(saved.note));
    r = await call(news, 'POST', KEY, JSON.stringify({ key, countyIds: [] }));
    assert.equal(r.body.entry.action, 'override_changed'); assert.deepEqual(r.body.entry.before, ['in-dubois']); assert.deepEqual(r.body.entry.after, []);
    r = await call(news, 'POST', KEY, { key, clear: true });
    assert.equal(r.body.entry.action, 'override_cleared'); assert.ok(!st.h.get('tsn:loc:overrides').has(key));
    const audit = st.l.get('tsn:loc:audit').map(JSON.parse);
    assert.deepEqual(audit.map(a => a.action), ['override_cleared', 'override_changed', 'override_set']);
    assert.ok(audit.every(a => a.by === 'admin key' && a.at && a.key === key));
    const g = (await call(news, 'GET', KEY)).body; assert.equal(g.audit.length, 3);
    const run = st.run; st.run = c => (c[0] === 'HSET' ? { error: 'ERR' } : run(c));
    assert.equal((await call(news, 'POST', KEY, { key, countyIds: ['in-dubois'] })).code, 502, 'a store error is not reported as saved');
  } finally { un(); }
});

test('overrides reach the scope filters through the snapshot and are stripped from the public response', () => {
  const news = fresh();
  const S = require('../api/_scope.js');
  const it = { title: 'Council approves budget for next year', link: 'https://example.com/a', source: 'X', sourceId: 'courier', published: new Date().toISOString() };
  const snap = { updatedAt: new Date().toISOString(), items: [it], sources: [], overrides: { [S.overrideKey(it)]: ['in-dubois'] } };
  const v = S.view(snap, S.parse('county:in-dubois'), news.SOURCES, { labels: true });
  assert.equal(v.items.length, 1, 'overridden story is in Dubois');
  assert.ok(!('overrides' in v));
  const none = S.view(Object.assign({}, snap, { overrides: { [S.overrideKey(it)]: [] } }), S.parse('county:in-vanderburgh'), news.SOURCES, { labels: true });
  assert.equal(none.items.length, 0, 'an empty override means no county');
  assert.ok(!('overrides' in news.publicSnapshot(snap)));
});

test('the admin page has the Sources & Coverage section, uses the shared key helpers, and still 8 functions', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  for (const id of ['cov', 'cvf', 'cvs', 'cvc', 'cvq', 'cva']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.match(html, /get\('\/api\/coverage'\)/); assert.match(html, /post\('\/api\/coverage'/);
  assert.ok(!/innerHTML/.test(html.slice(html.indexOf('Sources & Coverage (GET'))), 'text only, no innerHTML');
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const i = vercel.rewrites.findIndex(r => r.source === '/api/coverage');
  assert.equal(vercel.rewrites[i].destination, '/api/news?__route=coverage');
  const fns = fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.equal(fns.length, 8);
});
