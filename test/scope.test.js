// County expansion step 3 (plan PRs 6.1-6.4): ?scope= filters, county/state pages, scope UI, depth-gated sitemap.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const S = require('../api/_scope.js');
const RT = require('../public/routes.js');

const NOW = Date.parse('2026-10-22T20:00:00Z');
const iso = h => new Date(NOW - h * 3600e3).toISOString();
const SRC = [
  { id: 'base', name: 'Courier & Press', area: 'Evansville', url: 'https://example.com/a' },
  { id: 'clarion', name: 'The Hancock Clarion', area: 'Hawesville', url: 'https://example.com/b' }, // batch 1 source, home ky-hancock
  { id: 'pasun', name: 'The Paducah Sun', area: 'Paducah', url: 'https://example.com/c' },          // batch 1 source, extended
];
const item = (sourceId, title, h) => ({ sourceId, source: SRC.find(s => s.id === sourceId).name, title, link: 'https://example.com/' + encodeURIComponent(title), published: iso(h || 1), summary: '' });
const SNAP_BASE = { updatedAt: new Date(NOW).toISOString(), sources: [], items: [
  item('base', 'Henderson County Fiscal Court approves budget'),
  item('base', 'Dubois County commissioners meet in Jasper'),
  item('base', 'Weather looks mild this weekend'),
] };
const SNAP_B = Object.assign({}, SNAP_BASE, { items: SNAP_BASE.items.concat([
  item('clarion', 'School board hears building report'),           // names no place: home county only
  item('pasun', 'McCracken County Fiscal Court sets tax rate'),     // extended county
  item('pasun', 'Henderson County man honored in Paducah'),         // names a core county
]) });
const ids = v => v.items.map(i => i.title);

test('parse: canonical keys, labels, errors; no Missouri scope (removed in ship62)', () => {
  assert.strictEqual(S.parse(undefined).key, 'tristate');
  assert.strictEqual(S.parse('ALL').key, 'all');
  assert.strictEqual(S.parse('state:KY').key, 'state:ky');
  assert.strictEqual(S.parse('county:ky-henderson').label, 'Henderson County, KY');
  assert.strictEqual(S.parse('counties:ky-daviess,in-dubois,ky-daviess').key, 'counties:in-dubois,ky-daviess');
  for (const bad of ['state:tx', 'state:mo', 'county:mo-cape-girardeau', 'counties:mo-scott', 'county:ky-nowhere', 'counties:', 'nope', 'counties:' + S.COUNTIES.slice(0, 13).map(c => c.id).join(',')]) assert.ok(S.parse(bad).error, bad);
  assert.strictEqual(S.COUNTIES.length, 57);
  assert.strictEqual(S.CORE.size, 30);
  assert.ok(!S.COUNTIES.some(c => c.state === 'mo'));
  assert.deepStrictEqual(Object.keys(S.STATES).sort(), ['il', 'in', 'ky']);
});

test('default view: the snapshot object itself when no batch source is in it (byte for byte)', () => {
  assert.strictEqual(S.view(SNAP_BASE, S.parse(''), SRC), SNAP_BASE);
  assert.strictEqual(JSON.stringify(S.view(SNAP_BASE, S.parse('tristate'), SRC)), JSON.stringify(SNAP_BASE));
});

test('default view with batches on (D8): batch stories only when they name a core county; base stories all stay', () => {
  const v = ids(S.view(SNAP_B, S.parse(''), SRC));
  for (const t of ids(SNAP_BASE)) assert.ok(v.includes(t), t);
  assert.ok(v.includes('Henderson County man honored in Paducah'));
  assert.ok(!v.includes('McCracken County Fiscal Court sets tax rate'));
  assert.ok(!v.includes('School board hears building report'), 'Hancock is core, but a placeless batch story is not shown by default');
  assert.strictEqual(ids(S.view(SNAP_B, S.parse('all'), SRC)).length, SNAP_B.items.length);
});

test('county, counties and state scopes use the classifier, with the home-county fallback for placeless stories', () => {
  const v = k => ids(S.view(SNAP_B, S.parse(k), SRC, { labels: true }));
  assert.deepStrictEqual(v('county:ky-henderson').sort(), ['Henderson County Fiscal Court approves budget', 'Henderson County man honored in Paducah']);
  assert.deepStrictEqual(v('county:in-dubois'), ['Dubois County commissioners meet in Jasper']);
  assert.deepStrictEqual(v('county:ky-hancock'), ['School board hears building report']);
  assert.deepStrictEqual(v('county:ky-mccracken'), ['McCracken County Fiscal Court sets tax rate', 'Henderson County man honored in Paducah'], 'Paducah is in McCracken County');
  assert.deepStrictEqual(v('county:in-martin'), []);
  assert.strictEqual(v('state:ky').length, 4);
  assert.strictEqual(v('counties:in-dubois,ky-mccracken').length, 3);
  assert.ok(!v('state:in').includes('Weather looks mild this weekend'), 'a story with no place is in no county or state');
  const out = S.view(SNAP_B, S.parse('county:ky-hancock'), SRC, { labels: true });
  assert.deepStrictEqual(out.scope, { key: 'county:ky-hancock', kind: 'county', label: 'Hancock County, KY', sources: ['The Hancock Clarion'] });
  const all = S.view(SNAP_B, S.parse('all'), SRC, { labels: true }).items, by = re => all.find(i => re.test(i.title));
  assert.strictEqual(by(/Dubois County/).place, 'Dubois Co., IN');
  assert.strictEqual(by(/Fiscal Court approves/).place, undefined, 'no label below the likely band (county named without its state)');
  assert.strictEqual(by(/Weather/).place, undefined);
});

test('depth counts distinct local stories per county in 14 days', () => {
  const old = Object.assign({}, SNAP_B, { items: SNAP_B.items.concat([item('base', 'Henderson County Fiscal Court approves budget', 2), item('base', 'Henderson County old news', 24 * 20)]) });
  const d = S.depth(old, SRC, NOW);
  assert.strictEqual(d['ky-henderson'], 2, 'same title once; 20-day-old story out');
  assert.strictEqual(d['ky-hancock'], 1);
  assert.strictEqual(Object.keys(d).length, 57);
});

test('routes: /news/<state>[/<county>] <-> scope, both ways; tab routes unchanged', () => {
  assert.deepStrictEqual(RT.geo('/news/indiana/dubois'), { cat: 'news', path: '/news/indiana/dubois', scope: 'county:in-dubois' });
  assert.deepStrictEqual(RT.geo('/News/Kentucky/'), { cat: 'news', path: '/news/kentucky', scope: 'state:ky' });
  assert.strictEqual(RT.geo('/news'), null);
  assert.strictEqual(RT.geo('/news/texas'), null);
  assert.strictEqual(RT.byPath('/news/indiana'), null);
  for (const c of S.COUNTIES) {
    const sc = S.parse('county:' + c.id);
    assert.strictEqual(RT.geoPath(sc.key), S.pathOf(sc), c.id);
    assert.strictEqual(S.fromPath(S.pathOf(sc)).key, sc.key);
    assert.strictEqual(RT.geo(S.pathOf(sc)).scope, sc.key);
  }
  assert.strictEqual(S.fromPath('/news/indiana/nowhere'), null);
  assert.strictEqual(S.fromPath('/news/missouri'), null);
  assert.strictEqual(S.fromPath('/news/missouri/cape-girardeau'), null);
  assert.strictEqual(RT.geo('/news/missouri'), null);
  assert.strictEqual(RT.geo('/news/missouri/cape-girardeau'), null);
  assert.strictEqual(RT.geoPath('state:mo'), null);
  const vj = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const rw = vj.rewrites.map(r => r.source);
  for (const s of ['/news/:state/:county', '/news/:state', '/sitemap-regions.xml']) assert.ok(rw.indexOf(s) >= 0 && rw.indexOf(s) < rw.indexOf('/:path*'), s + ' before the not-found catch-all');
  assert.match(vj.functions['api/news.js'].includeFiles, /data\/pages\/index\.html/);
});

// The handlers, with a fake store answering every Redis call with the snapshot (no network, no real Redis).
async function call(env, mod, query, url) {
  const saved = Object.assign({}, process.env), realFetch = global.fetch;
  const clear = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k]; };
  clear();
  for (const k of ['COUNTY_FILTERS_ENABLED', 'REGIONAL_ROUTES_ENABLED', 'EXPANDED_SOURCES_ENABLED', 'SOURCE_BATCHES']) delete process.env[k];
  Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake', KV_REST_API_URL: '', KV_REST_API_TOKEN: '' }, env);
  const snap = Object.assign({}, SNAP_BASE, { updatedAt: new Date().toISOString() });
  global.fetch = async (u, init) => { const n = JSON.parse(init.body).length; return { ok: true, status: 200, json: async () => Array.from({ length: n }, () => ({ result: JSON.stringify(snap) })) }; };
  try {
    const h = require(path.join(API, mod));
    const res = { code: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = JSON.stringify(o); return this; }, send(b) { this.body = b; return this; }, end() { return this; } };
    await h({ method: 'GET', query, url: url || '/api/news', headers: {} }, res);
    return res;
  } finally { process.env = saved; global.fetch = realFetch; clear(); }
}

test('/api/news: flags off, ?scope is ignored and the body is the snapshot as before', async () => {
  const a = await call({}, 'news.js', {});
  const b = await call({}, 'news.js', { scope: 'county:in-martin' });
  assert.strictEqual(a.code, 200);
  const pa = JSON.parse(a.body), pb = JSON.parse(b.body);
  delete pa.updatedAt; delete pb.updatedAt;
  assert.deepStrictEqual(pb, pa);
  assert.ok(!('features' in pa) && !('scope' in pa));
  assert.deepStrictEqual(pa.items.map(i => i.title), ids(SNAP_BASE));
});

test('/api/news: COUNTY_FILTERS_ENABLED on filters, labels, 400s bad scopes and 308s to the canonical cache key', async () => {
  const on = { COUNTY_FILTERS_ENABLED: 'true' };
  const r = await call(on, 'news.js', { scope: 'county:ky-henderson' });
  const d = JSON.parse(r.body);
  assert.deepStrictEqual(d.items.map(i => i.title), ['Henderson County Fiscal Court approves budget']);
  assert.deepStrictEqual(d.features, { scopes: true, routes: false });
  assert.strictEqual(d.scope.label, 'Henderson County, KY');
  assert.match(r.headers['cache-control'], /max-age=0, s-maxage=60, stale-while-revalidate=60/);
  const def = JSON.parse((await call(on, 'news.js', {})).body);
  assert.deepStrictEqual(def.items.map(i => i.title), ids(SNAP_BASE), 'default view unchanged with filters on');
  assert.strictEqual(def.scope.key, 'tristate');
  const bad = await call(on, 'news.js', { scope: 'county:tx-travis' });
  assert.strictEqual(bad.code, 400);
  const red = await call(on, 'news.js', { scope: 'counties:ky-daviess,in-dubois' });
  assert.strictEqual(red.code, 308);
  assert.strictEqual(red.headers.location, '/api/news?scope=counties:in-dubois,ky-daviess');
});

test('county pages: 404 with REGIONAL_ROUTES_ENABLED off; on, head points at the page and thin counties are noindex', async () => {
  const off = await call({}, 'news.js', { __route: 'geopage', p: '/news/indiana/dubois' }, '/news/indiana/dubois');
  assert.strictEqual(off.code, 404);
  const on = { REGIONAL_ROUTES_ENABLED: 'true' };
  const ok = await call(on, 'news.js', { __route: 'geopage', p: '/news/indiana/dubois' }, '/news/indiana/dubois');
  assert.strictEqual(ok.code, 200);
  assert.match(ok.body, /<title>Dubois County, IN news · Tri-State News<\/title>/);
  assert.match(ok.body, /<link rel="canonical" href="https:\/\/tristatenewss\.vercel\.app\/news\/indiana\/dubois">/);
  const G = require('../api/_geopage.js');
  const cov = require('../data/geography/coverage.json');
  assert.strictEqual(/name="robots" content="noindex"/.test(ok.body), !(cov.depth['in-dubois'] >= cov.min));
  for (const p of ['/news/missouri', '/news/missouri/cape-girardeau', '/news/missouri/scott']) assert.strictEqual((await call(on, 'news.js', { __route: 'geopage', p }, p)).code, 404, p + ' (Missouri removed in ship62)');
  assert.ok(!/Missouri/.test(G.page(S.parse('county:ky-henderson')).meta.desc));
  const nf = await call(on, 'news.js', { __route: 'geopage', p: '/news/indiana/nowhere' }, '/news/indiana/nowhere');
  assert.strictEqual(nf.code, 404);
  const sm = await call(on, 'news.js', { __route: 'geopage', sitemap: '1' }, '/sitemap-regions.xml');
  for (const st of ['indiana', 'kentucky', 'illinois']) assert.ok(sm.body.includes('/news/' + st + '</loc>'), st);
  assert.ok(!/missouri/i.test(sm.body), 'no Missouri page in the sitemap');
  for (const c of S.COUNTIES) assert.strictEqual(sm.body.includes(S.pathOf(S.parse('county:' + c.id)) + '</loc>'), cov.depth[c.id] >= cov.min, c.id);
  const smOff = await call({}, 'news.js', { __route: 'geopage', sitemap: '1' }, '/sitemap-regions.xml');
  assert.strictEqual(smOff.code, 404);
});

test('coverage.json is a real measurement record with all 57 counties', () => {
  const cov = require('../data/geography/coverage.json');
  assert.ok(Date.parse(cov.measuredAt));
  assert.strictEqual(cov.min, S.DEPTH_MIN);
  assert.deepStrictEqual(Object.keys(cov.depth).sort(), S.COUNTIES.map(c => c.id).sort());
  assert.ok(Object.values(cov.depth).every(n => Number.isInteger(n) && n >= 0));
});

test('home page has no Area filter: no button, sheet, county picker, My counties or saved area (ship59)', () => {
  const html = require('./_page.js')();
  // valid inline scripts (a stray // comment in a one-line try once broke the page)
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
  for (const gone of ['scopeBtn', 'scopeSheet', 'scopeLbl', 'scope-btn', 'scope-sheet', 'scope-row', 'scope-st', 'scope-cty', 'scope-find', 'tabs-row',
    'Choose an area', 'Find a county', 'My counties', 'My Counties', 'aria-label="Area', "'Area: '", 'drawScope', 'setScope', 'savedScope', 'shortLabel', "fetch('/api/counties')",
    "setItem('tsn.scope'", "getItem('tsn.scope'", "setItem('tsn.myCounties'", "getItem('tsn.myCounties'"])
    assert.ok(!html.includes(gone), gone);
  assert.match(html, /<div class="nav-tabs"><div class="tabs" id="tabs" role="tablist" aria-label="Story type"><\/div><\/div>/);
  // returning readers: the old saved area is cleared, so the feed opens on Tri-State
  assert.ok(html.includes("try { localStorage.removeItem('tsn.scope'); localStorage.removeItem('tsn.myCounties'); } catch (e) {}"));
  assert.ok(html.includes("var SC = { key: 'tristate',"));
  assert.ok(html.includes("var url = '/api/news' + (SC.key !== 'tristate' ? '?scope=' + SC.key : '')"), 'the default request has no scope');
  // the county and state pages still set their scope from the path; leaving one goes back to Tri-State
  assert.match(html, /var g = RT && RT\.geo && RT\.geo\(location\.pathname\); if \(g\) \{ SC\.geo = g\.path; SC\.key = g\.scope;/);
  assert.ok(html.includes("else if (SC.geo) { SC.geo = null; SC.key = 'tristate'; }"));
  assert.ok(html.includes("if (SC.geo) { SC.geo = null; if (SC.key !== 'tristate') { SC.key = 'tristate'; load(false); } }"));
  assert.ok(html.includes('SC.on && SC.geo && SC.key !== \'tristate\' && !state.q.trim()) return scopeEmpty();'), 'the empty state is for county and state pages only');
  const empty = html.slice(html.indexOf('function scopeEmpty'), html.indexOf('function load('));
  assert.ok(!/Missouri/.test(html), 'no Missouri on the page (removed in ship62)');
  assert.ok(empty.includes('goScope(next.key)'));
  // untouched: locality label only with scopes on and not on a county page; ads and obituary rules
  assert.match(html, /if \(it\.place && SC\.on && !\/\^county:\/\.test\(SC\.key\)\)/);
  assert.match(html, /var AD_TABS = \['events', 'jobs', 'deals', 'classifieds', 'news'\]; \/\/ the only tabs with side ads/);
  assert.match(html, /TSNAds\.newsSlots\(shown\.map\(function \(it\) \{ var k = kindOf\(it\.sourceId\); return k === 'police' \|\| k === 'courts'; \}\)/);
  // the server side stays: scope API (including all for admin and old links), counties API, regional pages
  assert.equal(S.parse('all').key, 'all');
  assert.equal(S.parse('county:ky-henderson').key, 'county:ky-henderson');
  for (const f of ['api/_scope.js', 'api/_geopage.js', 'api/_geoapi.js', 'api/_coverage.js']) assert.ok(fs.existsSync(path.join(root, f)), f);
});

test('the reader UI sends no picker state: README and privacy no longer describe an area choice', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8'), legal = fs.readFileSync(path.join(root, 'public/legal.html'), 'utf8');
  assert.ok(!/My counties|My Counties|Done\/Clear|beside\s+the tabs with the current area/.test(readme));
  assert.ok(readme.includes('There is no area picker in the reader UI'));
  assert.ok(!/the area you chose to read|your list of counties/.test(legal));
});

test('still exactly 8 functions', () => {
  const fns = fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.deepStrictEqual(fns.sort(), ['alerts.js', 'inbox.js', 'listings.js', 'news.js', 'newsletter.js', 'react.js', 'stripe-webhook.js', 'unsubscribe.js']);
});
