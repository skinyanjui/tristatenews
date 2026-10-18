// PR 1.3, adapter results and run records (plan 6.1): every fetched source gets one typed result, and each refresh
// stores its results privately under tsn:runs:<runId> for 7 days. Feeds, DNS and the store are stubs: no network, no
// real Redis (KV/UPSTASH variables are cleared and replaced with a fake /pipeline).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const API = path.join(__dirname, '..', 'api');
const CLEAN = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'KV_URL', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'CRON_SECRET', 'EXTRA_FEEDS', 'TICKETMASTER_API_KEY'];
const STORE_ENV = { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake-token' };
const CONTRACT = ['runId', 'sourceId', 'endpointId', 'attemptedAt', 'status', 'httpStatus', 'durationMs', 'notModified', 'itemsReceived', 'itemsAccepted', 'itemsRejected', 'rejectionReasons', 'warnings'];
const RUN_ID_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\dZ-(fast|all)-[0-9a-f]{4}$/;

function load(env) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k];
  CLEAN.forEach(k => delete process.env[k]);
  Object.assign(process.env, env || {});
  const safe = require(path.join(API, '_safe.js'));
  safe.guard.lookup = async host => [{ address: /private\.example/.test(host) ? '10.0.0.7' : '93.184.216.34', family: 4 }];
  return f => require(path.join(API, f + '.js'));
}
test.afterEach(() => CLEAN.forEach(k => delete process.env[k]));

function store() {
  const kv = new Map(), ttl = new Map(), log = [];
  const run = ([op, ...a]) => {
    log.push(op);
    if (op === 'MGET') return { result: a.map(k => (kv.has(k) ? kv.get(k) : null)) };
    if (op === 'GET') return { result: kv.has(a[0]) ? kv.get(a[0]) : null };
    if (op === 'SET') { const [k, v, ...o] = a; if (o.includes('NX') && kv.has(k)) return { result: null }; kv.set(k, v); const ex = o.indexOf('EX'); if (ex >= 0) ttl.set(k, +o[ex + 1]); return { result: 'OK' }; }
    return { error: 'unsupported ' + op };
  };
  return { kv, ttl, log, handle: body => JSON.parse(body).map(run) };
}

const rss = titles => '<?xml version="1.0"?><rss><channel>' + titles.map((t, i) => '<item><title>' + t + '</title><link>https://feeds.example.com/' + i + '</link><pubDate>' + new Date(Date.now() - 6e5).toUTCString() + '</pubDate><description>' + t + '</description></item>').join('') + '</channel></rss>';
// routes: url -> function returning a Response (or throwing); anything else 404s. Store calls go to the fake store.
function install(routes, st) {
  const realFetch = global.fetch, realTimeout = global.setTimeout;
  const asked = [];
  global.fetch = async (url, init) => {
    url = String(url);
    if (url === 'https://kv.test/pipeline') return new Response(JSON.stringify(st.handle(init.body)), { status: 200 });
    asked.push(url);
    for (const [k, f] of Object.entries(routes)) if (url === k || url.startsWith(k + '?')) return f(init);
    if (routes['*']) return routes['*'](url, init);
    return new Response('nope', { status: 404 });
  };
  global.setTimeout = (fn, ms, ...a) => realTimeout(fn, 0, ...a);
  return { asked, restore() { global.fetch = realFetch; global.setTimeout = realTimeout; } };
}
const SRC = { id: 't', name: 'Test Feed', url: 'https://feeds.example.com/rss', altUrls: ['https://alt.example.com/rss'] };
const timeoutErr = () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };

test('statusOf: each loadSource outcome maps to one plan status', () => {
  const N = load()('news');
  const cases = [
    [{ items: [{}], error: null }, 'success'],
    [{ items: [], notModified: true }, 'not_modified'],
    [{ items: [], error: 'no items', httpStatus: 200, received: 4, feedLike: true }, 'empty_valid_feed'],
    [{ items: [], error: 'no items', httpStatus: 200, received: 0, feedLike: true }, 'empty_valid_feed'],
    [{ items: [], error: 'no items', httpStatus: 200 }, 'empty_valid_feed'],
    [{ items: [], error: 'no items', httpStatus: 200, received: 0, feedLike: false }, 'invalid_response'],
    [{ items: [], error: 'no items', missingKey: true }, 'configuration_error'],
    [{ items: [], error: 'HTTP 429', httpStatus: 429, blockCount: 1 }, 'rate_limited'],
    [{ items: [], error: 'HTTP 403', httpStatus: 403, blockCount: 2 }, 'rate_limited'],
    [{ items: [], error: 'HTTP 403', httpStatus: 403, blockCount: 3 }, 'blocked'],
    [{ items: [], error: 'cooling down after rate limit', blockCount: 1 }, 'rate_limited'],
    [{ items: [], error: 'cooling down after rate limit', blockCount: 4 }, 'blocked'],
    [{ items: [], error: 'HTTP 500', httpStatus: 500 }, 'temporary_failure'],
    [{ items: [], error: 'HTTP 503', httpStatus: 503 }, 'temporary_failure'],
    [{ items: [], error: 'HTTP 404', httpStatus: 404 }, 'configuration_error'],
    [{ items: [], error: 'HTTP 410', httpStatus: 410 }, 'configuration_error'],
    [{ items: [], error: 'HTTP 300', httpStatus: 300 }, 'invalid_response'],
    [{ items: [], error: 'blocked address 10.0.0.7 for x', errorCode: 'ERR_URL_BLOCKED' }, 'configuration_error'],
    [{ items: [], error: 'invalid URL', errorCode: 'ERR_URL_INVALID' }, 'configuration_error'],
    [{ items: [], error: 'no url' }, 'configuration_error'],
    [{ items: [], error: 'body over 4194304 bytes', errorCode: 'ERR_BODY_TOO_LARGE' }, 'invalid_response'],
    [{ items: [], error: 'more than 3 redirects', errorCode: 'ERR_TOO_MANY_REDIRECTS' }, 'invalid_response'],
    [{ items: [], error: 'Unexpected token < in JSON', errorCode: 'SyntaxError' }, 'invalid_response'],
    [{ items: [], error: 'The operation was aborted due to timeout', errorCode: 'TimeoutError' }, 'temporary_failure'],
    [{ items: [], error: 'fetch failed', errorCode: 'TypeError' }, 'temporary_failure'],
    [{ items: [], error: 'DNS ENOTFOUND x', errorCode: 'ERR_DNS' }, 'temporary_failure'],
  ];
  for (const [r, want] of cases) { assert.equal(N.statusOf(r), want, JSON.stringify(r)); assert.ok(N.STATUSES.includes(want)); }
  assert.equal(N.STATUSES.length, 8);
});

test('loadSource -> adapterResult: real fetch path, one result per outcome, private detail kept apart', async () => {
  const N = load()('news');
  const big = 'x'.repeat(4 * 1024 * 1024 + 1);
  const scenarios = [
    ['success', { 'https://feeds.example.com/rss': () => new Response(rss(['Evansville council approves budget', 'Henderson opens new park'])) }, null, r => { assert.equal(r.endpointId, 'main'); assert.equal(r.httpStatus, 200); assert.equal(r.itemsAccepted, 2); assert.equal(r.itemsReceived, 2); assert.equal(r.detail, undefined); }],
    ['not_modified', { 'https://feeds.example.com/rss': () => new Response(null, { status: 304 }) }, { url: 'https://feeds.example.com/rss', etag: '"e"', items: [] }, r => { assert.equal(r.notModified, true); assert.equal(r.httpStatus, 304); }],
    ['empty_valid_feed', { 'https://feeds.example.com/rss': () => new Response(rss([])), 'https://alt.example.com/rss': () => new Response(rss([])) }, null, r => { assert.equal(r.itemsReceived, 0); assert.equal(r.detail, undefined, '"no items" is not an error'); }],
    ['invalid_response', { 'https://feeds.example.com/rss': () => new Response('<html><body>Moved to our app!</body></html>'), 'https://alt.example.com/rss': () => new Response('<!doctype html><p>hi</p>') }, null, r => assert.equal(r.itemsReceived, 0)],
    ['rate_limited', { 'https://feeds.example.com/rss': () => new Response('slow down', { status: 429 }), 'https://alt.example.com/rss': () => new Response('slow down', { status: 429 }) }, null, r => { assert.equal(r.httpStatus, 429); assert.equal(r.detail, 'HTTP 429'); }],
    ['blocked', { 'https://feeds.example.com/rss': () => new Response('no', { status: 403 }), 'https://alt.example.com/rss': () => new Response('no', { status: 403 }) }, { blockCount: 2, items: [] }, r => assert.equal(r.httpStatus, 403)],
    ['temporary_failure', { 'https://feeds.example.com/rss': () => new Response('oops', { status: 502 }), 'https://alt.example.com/rss': timeoutErr }, null, r => { assert.equal(r.endpointId, 'alt1'); assert.match(r.detail, /timeout/); }],
    ['configuration_error', { 'https://feeds.example.com/rss': () => new Response('gone', { status: 404 }), 'https://alt.example.com/rss': () => new Response('gone', { status: 410 }) }, null, r => assert.equal(r.httpStatus, 410)],
    ['configuration_error', { 'https://feeds.example.com/rss': () => new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }), 'https://alt.example.com/rss': () => new Response('', { status: 301, headers: { location: 'https://private.example.org/feed' } }) }, null, r => assert.match(r.detail, /blocked address 10\.0\.0\.7/)],
    ['invalid_response', { 'https://feeds.example.com/rss': () => new Response(big), 'https://alt.example.com/rss': () => new Response(big) }, null, r => assert.match(r.detail, /body over/)],
    ['success', { 'https://feeds.example.com/rss': () => new Response('down', { status: 500 }), 'https://alt.example.com/rss': () => new Response(rss(['Evansville school board meets'])) }, null, r => { assert.equal(r.endpointId, 'alt1'); assert.deepEqual(r.warnings, ['fallback_endpoint']); }],
  ];
  for (const [want, routes, prev, check] of scenarios) {
    const io = install(routes, store());
    try {
      const t0 = Date.now();
      const lr = await N.loadSource(SRC, prev, Date.now());
      lr.attemptedAt = new Date(t0).toISOString(); lr.durationMs = Date.now() - t0;
      const r = N.adapterResult(lr, { runId: '2026-10-18T13:38Z-fast-abcd' });
      assert.deepEqual(Object.keys(r).filter(k => k !== 'detail'), CONTRACT, 'contract keys, in order');
      assert.equal(r.status, want, want + ' ' + JSON.stringify(r));
      assert.equal(r.sourceId, 't'); assert.equal(r.runId, '2026-10-18T13:38Z-fast-abcd');
      assert.equal(r.itemsRejected, r.itemsReceived - r.itemsAccepted);
      assert.ok(Number.isFinite(r.durationMs) && r.durationMs >= 0);
      check(r);
      assert.ok(!io.asked.some(u => /169\.254|private\.example/.test(u)), 'guarded URLs never fetched: ' + io.asked.join(' '));
    } finally { io.restore(); }
  }
});

test('adapterResult: items the filters drop are counted as rejected (not_eligible); parsing stays capped at 30 RSS items', async () => {
  const N = load()('news');
  const geo = { id: 'g', name: 'Geo', geo: true, url: 'https://feeds.example.com/rss' };
  let io = install({ 'https://feeds.example.com/rss': () => new Response(rss(['Evansville council approves budget', 'Phoenix heat wave continues', 'Seattle ferry schedule changes'])) }, store());
  try {
    const r = N.adapterResult(await N.loadSource(geo, null, Date.now()), { runId: 'r' });
    assert.deepEqual([r.status, r.itemsReceived, r.itemsAccepted, r.itemsRejected], ['success', 3, 1, 2]);
    assert.deepEqual(r.rejectionReasons, { not_eligible: 2 });
  } finally { io.restore(); }
  const many = Array.from({ length: 230 }, (_, i) => 'Evansville item number ' + i);
  io = install({ 'https://feeds.example.com/rss': () => new Response(rss(many)) }, store());
  try {
    const lr = await N.loadSource({ id: 'm', name: 'Many', url: 'https://feeds.example.com/rss' }, null, Date.now());
    const r = N.adapterResult(lr, { runId: 'r' });
    assert.equal(lr.items.length, 30, 'PER_SOURCE_LIMIT: the plan cap of 200 parsed items is already stricter');
    assert.deepEqual([r.itemsReceived, r.itemsAccepted, r.warnings], [30, 30, []]);
  } finally { io.restore(); }
});

test('refreshAll writes tsn:runs:<runId> (EX 7 days) in the same write request; /api/refresh returns the runId', async () => {
  const st = store();
  const io = install({ '*': (url) => /weather|wzdx|carsprogram/.test(url) ? new Response('{"features":[]}') : /fbi\.gov/.test(url) ? new Response('no', { status: 503 }) : new Response(rss(['Evansville council approves budget'])) }, st);
  try {
    const mod = load(Object.assign({ CRON_SECRET: 'cron-test' }, STORE_ENV));
    const N = mod('news');
    const out = await N.refreshAll({});
    assert.match(out.runId, RUN_ID_RE);
    assert.ok(out.runId.includes('-all-'));
    const key = 'tsn:runs:' + out.runId;
    assert.equal(st.ttl.get(key), 7 * 86400);
    assert.equal(N.RUN_TTL, 604800);
    const rec = JSON.parse(st.kv.get(key));
    assert.deepEqual(rec, out.run);
    assert.equal(rec.tier, 'all');
    assert.equal(rec.results.length, N.SOURCES.length);
    assert.equal(rec.attempted, N.SOURCES.length);
    assert.ok(Date.parse(rec.finishedAt) >= Date.parse(rec.startedAt) && rec.durationMs >= 0);
    assert.equal(Object.values(rec.statusCounts).reduce((a, b) => a + b, 0), rec.results.length);
    for (const r of rec.results) {
      for (const k of CONTRACT) assert.ok(k in r, r.sourceId + ' ' + k);
      assert.equal(r.runId, out.runId); assert.ok(N.STATUSES.includes(r.status), r.status);
    }
    const fbi = rec.results.filter(r => /^fbi/.test(r.sourceId));
    assert.ok(fbi.length >= 3 && fbi.every(r => r.status === 'temporary_failure' && r.httpStatus === 503 && r.detail === 'HTTP 503'), JSON.stringify(fbi));
    assert.equal(st.log.filter(op => op === 'SET').length, N.SOURCES.length + 2);

    // fast tier through /api/refresh: runId in the answer, run record stored, statuses counted
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
    await mod('_refresh')({ query: { tier: 'fast' }, headers: { authorization: 'Bearer cron-test' } }, res);
    assert.equal(res.code, 200);
    assert.match(res.body.runId, RUN_ID_RE); assert.ok(res.body.runId.includes('-fast-'));
    assert.notEqual(res.body.runId, out.runId);
    const fast = JSON.parse(st.kv.get('tsn:runs:' + res.body.runId));
    assert.equal(fast.tier, 'fast');
    assert.deepEqual(res.body.statuses, fast.statusCounts);
    assert.equal(st.ttl.get('tsn:runs:' + res.body.runId), 604800);
  } finally { io.restore(); }
});

test('without a store nothing is written and the run is still described', async () => {
  const io = install({ '*': () => new Response(rss(['Evansville council approves budget'])) }, store());
  try {
    const N = load()('news');
    const out = await N.refreshAll({ tier: 'fast' });
    assert.match(out.runId, RUN_ID_RE);
    assert.deepEqual(out.store, { requests: 0, commands: 0 });
    assert.ok(out.run.results.length > 0);
    assert.ok(!io.asked.some(u => u.startsWith('https://kv.test')));
  } finally { io.restore(); }
});

// ---------- private errors: no error text in public answers (plan 6.1 and 14: "0 public error strings") ----------
const resObj = () => ({ code: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; }, json(o) { this.body = JSON.stringify(o); return this; } });
const UI_FIELDS = ['logo', 'id', 'name', 'area', 'kind', 'ok', 'count', 'lastOk', 'stale'];

test('/api/news: sources[] has no error field or text; the detail stays in tsn:src and tsn:runs', async () => {
  const st = store();
  const io = install({ '*': (url) => /fbi\.gov/.test(url) ? new Response('no', { status: 503 }) : /justice\.gov/.test(url) ? new Response('', { status: 302, headers: { location: 'http://169.254.169.254/' } }) : new Response(rss(['Evansville council approves budget'])) }, st);
  try {
    const mod = load(STORE_ENV);
    const N = mod('news');
    const { runId } = await N.refreshAll({});
    const stored = JSON.parse(st.kv.get('tsn:news:snapshot'));
    for (const s of stored.sources) assert.deepEqual(Object.keys(s), UI_FIELDS, 'stored snapshot: ' + s.id);
    const r = resObj();
    await N({ method: 'GET', url: '/api/news', query: {}, headers: {} }, r);
    assert.equal(r.code, 200);
    const body = JSON.parse(r.body);
    assert.ok(body.sources.length === N.SOURCES.length);
    for (const s of body.sources) assert.deepEqual(Object.keys(s), UI_FIELDS, s.id);
    assert.ok(!/HTTP 503|blocked address|169\.254|"error"/.test(r.body), 'no error text anywhere in the public answer');
    const fbi = body.sources.find(s => s.id === 'fbilou');
    assert.equal(fbi.ok, false, 'a failing source still reads as not ok');
    // private copies keep the detail
    assert.equal(JSON.parse(st.kv.get('tsn:src:fbilou')).error, 'HTTP 503');
    assert.match(JSON.parse(st.kv.get('tsn:src:usaosdin')).error, /blocked address 169\.254\.169\.254/);
    const rec = JSON.parse(st.kv.get('tsn:runs:' + runId));
    assert.equal(rec.results.find(x => x.sourceId === 'usaosdin').status, 'configuration_error');
    assert.ok(!io.asked.some(u => u.includes('169.254')), 'metadata address never requested');
  } finally { io.restore(); }
});

test('/api/news: a snapshot stored before PR 1.3 (with error fields) is served without them, otherwise unchanged', async () => {
  const st = store();
  const old = { updatedAt: new Date().toISOString(), sources: [
    { logo: 'https://www.google.com/s2/favicons?sz=128&domain=wthitv.com', id: 'wthi', name: 'WTHI-TV 10', area: 'Terre Haute', kind: 'news', ok: false, count: 0, error: 'no items', lastOk: null, stale: false },
    { logo: 'L', id: 'wfie', name: '14 News', area: 'Evansville', kind: 'news', ok: true, count: 3, error: null, lastOk: '2026-10-18T13:00:00.000Z', stale: false },
    { logo: 'L', id: 'msgr', name: 'The Messenger', area: 'Madisonville', kind: 'news', ok: true, count: 2, error: 'HTTP 429', lastOk: '2026-10-18T12:00:00.000Z', stale: true }],
    items: [{ id: 'wfie-0', title: 'Evansville council approves budget', link: 'https://www.14news.com/a', sourceId: 'wfie' }] };
  st.kv.set('tsn:news:snapshot', JSON.stringify(old));
  const io = install({}, st);
  try {
    const N = load(STORE_ENV)('news');
    const r = resObj();
    await N({ method: 'GET', url: '/api/news', query: {}, headers: {} }, r);
    assert.equal(r.code, 200);
    const want = Object.assign({}, old, { sources: old.sources.map(s => { const o = Object.assign({}, s); delete o.error; return o; }) });
    assert.equal(r.body, JSON.stringify(want), 'byte-identical apart from the dropped error fields');
    assert.equal(io.asked.length, 0, 'served from the store, no feed fetched');
    assert.equal(N.publicSnapshot(want), want, 'already clean: returned as is');
  } finally { io.restore(); }
});

test('/api/news: a failure answers 503 without internal detail', async () => {
  const st = store();
  st.kv.set('tsn:news:snapshot', JSON.stringify({ updatedAt: new Date().toISOString(), sources: [], items: [] }));
  const io = install({}, st);
  try {
    const N = load(STORE_ENV)('news');
    const r = resObj();
    let first = true;
    r.send = function () { if (first) { first = false; throw new Error('store 401 secret-ish detail'); } return this; };
    const realErr = console.error; console.error = () => {};
    try { await N({ method: 'GET', url: '/api/news', query: {}, headers: {} }, r); } finally { console.error = realErr; }
    assert.equal(r.code, 503);
    assert.deepEqual(JSON.parse(r.body), { error: 'news temporarily unavailable' });
  } finally { io.restore(); }
});

test('/api/alerts: public answer drops error text; the forced (secret) answer keeps it for the workflow warnings', async () => {
  const st = store();
  const io = install({ '*': () => new Response('down', { status: 500 }) }, st);
  try {
    const mod = load(Object.assign({ CRON_SECRET: 'cron-test' }, STORE_ENV));
    const alerts = mod('alerts');
    const forced = resObj();
    await alerts({ query: { refresh: '1' }, headers: { authorization: 'Bearer cron-test' } }, forced);
    const f = JSON.parse(forced.body);
    assert.equal(f.ok, false);
    assert.ok(f.sources.length > 5 && f.sources.every(s => s.error === 'HTTP 500'), 'forced answer keeps errors');
    const pub = resObj();
    await alerts({ query: {}, headers: {} }, pub);
    const p = JSON.parse(pub.body);
    assert.equal(p.sources.length, f.sources.length);
    for (const s of p.sources) { assert.ok(!('error' in s), s.id); assert.equal(s.ok, false); assert.ok('count' in s && 'id' in s); }
    assert.ok(!/HTTP 500|"error"/.test(pub.body));
    assert.ok(JSON.parse(st.kv.get('tsn:alerts:snapshot')).sources.every(s => s.error === 'HTTP 500'), 'stored snapshot unchanged');
    // without the secret, ?refresh=1 is just a public read
    const fake = resObj();
    await alerts({ query: { refresh: '1' }, headers: { authorization: 'Bearer wrong' } }, fake);
    assert.ok(!/"error"/.test(fake.body));
  } finally { io.restore(); }
});
