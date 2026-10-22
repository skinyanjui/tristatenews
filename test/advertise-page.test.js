// Ads PR 4.1: the /advertise page. It sits behind the ADS_PAGE flag (off: a redirect to the site's Advertise form;
// preview: noindex; on: indexable), is served by api/inbox.js through a ?__route rewrite (still 8 functions), reads
// every price from /api/catalog, and posts inquiries to the existing /api/advertise.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../api/_catalog.js');
const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const page = read('data/pages/advertise.html');
const script = page.slice(page.indexOf('<script>') + 8, page.indexOf('</script>'));
const text = s => s.replace(/<script>[\s\S]*?<\/script>/g, ' ').replace(/<style>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

async function serve(flag, method, viaHost) {
  const saved = process.env.ADS_PAGE;
  for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k];
  if (flag == null) delete process.env.ADS_PAGE; else process.env.ADS_PAGE = flag;
  try {
    const h = viaHost ? require('../api/inbox.js') : require('../api/_adpage.js');
    const out = { status: 0, headers: {}, body: null };
    const res = { setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; }, status(c) { out.status = c; return res; }, send(b) { out.body = b; return res; }, json(o) { out.body = JSON.stringify(o); return res; } };
    await h({ method: method || 'GET', url: '/api/inbox?__route=adpage', query: { __route: 'adpage' }, headers: {} }, res);
    return out;
  } finally { if (saved == null) delete process.env.ADS_PAGE; else process.env.ADS_PAGE = saved; }
}

test('ADS_PAGE off (the default): /advertise redirects to the site’s Advertise form, page never served', async () => {
  for (const flag of [undefined, '', '0', 'off', 'true', 'yes', 'ON ']) {
    const r = await serve(flag, 'GET', true);
    if (flag === 'ON ') { assert.strictEqual(r.status, 200, 'case and spaces are ignored'); continue; }
    assert.deepStrictEqual([r.status, r.headers.location, r.headers['cache-control'], r.body], [302, '/#advertise', 'no-store', ''], String(flag));
  }
  assert.ok(read('public/index.html').includes("if (location.hash === '#advertise') setTimeout(function () { openAd();"), 'the redirect opens the existing form');
});

test('ADS_PAGE=preview: served with noindex and no caching; ADS_PAGE=on: indexable, cached briefly', async () => {
  const p = await serve('preview');
  assert.deepStrictEqual([p.status, p.headers['x-robots-tag'], p.headers['cache-control'], p.headers['content-type']], [200, 'noindex, nofollow', 'no-store', 'text/html; charset=utf-8']);
  assert.ok(p.body.includes('<meta name="robots" content="noindex, nofollow">') && !p.body.includes('<!--robots-->'));
  const o = await serve('on');
  assert.deepStrictEqual([o.status, o.headers['x-robots-tag'], o.headers['cache-control']], [200, undefined, 'public, max-age=0, s-maxage=300']);
  assert.ok(!/name="robots"/.test(o.body) && !o.body.includes('<!--robots-->'));
  assert.strictEqual((await serve('on', 'HEAD')).body, '', 'HEAD: headers only');
  assert.strictEqual((await serve('on', 'POST')).status, 405);
  assert.strictEqual((await serve('on', 'GET', true)).status, 200, 'through the inbox host');
});

test('routing: a rewrite to api/inbox.js (still 8 functions); the page is bundled, and not reachable as a static file', () => {
  const vercel = JSON.parse(read('vercel.json'));
  assert.deepStrictEqual(vercel.rewrites.filter(r => r.source === '/advertise').map(r => r.destination), ['/api/inbox?__route=adpage']);
  assert.deepStrictEqual(vercel.functions['api/inbox.js'], { includeFiles: 'data/pages/**' });
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.ok(!fs.existsSync(path.join(root, 'public/advertise.html')), 'in public/ it would bypass the flag');
  assert.ok(read('api/inbox.js').includes("adpage: () => require('./_adpage.js')"));
  assert.ok(read('server.js').includes("app.all(['/advertise', '/advertise/'], (req, res) => adPageHandler(req, res));"));
  assert.ok(!require('../public/routes.js').byPath('/advertise'), 'not a tab of index.html');
  assert.ok(!read('public/sitemap.xml').includes('/advertise'), 'out of the sitemap until sales open');
});

test('no price is written in the page: every amount comes from /api/catalog', () => {
  assert.ok(!/\$\s?\d/.test(page), 'no hardcoded dollar amounts');
  assert.ok(!/\b(19|59|79|99|249|599|1,?199|2,?499)\b/.test(text(page)), 'no bare price numbers either');
  assert.ok(script.includes("fetch('/api/catalog')"));
});

// Run the page's own script against a tiny DOM and the real catalog.
async function render(checkoutConfigured, fetchOverride) {
  const store = {};
  const nodes = new Proxy(store, { get: (o, id) => (typeof id === 'string' && !(id in o) ? (o[id] = mk('div')) : o[id]) }); // any id exists, as in the HTML
  const mk = (tag, cls, txt) => {
    const n = { tag, className: cls || '', children: [], listeners: {}, hidden: false, value: '', type: '' };
    Object.defineProperty(n, 'textContent', { get() { return (n._t || '') + n.children.map(c => c.textContent).join(' '); }, set(v) { n._t = String(v); n.children = []; } });
    n.appendChild = c => { n.children.push(c); return c; };
    n.addEventListener = (e, f) => { n.listeners[e] = f; };
    n.scrollIntoView = () => {}; n.focus = () => {};
    if (txt != null) n.textContent = txt;
    return n;
  };
  const document = { getElementById: id => nodes[id], createElement: t => mk(t) };
  nodes.interest = mk('select'); nodes.interest.value = 'Featured job or deal';
  for (const id of ['rate-card', 'done', 'err']) { nodes[id] = mk('div'); nodes[id].hidden = true; } // hidden in the HTML
  const posts = [];
  const fetch = fetchOverride || (async (u, init) => {
    if (u === '/api/catalog') return { ok: true, json: async () => JSON.parse(JSON.stringify(C.publicCatalog(checkoutConfigured))) };
    if (u === '/api/advertise') { posts.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true, ref: 'AD-TEST01AB' }) }; }
    throw new Error('unexpected fetch ' + u);
  });
  const location = { href: '/advertise' };
  new Function('document', 'fetch', 'location', script)(document, fetch, location);
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  return { nodes, posts, location };
}
const cardText = n => n.children.map(c => c.textContent.replace(/\s+/g, ' ').trim());
const money = c => '$' + (c / 100).toLocaleString('en-US');

test('rate card: Featured prices and packages A–C from the catalog, D by proposal, newsletter and sponsored feature coming soon', async () => {
  const { nodes } = await render(false);
  assert.strictEqual(nodes['rate-card'].hidden, false);
  const feat = cardText(nodes.featured);
  assert.deepStrictEqual(feat.length, 4);
  for (const k of ['item', 'event', 'deal', 'job']) {
    const f = C.FEATURED[k];
    assert.ok(feat.some(t => t.includes(f.label) && t.includes(money(f.cents)) && t.includes(f.days + ' days')), k);
  }
  assert.deepStrictEqual(Object.values(C.FEATURED).map(f => f.cents).sort((a, b) => a - b), [1900, 5900, 7900, 9900], 'the $19, $59, $79 and $99 Featured posts');
  assert.ok(feat.every(t => t.includes('Opening soon')), 'without checkout, Featured says it opens soon');
  const pk = cardText(nodes.packages);
  assert.strictEqual(pk.length, 4);
  for (const k of ['A', 'B', 'C']) assert.ok(pk.some(t => t.startsWith(C.PACKAGES[k].label) && t.includes(money(C.PACKAGES[k].cents)) && t.includes('Order online')), k);
  const d = pk.find(t => t.startsWith('Package D'));
  assert.ok(d.includes('By proposal') && !d.includes('$'), 'D: by proposal, no price');
  const soon = cardText(nodes.soon);
  assert.ok(soon.some(t => t.startsWith('Newsletter sponsorship')) && soon.some(t => t.startsWith('Sponsored feature')));
  assert.ok(soon.every(t => t.includes('Coming soon') && !t.includes('$')), 'coming soon, no price, no button');
  assert.ok(nodes.soon.children.every(c => !c.children.some(x => x.tag === 'button')));
  const on = await render(true);
  assert.ok(cardText(on.nodes.featured).every(t => t.includes('Buy from your post')), 'Featured follows the catalog once checkout is on');
});

test('rate card: a catalog that fails to load shows a plain note, never a made-up price', async () => {
  const { nodes } = await render(false, async () => ({ ok: false, json: async () => ({}) }));
  assert.match(nodes['rates-status'].textContent, /couldn’t load/);
  assert.strictEqual(nodes['rate-card'].hidden, true, 'the rate card stays hidden');
  assert.strictEqual(nodes.featured.children.length, 0);
});

test('inquiry form: posts to /api/advertise and shows the AD- reference; the package buttons prefill it', async () => {
  const { nodes, posts, location } = await render(false);
  const orderB = nodes.packages.children[1].children.find(c => c.tag === 'button');
  assert.strictEqual(orderB.textContent, 'Order Package B');
  orderB.listeners.click();
  assert.strictEqual(location.href, '/order.html?pkg=B', 'A–C go to the online order page (ads Phase 6)');
  const askD = nodes.packages.children[3].children.find(c => c.tag === 'button');
  askD.listeners.click();
  assert.deepStrictEqual([nodes.interest.value, nodes.message.value], ['Section sponsorship', 'I’d like a proposal for Package D.']);
  Object.assign(nodes.business, { value: 'Main Street Shop' }); Object.assign(nodes.name, { value: 'Pat' }); Object.assign(nodes.email, { value: 'pat@shop.test' });
  nodes.f.listeners.submit({ preventDefault() {} });
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  assert.strictEqual(posts.length, 1);
  assert.deepStrictEqual(Object.keys(posts[0]).sort(), ['budget', 'business', 'email', 'interest', 'message', 'name', 'package', 'phone', 'website']);
  assert.strictEqual(posts[0].package, 'D', 'the package button picks the package too');
  // ads PR 4.2: package and budget choices come from the catalog
  assert.deepStrictEqual(nodes.package.children.map(o => [o.value, o.textContent]), ['A', 'B', 'C', 'D'].map(k => [k, C.PACKAGES[k].label]));
  assert.deepStrictEqual(nodes.budget.children.map(o => [o.value, o.textContent]), C.budgetBands().map(b => [b.key, b.label]));
  assert.deepStrictEqual([nodes.f.hidden, nodes.done.hidden, nodes.ref.textContent], [true, false, 'AD-TEST01AB']);
  const bad = await render(false);
  Object.assign(bad.nodes.business, { value: 'Shop' }); Object.assign(bad.nodes.name, { value: 'Pat' }); Object.assign(bad.nodes.email, { value: 'nope' });
  bad.nodes.f.listeners.submit({ preventDefault() {} });
  assert.strictEqual(bad.posts.length, 0);
  assert.match(bad.nodes.err.textContent, /valid email/);
  const serverInterests = read('api/_advertise.js').match(/const INTERESTS = \[([^\]]+)\]/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  assert.deepStrictEqual([...page.matchAll(/<option>([^<]+)<\/option>/g)].map(m => m[1]), serverInterests, 'the same choices the server accepts');
  assert.ok(page.includes('name="website"') && page.includes('class="hp"'), 'keeps the spam trap');
});

test('plain words: untargeted, where ads never go, links to the upload page and the Advertising Policy; no ads or tracking on the page', () => {
  const t = text(page);
  for (const s of ['Ads appear on the Jobs, Deals, Events and Classifieds boards and in the News feed, never directly next to a Police & courts item', 'There are never ads on Obituaries', 'Ads aren’t targeted',
    'Everyone who opens a board sees the same ads', 'labeled “Sponsored,”', 'A person reviews every ad before it runs'])
    assert.ok(t.includes(s), s);
  assert.ok(page.includes('href="/creative.html"') && page.includes('href="/legal.html#advertising"'));
  assert.ok(!/adslots\.js|\/api\/creative|sponsors\.json|googlesyndication|localStorage|sessionStorage|document\.cookie|<iframe|<video|autoplay/.test(page));
  assert.ok(!/\b\d[\d,]*\s*(readers|visitors|views|impressions|subscribers|people)\b/i.test(t), 'no audience numbers');
  assert.ok(!/sample|example\.com/i.test(page));
  assert.ok(page.includes('<!--robots-->'), 'the flag decides noindex');
});

test('the Advertise form on the site: newsletter is "Coming soon", and the rates page link shows only when the page is on', () => {
  const html = read('public/index.html');
  assert.ok(html.includes("['Newsletter sponsorship', 'One sponsor in each email', 'Coming soon']"));
  assert.ok(html.includes("fetch('/advertise', { method: 'HEAD', redirect: 'manual', cache: 'no-store' })") && html.includes('if (r.status !== 200) return;'));
});
