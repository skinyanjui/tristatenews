// County expansion step 1 (plan PR 4.2): the article location contract and the shadow classifier.
// Stories are placed where they happen, from their own text; ambiguous names stay unassigned with a reason;
// source coverage, article geography and reader preference stay separate; shadow mode changes nothing readers see.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const CLEAN = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'KV_URL', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'UPSTASH_REDIS_URL', 'CRON_SECRET', 'EXTRA_FEEDS', 'COUNTY_CLASSIFICATION_ENABLED', 'LISTINGS_ADMIN_KEY'];
CLEAN.forEach(k => delete process.env[k]);
const L = require('../api/_location.js');
const FLAGS = require('../api/_flags.js');
const GEO = require('../api/_geo.js');
const { SOURCES } = require('../api/news.js');
const CASES = require('./fixtures/expansion/location-cases.json').cases;
const src = id => { const s = SOURCES.find(x => x.id === id); assert.ok(s, 'source ' + id); return s; };
const sorted = a => [...a].sort();

test('fixture cases: county sets, scopes and reasons', () => {
  assert.ok(CASES.length >= 20);
  for (const c of CASES) {
    const l = L.classify(c.item, src(c.source));
    assert.equal(l.scope, c.expect.scope, c.name);
    assert.deepEqual(sorted(l.countyIds), sorted(c.expect.countyIds), c.name);
    for (const k of ['reason', 'level', 'method']) if (c.expect[k]) assert.equal(l[k], c.expect[k], c.name + ' ' + k);
  }
});

test('ambiguous names are never assigned without a qualifier, and say why', () => {
  for (const t of ['Washington', 'Marion', 'Mount Vernon', 'Mt. Vernon', 'Princeton', 'Benton', 'Greenville', 'Perry County', 'Wayne County', 'Union County', 'Daviess County']) {
    for (const s of ['wfie', 'weht', 'kfvs', 'owtimes', 'inchron']) {
      const l = L.classify({ title: t + ' officials announce new plan', summary: '' }, src(s));
      assert.deepEqual(l.countyIds, [], t + ' via ' + s);
      assert.equal(l.primaryCountyId, null);
      assert.equal(l.reason, 'ambiguous_name', t);
      assert.equal(l.requiresReview, true);
      assert.ok(l.unresolved.length && l.unresolved[0].candidates.length >= 1 && l.unresolved[0].reasons.length, t); // Washington has one candidate here but is a state name and common elsewhere
    }
  }
});

test('the article is placed by its text, not the publisher: Henderson story from an Evansville outlet', () => {
  const l = L.classify({ title: 'Henderson County school board approves calendar', summary: '' }, src('wfie'));
  assert.deepEqual(l.countyIds, ['ky-henderson']);
  assert.deepEqual(l.publisherPrior.countyIds, ['in-vanderburgh'], 'the source prior is recorded separately');
  const none = L.classify({ title: 'Community supper Friday night', summary: '' }, src('wfie'));
  assert.deepEqual(none.countyIds, []);
  assert.equal(none.method, 'publisher_prior');
  assert.ok(none.confidence <= 0.4 && none.level !== 'verified_county');
});

test('the publisher\'s own name is not evidence', () => {
  const s = Object.assign({}, src('wfie'), { name: 'Dubois County Herald' });
  const l = L.classify({ title: 'Healthy Drinks - Dubois County Herald', summary: '' , source: 'Dubois County Herald' }, s);
  assert.deepEqual(l.countyIds, []);
  assert.deepEqual(L.classify({ title: 'Dubois County fair opens - Dubois County Herald', summary: '' }, s).countyIds, ['in-dubois']);
});

test('source coverage is its own field; the location contract has every field', () => {
  const cov = L.sourceCoverage(src('wfie'));
  assert.deepEqual(cov, { sourceId: 'wfie', area: 'Evansville', kind: 'news', statewide: false, state: 'IN', countyIds: ['in-vanderburgh'], stateIds: ['IN'] });
  assert.equal(L.sourceCoverage(src('inchron')).statewide, true);
  const l = L.classify({ title: 'Posey County fair', summary: '' }, src('wfie'));
  for (const k of ['scope', 'primaryCountyId', 'countyIds', 'stateIds', 'confidence', 'method', 'level', 'evidence', 'requiresReview', 'reason', 'publisherPrior', 'datelinePrior', 'inTriStateHistoric', 'inCore'])
    assert.ok(k in l, k);
  assert.deepEqual(l.evidence[0], { text: 'posey county', field: 'title', rule: 'unique_locality', countyIds: ['in-posey'] });
  assert.ok(!('preference' in l) && !('readerCounties' in l), 'no reader preference on an article');
});

test('county ids look like in-perry, ky-daviess, and every assigned id is in the manifest', () => {
  const ids = new Set(GEO.counties.map(c => c.id));
  for (const id of ['in-perry', 'ky-daviess', 'il-perry', 'mo-perry', 'in-daviess']) assert.ok(ids.has(id), id);
  for (const c of GEO.counties) assert.match(c.id, /^(in|ky|il|mo)-[a-z0-9-]+$/, c.id);
  for (const c of CASES) for (const id of c.expect.countyIds) assert.ok(ids.has(id), id);
});

test('Missouri is never labeled historic Tri-State', () => {
  for (const c of GEO.counties.filter(x => x.state === 'MO')) assert.ok(!c.groups.includes('tri_state_historic'), c.id);
  const l = L.classify({ title: 'Cape Girardeau County, Mo. opens new jail', summary: '' }, src('kfvs'));
  assert.equal(l.stateIds[0], 'MO');
  assert.equal(l.inTriStateHistoric, false);
  const k = L.classify({ title: 'Posey County fair', summary: '' }, src('wfie'));
  assert.equal(k.inTriStateHistoric, true);
});

test('regional: five or more counties get no primary', () => {
  const l = L.classify({ title: 'Storms hit Posey County, Vanderburgh County, Warrick County, Gibson County and Henderson County', summary: '' }, src('wfie'));
  assert.equal(l.scope, 'regional');
  assert.equal(l.primaryCountyId, null);
  assert.equal(l.countyIds.length, 5);
});

test('official police source with a one-county area is placed there only when the text names no place', () => {
  const s = src('vcso');
  const l = L.classify({ title: 'Deputy named traffic safety all-star', summary: '' }, s);
  assert.equal(l.method, 'official_source');
  assert.deepEqual(l.countyIds, ['in-vanderburgh']);
  assert.ok(l.confidence < 0.85 && l.level !== 'verified_county');
  const t = L.classify({ title: 'Deputies assist in Warrick County crash', summary: '' }, s);
  assert.deepEqual(t.countyIds, ['in-warrick'], 'text evidence wins over the source');
});

test('levels: verified only for one county from explicit evidence', () => {
  assert.equal(L.levelOf({ scope: 'county', confidence: 0.9, method: 'unique_locality', countyIds: ['x'] }), 'likely_county');
  assert.equal(L.levelOf({ scope: 'county', confidence: 0.9, method: 'explicit_county', countyIds: ['x'] }), 'verified_county');
  assert.equal(L.levelOf({ scope: 'county', confidence: 0.3, method: 'publisher_prior', countyIds: [] }), 'needs_review');
});

test('accuracy: precision and recall against labels', () => {
  const rows = [
    { id: 'a', title: 'A', location: { countyIds: ['ky-daviess'] } },
    { id: 'b', title: 'B', location: { countyIds: ['in-posey'] } },
    { id: 'c', title: 'C', location: { countyIds: [] } },
    { id: 'd', title: 'D', location: { countyIds: [] } }
  ];
  const a = L.accuracy(rows, [{ id: 'a', expected: { countyIds: ['ky-daviess'] } }, { id: 'b', expected: { countyIds: ['in-vanderburgh'] } },
    { id: 'c', expected: { countyIds: ['in-gibson'] } }, { id: 'd', expected: { countyIds: [] } }, { id: 'zz', expected: { countyIds: [] } }]);
  assert.deepEqual([a.labels, a.missing, a.assigned, a.correctAssigned, a.precision, a.recall, a.unknownLabels, a.unknownCorrect], [5, 1, 2, 1, 50, 33.3, 1, 1]);
  assert.equal(a.wrong.length, 2);
});

test('flags: all off by default; only the exact value "true" turns one on', () => {
  assert.deepEqual(FLAGS.all({}), { COUNTY_CLASSIFICATION_ENABLED: false, COUNTY_FILTERS_ENABLED: false, EXPANDED_SOURCES_ENABLED: false, SOURCE_ADMIN_ENABLED: false, REGIONAL_ROUTES_ENABLED: false });
  for (const v of ['1', 'yes', 'on', 'TRUE ', 'false', '']) assert.equal(FLAGS.countyClassification({ COUNTY_CLASSIFICATION_ENABLED: v }), v.trim().toLowerCase() === 'true', JSON.stringify(v));
  assert.equal(FLAGS.countyClassification({ COUNTY_CLASSIFICATION_ENABLED: 'true' }), true);
});

// ---- shadow mode through refresh, against a fake Upstash store (never a real one) ----
function fakeStore() {
  const kv = new Map(), ttl = new Map(), log = [];
  const run = ([op, ...a]) => {
    log.push(op);
    if (op === 'GET') return { result: kv.has(a[0]) ? kv.get(a[0]) : null };
    if (op === 'MGET') return { result: a.map(k => (kv.has(k) ? kv.get(k) : null)) };
    if (op === 'SET') { const [k, v, ...o] = a; if (o.includes('NX') && kv.has(k)) return { result: null }; kv.set(k, v); const ex = o.indexOf('EX'); if (ex >= 0) ttl.set(k, Number(o[ex + 1])); return { result: 'OK' }; }
    return { error: 'ERR ' + op };
  };
  return { kv, ttl, log, handle: body => JSON.parse(body).map(run) };
}
const RSS = () => '<?xml version="1.0"?><rss><channel>' + ['Owensboro council approves budget', 'Marion police investigate break-in', 'Posey County fair opens'].map((t, i) =>
  '<item><title>' + t + '</title><link>https://example.com/' + i + '</link><pubDate>' + new Date(Date.now() - 6e5).toUTCString() + '</pubDate><description>' + t + '</description></item>').join('') + '</channel></rss>';
function install(store) {
  const realFetch = global.fetch, realTimeout = global.setTimeout;
  global.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith('https://kv.test/')) return new Response(JSON.stringify(store.handle(init.body)), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(RSS(), { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };
  global.setTimeout = (fn, ms, ...a) => realTimeout(fn, 0, ...a);
  return () => { global.fetch = realFetch; global.setTimeout = realTimeout; };
}
function load(env) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k];
  CLEAN.forEach(k => delete process.env[k]);
  Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake-token' }, env);
  require(path.join(API, '_safe.js')).guard.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  return f => require(path.join(API, f + '.js'));
}
test.afterEach(() => CLEAN.forEach(k => delete process.env[k]));

async function refresh(env) {
  const store = fakeStore(), restore = install(store);
  try { const r = await load(env)('news').refreshAll({}); return { store, r }; } finally { restore(); }
}

test('shadow off (default): refresh writes no classification and the snapshot has no location field', async () => {
  const { store, r } = await refresh({});
  assert.equal(store.kv.has(L.SHADOW_KEY), false);
  assert.equal(r.locations, null);
  assert.ok(r.snapshot.items.length > 0);
  for (const it of r.snapshot.items) assert.ok(!('location' in it), 'no location on public items');
});

test('shadow on: the same snapshot (readers see no change) plus a private tsn:loc:shadow record', async () => {
  const off = await refresh({});
  const on = await refresh({ COUNTY_CLASSIFICATION_ENABLED: 'true' });
  const strip = s => s.items.map(i => [i.id, i.title, i.link, i.sourceId]);
  assert.deepEqual(strip(on.r.snapshot), strip(off.r.snapshot), 'same public items');
  assert.equal(on.store.kv.get('tsn:news:snapshot').includes('"location"'), false, 'stored snapshot unchanged in shape');
  assert.ok(on.store.kv.has(L.SHADOW_KEY));
  assert.equal(on.store.ttl.get(L.SHADOW_KEY), 7 * 86400);
  const rec = JSON.parse(on.store.kv.get(L.SHADOW_KEY));
  assert.equal(rec.classifierVersion, L.VERSION);
  assert.equal(rec.runId, on.r.runId);
  assert.ok(rec.summary.total > 0 && rec.items.length === Math.min(rec.summary.total, 400));
  const byTitle = t => rec.items.find(x => x.title === t).location;
  assert.deepEqual(byTitle('Owensboro council approves budget').countyIds, ['ky-daviess']);
  assert.deepEqual(byTitle('Marion police investigate break-in').countyIds, []);
  assert.equal(byTitle('Marion police investigate break-in').reason, 'ambiguous_name');
  assert.deepEqual(on.r.locations, rec.summary);
  assert.equal(on.store.log.filter(c => c === 'SET').length, off.store.log.filter(c => c === 'SET').length + 1, 'one extra SET, same round trips');
});

// ---- admin endpoint, hosted by news.js (still 8 functions) ----
function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.send = b => { r.body = b; return r; };
  return r;
}
async function call(method, query, headers, body, env) {
  const store = fakeStore(), restore = install(store);
  try {
    const news = load(Object.assign({ LISTINGS_ADMIN_KEY: 'k-test' }, env || {}))('news');
    if (env && env.seed) await news.refreshAll({});
    const res = fakeRes();
    await news({ method, url: '/api/news?__route=locations', query: Object.assign({ __route: 'locations' }, query), headers: headers || {}, body }, res);
    return res;
  } finally { restore(); }
}

test('/api/locations: 404 without the admin key', async () => {
  assert.equal((await call('GET', {}, {})).statusCode, 404);
  assert.equal((await call('GET', {}, { 'x-admin-key': 'wrong' })).statusCode, 404);
  const none = await call('GET', {}, { 'x-admin-key': 'k-test' }, null, { LISTINGS_ADMIN_KEY: '' });
  assert.equal(none.statusCode, 404, 'no key configured: closed');
});

test('/api/locations: stored record, live classification and label accuracy', async () => {
  const empty = await call('GET', {}, { 'x-admin-key': 'k-test' });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.body, { ok: true, flags: { COUNTY_CLASSIFICATION_ENABLED: false }, stored: null });
  assert.equal(empty.headers['cache-control'], 'no-store');
  const stored = await call('GET', {}, { 'x-admin-key': 'k-test' }, null, { seed: 1, COUNTY_CLASSIFICATION_ENABLED: 'true' });
  assert.equal(stored.body.flags.COUNTY_CLASSIFICATION_ENABLED, true);
  assert.ok(stored.body.stored && stored.body.stored.summary.total > 0);
  const live = await call('GET', { live: '1' }, { 'x-admin-key': 'k-test' }, null, { seed: 1 });
  assert.equal(live.body.live.live, true);
  assert.ok(live.body.live.summary.total > 0, 'live works with the flag off and stores nothing');
  const id = live.body.live.items.find(x => x.title === 'Owensboro council approves budget').id;
  const acc = await call('POST', {}, { 'x-admin-key': 'k-test' }, { labels: [{ id, expected: { countyIds: ['ky-daviess'] } }] }, { seed: 1 });
  assert.equal(acc.statusCode, 200);
  assert.equal(acc.body.accuracy.precision, 100);
  assert.equal((await call('POST', {}, { 'x-admin-key': 'k-test' }, {}, { seed: 1 })).statusCode, 400);
  assert.equal((await call('DELETE', {}, { 'x-admin-key': 'k-test' })).statusCode, 405);
});

test('routing: /api/locations is a rewrite into news.js, still exactly 8 functions', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.deepEqual(vercel.rewrites.filter(r => r.source === '/api/locations').map(r => r.destination), ['/api/news?__route=locations']);
  const i = vercel.rewrites.findIndex(r => r.source === '/api/locations'), nf = vercel.rewrites.findIndex(r => r.source === '/api/:path*');
  assert.ok(i >= 0 && i < nf, 'before the not-found catch-all');
  assert.equal(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
});

test('report script: reads a saved snapshot, prints counts, writes a labeling sheet with empty labels', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'loc-'));
  const snap = { updatedAt: '2026-10-22T00:00:00.000Z', items: CASES.map((c, i) => Object.assign({ id: 'x' + i, sourceId: c.source, link: 'https://example.com/' + i }, c.item)) };
  fs.writeFileSync(path.join(tmp, 'snap.json'), JSON.stringify(snap));
  fs.writeFileSync(path.join(tmp, 'labels.json'), JSON.stringify(CASES.map((c, i) => ({ id: 'x' + i, expected: { countyIds: c.expect.countyIds } }))));
  const env = Object.assign({}, process.env); CLEAN.forEach(k => delete env[k]);
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/location-report.js'), '--file', path.join(tmp, 'snap.json'), '--labels', path.join(tmp, 'labels.json'), '--sample', '5', '--out', path.join(tmp, 'sheet.json')], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp('Stories classified: ' + CASES.length));
  assert.match(r.stdout, /precision 100%, recall 100%/);
  const sheet = JSON.parse(fs.readFileSync(path.join(tmp, 'sheet.json'), 'utf8'));
  assert.equal(sheet.length, 5);
  assert.ok(sheet.every(x => x.expected === null && x.classifier && x.id));
});
