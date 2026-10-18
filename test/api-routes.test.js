// PR 1 route consolidation: every public /api path that existed before still works.
// Each moved path has a vercel.json rewrite to its host function, and calling the host the way Vercel does after
// that rewrite (or the way the local server does, by path) gives the same status, body and headers as calling the
// route's handler module directly, for each method, with and without auth.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const root = path.join(__dirname, '..');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

// The 12 public API paths before this change, and where each is served now.
const OLD_PATHS = ['advertise', 'alerts', 'checkout', 'listings', 'news', 'newsletter', 'react', 'refresh', 'stripe-webhook', 'submit', 'subscribe', 'unsubscribe'];
const MOVED = { refresh: ['news', '_refresh'], checkout: ['listings', '_checkout'], subscribe: ['unsubscribe', '_subscribe'], submit: ['inbox', '_submit'], advertise: ['inbox', '_advertise'] };
const functions = () => fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_')).sort();

test('at most 9 Vercel functions (Hobby allows 12)', () => {
  const fns = functions();
  assert.ok(fns.length <= 9, fns.join(', '));
  assert.deepEqual(fns, ['alerts.js', 'inbox.js', 'listings.js', 'news.js', 'newsletter.js', 'react.js', 'stripe-webhook.js', 'unsubscribe.js']);
});

test('vercel.json: every old /api path is a function or a rewrite to the host that serves it; config only names real functions', () => {
  const fns = functions().map(f => f.slice(0, -3));
  for (const p of OLD_PATHS) {
    const rw = (vercel.rewrites || []).filter(r => r.source === '/api/' + p);
    if (MOVED[p]) {
      assert.equal(rw.length, 1, p);
      assert.equal(rw[0].destination, '/api/' + MOVED[p][0] + '?__route=' + p, p);
      assert.ok(fns.includes(MOVED[p][0]), p + ' host exists');
      assert.ok(!fns.includes(p), p + ' has no function of its own any more');
    } else {
      assert.ok(fns.includes(p), p + ' keeps its own function');
      assert.equal(rw.length, 0, p + ' is not rewritten');
    }
  }
  for (const f of Object.keys(vercel.functions || {})) assert.ok(fs.existsSync(path.join(root, f)) && !path.basename(f).startsWith('_'), f);
  // no rewrite captures any other /api path, the Stripe webhook or a static page
  const apiRw = vercel.rewrites.filter(r => r.source.startsWith('/api/'));
  assert.deepEqual(apiRw.map(r => r.source).sort(), Object.keys(MOVED).map(p => '/api/' + p).sort());
});

test('maxDuration still covers the routes it covered before', () => {
  const d = f => (vercel.functions[f] || {}).maxDuration;
  assert.equal(d('api/news.js'), 30, '/api/news and /api/refresh both had 30 s');
  assert.equal(d('api/alerts.js'), 20);
  assert.equal(d('api/newsletter.js'), 60);
  for (const f of ['api/inbox.js', 'api/listings.js', 'api/unsubscribe.js']) assert.equal(d(f), undefined, f + ': hosts routes that had the platform default, so it keeps the default');
});

// ---- behavior: host vs handler, with a fake Upstash REST store ----
function fakeStore(seed) {
  seed = JSON.parse(JSON.stringify(seed)); // each store gets its own copy
  const kv = new Map(Object.entries(seed.kv || {})), sets = new Map(Object.entries(seed.sets || {}).map(([k, v]) => [k, new Set(v)])), lists = new Map(Object.entries(seed.lists || {}));
  const run = ([op, k, ...a]) => {
    switch (op) {
      case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
      case 'SET': kv.set(k, a[0]); return { result: 'OK' };
      case 'INCR': { const n = (Number(kv.get(k)) || 0) + 1; kv.set(k, String(n)); return { result: n }; }
      case 'EXPIRE': return { result: 1 };
      case 'SADD': { const s = sets.get(k) || new Set(); sets.set(k, s); let n = 0; a.forEach(m => { if (!s.has(m)) { s.add(m); n++; } }); return { result: n }; }
      case 'SREM': { const s = sets.get(k) || new Set(); let n = 0; a.forEach(m => { if (s.delete(m)) n++; }); return { result: n }; }
      case 'SMEMBERS': return { result: [...(sets.get(k) || [])] };
      case 'LPUSH': { const l = lists.get(k) || []; a.forEach(x => l.unshift(x)); lists.set(k, l); return { result: l.length }; }
      case 'LTRIM': return { result: 'OK' };
      case 'LRANGE': return { result: (lists.get(k) || []).slice(Number(a[0]), Number(a[1]) + 1) };
      case 'ZREVRANGEBYSCORE': case 'ZRANGEBYSCORE': case 'ZREVRANGE': case 'ZRANGE': return { result: [] };
      case 'MGET': return { result: [k, ...a].map(x => (kv.has(x) ? kv.get(x) : null)) };
      default: return { result: null };
    }
  };
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { res.setHeader('content-type', 'application/json'); const cmds = JSON.parse(b); res.end(JSON.stringify((Array.isArray(cmds[0]) ? cmds : [cmds]).map(run))); }); });
  return { srv, kv, sets, lists };
}
function mockRes() {
  const r = { code: 200, body: undefined, headers: {}, ended: false };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; };
  r.status = c => { r.code = c; return r; };
  r.json = o => { r.body = JSON.parse(JSON.stringify(o)); r.ended = true; return r; };
  r.send = s => { r.body = typeof s === 'string' ? (() => { try { return JSON.parse(s); } catch (_) { return s; } })() : s; r.ended = true; return r; };
  r.end = s => { if (s !== undefined) r.body = s; r.ended = true; return r; };
  return r;
}
const API = path.join(root, 'api');
function load(env) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k];
  Object.assign(process.env, env);
  return f => require(path.join(API, f + '.js'));
}
const SEED = {
  kv: { 'tsn:news:snapshot': JSON.stringify({ updatedAt: new Date().toISOString(), sources: [], items: [{ id: 'a', title: 'Hello' }] }) },
  sets: { 'tsn:nl:subs': ['reader@example.com'] },
  lists: { 'tsn:tips': [JSON.stringify({ ref: 'TSN-1', headline: 'Tip' })], 'tsn:ads': [JSON.stringify({ ref: 'AD-1', business: 'Biz' })] }
};
const BASE_ENV = { RESEND_API_KEY: '', TIPS_TO_EMAIL: '', RESEND_AUDIENCE_ID: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', NEWSLETTER_SECRET: '' };

// One request against (a) the route's own handler module and (b) the host function, as Vercel calls it after the
// rewrite (url = destination, query includes __route) and as the local server calls it (original url, no __route).
async function compare(route, reqSpec, env, withStore) {
  const [hostName, modName] = MOVED[route];
  const out = [];
  for (const mode of ['direct', 'vercel', 'local']) {
    let store = null, storeEnv = { UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', KV_REST_API_URL: '', KV_REST_API_TOKEN: '' };
    if (withStore) { store = fakeStore(SEED); await new Promise(r => store.srv.listen(0, '127.0.0.1', r)); storeEnv = { UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:' + store.srv.address().port, UPSTASH_REDIS_REST_TOKEN: 't' }; }
    const saved = { ...process.env };
    try {
      const req = (m) => {
        const query = Object.assign({}, reqSpec.query || {});
        const qs = new URLSearchParams(query).toString();
        let url = '/api/' + route + (qs ? '?' + qs : '');
        if (m === 'vercel') { query.__route = route; url = '/api/' + hostName + '?' + new URLSearchParams(query).toString(); }
        return { method: reqSpec.method, url, query, headers: Object.assign({ 'x-forwarded-for': '9.9.9.9' }, reqSpec.headers || {}), body: reqSpec.body };
      };
      const mod = load(Object.assign({}, BASE_ENV, storeEnv, env));
      const fn = mode === 'direct' ? mod(modName) : mod(hostName);
      const res = mockRes();
      await fn(req(mode), res);
      out.push({ code: res.code, body: res.body, headers: res.headers, store: store ? { kv: [...store.kv].filter(([k]) => !k.includes(':rl:')).sort(), sets: [...store.sets].map(([k, v]) => [k, [...v].sort()]), lists: [...store.lists].map(([k, v]) => [k, v.map(x => { const o = JSON.parse(x); delete o.ref; delete o.at; return o; })]) } : null });
    } finally { process.env = saved; if (store) store.srv.close(); }
  }
  // refs and timestamps are random per call; everything else must match
  const norm = o => JSON.parse(JSON.stringify(o).replace(/"(TSN|AD)-[A-Z0-9]+"/g, '"REF"'));
  assert.deepEqual(norm(out[1]), norm(out[0]), route + ' via vercel rewrite: ' + JSON.stringify(reqSpec));
  assert.deepEqual(norm(out[2]), norm(out[0]), route + ' via local path: ' + JSON.stringify(reqSpec));
  return out[0];
}

const KEY = 'admin-key-123', CRON = 'cron-secret-456';
const tip = { type: 'News tip', headline: 'Road closed on Main', details: 'The road has been closed since this morning near the bridge.', town: 'Evansville, IN', name: 'Pat Doe', email: 'pat@example.com', consent: true };
const ad = { business: 'Main St Bakery', name: 'Pat Doe', email: 'pat@example.com', interest: 'Section sponsorship', message: 'Hi' };

test('/api/refresh: same auth and answers via news.js', async () => {
  assert.equal((await compare('refresh', { method: 'GET' }, { CRON_SECRET: '' }, false)).code, 503);
  assert.equal((await compare('refresh', { method: 'GET', query: { tier: 'fast' } }, { CRON_SECRET: CRON }, false)).code, 401);
  assert.equal((await compare('refresh', { method: 'GET', headers: { authorization: 'Bearer nope' } }, { CRON_SECRET: CRON }, false)).code, 401);
  assert.equal((await compare('refresh', { method: 'GET', headers: { authorization: 'Bearer ' + CRON } }, { CRON_SECRET: CRON }, false)).code, 503, 'no store configured');
});

test('/api/checkout: same answers via listings.js', async () => {
  const g = await compare('checkout', { method: 'GET' }, {}, true);
  assert.equal(g.code, 200); assert.equal(g.body.configured, false); assert.ok(g.body.prices.job);
  assert.equal((await compare('checkout', { method: 'PUT' }, {}, true)).code, 405);
  assert.deepEqual((await compare('checkout', { method: 'POST', body: { id: 'abcdef12', kind: 'job', uid: 'user-0001' } }, {}, true)).body, { configured: false });
});

test('/api/subscribe: same signup, admin list and errors via unsubscribe.js', async () => {
  assert.equal((await compare('subscribe', { method: 'POST', body: { email: 'a@example.com' } }, { LISTINGS_ADMIN_KEY: KEY }, false)).code, 503);
  assert.equal((await compare('subscribe', { method: 'GET' }, { LISTINGS_ADMIN_KEY: KEY }, true)).code, 404);
  assert.equal((await compare('subscribe', { method: 'GET', headers: { 'x-admin-key': 'wrong' } }, { LISTINGS_ADMIN_KEY: KEY }, true)).code, 404);
  const list = await compare('subscribe', { method: 'GET', headers: { 'x-admin-key': KEY } }, { LISTINGS_ADMIN_KEY: KEY }, true);
  assert.deepEqual(list.body, { count: 1, emails: ['reader@example.com'] });
  assert.equal((await compare('subscribe', { method: 'POST', body: { email: 'bad' } }, {}, true)).code, 400);
  const ok = await compare('subscribe', { method: 'POST', body: { email: 'New@Example.com' } }, {}, true);
  assert.equal(ok.code, 200); assert.ok(ok.store.sets.find(([k]) => k === 'tsn:nl:subs')[1].includes('new@example.com'));
  assert.equal((await compare('subscribe', { method: 'DELETE' }, {}, true)).code, 405);
});

test('/api/unsubscribe keeps its own path and behavior (host fallback)', async () => {
  const load_ = load(Object.assign({}, BASE_ENV, { UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', KV_REST_API_URL: '', KV_REST_API_TOKEN: '' }));
  const h = load_('unsubscribe'), r = mockRes();
  await h({ method: 'GET', url: '/api/unsubscribe', query: {}, headers: {} }, r);
  assert.equal(r.code, 405);
  for (const k of ['link', 'tokenFor', 'validToken', 'DONE']) assert.ok(h[k], k + ' still exported');
});

test('/api/submit and /api/advertise: same answers via inbox.js; /api/inbox alone is 404', async () => {
  for (const [route, body, list] of [['submit', tip, 'tsn:tips'], ['advertise', ad, 'tsn:ads']]) {
    assert.equal((await compare(route, { method: 'POST', body }, {}, false)).code, 503, route + ' closed without store or mail');
    assert.equal((await compare(route, { method: 'GET' }, { LISTINGS_ADMIN_KEY: KEY }, true)).code, 404);
    const g = await compare(route, { method: 'GET', headers: { 'x-admin-key': KEY } }, { LISTINGS_ADMIN_KEY: KEY }, true);
    assert.equal(g.code, 200); assert.equal(g.body.items.length, 1);
    assert.equal((await compare(route, { method: 'PUT' }, {}, true)).code, 405);
    assert.equal((await compare(route, { method: 'POST', body: { name: 'x' } }, {}, true)).code, 400);
    assert.equal((await compare(route, { method: 'POST', body: Object.assign({ website: 'spam' }, body) }, {}, true)).body.ok, true, 'honeypot');
    const ok = await compare(route, { method: 'POST', body }, {}, true);
    assert.equal(ok.code, 200); assert.equal(ok.store.lists.find(([k]) => k === list)[1].length, 2);
  }
  const inbox = load(BASE_ENV)('inbox'), r = mockRes();
  await inbox({ method: 'GET', url: '/api/inbox', query: {}, headers: {} }, r);
  assert.equal(r.code, 404);
});

test('/api/news and /api/listings still run their own handlers', async () => {
  const s = fakeStore(SEED); await new Promise(r => s.srv.listen(0, '127.0.0.1', r));
  const saved = { ...process.env };
  try {
    const mod = load(Object.assign({}, BASE_ENV, { UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:' + s.srv.address().port, UPSTASH_REDIS_REST_TOKEN: 't' }));
    const news = mod('news'), r = mockRes();
    await news({ method: 'GET', url: '/api/news', query: {}, headers: {} }, r);
    assert.equal(r.code, 200); assert.equal(r.body.items[0].title, 'Hello');
    for (const k of ['parseFeed', 'combine', 'refreshAll', 'stored', 'inRegion', 'inTriState']) assert.ok(news[k], 'news.' + k + ' still exported');
    const listings = mod('listings');
    for (const k of ['validate', 'goodImage', 'indexTtl', 'indexFor']) assert.ok(listings[k], 'listings.' + k + ' still exported');
  } finally { process.env = saved; s.srv.close(); }
});
