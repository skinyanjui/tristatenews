// Rolling per-county 14-day depth record (api/_depthrec.js, tsn:geo:depth): built at refresh time from every story
// before the public 240 cap, bounded, merged across runs, and read by the county pages, /sitemap-regions.xml and the
// admin coverage report, with coverage.json as the fallback. Fake Upstash /pipeline only; never a real store.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const API = path.join(__dirname, '..', 'api');
const CLEAN = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'UPSTASH_REDIS_URL', 'EXTRA_FEEDS', 'EXPANDED_SOURCES_ENABLED', 'SOURCE_BATCHES', 'LISTINGS_ADMIN_KEY', 'REGIONAL_ROUTES_ENABLED', 'CRON_SECRET'];
const STORE = { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake-token' };
function fresh(env) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k];
  CLEAN.forEach(k => delete process.env[k]); Object.assign(process.env, env || {});
  const news = require('../api/news.js');
  require('../api/_safe.js').guard.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  return news;
}
function store() {
  const kv = new Map(), ttl = new Map(), h = new Map(), log = [];
  let fail = null;
  const run = ([op, ...a]) => {
    log.push(op);
    if (fail && fail(op, a)) return { error: 'ERR injected' };
    switch (op) {
      case 'GET': return { result: kv.has(a[0]) ? kv.get(a[0]) : null };
      case 'MGET': return { result: a.map(k => (kv.has(k) ? kv.get(k) : null)) };
      case 'SET': { kv.set(a[0], a[1]); const i = a.indexOf('EX'); if (i > 0) ttl.set(a[0], Number(a[i + 1])); return { result: 'OK' }; }
      case 'HGETALL': return { result: [].concat(...[...(h.get(a[0]) || new Map())]) };
      case 'LRANGE': return { result: [] };
      default: return { result: null };
    }
  };
  return { kv, ttl, h, log, run, failWhen(f) { fail = f; } };
}
const hour = 36e5, NOW = Date.now();
const rss = items => '<?xml version="1.0"?><rss><channel>' + items.map(([t, l, ago]) => '<item><title>' + t + '</title><link>' + l + '</link><pubDate>' + new Date(NOW - ago).toUTCString() + '</pubDate><description>' + t + '</description></item>').join('') + '</channel></rss>';
function install(st, feed) {
  const real = global.fetch, realT = global.setTimeout;
  global.fetch = async (url, init) => {
    url = String(url);
    if (url === 'https://kv.test/pipeline') return new Response(JSON.stringify(JSON.parse(init.body).map(st.run)), { status: 200 });
    if (/weather\.gov|wzdx|carsprogram/.test(url)) return new Response('{"features":[]}', { status: 200 });
    return new Response(feed(url), { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };
  global.setTimeout = (f, ms, ...a) => realT(f, 0, ...a);
  return () => { global.fetch = real; global.setTimeout = realT; };
}
const res = () => ({ code: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; } });

test('update: distinct titles per county, 14-day window, per-county cap, merge across runs, overrides honored', () => {
  fresh();
  const D = require('../api/_depthrec.js'), S = require('../api/_scope.js');
  const it = (title, ago, src) => ({ title, link: 'https://ex.com/' + encodeURIComponent(title), sourceId: src || 'courier', source: 'X', published: new Date(NOW - ago).toISOString() });
  const items = [it('Henderson County fiscal court sets tax rate', hour), it('Henderson County Fiscal Court sets tax rate!', 2 * hour), it('Henderson County schools close early', 3 * hour),
    it('Henderson County old story', 15 * 864e5), it('Henderson County obit', hour), it('Henderson County fair opens', hour)];
  items[4].isObit = true;
  const r1 = D.update(null, items, require('../api/news.js').SOURCES, NOW, null);
  assert.equal(r1.v, 1); assert.equal(r1.cap, D.CAP);
  assert.equal(D.counts(r1, NOW)['ky-henderson'], 3, 'same title counted once; old and obituary items left out');
  // Next run: the stories are no longer in the feed, but the record keeps them for the window.
  const r2 = D.update(JSON.stringify(r1), [it('Henderson County council meets', hour)], require('../api/news.js').SOURCES, NOW + hour, null);
  assert.equal(D.counts(r2, NOW + hour)['ky-henderson'], 4);
  // ...and drops them once they are older than 14 days.
  assert.equal(D.counts(D.update(JSON.stringify(r2), [], [], NOW + 15 * 864e5, null), NOW + 15 * 864e5), null, 'all aged out: empty record means fallback');
  // Cap: at most CAP ids per county, newest kept.
  const many = Array.from({ length: D.CAP + 25 }, (_, i) => it('Henderson County story number ' + i, i * 60e3));
  const r3 = D.update(null, many, [], NOW, null);
  assert.equal(r3.c['ky-henderson'].length, D.CAP);
  assert.ok(r3.c['ky-henderson'].every(e => typeof e[0] === 'string' && e[0].length === 10 && Number.isInteger(e[1])));
  // Bounded size even with every county full.
  const full = { v: 1, c: {} }; for (const c of S.COUNTIES) full.c[c.id] = r3.c['ky-henderson'];
  assert.ok(JSON.stringify(full).length < 70000, 'full record ' + JSON.stringify(full).length + ' bytes');
  // An admin override moves the story.
  const x = it('Council approves budget for next year', hour);
  const r4 = D.update(null, [x], [], NOW, { [S.overrideKey(x)]: ['in-dubois'] });
  assert.equal(D.counts(r4, NOW)['in-dubois'], 1);
  assert.equal(D.parse('{"v":2}'), null); assert.equal(D.parse('nope'), null);
});

test('gate: rolling record when it has stories, coverage.json when missing or empty', () => {
  fresh();
  const D = require('../api/_depthrec.js'), cov = require('../data/geography/coverage.json');
  const g0 = D.gate(null, NOW); assert.equal(g0.source, 'measured'); assert.deepEqual(g0.depth, cov.depth);
  assert.equal(D.gate(JSON.stringify({ v: 1, c: {} }), NOW).source, 'measured');
  const hr = Math.floor(NOW / hour);
  const rec = { v: 1, updatedAt: new Date(NOW).toISOString(), c: { 'in-martin': [0, 1, 2, 3, 4].map(i => ['a00000000' + i, hr - i]), 'ky-daviess': [['b000000000', hr]] } };
  const g = D.gate(JSON.stringify(rec), NOW);
  assert.equal(g.source, 'rolling'); assert.equal(g.depth['in-martin'], 5); assert.equal(g.depth['ky-daviess'], 1); assert.equal(g.depth['ky-mcCracken'], undefined);
});

test('refresh writes the record in its existing write request; the public feed is unchanged by it', async () => {
  const st = store();
  const titles = Array.from({ length: 8 }, (_, i) => ['Henderson County commission item ' + i, 'https://example.com/h' + i, (i + 1) * hour]);
  const un = install(st, url => rss(titles.map(([t, l, a]) => [t, l + '?' + encodeURIComponent(url).slice(0, 20), a])));
  try {
    const news = fresh(STORE);
    const a = await news.refreshAll({});
    assert.deepEqual(a.store.requests, 2, 'still one read and one write request');
    assert.ok(st.log.includes('GET'));
    const rec = JSON.parse(st.kv.get('tsn:geo:depth'));
    assert.equal(st.ttl.get('tsn:geo:depth'), 14 * 86400);
    const D = require('../api/_depthrec.js');
    assert.ok(D.counts(rec, Date.now())['ky-henderson'] >= 8);
    // The snapshot is exactly what combine() gives without collecting the pool.
    const results = news.SOURCES.map(s => ({ source: s, items: (JSON.parse(st.kv.get('tsn:src:' + s.id) || '{"items":[]}').items) }));
    const now = Date.parse(a.snapshot.updatedAt);
    assert.equal(JSON.stringify(news.combine(results, now)), JSON.stringify(news.combine(results, now, [])));
    assert.ok(!('depth' in a.snapshot) && !/tsn:geo:depth/.test(JSON.stringify(news.publicSnapshot(a.snapshot))));
    // A failed read never overwrites the history.
    st.kv.set('tsn:geo:depth', 'KEEP');
    st.failWhen((op, args) => op === 'GET' && args[0] === 'tsn:geo:depth');
    st.log.length = 0;
    await news.refreshAll({});
    assert.equal(st.kv.get('tsn:geo:depth'), 'KEEP');
  } finally { un(); }
});

test('county pages and /sitemap-regions.xml follow the rolling record, and fall back to coverage.json', async () => {
  const st = store(), un = install(st, () => rss([]));
  try {
    const news = fresh(Object.assign({ REGIONAL_ROUTES_ENABLED: 'true' }, STORE));
    const G = require('../api/_geopage.js'), cov = require('../data/geography/coverage.json');
    const hr = Math.floor(Date.now() / hour);
    // Martin County IN fails the committed measurement; with 5 stories in the record it is indexable.
    assert.ok(!(cov.depth['in-martin'] >= cov.min), 'fixture assumption: Martin is thin in coverage.json');
    st.kv.set('tsn:geo:depth', JSON.stringify({ v: 1, updatedAt: new Date().toISOString(), c: { 'in-martin': [0, 1, 2, 3, 4].map(i => ['c00000000' + i, hr - i]) } }));
    const call = async q => { const r = res(); await news({ method: 'GET', url: '/api/news', query: Object.assign({ __route: 'geopage' }, q), headers: {} }, r); return r; };
    const page = await call({ p: '/news/indiana/martin' });
    assert.equal(page.code, 200); assert.ok(!/name="robots" content="noindex"/.test(page.body));
    const sm = await call({ sitemap: '1' });
    assert.ok(sm.body.includes('/news/indiana/martin</loc>'));
    assert.ok(!sm.body.includes('/news/kentucky/mccracken</loc>'), 'rolling record is the whole gate: counties not in it are thin');
    const gets = st.log.filter(o => o === 'GET').length;
    await call({ p: '/news/indiana/dubois' });
    assert.equal(st.log.filter(o => o === 'GET').length, gets, 'gate cached for 5 minutes in the instance');
    // Empty record or a store error: coverage.json.
    G.resetGate(); st.kv.delete('tsn:geo:depth');
    const sm2 = await call({ sitemap: '1' });
    const S = require('../api/_scope.js');
    for (const c of S.COUNTIES) assert.equal(sm2.body.includes(S.pathOf(S.parse('county:' + c.id)) + '</loc>'), cov.depth[c.id] >= cov.min, c.id);
    G.resetGate(); st.failWhen(op => op === 'GET');
    const p2 = await call({ p: '/news/indiana/martin' });
    assert.equal(p2.code, 200); assert.match(p2.body, /name="robots" content="noindex"/);
  } finally { un(); }
});

test('admin coverage shows rolling 14-day counts and which source the gate uses', async () => {
  const st = store(), un = install(st, () => rss([]));
  try {
    const news = fresh(Object.assign({ LISTINGS_ADMIN_KEY: 'test-admin-key-not-real' }, STORE));
    const hr = Math.floor(Date.now() / hour);
    st.kv.set('tsn:geo:depth', JSON.stringify({ v: 1, updatedAt: new Date().toISOString(), c: { 'ky-ohio': [0, 1, 2, 3, 4, 5].map(i => ['d00000000' + i, hr - i]) } }));
    const r = res();
    await news({ method: 'GET', url: '/api/coverage', query: { __route: 'coverage' }, headers: { 'x-admin-key': 'test-admin-key-not-real' } }, r);
    assert.equal(r.code, 200);
    assert.equal(r.body.gate.source, 'rolling');
    const ohio = r.body.counties.find(c => c.id === 'ky-ohio');
    assert.equal(ohio.rolling14d, 6); assert.equal(ohio.passesGate, true);
    assert.equal(r.body.counties.find(c => c.id === 'in-martin').rolling14d, 0);
    const html = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
    assert.match(html, /14-day stories/); assert.match(html, /rolling14d/);
  } finally { un(); }
});
