// PR 1.2, Redis batching: the news refresh and the alerts build read their per-source state with one MGET
// instead of one GET per key, and alerts index active alerts with one ZADD. Against a fake Upstash /pipeline
// (global fetch stub, never a real store) that counts billed commands and HTTP round trips per run.
// Measured on this suite's fake feeds (counts depend only on the source lists and on how many sources are due):
//   news refresh, tier all, empty store:  before 60 GET + 60 SET + 1 = 121   after 1 MGET + 60 SET + 1 = 62
//   news refresh, tier fast, right after: before 60 GET + 13 SET + 1 = 74    after 1 MGET + 13 SET + 1 = 15
//   PR 1.3 adds one SET per run (the tsn:runs:<runId> record): all 63, fast 16, still 2 round trips
//   2026-10-22 adds HGETALL tsn:loc:overrides to the read request: all 64, fast 17, still 2 round trips
//   step 5 adds the rolling county depth record (GET in the read, SET in the write): all 66, fast 19, still 2 trips
//     (13 of the 15 fast sources are due; Courier & Press and the Gleaner poll every 30 minutes)
//   alerts, snapshot still fresh:         before 17 (3 + 14 GET)             after 2 (MGET + HGETALL)
//   alerts refresh, A active alerts:      before 17 + 1 + 3 + 12 + 2A        after 2 + 1 + 3 + 12 + A + 1
//     (11 alerts on these fake feeds: 55 before, 30 after)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const API = path.join(__dirname, '..', 'api');
const STORE_ENV = { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake-token' };
const CLEAN = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'KV_URL', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'CRON_SECRET', 'EXTRA_FEEDS'];

// Minimal Upstash-style store: strings with TTLs, hashes, sorted sets. Records every command and request.
function fakeStore() {
  const kv = new Map(), ttl = new Map(), zsets = new Map(), hashes = new Map();
  const log = { requests: 0, commands: [] };
  const run = ([op, ...a]) => {
    log.commands.push(op);
    switch (op) {
      case 'GET': return { result: kv.has(a[0]) ? kv.get(a[0]) : null };
      case 'MGET': return a.length ? { result: a.map(k => (kv.has(k) ? kv.get(k) : null)) } : { error: "ERR wrong number of arguments for 'mget' command" };
      case 'SET': {
        const [k, v, ...o] = a, nx = o.includes('NX'), ex = o.indexOf('EX');
        if (nx && kv.has(k)) return { result: null };
        kv.set(k, v); if (ex >= 0) ttl.set(k, Number(o[ex + 1])); else ttl.delete(k);
        return { result: 'OK' };
      }
      case 'DEL': { let n = 0; a.forEach(k => { if (kv.delete(k)) n++; ttl.delete(k); }); return { result: n }; }
      case 'HGETALL': return { result: [].concat(...[...(hashes.get(a[0]) || new Map())]) };
      case 'ZADD': { const z = zsets.get(a[0]) || new Map(); zsets.set(a[0], z); let n = 0; for (let i = 1; i < a.length; i += 2) { if (!z.has(a[i + 1])) n++; z.set(a[i + 1], Number(a[i])); } return { result: n }; }
      case 'ZREMRANGEBYSCORE': { const z = zsets.get(a[0]) || new Map(); let n = 0; const hi = Number(a[2]); for (const [m, s] of z) if (s <= hi) { z.delete(m); n++; } return { result: n }; }
      default: return (['HGETALL','SMEMBERS'].includes(String(op).toUpperCase()) ? { result: [] } : ['EXISTS','ZREM','DEL','SADD','SREM','EXPIRE','RENAME'].includes(String(op).toUpperCase()) ? { result: String(op).toUpperCase() === 'RENAME' ? 'OK' : 0 } : { error: 'ERR unknown command ' + op });
    }
  };
  const handle = body => { log.requests++; return JSON.parse(body).map(run); };
  return { kv, ttl, zsets, hashes, log, handle, reset() { log.requests = 0; log.commands = []; } };
}

const NOW_RSS = () => '<?xml version="1.0"?><rss><channel>' + ['Evansville council approves budget', 'Boil water notice issued for Henderson'].map((t, i) =>
  '<item><title>' + t + '</title><link>https://example.com/' + i + '</link><pubDate>' + new Date(Date.now() - 6e5).toUTCString() + '</pubDate><description>' + t + '</description></item>').join('') + '</channel></rss>';

// Feeds answer with RSS (JSON for NWS and WZDx), or fail when feedsDown is set; the store answers /pipeline.
function install(store, opts = {}) {
  const realFetch = global.fetch, realTimeout = global.setTimeout;
  global.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith('https://kv.test/')) {
      assert.equal(url, 'https://kv.test/pipeline');
      if (opts.storeReply) { store.log.requests++; return new Response(JSON.stringify(opts.storeReply(JSON.parse(init.body))), { status: 200 }); }
      return new Response(JSON.stringify(store.handle(init.body)), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (opts.feedsDown) return new Response('down', { status: 500 });
    if (/weather\.gov|wzdx|carsprogram/.test(url)) return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(NOW_RSS(), { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };
  global.setTimeout = (fn, ms, ...a) => realTimeout(fn, 0, ...a); // no real waiting (news.js pauses between same-host sources)
  return () => { global.fetch = realFetch; global.setTimeout = realTimeout; };
}
function load(env) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k];
  CLEAN.forEach(k => delete process.env[k]);
  Object.assign(process.env, env);
  // Feed hosts resolve to a public address through the guard's stub resolver: no real DNS (PR 1.3).
  require(path.join(API, '_safe.js')).guard.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  return f => require(path.join(API, f + '.js'));
}
test.afterEach(() => CLEAN.forEach(k => delete process.env[k]));

const count = (log, op) => log.commands.filter(c => c === op).length;

test('news refresh: one MGET reads every source state; writes unchanged; 2 round trips per run', async () => {
  const store = fakeStore(), restore = install(store);
  try {
    const news = load(STORE_ENV)('news');
    const N = news.SOURCES.length;
    assert.equal(N, 60);
    const all = await news.refreshAll({});
    assert.equal(store.log.requests, 2, 'one read request, one write request');
    assert.equal(count(store.log, 'MGET'), 1);
    assert.equal(count(store.log, 'GET'), 1, 'no per-source GET; the one GET is the rolling county depth record');
    assert.equal(count(store.log, 'SET'), N + 3, 'one SET per fetched source, the snapshot, the run record and the depth record');
    // 2026-10-22: the read request also carries HGETALL tsn:loc:overrides (admin county overrides): +1 command, same trips.
    assert.equal(count(store.log, 'HGETALL'), 1);
    // ship67: + the current story-id set for /api/react (DEL, SADD, RENAME, EXPIRE), same write request.
    assert.equal(store.log.commands.length, N + 10);
    assert.equal(all.report.length, N);
    assert.deepEqual(all.store, { requests: 2, commands: N + 10 }, 'refreshAll reports what it sent');
    // Same keys and TTLs as before: tsn:src:<id> for 14 days, the snapshot for 2 days.
    for (const s of news.SOURCES) assert.equal(store.ttl.get('tsn:src:' + s.id), 14 * 86400, s.id);
    assert.equal(store.ttl.get('tsn:news:snapshot'), 2 * 86400);
    assert.equal(store.kv.get('tsn:news:snapshot'), JSON.stringify(all.snapshot));
    for (const s of news.SOURCES) assert.ok(store.kv.has('tsn:src:' + s.id), s.id);

    // Fast tier right after: every source state is still read (everyMin needs it), only the due fast sources write.
    store.reset();
    const fast = await news.refreshAll({ tier: 'fast' });
    const F = fast.report.length;
    assert.ok(F > 0 && F <= 15, 'fast sources fetched: ' + F);
    assert.deepEqual([store.log.requests, count(store.log, 'MGET'), count(store.log, 'GET'), count(store.log, 'SET')], [2, 1, 1, F + 3]);
    assert.deepEqual(fast.store, { requests: 2, commands: F + 10 }); // + the story-id set (4 commands, ship67)
    assert.equal(F + 6, 19, '13 due fast sources + MGET + HGETALL + GET depth + snapshot + run record + SET depth');
    assert.equal(store.ttl.get('tsn:geo:depth'), 14 * 86400, 'depth record expires with its window');
    console.log('# measured news commands per run: all=' + (N + 3) + ' (PR 1.2: ' + (N + 2) + '), fast=' + store.log.commands.length + ' (PR 1.2: ' + (F + 2) + ')');
  } finally { restore(); }
});

test('news refresh: the MGET result feeds the next run exactly like the per-key GETs did', async () => {
  const store = fakeStore();
  let restore = install(store);
  let first;
  try { first = await load(STORE_ENV)('news').refreshAll({}); } finally { restore(); }
  // Second run with every feed down: each source keeps the stories it had (read back through MGET) and counts a failure.
  restore = install(store, { feedsDown: true });
  try {
    const news = load(STORE_ENV)('news');
    for (const s of news.SOURCES) { const st = JSON.parse(store.kv.get('tsn:src:' + s.id)); st.lastTry = new Date(Date.now() - 864e5).toISOString(); store.kv.set('tsn:src:' + s.id, JSON.stringify(st)); }
    const before = Object.fromEntries(news.SOURCES.map(s => [s.id, JSON.parse(store.kv.get('tsn:src:' + s.id))]));
    const second = await news.refreshAll({});
    let failed = 0;
    for (const s of news.SOURCES) {
      const st = JSON.parse(store.kv.get('tsn:src:' + s.id));
      assert.deepEqual(st.items, before[s.id].items, s.id + ' kept its stories');
      assert.ok(st.fails >= (before[s.id].fails || 0), s.id);
      if (st.fails === (before[s.id].fails || 0) + 1) { failed++; assert.equal(st.lastOk, before[s.id].lastOk, s.id + ' keeps its last good time'); }
    }
    assert.ok(failed > 40, 'most sources counted a failure on top of the stored count: ' + failed);
    assert.deepEqual(second.snapshot.items.map(i => i.link).sort(), first.snapshot.items.map(i => i.link).sort());
  } finally { restore(); }
});

test('news refresh: a bad MGET reply is treated as an unreachable store, never as empty state', async () => {
  const store = fakeStore();
  for (const reply of [() => [{ error: 'ERR boom' }], () => [{ result: ['only-one'] }], () => [{ result: 'OK' }]]) {
    store.reset();
    const restore = install(store, { storeReply: reply });
    try {
      const news = load(STORE_ENV)('news');
      const r = await news.refreshAll({});
      assert.equal(store.log.requests, 1, 'read attempted, nothing written');
      assert.equal(r.report.length, news.SOURCES.length, 'still refreshes live');
    } finally { restore(); }
  }
});

test('news without a store: no store requests at all (unchanged)', async () => {
  const store = fakeStore(), restore = install(store);
  try {
    const news = load({})('news');
    const r = await news.refreshAll({ tier: 'fast' });
    assert.equal(store.log.requests, 0);
    assert.deepEqual(r.store, { requests: 0, commands: 0 });
  } finally { restore(); }
});

test('alerts: one MGET plus HGETALL to read, one ZADD for the active index; same keys, values and TTLs', async () => {
  const store = fakeStore(), restore = install(store);
  try {
    const alerts = load(STORE_ENV)('alerts');
    const live = alerts.FEEDS.filter(f => !f.disabled);
    assert.deepEqual([alerts.FEEDS.length, live.length], [14, 12]);
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = JSON.parse(b); return this; }, json(o) { this.body = o; return this; } };
    await alerts({ query: {}, headers: {} }, res);
    assert.equal(res.code, 200);
    const n = res.body.alerts.length;
    assert.ok(n >= 2, 'the fake feeds give active alerts: ' + n);
    assert.equal(store.log.requests, 3, 'read, lock, write');
    assert.deepEqual(store.log.commands.slice(0, 2), ['MGET', 'HGETALL']);
    assert.equal(count(store.log, 'GET'), 0);
    assert.equal(count(store.log, 'ZADD'), 1, 'one ZADD for every active alert');
    assert.equal(store.log.commands.length, 2 + 1 + 3 + live.length + n + 1);
    console.log('# measured alerts commands per refresh: ' + store.log.commands.length + ' (was ' + (3 + alerts.FEEDS.length + 1 + 3 + live.length + 2 * n) + ')');
    // Stored exactly as before.
    assert.equal(store.ttl.get('tsn:alerts:snapshot'), 900);
    for (const f of live) assert.equal(store.ttl.get('tsn:alerts:src:' + f.id), 7 * 86400, f.id);
    assert.ok(!store.kv.has('tsn:alerts:lock'), 'lock released');
    const active = store.zsets.get('tsn:alerts:active');
    assert.equal(active.size, n);
    for (const [k, end] of active) {
      const c = JSON.parse(store.kv.get('tsn:alert:' + k));
      assert.equal(require('../public/breaking.js').endOf(c), end);
      assert.ok(store.ttl.get('tsn:alert:' + k) >= 60);
    }
    // A request while the snapshot is fresh reads only: 2 commands (was 17).
    store.reset();
    const res2 = Object.assign({}, res, { headers: {} });
    await alerts({ query: {}, headers: {} }, res2);
    assert.deepEqual(store.log.commands, ['MGET', 'HGETALL']);
    assert.deepEqual(res2.body, res.body);
  } finally { restore(); }
});

test('alerts: previous feed state, registry and tier overrides still come back from the store', async () => {
  const store = fakeStore(), restore = install(store);
  try {
    store.hashes.set('tsn:alerts:sources', new Map([['x', JSON.stringify({ feedId: 'omu-bwa', enabled: false })]]));
    store.kv.set('tsn:alerts:tiers', JSON.stringify({ nwsOverrides: {} }));
    const alerts = load(STORE_ENV)('alerts');
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, send(b) { this.body = JSON.parse(b); return this; }, json(o) { this.body = o; return this; } };
    await alerts({ query: {}, headers: {} }, res);
    assert.ok(!res.body.sources.some(s => s.id === 'omu-bwa'), 'a feed disabled in the registry is skipped');
    assert.ok(!res.body.alerts.some(c => c.sourceId === 'omu-bwa'));
    assert.ok(res.body.alerts.some(c => c.sourceId === 'hwu-bwa'));
    // A store that answers MGET badly: alerts are fetched live and nothing is written.
    store.reset();
    restore();
    const r2 = install(store, { storeReply: () => [{ error: 'ERR boom' }, { result: [] }] });
    try {
      const a2 = load(STORE_ENV)('alerts');
      const res2 = { setHeader() {}, status(c) { this.code = c; return this; }, send(b) { this.body = JSON.parse(b); return this; }, json(o) { this.body = o; return this; } };
      await a2({ query: {}, headers: {} }, res2);
      assert.equal(res2.code, 200);
      assert.equal(store.log.requests, 1);
    } finally { r2(); }
  } finally { restore(); }
});

test('/api/refresh reports the run\'s store round trips and commands', async () => {
  const store = fakeStore(), restore = install(store);
  try {
    const mod = load(Object.assign({ CRON_SECRET: 'cron-test' }, STORE_ENV));
    const refresh = mod('_refresh'), N = mod('news').SOURCES.length;
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
    await refresh({ query: { tier: 'all' }, headers: { authorization: 'Bearer cron-test' } }, res);
    assert.equal(res.code, 200);
    // ship67: + one request pruning the 5 board indexes (api/listings.js pruneCmds)
    assert.deepEqual(res.body.store, { requests: 3, commands: N + 15 });
    assert.deepEqual(res.body.store.commands, store.log.commands.length, 'matches what the store saw');
    for (const k of ['ok', 'tier', 'runId', 'ms', 'stories', 'sourcesWithStories', 'notModified', 'failing', 'statuses']) assert.ok(k in res.body, k);
  } finally { restore(); }
});
