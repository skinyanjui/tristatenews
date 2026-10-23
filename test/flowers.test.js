// Ads PR 4.3: the obituary "Send flowers" link. A quiet text link, never an ad unit: the funeral home's own florist
// page when one is checked and listed in data/funeral-homes.json, else the affiliate link (labeled "paid link",
// rel="sponsored noopener") when an affiliate ID is set, else the unpaid fallbackUrl from data/flowers.json (no label,
// rel="noopener nofollow"), else (fallbackUrl emptied) no link. GET /api/flowers is served by listings.js.
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
  assert.deepStrictEqual(F.linkFor({ source: 'Ziemer Funeral Home' }, cfg), { href: 'https://example.org/flowers', paid: false, rel: 'noopener' });
  assert.deepStrictEqual(F.linkFor({ business: 'ziemer funeral home', source: 'x' }, cfg), { href: 'https://example.org/flowers', paid: false, rel: 'noopener' }, 'a posted notice names its funeral home in "business"');
});

test('order: florist page, then the affiliate link (paid), then the unpaid fallback, then nothing; only https', () => {
  const aff = 'https://www.floristone.com/index.cfm?AffiliateID=123&source_id=aff', fb = 'https://www.floristone.com/funeral-flowers/';
  const cfg = { homes: { ziemer: 'https://example.org/flowers', browning: 'http://example.org/x', koehler: 'javascript:alert(1)' }, affiliate: aff, fallbackUrl: fb };
  assert.deepStrictEqual(F.linkFor({ source: 'Ziemer Funeral Home' }, cfg), { href: 'https://example.org/flowers', paid: false, rel: 'noopener' });
  assert.deepStrictEqual(F.linkFor({ source: 'Browning Funeral Home' }, cfg), { href: aff, paid: true, rel: 'sponsored noopener' }, 'a non-https florist page is ignored');
  assert.deepStrictEqual(F.linkFor({ source: 'Koehler Funeral Home' }, cfg), { href: aff, paid: true, rel: 'sponsored noopener' });
  assert.deepStrictEqual(F.linkFor({ source: 'Dubois County Herald' }, cfg), { href: aff, paid: true, rel: 'sponsored noopener' }, 'the affiliate link wins over the fallback');
  const noId = { homes: { ziemer: 'https://example.org/flowers' }, affiliate: null, fallbackUrl: fb };
  assert.deepStrictEqual(F.linkFor({ source: 'Dubois County Herald' }, noId), { href: fb, paid: false, rel: 'noopener nofollow' }, 'no ID, no florist page: the unpaid fallback');
  assert.deepStrictEqual(F.linkFor({ source: 'Ziemer Funeral Home' }, noId), { href: 'https://example.org/flowers', paid: false, rel: 'noopener' }, 'the florist page still wins');
  assert.strictEqual(F.linkFor({ source: 'Dubois County Herald' }, { homes: {}, affiliate: null, fallbackUrl: null }), null, 'fallback emptied: hidden');
  assert.strictEqual(F.linkFor({ source: 'Dubois County Herald' }, { homes: {}, affiliate: null }), null);
  assert.strictEqual(F.linkFor({ source: 'x' }, { homes: {}, affiliate: 'http://example.org', fallbackUrl: 'http://example.org/f' }), null);
  assert.strictEqual(F.linkFor({ source: 'x' }, null), null, 'before /api/flowers answers: hidden');
  assert.strictEqual(F.REL_PAID, 'sponsored noopener');
  assert.strictEqual(F.REL_FALLBACK, 'noopener nofollow');
  assert.strictEqual(F.REL_HOME, 'noopener');
  assert.strictEqual(F.LABEL_PAID, 'paid link');
});

test('shipped data: no invented URLs, no affiliate ID yet, every funeral-home source listed', () => {
  assert.strictEqual(CONFIG.affiliateId, '', 'empty until Sam joins the program');
  assert.ok(CONFIG.affiliateUrl.startsWith('https://www.floristone.com/') && CONFIG.affiliateUrl.includes('AffiliateID={id}'));
  assert.ok(/TODO/.test(CONFIG.note), 'the URL shape is documented as to be confirmed');
  assert.strictEqual(CONFIG.fallbackUrl, 'https://www.floristone.com/funeral-flowers/', 'the public page checked with curl (200) on Oct 18, 2026');
  assert.ok(!/affiliate|source_id|[?&]/i.test(CONFIG.fallbackUrl), 'no affiliate code in the fallback');
  assert.strictEqual(S.fallbackUrl({ fallbackUrl: '' }), null, 'emptied: hidden');
  assert.strictEqual(S.fallbackUrl({ fallbackUrl: 'http://example.org/' }), null, 'https only');
  for (const h of HOMES.homes) {
    assert.deepStrictEqual(Object.keys(h).sort(), ['donateUrl', 'florist', 'name', 'treeUrl'], h.name);
    for (const f of ['florist', 'treeUrl', 'donateUrl']) assert.strictEqual(h[f], '', h.name + ': ' + f + ' empty until someone checks the funeral home’s own page');
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

test('GET /api/flowers through listings.js: the unpaid fallback by default, the affiliate link once the ID is set, GET/HEAD only', async () => {
  const host = require('../api/listings.js');
  await withEnv(null, async () => {
    const r = await call(host, 'GET', { __route: 'flowers' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(JSON.parse(r.body), { homes: {}, affiliate: null, fallbackUrl: 'https://www.floristone.com/funeral-flowers/', tree: { homes: {}, affiliate: null, fallbackUrl: 'https://onetreeplanted.org/products/gift-trees-in-memory' }, donate: { homes: {} } });
    assert.match(r.headers['cache-control'], /public/);
  });
  await withEnv('2026012345', async () => {
    const r = await call(host, 'GET', { __route: 'flowers' });
    assert.strictEqual(JSON.parse(r.body).affiliate, 'https://www.floristone.com/index.cfm?AffiliateID=2026012345&source_id=aff');
    assert.strictEqual(JSON.parse(r.body).fallbackUrl, 'https://www.floristone.com/funeral-flowers/');
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
  assert.ok(fn.includes("['Send flowers', F.linkFor(it, FLOWERS)], ['Plant a tree', F.treeFor(it, FLOWERS)], ['Donate', F.donateFor(it, FLOWERS)]") && fn.includes("a.target = '_blank'"));
  assert.ok(fn.includes("a.rel = f.paid ? F.REL_PAID : f.rel;") && fn.includes("if (f.paid) w.appendChild(el('span', 'ob-paid', F.LABEL_PAID));"), '"paid link" only when paid');
  assert.ok(fn.includes('return p.children.length ? p : null;'), 'no empty row');
  assert.ok(html.includes('FLOWERS.fallbackUrl'), 'the fallback alone re-renders the tab');
  assert.ok(!/<img|ad-card|spon|Sponsored|Advertise/.test(fn), 'not an ad unit');
  assert.ok(html.includes("var fl = kd === 'obits' ? flowersLink(it, 'div') : null; if (fl) { foot.classList.add('cf-ob'); foot.appendChild(fl); }"), 'feed cards: only obituaries, in the footer, not inside the card link');
  const mk = html.slice(html.indexOf('function makeCard('), html.indexOf('var brkTimer'));
  assert.ok(mk.indexOf('foot.appendChild(actRow(sb, it));') < mk.indexOf("flowersLink(it, 'div')"), 'heart and share first, the flowers row last (audit 2026-10-22: it sat above them on phones)');
  const ob = html.slice(html.indexOf('function obitCard('), html.indexOf('function applyHref('));
  assert.ok(ob.includes('flowersLink(it)'), 'posted obituaries too');
  assert.strictEqual((html.match(/flowersLink\(/g) || []).length, 3, 'defined once, used on the two obituary cards only');
  assert.ok(html.includes("if (state.cat === 'obits') { loadFlowers();"), 'fetched only on the Obituaries tab');
  assert.ok(/'paid link'/.test(read('public/flowers.js')) && /'sponsored noopener'/.test(read('public/flowers.js')));
  assert.ok(read('package.json').includes('public/flowers.js'), 'linted');
});

test('legal and README describe the link as it works', () => {
  const legal = read('public/legal.html').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  for (const s of ['An obituary may show a “Send flowers” link', 'It is a small text link only, not an ad', 'a small “Send flowers” text link to a florist', 'When the link is marked “paid link,” it’s an affiliate link: we may earn a commission',
    'A “Send flowers” link without that label earns us nothing', 'carries nothing about you or the person who died', 'The link carries only our affiliate code', 'isn’t an affiliate link and carries no code at all'])
    assert.ok(legal.includes(s), s);
  assert.ok(!/\(planned\)|planned “Send flowers”|We plan to add a “Send flowers”/.test(legal));
  const readme = read('README.md');
  assert.ok(readme.includes('FLORIST_ONE_AFFILIATE_ID') && readme.includes('data/funeral-homes.json'));
});

test('Plant a tree: home treeUrl, then a paid affiliate link (ID + template), then the unpaid memorial-tree page', async () => {
  const fb = 'https://onetreeplanted.org/products/gift-trees-in-memory';
  assert.strictEqual(CONFIG.tree.fallbackUrl, fb); assert.strictEqual(CONFIG.tree.affiliateId, ''); assert.strictEqual(CONFIG.tree.affiliateUrl, '');
  const cfg = { tree: { homes: { ziemer: 'https://example.org/trees' }, affiliate: null, fallbackUrl: fb } };
  assert.deepStrictEqual(F.treeFor({ source: 'Ziemer Funeral Home' }, cfg), { href: 'https://example.org/trees', paid: false, rel: 'noopener' });
  assert.deepStrictEqual(F.treeFor({ source: 'Courier & Press' }, cfg), { href: fb, paid: false, rel: 'noopener nofollow' }, 'unpaid fallback, no label');
  assert.deepStrictEqual(F.treeFor({ source: 'x' }, { tree: { homes: {}, affiliate: 'https://example.org/t?id=7', fallbackUrl: fb } }), { href: 'https://example.org/t?id=7', paid: true, rel: 'sponsored noopener' });
  assert.strictEqual(F.treeFor({ source: 'x' }, { tree: { homes: {}, affiliate: null, fallbackUrl: null } }), null);
  assert.strictEqual(F.treeFor({ source: 'x' }, null), null);
  assert.strictEqual(S.treeAffiliateId({}), ''); assert.strictEqual(S.treeAffiliateId({ TREE_AFFILIATE_ID: 'ab_12' }), 'ab_12');
  assert.strictEqual(S.treeConfig({ TREE_AFFILIATE_ID: 'ab_12' }).affiliate, null, 'no template yet: still unpaid');
  assert.strictEqual(S.treeConfig({ TREE_AFFILIATE_ID: 'ab_12' }, { tree: { affiliateUrl: 'https://example.org/t?a={id}', fallbackUrl: fb } }).affiliate, 'https://example.org/t?a=ab_12');
  assert.ok(!S.treeConfig({ FLORIST_ONE_AFFILIATE_ID: '99' }, { tree: { affiliateUrl: 'https://example.org/t?a={id}' } }).affiliate, 'the florist ID is not reused');
});

test('Donate: a home donateUrl, or the obituary asks for donations; never an invented charity', () => {
  const page = 'https://www.example-funeral.test/obituaries/jane-doe';
  const cfg = { donate: { homes: { ziemer: 'https://example.org/donate' } } };
  assert.deepStrictEqual(F.donateFor({ source: 'Ziemer Funeral Home', summary: 'Jane died.' }, cfg), { href: 'https://example.org/donate', paid: false, rel: 'noopener' });
  assert.strictEqual(F.donateFor({ source: 'Courier & Press', summary: 'John Sample, 75, died at home.', link: page }, cfg), null, 'no ask: hidden');
  assert.deepStrictEqual(F.donateFor({ source: 'x', summary: 'In lieu of flowers, memorial contributions may be made to the American Cancer Society.', link: page }, cfg), { href: page, paid: false, rel: 'noopener nofollow', page: true }, 'the obituary page names the charity');
  assert.deepStrictEqual(F.donateFor({ source: 'x', desc: 'Memorial donations may be made to St. Vincent at https://give.example.org/svh. Services Friday.' }, {}), { href: 'https://give.example.org/svh', paid: false, rel: 'noopener nofollow' }, 'an https link in the ask');
  assert.strictEqual(F.donateFor({ source: 'x', desc: 'In lieu of flowers, please donate to the family church.' }, {}), null, 'a posted notice with no link: hidden, nothing invented');
  assert.strictEqual(F.donateFor({ source: 'x', desc: 'In lieu of flowers see http://insecure.example.org', link: 'http://insecure.example.org' }, {}), null, 'https only');
  for (const t of ['In lieu of flowers, donations to Hospice.', 'Memorial contributions may be made to the Humane Society.', 'Donations in her memory may go to the library.', 'Contributions can be sent to Riley Children’s Foundation.'])
    assert.ok(F.asksDonations(t), t);
  for (const t of ['He loved flowers and his garden.', 'She donated blood for 40 years.', 'Visitation at the chapel.'])
    assert.ok(!F.asksDonations(t), t);
});

test('action row: one row at the bottom of the card, wraps and stacks, 40px targets, shared tokens; no ads on obituaries', () => {
  const html = read('public/index.html');
  const css = html.slice(html.indexOf('/* Obituary action row'), html.indexOf('/* in-listing Sponsored card'));
  assert.ok(css.includes('.ob { display:flex; flex-direction:column; }') && css.includes('.ob > .ob-acts { margin-top:auto;'), 'pinned to the bottom');
  assert.ok(css.includes('.card:has(.cf .ob-acts) > .cf { margin-top:auto; }'), 'feed obituary cards too');
  assert.ok(css.includes('.card .cf.cf-ob > .ob-acts { order:2; flex:1 0 100%;'), 'feed obituary cards: the row is a full-width last row at every width');
  assert.ok(css.includes('flex-wrap:wrap') && css.includes('@media (max-width:374px) { .ob-acts { flex-direction:column;'), 'wraps, stacks on narrow phones');
  assert.ok(css.includes('var(--card-pad)') && css.includes('var(--card-stack)'), 'shared tokens');
  assert.ok(html.includes('.ob-flw a, .card .ob-flw a { display:inline-flex; align-items:center; min-height:var(--card-tap); }'), '40px targets');
  const ob = html.slice(html.indexOf('function obitCard('), html.indexOf('function applyHref('));
  assert.ok(ob.indexOf('flowersLink(it)') > ob.indexOf("actions(it, 'obit', b, foot)"), 'the row is the last thing in the card');
  assert.ok(!/UI\.sponsor\('obits'|UI\.adCard\('obit/.test(html), 'still no ads on Obituaries');
});
