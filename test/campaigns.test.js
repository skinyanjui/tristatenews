// Ads PR 5.1/5.2: campaigns. An admin books an approved creative on placements for a date range; caps per placement
// per day can't be exceeded; with ADS_CAMPAIGNS=on, /api/creative?live=1 serves only campaigns running today (Chicago
// date), in a fixed order that public/adslots.js rotates in equal turns. Never targeted; samples still fill only an
// empty spot. No network: Upstash is faked by intercepting fetch, with placeholder keys.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const P = require('../api/_campaigns.js');
const A = require('../public/adslots.js');
const ADMIN = 'admin-placeholder-key';
const NOW = Date.parse('2026-10-18T18:00:00Z'); // Oct 18, 1 PM CT

function fakeStore() {
  const kv = new Map(), z = new Map(), sets = new Map(), lists = new Map();
  const run = ([op, k, ...a]) => {
    switch (op) {
      case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
      case 'MGET': return { result: [k, ...a].map(x => (kv.has(x) ? kv.get(x) : null)) };
      case 'SET': kv.set(k, a[0]); return { result: 'OK' };
      case 'ZADD': { const s = z.get(k) || new Map(); z.set(k, s); s.set(a[1], Number(a[0])); return { result: 1 }; }
      case 'ZREVRANGE': return { result: [...(z.get(k) || new Map())].sort((x, y) => y[1] - x[1]).map(x => x[0]).slice(Number(a[0]), Number(a[1]) + 1) };
      case 'SADD': { const s = sets.get(k) || new Set(); sets.set(k, s); s.add(a[0]); return { result: 1 }; }
      case 'SREM': { const s = sets.get(k); return { result: s && s.delete(a[0]) ? 1 : 0 }; }
      case 'SMEMBERS': return { result: [...(sets.get(k) || [])] };
      case 'LPUSH': { const l = lists.get(k) || []; lists.set(k, l); l.unshift(...a); return { result: l.length }; }
      case 'LTRIM': { const l = lists.get(k) || []; lists.set(k, l.slice(Number(a[0]), Number(a[1]) + 1)); return { result: 'OK' }; }
      case 'LRANGE': return { result: (lists.get(k) || []).slice(Number(a[0]), Number(a[1]) + 1) };
      default: throw new Error('unexpected command ' + op);
    }
  };
  const fetch = async (u, init) => {
    if (!String(u).startsWith('https://kv.test/')) throw new Error('unexpected fetch ' + u);
    return new Response(JSON.stringify(JSON.parse(init.body).map(run)), { status: 200 });
  };
  return { kv, z, sets, lists, fetch };
}
async function withStore(env, fn) {
  const saved = { ...process.env }, realFetch = global.fetch, realNow = Date.now, s = fakeStore();
  const clear = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k]; };
  clear(); Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', LISTINGS_ADMIN_KEY: ADMIN, ADS_CAMPAIGNS: '' }, env);
  global.fetch = s.fetch; Date.now = () => NOW;
  try {
    const inbox = require('../api/inbox.js');
    const call = async (route, method, opts) => {
      opts = opts || {};
      const out = { status: 0, body: null, headers: {} };
      const res = { setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, status(c) { out.status = c; return res; }, send(b) { out.body = typeof b === 'string' ? JSON.parse(b) : b; return res; }, json(o) { out.body = o; return res; } };
      await inbox({ method, url: '/api/' + route, query: Object.assign({ __route: route }, opts.query || {}), headers: Object.assign({}, opts.admin === false ? {} : { 'x-admin-key': opts.admin || ADMIN }), body: opts.body }, res);
      return out;
    };
    return await fn({ s, call });
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved); global.fetch = realFetch; Date.now = realNow; clear();
  }
}
const creative = (id, extra) => Object.assign({ id, ref: 'AD-SHOP' + id.slice(-4).toUpperCase(), headline: 'Shop ' + id.slice(-2), text: 'Fall sale', cta: 'Visit website', dest: 'https://shop.test/', destType: 'url',
  image: { type: 'png', w: 600, h: 300, bytes: 1000 }, status: 'approved', placements: ['card:jobs', 'line:jobs', 'rail:right'] }, extra || {});
const seedCreative = (s, c) => { s.kv.set('tsn:cr:' + c.id, JSON.stringify(c)); if (c.status === 'approved') { const l = s.sets.get('tsn:cr:live') || new Set(); l.add(c.id); s.sets.set('tsn:cr:live', l); } };
const camp = (id, placements, start, end, status) => ({ id, creativeId: 'cr0000000001', placements, start, end, status: status || 'active' });

test('dates are Chicago calendar dates; a campaign runs from its start to its end date, inclusive', () => {
  assert.strictEqual(P.today(Date.parse('2026-10-19T04:59:00Z')), '2026-10-18');
  assert.strictEqual(P.today(Date.parse('2026-10-19T05:00:00Z')), '2026-10-19');
  const c = camp('cp0000000001', ['card:jobs'], '2026-10-18', '2026-10-20');
  assert.deepStrictEqual(['2026-10-17', '2026-10-18', '2026-10-20', '2026-10-21'].map(d => P.runningOn(c, d)), [false, true, true, false]);
  assert.strictEqual(P.phase(c, NOW), 'running');
  assert.strictEqual(P.phase(Object.assign({}, c, { start: '2026-10-19' }), NOW), 'upcoming');
  assert.strictEqual(P.phase(Object.assign({}, c, { end: '2026-10-17' }), NOW), 'finished');
  assert.strictEqual(P.phase(Object.assign({}, c, { status: 'paused' }), NOW), 'paused');
  assert.strictEqual(P.phase(Object.assign({}, c, { status: 'ended' }), NOW), 'ended');
});

test('inventory caps: 3 shares per board for the card and the sponsor line, 2 per side ad, checked day by day', () => {
  assert.deepStrictEqual(P.CAPS, { 'card:jobs': 3, 'card:deals': 3, 'card:events': 3, 'card:classifieds': 3, 'card:news': 3, 'line:jobs': 3, 'line:deals': 3, 'line:events': 3, 'line:classifieds': 3, 'rail:left': 2, 'rail:right': 2 });
  const three = [camp('cp0000000001', ['card:jobs'], '2026-10-18', '2026-11-16'), camp('cp0000000002', ['card:jobs'], '2026-10-25', '2026-11-23'), camp('cp0000000003', ['card:jobs', 'line:jobs'], '2026-11-01', '2026-11-30')];
  assert.deepStrictEqual(P.overCap(three, ['card:jobs'], '2026-11-10', '2026-11-12'), { placement: 'card:jobs', day: '2026-11-10', booked: 3, cap: 3 });
  assert.strictEqual(P.overCap(three, ['card:jobs'], '2026-11-24', '2026-12-20'), null, 'two left by then');
  assert.strictEqual(P.overCap(three, ['card:jobs'], '2026-10-18', '2026-10-24'), null, 'only one booked that week');
  assert.strictEqual(P.overCap(three, ['line:jobs', 'card:deals'], '2026-11-01', '2026-11-30'), null, 'other placements are separate');
  const paused = three.map((c, i) => (i === 0 ? Object.assign({}, c, { status: 'paused' }) : c));
  assert.ok(P.overCap(paused, ['card:jobs'], '2026-11-10', '2026-11-10'), 'a paused campaign still holds its share');
  const ended = three.map((c, i) => (i === 0 ? Object.assign({}, c, { status: 'ended' }) : c));
  assert.strictEqual(P.overCap(ended, ['card:jobs'], '2026-11-10', '2026-11-10'), null, 'an ended one frees it');
  const rails = [camp('cp0000000004', ['rail:right'], '2026-10-18', '2026-11-16'), camp('cp0000000005', ['rail:right'], '2026-10-18', '2026-11-16')];
  assert.strictEqual(P.overCap(rails, ['rail:right'], '2026-11-16', '2026-11-20').placement, 'rail:right');
  assert.strictEqual(P.overCap(rails, ['rail:left'], '2026-11-16', '2026-11-20'), null);
  const inv = P.inventory(three, NOW, 30);
  assert.deepStrictEqual(inv['card:jobs'], { cap: 3, today: 1, max: 3, free: 0 });
  assert.deepStrictEqual(inv['line:jobs'], { cap: 3, today: 0, max: 1, free: 2 });
});

test('booking rules: an approved creative, only its approved placements, sensible dates', () => {
  const cr = creative('cr0000000001'), ok = { placements: ['card:jobs'], start: '2026-10-18', end: '2026-11-16', note: 'Package A, invoice 12' };
  const r = P.newCampaign(ok, cr, [], NOW);
  assert.ok(r.rec && /^cp[a-z0-9]{10}$/.test(r.rec.id));
  assert.deepStrictEqual([r.rec.status, r.rec.creativeId, r.rec.ref, r.rec.advertiser, r.rec.history[0].note], ['active', cr.id, cr.ref, cr.headline, 'Package A, invoice 12']);
  const bad = [[ok, creative('cr0000000001', { status: 'pending' })], [ok, null], [Object.assign({}, ok, { placements: ['card:deals'] }), cr], [Object.assign({}, ok, { placements: ['card:news'] }), cr],
    [Object.assign({}, ok, { placements: [] }), cr], [Object.assign({}, ok, { start: '2026-02-30' }), cr], [Object.assign({}, ok, { end: '2026-10-17' }), cr],
    [Object.assign({}, ok, { start: '2026-09-01', end: '2026-10-17' }), cr], [Object.assign({}, ok, { end: '2027-12-01' }), cr], [Object.assign({}, ok, { start: '2028-01-01', end: '2028-01-30' }), cr]];
  for (const [b, c] of bad) assert.strictEqual(P.newCampaign(b, c, [], NOW).code, 400, JSON.stringify(b) + (c && c.status));
  const full = [1, 2, 3].map(i => camp('cp000000000' + i, ['card:jobs'], '2026-10-01', '2026-12-31'));
  assert.strictEqual(P.newCampaign(ok, cr, full, NOW).code, 409);
});

test('pause, resume and end: allowed moves only; ending needs a reason', () => {
  const c = camp('cp0000000001', ['card:jobs'], '2026-10-18', '2026-11-16');
  const p = P.act(c, 'pause', '', NOW);
  assert.strictEqual(p.rec.status, 'paused'); assert.deepStrictEqual([p.entry.from, p.entry.to], ['active', 'paused']);
  assert.strictEqual(P.act(p.rec, 'pause', '', NOW).code, 409);
  assert.strictEqual(P.act(p.rec, 'resume', '', NOW).rec.status, 'active');
  assert.strictEqual(P.act(c, 'end', '', NOW).code, 400);
  const e = P.act(c, 'end', 'Advertiser cancelled; refunded the rest', NOW);
  assert.strictEqual(e.rec.status, 'ended'); assert.ok(e.rec.endedAt);
  assert.strictEqual(P.act(e.rec, 'resume', '', NOW).code, 409, 'ended is final');
  assert.strictEqual(P.act(c, 'delete', '', NOW).code, 400);
});

test('what runs today: active campaigns in their dates whose creative is still approved, in a fixed order', () => {
  const pub = c => ({ name: c.headline, url: c.dest });
  const crs = [creative('cr0000000001'), creative('cr0000000002'), creative('cr0000000003', { status: 'withdrawn' }), creative('cr0000000004', { placements: ['card:jobs'] })];
  const recs = [
    Object.assign(camp('cp00000000bb', ['card:jobs', 'rail:right'], '2026-10-10', '2026-11-09'), { creativeId: 'cr0000000002' }),
    Object.assign(camp('cp00000000aa', ['card:jobs', 'line:jobs'], '2026-10-10', '2026-11-09'), { creativeId: 'cr0000000001' }),
    Object.assign(camp('cp00000000cc', ['card:jobs'], '2026-10-01', '2026-10-30'), { creativeId: 'cr0000000003' }),
    Object.assign(camp('cp00000000dd', ['card:jobs'], '2026-10-19', '2026-11-30'), { creativeId: 'cr0000000001' }),
    Object.assign(camp('cp00000000ee', ['card:jobs'], '2026-10-01', '2026-10-30', 'paused'), { creativeId: 'cr0000000001' }),
    Object.assign(camp('cp00000000ff', ['card:jobs', 'line:jobs'], '2026-10-01', '2026-10-30'), { creativeId: 'cr0000000004' }),
  ];
  const out = P.plan(recs, crs, NOW, pub);
  assert.deepStrictEqual(out.cards.jobs.map(a => a.cid), ['cp00000000ff', 'cp00000000aa', 'cp00000000bb'], 'earliest start first, then id; withdrawn, upcoming and paused left out');
  assert.deepStrictEqual(out.slots.jobs.map(a => a.cid), ['cp00000000aa'], 'a placement the creative is not approved for is skipped');
  assert.deepStrictEqual(out.rails.right.map(a => a.cid), ['cp00000000bb']);
  assert.deepStrictEqual(out.cards.deals, []);
  assert.strictEqual(P.plan.length, 4, 'plan(records, creatives, now, pub): nothing about the reader goes in');
});

test('fair rotation among sponsors sharing a spot, and samples only when nothing real runs', () => {
  const ads = ['One', 'Two', 'Three'].map(n => ({ name: n, url: 'https://shop.test/' + n }));
  const seen = {};
  for (let m = 0; m < 96; m++) { const x = A.fill('job', { jobs: ads }, Date.parse('2026-10-18T05:00:00Z') + m * 15 * 60000).ad.name; seen[x] = (seen[x] || 0) + 1; }
  assert.deepStrictEqual(seen, { One: 32, Two: 32, Three: 32 }, 'equal turns over a Chicago day');
  // side ads show two at once; the top spot takes the same turns
  const T = 15 * 60000, t0 = A.turn(NOW) * T;
  assert.deepStrictEqual([0, 1, 2].map(i => A.order(ads, t0 + i * T)[0].name).sort(), ['One', 'Three', 'Two']);
  assert.deepStrictEqual(A.order(ads.slice(0, 2), t0).map(a => a.name).concat().sort(), ['One', 'Two']);
  assert.deepStrictEqual(A.order([], NOW), []);
  assert.ok(read('public/index.html').includes("TSNAds.railFill(tab, r[1], cfg[r[1]], Date.now()") && read('public/adslots.js').includes('var ads = order(list, now).filter(validAd).slice(0, 2);'));
  const samples = { on: true, ads: [{ name: 'Ninebark Bakehouse', text: 'x' }] };
  assert.strictEqual(A.fill('job', { jobs: ads }, NOW, samples).type, 'direct', 'a real campaign comes first');
  assert.strictEqual(A.fill('job', { jobs: [] }, NOW, samples).type, 'sample', 'an empty spot can show a sample');
  assert.strictEqual(A.fill('job', { jobs: [] }, NOW, { on: false, ads: [] }).type, 'house');
});

test('the admin API: admin only; book, refuse over the cap, pause, resume, end; everything in the log', () => withStore({}, async ({ s, call }) => {
  seedCreative(s, creative('cr0000000001'));
  seedCreative(s, creative('cr0000000009', { status: 'pending' }));
  assert.strictEqual((await call('campaigns', 'GET', { admin: false })).status, 404);
  assert.strictEqual((await call('campaigns', 'GET', { admin: 'wrong' })).status, 404);
  assert.strictEqual((await call('campaigns', 'POST', { admin: false, body: { action: 'create' } })).status, 404);
  const book = (extra) => call('campaigns', 'POST', { body: Object.assign({ action: 'create', creativeId: 'cr0000000001', placements: ['rail:right'], start: '2026-10-18', end: '2026-11-16', note: 'test' }, extra || {}) });
  const a = await book(), b = await book();
  assert.deepStrictEqual([a.status, b.status], [200, 200]);
  const c = await book({ start: '2026-11-10', end: '2026-11-20' });
  assert.strictEqual(c.status, 409); assert.match(c.body.error, /rail:right is full on 2026-11-10 \(2 of 2 shares booked\)/);
  assert.strictEqual((await book({ creativeId: 'cr0000000009' })).status, 400, 'a pending creative can’t be booked');
  const id = a.body.campaign.id;
  assert.strictEqual((await call('campaigns', 'POST', { body: { action: 'pause', id } })).status, 200);
  assert.strictEqual((await book({ start: '2026-11-10', end: '2026-11-20' })).status, 409, 'paused still holds the share');
  assert.strictEqual((await call('campaigns', 'POST', { body: { action: 'end', id, note: '' } })).status, 400);
  assert.strictEqual((await call('campaigns', 'POST', { body: { action: 'end', id, note: 'Cancelled' } })).status, 200);
  assert.ok(!s.sets.get('tsn:camp:open').has(id));
  assert.strictEqual((await book({ start: '2026-11-10', end: '2026-11-20' })).status, 200, 'ended frees the share');
  const g = await call('campaigns', 'GET');
  assert.strictEqual(g.status, 200);
  assert.strictEqual(g.body.on, false); assert.strictEqual(g.body.today, '2026-10-18');
  assert.strictEqual(g.body.campaigns.length, 3);
  assert.deepStrictEqual(g.body.creatives.map(x => x.id), ['cr0000000001'], 'only approved creatives can be booked');
  assert.deepStrictEqual(g.body.inventory['rail:right'], { cap: 2, today: 1, max: 2, free: 0 });
  assert.deepStrictEqual(g.body.audit.map(x => x.action), ['create', 'end', 'pause', 'create', 'create']);
  assert.strictEqual((await call('campaigns', 'POST', { body: { action: 'pause', id: 'cp0000000zzz' } })).status, 404);
  assert.strictEqual((await call('campaigns', 'PUT')).status, 405);
}));

test('serving: ADS_CAMPAIGNS off keeps every approved creative; on serves only campaigns running today', async () => {
  const setup = s => {
    seedCreative(s, creative('cr0000000001'));
    seedCreative(s, creative('cr0000000002', { placements: ['card:deals'] }));
    const c = { id: 'cp0000000001', creativeId: 'cr0000000001', ref: 'x', advertiser: 'Shop 01', placements: ['card:jobs'], start: '2026-10-18', end: '2026-10-31', status: 'active' };
    s.kv.set('tsn:camp:' + c.id, JSON.stringify(c)); s.sets.set('tsn:camp:open', new Set([c.id]));
  };
  await withStore({ ADS_CAMPAIGNS: '' }, async ({ s, call }) => {
    setup(s);
    const r = await call('creative', 'GET', { admin: false, query: { live: '1' } });
    assert.strictEqual(r.body.campaigns, undefined);
    assert.deepStrictEqual([r.body.cards.jobs.length, r.body.slots.jobs.length, r.body.cards.deals.length], [1, 1, 1], 'flag off: as before');
  });
  await withStore({ ADS_CAMPAIGNS: 'on' }, async ({ s, call }) => {
    setup(s);
    const r = await call('creative', 'GET', { admin: false, query: { live: '1' } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.campaigns, true);
    assert.deepStrictEqual(r.body.cards.jobs.map(a => [a.cid, a.name]), [['cp0000000001', 'Shop 01']]);
    assert.deepStrictEqual([r.body.slots.jobs, r.body.cards.deals, r.body.rails.right], [[], [], []], 'approved but not booked: not served');
    assert.match(r.headers['cache-control'], /^public, max-age=60/);
    assert.ok(A.validAd(r.body.cards.jobs[0]), 'the page accepts it');
  });
});

test('wiring and policy: 8 functions, the rewrite, admin page, no targeting, the Advertising Policy', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.deepStrictEqual(v.rewrites.filter(r => r.source === '/api/campaigns').map(r => r.destination), ['/api/inbox?__route=campaigns']);
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.ok(read('api/inbox.js').includes("campaigns: () => require('./_campaigns.js')"));
  const src = read('api/_campaigns.js');
  for (const re of [/cookie/i, /x-forwarded-for/i, /user-agent/i, /Math\.random/, /geo/i, /req\.query/]) assert.ok(!re.test(src), String(re));
  const html = read('public/admin.html');
  for (const s of ['id="cpf"', 'id="cpinv"', 'id="cpa"', "post('/api/campaigns'", 'ADS_CAMPAIGNS is on', 'Book campaign']) assert.ok(html.includes(s), s);
  const legal = read('public/legal.html').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(legal.includes('Each paid spot runs for the dates we agree with the advertiser'));
  assert.ok(legal.includes('take equal turns of 15 minutes by the clock'));
  assert.ok(!/chosen by the date|turns by the date/.test(legal));
  assert.ok(read('README.md').includes('ADS_CAMPAIGNS') && read('README.md').includes('equal 15-minute turns'));
});
