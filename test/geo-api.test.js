// Read-only geography API (plan PR 2.3): /api/counties and /api/regions, hosted by api/news.js through
// vercel.json rewrites. Contract: GET/HEAD only, no Redis or network, deterministic and cacheable, data equal to
// the reviewed manifest, and no Missouri (southeast Missouri was removed in ship62).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const M = JSON.parse(fs.readFileSync(path.join(root, 'data/geography/target-counties.json'), 'utf8'));
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

function mockRes() {
  const r = { code: 200, body: undefined, raw: undefined, headers: {}, ended: false };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; };
  r.status = c => { r.code = c; return r; };
  r.json = o => { r.raw = JSON.stringify(o); r.body = JSON.parse(r.raw); r.ended = true; return r; };
  r.send = s => { r.raw = s; r.body = JSON.parse(s); r.ended = true; return r; };
  r.end = s => { if (s !== undefined) r.raw = s; r.ended = true; return r; };
  return r;
}
// The three ways a request arrives: Vercel after the rewrite (url is the destination, query has __route and the
// original query), the local Express server (original path), and the route module itself.
function call(route, opts = {}) {
  const query = Object.assign({}, opts.query || {});
  const qs = new URLSearchParams(query).toString();
  const mode = opts.mode || 'vercel';
  let req;
  if (mode === 'vercel') req = { method: opts.method || 'GET', url: '/api/news?' + new URLSearchParams(Object.assign({ __route: route }, query)), query: Object.assign({ __route: route }, query), headers: opts.headers || {} };
  else req = { method: opts.method || 'GET', url: '/api/' + route + (qs ? '?' + qs : ''), query, headers: opts.headers || {} };
  const fn = mode === 'direct' ? require(path.join(API, '_geoapi.js'))[route] : require(path.join(API, 'news.js'));
  const res = mockRes();
  fn(req, res);
  return res;
}

// No store, no network: every outbound call fails loudly and is recorded.
const calls = [];
const realFetch = global.fetch;
test.before(() => {
  for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'KV_URL', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
  global.fetch = (...a) => { calls.push(a[0]); throw new Error('network used'); };
});
test.after(() => { global.fetch = realFetch; });

test('routes: /api/counties and /api/regions are rewrites into news.js; still 8 functions', () => {
  const fns = fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.equal(fns.length, 8);
  for (const p of ['counties', 'regions']) {
    assert.deepEqual(vercel.rewrites.filter(r => r.source === '/api/' + p).map(r => r.destination), ['/api/news?__route=' + p]);
    assert.ok(!fs.existsSync(path.join(API, p + '.js')));
  }
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /app\.all\(\['\/api\/counties', '\/api\/regions'\], [^\n]*\n\s*Promise\.resolve\(newsHandler\(req, res\)\)/);
});

test('same answer via the Vercel rewrite, the local server path and the module itself', () => {
  for (const [route, query] of [['counties', {}], ['counties', { state: 'ky', tier: 'extended' }], ['counties', { region: 'southern-illinois:east' }], ['counties', { id: 'ky-henderson,in-posey' }],
    ['regions', {}], ['regions', { id: 'paducah-murray-far-western-ky' }], ['counties', { state: 'oh' }], ['regions', { id: 'nope' }]]) {
    const [v, l, d] = ['vercel', 'local', 'direct'].map(mode => call(route, { query, mode }));
    for (const x of [l, d]) { assert.equal(x.code, v.code); assert.equal(x.raw, v.raw, route + ' ' + JSON.stringify(query)); assert.deepEqual(x.headers, v.headers); }
  }
});

test('GET /api/counties: all 57 counties, equal to the manifest', () => {
  const r = call('counties');
  assert.equal(r.code, 200);
  assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
  const b = r.body;
  assert.equal(b.schemaVersion, 1);
  assert.equal(b.manifestVersion, M.manifestVersion);
  assert.equal(b.count, 57); assert.equal(b.counties.length, 57);
  assert.deepEqual(b.filters, {});
  assert.deepEqual(b.tiers.map(t => [t.id, t.count]), [['tri_state_core', 30], ['extended', 27]]);
  const byId = new Map(M.counties.map(c => [c.id, c]));
  for (const c of b.counties) {
    const m = byId.get(c.id);
    assert.ok(m, c.id);
    assert.deepEqual([c.state, c.name, c.fullName, c.fips, c.tier], [m.state, m.name, m.fullName, m.fips, m.tier], c.id);
    assert.deepEqual(c.seat, { name: m.seat.name, source: m.seat.source });
    assert.deepEqual(c.internalPoint, { lat: m.centroid.lat, lon: m.centroid.lon, kind: 'census_internal_point', source: 'census-gazetteer-2025' });
    assert.ok(b.sources[c.seat.source] && b.sources[c.seat.source].url, c.id + ' seat source listed');
    const prim = M.members.filter(x => x.countyId === c.id && x.membershipType === 'primary' && M.groups.find(g => g.id === x.groupId).kind === 'editorial_region');
    assert.equal(c.regions.primary, prim[0].groupId, c.id);
    assert.equal(c.historicTriState, M.members.some(x => x.countyId === c.id && x.groupId === 'tri_state_historic'), c.id);
    assert.equal(c.regions.subregion !== null, c.state === 'IL', c.id + ' subregion only in Southern Illinois');
  }
  assert.deepEqual(b.counties.find(c => c.id === 'il-jackson').regions, { primary: 'region:southern-illinois', secondary: [], subregion: 'region:southern-illinois:west' });
  assert.deepEqual(b.counties.find(c => c.id === 'il-massac').regions, { primary: 'region:southern-illinois', secondary: ['region:paducah-murray-far-western-ky'], subregion: 'region:southern-illinois:west' });
});

// Every string anywhere inside a value (keys are field names, not labels).
const strings = v => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);

test('no Missouri: ?state=MO is an unknown state, the Missouri region is gone, no county or region names Missouri', () => {
  const mo = call('counties', { query: { state: 'MO' } });
  assert.equal(mo.code, 400);
  assert.deepEqual(mo.body.allowed, ['IL', 'IN', 'KY']);
  assert.equal(call('regions', { query: { id: 'cape-girardeau-se-missouri' } }).code, 404);
  const all = call('counties').body;
  assert.ok(all.counties.every(c => c.state !== 'MO' && !c.id.startsWith('mo-')));
  assert.equal(all.counties.filter(c => c.historicTriState).length, 30);
  for (const s of strings(all.counties).concat(strings(call('regions').body.regions))) assert.doesNotMatch(s, /missouri/i, s);
  assert.match(all.note, /Coverage is Illinois, Indiana and Kentucky/);
});

test('county filters: state, tier, region (with or without the region: prefix, subregions too), id', () => {
  const ids = q => call('counties', { query: q }).body.counties.map(c => c.id);
  assert.equal(ids({ state: 'ky' }).length, 24);
  assert.equal(ids({ state: 'IN' }).length, 11);
  assert.equal(ids({ tier: 'tri_state_core' }).length, 30);
  assert.deepEqual(ids({ region: 'owensboro-western-ky' }).sort(), ['ky-daviess', 'ky-hancock', 'ky-mclean', 'ky-muhlenberg', 'ky-ohio'], 'primary and secondary members');
  assert.deepEqual(ids({ region: 'region:owensboro-western-ky' }), ids({ region: 'owensboro-western-ky' }));
  assert.equal(ids({ region: 'southern-illinois:east' }).length, 12);
  assert.equal(ids({ region: 'southern-illinois:west' }).length, 10);
  assert.deepEqual(ids({ id: 'ky-henderson' }), ['ky-henderson']);
  assert.deepEqual(ids({ id: 'IN-POSEY, ky-henderson' }).sort(), ['in-posey', 'ky-henderson']);
  assert.deepEqual(call('counties', { query: { state: 'ky' } }).body.filters, { state: 'KY' });
});

test('bad input: 400 for unknown filter values, 404 for unknown ids, 405 for writes', () => {
  for (const q of [{ state: 'oh' }, { tier: 'gold' }, { region: 'chicago' }]) {
    const r = call('counties', { query: q });
    assert.equal(r.code, 400, JSON.stringify(q));
    assert.ok(Array.isArray(r.body.allowed));
    assert.equal(r.headers.etag, undefined);
  }
  assert.equal(call('counties', { query: { id: 'ky-jefferson' } }).code, 404);
  assert.equal(call('counties', { query: { id: 'in-crawford' } }).code, 404, 'optional counties are not in the API');
  assert.equal(call('regions', { query: { id: 'nope' } }).code, 404);
  for (const route of ['counties', 'regions']) for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = call(route, { method });
    assert.equal(r.code, 405, route + ' ' + method);
    assert.equal(r.headers.allow, 'GET, HEAD');
    assert.equal(r.headers['cache-control'], 'no-store');
  }
});

test('GET /api/regions: six regions and two Southern Illinois subregions, equal to the manifest', () => {
  const b = call('regions').body;
  assert.equal(b.manifestVersion, M.manifestVersion);
  assert.equal(b.count, 8);
  const top = b.regions.filter(r => r.kind === 'editorial_region'), sub = b.regions.filter(r => r.kind === 'editorial_subregion');
  assert.equal(top.length, 6); assert.equal(sub.length, 2);
  for (const r of b.regions) {
    const g = M.groups.find(x => x.id === r.id);
    assert.equal(r.name, g.name); assert.deepEqual(r.hubCountyIds, g.hubCountyIds); assert.equal(r.membershipStatus, 'editorial_judgment');
    assert.equal(r.slug, r.id.slice(7));
    const mem = t => M.members.filter(m => m.groupId === r.id && m.membershipType === t).map(m => m.countyId);
    assert.deepEqual(r.counties.primary, mem('primary'), r.id);
    assert.deepEqual(r.counties.secondary, mem('secondary'), r.id);
  }
  const si = b.regions.find(r => r.id === 'region:southern-illinois');
  assert.deepEqual(si.subregions, ['region:southern-illinois:east', 'region:southern-illinois:west']);
  for (const s of sub) { assert.equal(s.parent, 'region:southern-illinois'); assert.deepEqual(s.subregions, []); }
  assert.ok(top.every(r => r.parent === null));
  assert.match(b.note, /editorial judgment, not official boundaries/);
  const one = call('regions', { query: { id: 'southern-illinois:west' } }).body;
  assert.deepEqual([one.count, one.regions[0].id, one.regions[0].hubCountyIds], [1, 'region:southern-illinois:west', ['il-williamson']]);
});

test('cacheable and deterministic: Cache-Control, strong ETag, 304, HEAD', () => {
  for (const route of ['counties', 'regions']) {
    const a = call(route), b = call(route);
    assert.equal(a.raw, b.raw);
    assert.equal(a.headers['cache-control'], 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
    assert.match(a.headers.etag, /^"[A-Za-z0-9_-]{27}"$/);
    assert.equal(a.headers.etag, b.headers.etag);
    const nm = call(route, { headers: { 'if-none-match': a.headers.etag } });
    assert.equal(nm.code, 304); assert.equal(nm.raw, undefined);
    assert.equal(call(route, { headers: { 'if-none-match': '"other"' } }).code, 200);
    const h = call(route, { method: 'HEAD' });
    assert.equal(h.code, 200); assert.equal(h.raw, undefined); assert.equal(h.headers.etag, a.headers.etag);
    assert.notEqual(call('counties', { query: { state: 'ky' } }).headers.etag, call('counties').headers.etag);
  }
});

test('side-effect free: no Redis, no network, no writes; the module depends only on _geo.js', () => {
  calls.length = 0;
  for (const route of ['counties', 'regions']) for (let i = 0; i < 3; i++) call(route);
  assert.deepEqual(calls, []);
  const src = fs.readFileSync(path.join(API, '_geoapi.js'), 'utf8');
  assert.deepEqual([...src.matchAll(/require\('([^']+)'\)/g)].map(m => m[1]).sort(), ['./_geo.js', 'crypto']);
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /redis|upstash|fetch\(|process\.env|writeFile|setTimeout/i);
  const before = JSON.stringify(require(path.join(API, '_geo.js')).registry);
  call('counties', { query: { state: 'ky' } }); call('regions', { query: { id: 'southern-illinois' } });
  assert.equal(JSON.stringify(require(path.join(API, '_geo.js')).registry), before, 'responses do not mutate the data');
});

test('news.js keeps its exports and /api/refresh route', () => {
  const news = require(path.join(API, 'news.js'));
  for (const k of ['parseFeed', 'combine', 'refreshAll', 'stored', 'inRegion', 'inTriState', 'passesFilters', 'SOURCES']) assert.ok(news[k], k);
  const src = fs.readFileSync(path.join(API, 'news.js'), 'utf8');
  assert.match(src, /refresh: \(\) => require\('\.\/_refresh\.js'\)/);
  assert.match(src, /\}, handler\);/);
});
