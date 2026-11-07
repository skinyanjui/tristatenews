'use strict';
// ship105: tristatemarketplace.com test listings on Classifieds (api/_market.js, GET /api/market hosted by
// api/listings.js). Parsing only reads public sitemap and listing-page markup; the cache serves the last good result
// and a failure with nothing cached is ok:false with no items. The pages below are trimmed copies of the site's
// public markup, used only here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[k];
const M = require('../api/_market.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const SITEMAP = '<?xml version="1.0"?><urlset><url><loc>https://tristatemarketplace.vercel.app</loc></url>' +
  '<url><loc>https://tristatemarketplace.vercel.app/listing/camry</loc></url><url><loc>https://www.tristatemarketplace.com/listing/wanted-sofa</loc></url>' +
  '<url><loc>https://tristatemarketplace.vercel.app/listing/camry</loc></url><url><loc>https://evil.example/listing/x</loc></url><url><loc>https://tristatemarketplace.vercel.app/listing/../admin</loc></url></urlset>';
const page = o => '<html><head><title>' + o.title + ' | Tristate Market</title><meta name="description" content="' + o.meta + '"/></head><body>' +
  '<main class="dwrap"><div class="hero">' + (o.img ? '<img src="' + o.img + '" alt="x" draggable="false"/>' : '') + '</div>' +
  '<div class="section"><div class="metarow"><span class="pill" style="position:static">' + o.cat + '</span><span class="muted metaplace"><svg></svg><span>' + o.town + '<!-- --> · <!-- -->Posted yesterday</span></span><button>Share</button></div>' +
  '<h1 class="dtitle">' + o.title + '</h1><div class="mprice"><span class="dprice">' + o.price + '</span><a href="#contact" class="btn">Message</a></div>' +
  '<div>Message seller DW Dana W. · Private seller 812-555-0199</div></div></main></body></html>';
const CAMRY = page({ title: '2015 Ford Fusion Titanium, one owner', meta: '$11,900 · Evansville, IN. One-owner Fusion with &amp; leather seats.', img: '/listings/car-sedan.jpg', cat: 'Cars', town: 'Evansville, IN', price: '$11,900' });
const SOFA = page({ title: 'Wanted: sectional sofa', meta: '$400 · Evansville, IN. Looking for a clean sectional.', cat: 'Furniture', town: 'Evansville, IN', price: '$400' });

function fakeFetch(map, calls) {
  return async url => {
    calls && calls.push(url);
    const body = map[url];
    if (body instanceof Error) throw body;
    return body == null ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => body };
  };
}
const SITE = 'https://www.tristatemarketplace.com';
const GOOD = { [SITE + '/sitemap.xml']: SITEMAP, [SITE + '/listing/camry']: CAMRY, [SITE + '/listing/wanted-sofa']: SOFA };

test('ship105: the sitemap gives listing slugs on the site\'s own hosts only, in order, once each', () => {
  assert.deepEqual(M.parseSitemap(SITEMAP), ['camry', 'wanted-sofa']);
  assert.deepEqual(M.parseSitemap('not xml'), []);
});

test('ship105: a listing page gives only what it prints; no seller name or contact is kept', () => {
  const x = M.parseListing(CAMRY, 'camry');
  assert.deepEqual(x, { id: 'mk-camry', url: SITE + '/listing/camry', title: '2015 Ford Fusion Titanium, one owner', price: '$11,900', town: 'Evansville, IN',
    desc: 'One-owner Fusion with & leather seats.', srcCategory: 'Cars', category: 'Vehicles', image: SITE + '/listings/car-sedan.jpg' });
  assert.ok(!/Dana|555|Posted/.test(JSON.stringify(x)));
  assert.equal(M.parseListing(SOFA, 'wanted-sofa').image, '', 'no photo: none invented');
  assert.equal(M.parseListing(page({ title: 'Lamp', meta: '', img: 'https://evil.example/a.jpg', cat: 'Furniture', town: 'Newburgh, IN', price: '' }), 'lamp').image, '', 'only the site\'s own images');
  assert.equal(M.parseListing(page({ title: 'Lamp', meta: '', cat: 'Furniture', town: 'Newburgh, IN', price: '' }), 'lamp').price, '', 'no price: none invented');
  assert.equal(M.parseListing('<html><title></title></html>', 'x'), null);
});

test('ship105: categories map onto the Classifieds categories; anything else is Other', () => {
  const cats = JSON.parse(read('api/listings.js').match(/item: (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  for (const c of ['Cars', 'Motorcycles', 'Trailers', 'Furniture', 'Electronics', 'Appliances', 'Tools', 'Lawn and garden', 'Sports', 'Jobs', 'Livestock', 'Real estate', 'Free stuff', ''])
    assert.ok(cats.includes(M.category(c)), c);
  assert.equal(M.category('Cars'), 'Vehicles'); assert.equal(M.category('Lawn and garden'), 'Home & garden'); assert.equal(M.category('Livestock'), 'Other');
});

test('ship105: duplicates (same slug, or same title and town) are dropped', () => {
  const a = M.parseListing(CAMRY, 'camry'), b = Object.assign({}, a, { id: 'mk-camry-2', url: SITE + '/listing/camry-2', town: 'Evansville, Indiana' });
  assert.deepEqual(M.dedupe([a, a, b]).map(x => x.id), ['mk-camry']);
});

test('ship105: a live read is bounded and cached; a failure serves the last good result as stale', async () => {
  M.reset();
  const calls = [], t0 = Date.parse('2026-11-06T12:00:00Z');
  const r1 = await M.load({ fetch: fakeFetch(GOOD, calls), now: t0 });
  assert.equal(r1.ok, true); assert.equal(r1.stale, false); assert.deepEqual(r1.items.map(x => x.id), ['mk-camry', 'mk-wanted-sofa']);
  assert.equal(calls.length, 3, 'the sitemap and two pages');
  const r2 = await M.load({ fetch: fakeFetch({}, calls), now: t0 + 10 * 60000 });
  assert.equal(calls.length, 3, 'within 30 minutes: no request'); assert.equal(r2.stale, false);
  const r3 = await M.load({ fetch: fakeFetch({ [SITE + '/sitemap.xml']: new Error('down') }), now: t0 + 31 * 60000 });
  assert.equal(r3.ok, true); assert.equal(r3.stale, true); assert.equal(r3.at, t0); assert.equal(r3.items.length, 2);
  const r4 = await M.load({ fetch: fakeFetch({}), now: t0 + 4 * 864e5 });
  assert.deepEqual(r4, { ok: false, stale: false, refreshing: false, at: 0, items: [] }, 'older than 3 days: not shown');
  assert.ok(M.LIMITS.MAX_LISTINGS <= 40 && M.LIMITS.CONCURRENCY <= 6 && M.LIMITS.DEADLINE_MS < 10000);
});

test('ship105: nothing cached and the site down: ok:false and no items (never fixtures)', async () => {
  M.reset();
  assert.deepEqual(await M.load({ fetch: fakeFetch({ [SITE + '/sitemap.xml']: new Error('down') }) }), { ok: false, stale: false, refreshing: false, at: 0, items: [] });
  M.reset();
  assert.equal((await M.load({ fetch: fakeFetch({ [SITE + '/sitemap.xml']: SITEMAP }) })).ok, false, 'sitemap but no readable page');
  M.reset();
  const many = '<urlset>' + Array.from({ length: 60 }, (_, i) => '<url><loc>' + SITE + '/listing/l' + i + '</loc></url>').join('') + '</urlset>', calls = [];
  const map = { [SITE + '/sitemap.xml']: many }; for (let i = 0; i < 60; i++) map[SITE + '/listing/l' + i] = page({ title: 'Item number ' + i, meta: '', cat: 'Tools', town: 'Evansville, IN', price: '$' + i });
  const r = await M.load({ fetch: fakeFetch(map, calls) });
  assert.equal(r.items.length, 40); assert.equal(calls.length, 41, 'at most 40 listing pages');
  M.reset();
});

test('ship105: /api/market is a route of api/listings.js (still eight functions) and answers GET only', async () => {
  const vj = JSON.parse(read('vercel.json'));
  assert.deepEqual(vj.rewrites.filter(r => r.source === '/api/market').map(r => r.destination), ['/api/listings?__route=market']);
  assert.match(read('api/listings.js'), /market: \(\) => require\('\.\/_market\.js'\)/);
  assert.equal(fs.readdirSync(path.join(root, 'api')).filter(n => n.endsWith('.js') && !n.startsWith('_')).length, 8);
  const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  await M({ method: 'POST' }, res);
  assert.equal(res.code, 405);
});

test('ship105: Classifieds shows the listings in their own section with a test-listing disclosure on it and every card', () => {
  const js = read('public/assets/app.js');
  assert.match(js, /fetch\('\/api\/market'\)/);
  assert.match(js, /'From tristatemarketplace\.com'/);
  assert.match(js, /'Test listings from tristatemarketplace\.com, shown while we test the site\. Some are samples, and TRISTATENOW hasn\\u2019t verified any of them\. Prices and details are as posted there\.'/);
  assert.match(js, /el\('span', 'mk-tag', 'Test listing'\)/);
  assert.match(js, /href: x\.url/);
  assert.match(js, /if \(!MK\.ok\) \{/);
  assert.ok(!/verified listing/i.test(js));
  assert.match(js, /root\.appendChild\(marketSection\(boards\.item\)\);/);
});
