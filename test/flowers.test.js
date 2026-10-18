// Ads PR 4.3: the obituary "Send flowers" link. A quiet text link, never an ad unit: the funeral home's own florist
// page when one is checked and listed in data/funeral-homes.json, else the affiliate link (labeled "paid link",
// rel="sponsored noopener") when an affiliate ID is set, else no link. GET /api/flowers is served by listings.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const F = require('../public/flowers.js');
const S = require('../api/_flowers.js');
const HOMES = require('../data/funeral-homes.json');
const CONFIG = require('../data/flowers.json');

function call(handler, method, query) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
      send(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); return this; }, json(o) { this.setHeader('content-type', 'application/json'); return this.send(JSON.stringify(o)); } };
    Promise.resolve(handler({ method, url: '/api/flowers', query: query || {}, headers: {} }, res));
  });
}
function withEnv(v, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'FLORIST_ONE_AFFILIATE_ID'), old = process.env.FLORIST_ONE_AFFILIATE_ID;
  if (v == null) delete process.env.FLORIST_ONE_AFFILIATE_ID; else process.env.FLORIST_ONE_AFFILIATE_ID = v;
  return Promise.resolve().then(fn).finally(() => { if (had) process.env.FLORIST_ONE_AFFILIATE_ID = old; else delete process.env.FLORIST_ONE_AFFILIATE_ID; });
}

test('funeral-home names match loosely; papers never match a funeral home', () => {
  assert.strictEqual(F.key('Nass & Son Funeral Home'), 'nass son');
  assert.strictEqual(F.key('NASS AND SON'), 'nass son');
  assert.strictEqual(F.key('Glenn Funeral Home and Crematory'), 'glenn');
  assert.strictEqual(F.key('Haley-McGinnis Funeral Home'), 'haley mcginnis');
  assert.strictEqual(F.key(''), '');
  const cfg = { homes: { [F.key('Ziemer Funeral Home')]: 'https://example.org/flowers' }, affiliate: null };
  assert.strictEqual(F.linkFor({ source: 'Messenger-Inquirer' }, cfg), null);
  assert.deepStrictEqual(F.linkFor({ source: 'Ziemer Funeral Home' }, cfg), { href: 'https://example.org/flowers', paid: false });
  assert.deepStrictEqual(F.linkFor({ business: 'ziemer funeral home', source: 'x' }, cfg), { href: 'https://example.org/flowers', paid: false }, 'a posted notice names its funeral home in "business"');
});

test('order: florist page, then the affiliate link (paid), then nothing; only https', () => {
  const aff = 'https://www.floristone.com/index.cfm?AffiliateID=123&source_id=aff';
  const cfg = { homes: { ziemer: 'https://example.org/flowers', browning: 'http://example.org/x', koehler: 'javascript:alert(1)' }, affiliate: aff };
  assert.deepStrictEqual(F.linkFor({ source: 'Ziemer Funeral Home' }, cfg), { href: 'https://example.org/flowers', paid: false });
  assert.deepStrictEqual(F.linkFor({ source: 'Browning Funeral Home' }, cfg), { href: aff, paid: true }, 'a non-https florist page is ignored');
  assert.deepStrictEqual(F.linkFor({ source: 'Koehler Funeral Home' }, cfg), { href: aff, paid: true });
  assert.deepStrictEqual(F.linkFor({ source: 'Dubois County Herald' }, cfg), { href: aff, paid: true });
  assert.strictEqual(F.linkFor({ source: 'Dubois County Herald' }, { homes: {}, affiliate: null }), null, 'no florist page and no affiliate ID: hidden');
  assert.strictEqual(F.linkFor({ source: 'x' }, { homes: {}, affiliate: 'http://example.org' }), null);
  assert.strictEqual(F.linkFor({ source: 'x' }, null), null, 'before /api/flowers answers: hidden');
  assert.strictEqual(F.REL_PAID, 'sponsored noopener');
  assert.strictEqual(F.LABEL_PAID, 'paid link');
});

test('shipped data: no invented URLs, no affiliate ID yet, every funeral-home source listed', () => {
  assert.strictEqual(CONFIG.affiliateId, '', 'empty until Sam joins the program');
  assert.ok(CONFIG.affiliateUrl.startsWith('https://www.floristone.com/') && CONFIG.affiliateUrl.includes('AffiliateID={id}'));
  assert.ok(/TODO/.test(CONFIG.note), 'the URL shape is documented as to be confirmed');
  for (const h of HOMES.homes) {
    assert.deepStrictEqual(Object.keys(h).sort(), ['florist', 'name'], h.name);
    assert.strictEqual(h.florist, '', h.name + ': empty until someone checks the funeral home’s own florist page');
  }
  const names = new Set(HOMES.homes.map(h => h.name));
  for (const f of fs.readdirSync(path.join(root, 'data/sources')).filter(f => f.endsWith('.json'))) {
    const j = JSON.parse(read('data/sources/' + f)), arr = Array.isArray(j) ? j : (j.sources || []);
    for (const s of arr.filter(s => s.funeralHome)) assert.ok(names.has(s.name), s.name + ' is in data/funeral-homes.json');
  }
  assert.deepStrictEqual(S.homesMap({ homes: [{ name: 'Ziemer Funeral Home', florist: 'https://example.org/f' }, { name: 'Browning', florist: 'http://x.org' }, { name: 'Koehler', florist: '' }] }), { ziemer: 'https://example.org/f' });
});

test('the affiliate ID: the server env var wins over the config file; a malformed ID counts as unset', () => {
  assert.strictEqual(S.affiliateId({}), '');
  assert.strictEqual(S.affiliateId({ FLORIST_ONE_AFFILIATE_ID: ' 2026012345 ' }), '2026012345');
  assert.strictEqual(S.affiliateId({ FLORIST_ONE_AFFILIATE_ID: 'a b' }), '');
  assert.strictEqual(S.affiliateId({ FLORIST_ONE_AFFILIATE_ID: '1&x=2' }), '');
  assert.strictEqual(S.affiliateUrl({}), null);
  assert.strictEqual(S.affiliateUrl({ FLORIST_ONE_AFFILIATE_ID: '2026012345' }), 'https://www.floristone.com/index.cfm?AffiliateID=2026012345&source_id=aff');
  assert.strictEqual(S.affiliateUrl({ FLORIST_ONE_AFFILIATE_ID: '7' }, { affiliateUrl: 'https://example.org/no-placeholder' }), null);
});

test('GET /api/flowers through listings.js: hidden by default, the affiliate link once the ID is set, GET/HEAD only', async () => {
  const host = require('../api/listings.js');
  await withEnv(null, async () => {
    const r = await call(host, 'GET', { __route: 'flowers' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(JSON.parse(r.body), { homes: {}, affiliate: null });
    assert.match(r.headers['cache-control'], /public/);
  });
  await withEnv('2026012345', async () => {
    const r = await call(host, 'GET', { __route: 'flowers' });
    assert.strictEqual(JSON.parse(r.body).affiliate, 'https://www.floristone.com/index.cfm?AffiliateID=2026012345&source_id=aff');
  });
  const p = await call(host, 'POST', { __route: 'flowers' });
  assert.strictEqual(p.status, 405);
  const v = JSON.parse(read('vercel.json'));
  assert.deepStrictEqual(v.rewrites.filter(r => r.source === '/api/flowers').map(r => r.destination), ['/api/listings?__route=flowers']);
  assert.ok(read('server.js').includes("'/api/flowers'"));
});

test('the page: a text link on obituaries only, "paid link" and rel="sponsored noopener" when paid, outside the card link', () => {
  const html = read('public/index.html');
  assert.ok(html.includes('<script src="/flowers.js"></script>'));
  const fn = html.slice(html.indexOf('function flowersLink('), html.indexOf('function obitCard('));
  assert.ok(fn.includes("el('a', null, 'Send flowers')") && fn.includes('TSNFlowers.REL_PAID') && fn.includes('TSNFlowers.LABEL_PAID') && fn.includes("a.target = '_blank'"));
  assert.ok(!/<img|ad-card|spon|Sponsored|Advertise/.test(fn), 'not an ad unit');
  assert.ok(html.includes("var fl = kd === 'obits' ? flowersLink(it, 'span') : null; if (fl) foot.appendChild(fl);"), 'feed cards: only obituaries, in the footer, not inside the card link');
  const ob = html.slice(html.indexOf('function obitCard('), html.indexOf('function applyHref('));
  assert.ok(ob.includes('flowersLink(it)'), 'posted obituaries too');
  assert.strictEqual((html.match(/flowersLink\(/g) || []).length, 3, 'defined once, used on the two obituary cards only');
  assert.ok(html.includes("if (state.cat === 'obits') { loadFlowers();"), 'fetched only on the Obituaries tab');
  assert.ok(/'paid link'/.test(read('public/flowers.js')) && /'sponsored noopener'/.test(read('public/flowers.js')));
  assert.ok(read('package.json').includes('public/flowers.js'), 'linted');
});

test('legal and README describe the link as it works', () => {
  const legal = read('public/legal.html').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  for (const s of ['An obituary may show a “Send flowers” link', 'It is a small text link only, not an ad', 'that link is not paid', 'labeled “paid link,” and we may earn a commission',
    'If neither applies, the obituary shows no link', 'carries nothing about you or the person who died', 'The link carries only our affiliate code', 'isn’t an affiliate link'])
    assert.ok(legal.includes(s), s);
  assert.ok(!/\(planned\)|planned “Send flowers”|We plan to add a “Send flowers”/.test(legal));
  const readme = read('README.md');
  assert.ok(readme.includes('FLORIST_ONE_AFFILIATE_ID') && readme.includes('data/funeral-homes.json'));
});
