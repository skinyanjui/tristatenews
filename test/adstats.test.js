// Ads PR 5.3: first-party, cookie-free ad counts. A booked campaign's ad sends a beacon with only {e, cid, pl} when it
// is at least half on screen (once per page load) or clicked; the server adds one to a daily total per campaign and
// placement, only for a campaign running today on that placement, with ADS_CAMPAIGNS on, skipping bots and capping
// each connection (a one-way hash, 24 hours). The admin gets counts by day and a CSV. No network: Upstash is faked.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const S = require('../api/_adstats.js');
const ADMIN = 'admin-placeholder-key';
const NOW = Date.parse('2026-10-18T18:00:00Z'); // Oct 18, 1 PM CT
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

function fakeStore() {
  const kv = new Map(), hashes = new Map(), ttl = new Map(), log = [];
  const run = ([op, k, ...a]) => {
    log.push([op, k, ...a]);
    switch (op) {
      case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
      case 'INCR': { const n = (Number(kv.get(k)) || 0) + 1; kv.set(k, String(n)); return { result: n }; }
      case 'EXPIRE': if (!ttl.has(k)) ttl.set(k, Number(a[0])); return { result: 1 };
      case 'HINCRBY': { const h = hashes.get(k) || new Map(); hashes.set(k, h); const n = (Number(h.get(a[0])) || 0) + Number(a[1]); h.set(a[0], String(n)); return { result: n }; }
      case 'HGETALL': return { result: [...(hashes.get(k) || new Map())].flat() };
      default: throw new Error('unexpected command ' + op);
    }
  };
  const fetch = async (u, init) => {
    if (!String(u).startsWith('https://kv.test/')) throw new Error('unexpected fetch ' + u);
    return new Response(JSON.stringify(JSON.parse(init.body).map(run)), { status: 200 });
  };
  return { kv, hashes, ttl, log, fetch };
}
async function withStore(env, fn) {
  const saved = { ...process.env }, realFetch = global.fetch, realNow = Date.now, s = fakeStore();
  const clear = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k]; };
  clear(); Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', LISTINGS_ADMIN_KEY: ADMIN, ADS_CAMPAIGNS: '' }, env);
  global.fetch = s.fetch; Date.now = () => NOW;
  try {
    const inbox = require('../api/inbox.js');
    const call = async (method, opts) => {
      opts = opts || {};
      const out = { status: 0, body: null, headers: {} };
      const res = { setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, status(c) { out.status = c; return res; }, send(b) { out.body = typeof b === 'string' && /json/.test(out.headers['content-type'] || '') ? JSON.parse(b) : b; return res; }, end() { return res; } };
      const headers = Object.assign({ 'user-agent': UA, 'x-forwarded-for': opts.ip || '203.0.113.9' }, opts.admin ? { 'x-admin-key': opts.admin } : {}, opts.headers || {});
      await inbox({ method, url: '/api/adstats', query: Object.assign({ __route: 'adstats' }, opts.query || {}), headers, body: opts.body }, res);
      return out;
    };
    return await fn({ s, call });
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved); global.fetch = realFetch; Date.now = realNow; clear();
  }
}
const CID = 'cp0000000001';
const seed = (s, extra) => s.kv.set('tsn:camp:' + CID, JSON.stringify(Object.assign({ id: CID, creativeId: 'cr0000000001', ref: 'AD-X', advertiser: 'Shop, "One"', placements: ['card:jobs', 'rail:right'], start: '2026-10-18', end: '2026-10-31', status: 'active' }, extra || {})));
const beacon = (e, pl, cid) => JSON.stringify({ e, cid: cid || CID, pl });

test('events: only {e, cid, pl} with a known event, campaign id and placement; bots are skipped', () => {
  assert.deepStrictEqual(S.parseEvent(beacon('v', 'card:jobs')), { e: 'v', cid: CID, pl: 'card:jobs' });
  assert.deepStrictEqual(S.parseEvent({ e: 'c', cid: CID, pl: 'rail:right', who: 'x' }), { e: 'c', cid: CID, pl: 'rail:right' }, 'anything else is dropped');
  for (const bad of ['', 'nope', '{"e":"x","cid":"cp0000000001","pl":"card:jobs"}', beacon('v', 'card:news'), beacon('v', 'card:jobs', 'cp1'), 'x'.repeat(400), null]) assert.strictEqual(S.parseEvent(bad), null, String(bad).slice(0, 40));
  assert.ok(S.isBot('Googlebot/2.1') && S.isBot('Mozilla/5.0 HeadlessChrome/141') && S.isBot('curl/8') && S.isBot(''));
  assert.ok(!S.isBot(UA) && !S.isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'));
  const h = S.connHash('203.0.113.9', '2026-10-18');
  assert.match(h, /^[0-9a-f]{24}$/); assert.ok(!h.includes('203')); assert.notStrictEqual(h, S.connHash('203.0.113.9', '2026-10-19'), 'a new code every day');
  assert.ok(read('api/_adstats.js').includes("crypto.createHmac('sha256', HASH_KEY)"), 'keyed, so it cannot be reversed by trying every address');
});

test('report: counts by day and placement, totals, CSV; no ratios or made-up figures', () => {
  const r = S.report({ '2026-10-19|card:jobs|v': '5', '2026-10-18|card:jobs|v': '10', '2026-10-18|card:jobs|c': '2', '2026-10-18|rail:right|v': '4', 'junk': '9', '2026-10-18|card:news|v': '3' });
  assert.deepStrictEqual(r.rows, [{ date: '2026-10-18', placement: 'card:jobs', views: 10, clicks: 2 }, { date: '2026-10-18', placement: 'rail:right', views: 4, clicks: 0 }, { date: '2026-10-19', placement: 'card:jobs', views: 5, clicks: 0 }]);
  assert.deepStrictEqual(r.totals, { views: 19, clicks: 2 });
  assert.deepStrictEqual(r.byPlacement['card:jobs'], { views: 15, clicks: 2 });
  const c = S.csv({ id: CID, advertiser: 'Shop, "One"' }, r).split('\r\n');
  assert.strictEqual(c[0], 'campaign,advertiser,date,placement,views,clicks');
  assert.strictEqual(c[1], CID + ',"Shop, ""One""",2026-10-18,card:jobs,10,2');
  assert.deepStrictEqual(S.pairs(['a', '1', 'b', '2']), { a: '1', b: '2' });
});

test('counting: flag on, campaign running today on that placement; 204 always; nothing about the reader stored', async () => {
  await withStore({ ADS_CAMPAIGNS: '' }, async ({ s, call }) => {
    seed(s);
    const r = await call('POST', { body: beacon('v', 'card:jobs') });
    assert.strictEqual(r.status, 204); assert.strictEqual(s.log.length, 0, 'flag off: not even read');
  });
  await withStore({ ADS_CAMPAIGNS: 'on' }, async ({ s, call }) => {
    seed(s);
    for (const b of [beacon('v', 'card:jobs'), beacon('v', 'card:jobs'), beacon('c', 'card:jobs'), beacon('v', 'rail:right')]) assert.strictEqual((await call('POST', { body: b })).status, 204);
    assert.strictEqual((await call('POST', { body: beacon('v', 'line:jobs') })).status, 204, 'not booked there: ignored');
    assert.strictEqual((await call('POST', { body: beacon('v', 'card:jobs'), headers: { 'user-agent': 'Googlebot/2.1' } })).status, 204);
    assert.strictEqual((await call('POST', { body: beacon('v', 'card:jobs', 'cp0000000999') })).status, 204, 'unknown campaign');
    assert.deepStrictEqual(Object.fromEntries(s.hashes.get('tsn:adstat:' + CID)), { '2026-10-18|card:jobs|v': '2', '2026-10-18|card:jobs|c': '1', '2026-10-18|rail:right|v': '1' });
    assert.deepStrictEqual([...s.hashes.keys()], ['tsn:adstat:' + CID], 'only campaign totals');
    const keys = [...s.kv.keys()].concat([...s.hashes.keys()]).join(' ');
    assert.ok(!keys.includes('203.0.113.9'), 'the address is never a key'); assert.ok(!JSON.stringify(s.log).includes('203.0.113.9') && !JSON.stringify(s.log).includes('Mozilla'), 'nor stored anywhere');
    const rl = [...s.kv.keys()].filter(k => k.startsWith('tsn:as:rl:'));
    assert.strictEqual(rl.length, 1); assert.strictEqual(s.ttl.get(rl[0]), 86400, 'the connection code expires in 24 hours');
  });
  for (const extra of [{ status: 'paused' }, { status: 'ended' }, { start: '2026-10-19' }, { end: '2026-10-17', start: '2026-10-10' }]) {
    await withStore({ ADS_CAMPAIGNS: 'on' }, async ({ s, call }) => {
      seed(s, extra);
      await call('POST', { body: beacon('v', 'card:jobs') });
      assert.ok(!s.hashes.size, 'not running today: ' + JSON.stringify(extra));
    });
  }
  await withStore({ ADS_CAMPAIGNS: 'on' }, async ({ s, call }) => {
    seed(s);
    for (let i = 0; i < S.DAILY_PER_CONN + 5; i++) await call('POST', { body: beacon('v', 'card:jobs') });
    await call('POST', { body: beacon('v', 'card:jobs'), ip: '198.51.100.7' });
    assert.strictEqual(s.hashes.get('tsn:adstat:' + CID).get('2026-10-18|card:jobs|v'), String(S.DAILY_PER_CONN + 1), 'one connection is capped per day; another still counts');
  });
});

test('admin report: key required, JSON by day and a CSV download', async () => {
  await withStore({ ADS_CAMPAIGNS: 'on' }, async ({ s, call }) => {
    seed(s);
    await call('POST', { body: beacon('v', 'card:jobs') }); await call('POST', { body: beacon('c', 'card:jobs') });
    assert.strictEqual((await call('GET', { query: { cid: CID } })).status, 404, 'no key');
    assert.strictEqual((await call('GET', { query: { cid: CID }, admin: 'wrong' })).status, 404);
    assert.strictEqual((await call('GET', { query: { cid: 'x' }, admin: ADMIN })).status, 400);
    assert.strictEqual((await call('GET', { query: { cid: 'cp0000000999' }, admin: ADMIN })).status, 404);
    const r = await call('GET', { query: { cid: CID }, admin: ADMIN });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.body.totals, r.body.rows, r.body.today, r.body.advertiser], [{ views: 1, clicks: 1 }, [{ date: '2026-10-18', placement: 'card:jobs', views: 1, clicks: 1 }], '2026-10-18', 'Shop, "One"']);
    const c = await call('GET', { query: { cid: CID, format: 'csv' }, admin: ADMIN });
    assert.match(c.headers['content-type'], /^text\/csv/); assert.match(c.headers['content-disposition'], /attachment; filename="cp0000000001-counts.csv"/);
    assert.ok(c.body.includes('cp0000000001,"Shop, ""One""",2026-10-18,card:jobs,1,1'));
    assert.strictEqual((await call('DELETE', { admin: ADMIN })).status, 404);
  });
  await withStore({ ADS_CAMPAIGNS: 'on', LISTINGS_ADMIN_KEY: '' }, async ({ call }) => {
    assert.strictEqual((await call('GET', { query: { cid: CID }, admin: ADMIN })).status, 404, 'no admin key configured: nothing');
  });
});

test('serving and page: campaign ads carry cid and pl; the page counts only those, by beacon, without cookies', () => {
  const P = require('../api/_campaigns.js');
  const cr = { id: 'cr0000000001', status: 'approved', placements: ['card:jobs', 'line:jobs'] };
  const out = P.plan([{ id: CID, creativeId: cr.id, placements: ['card:jobs', 'line:jobs'], start: '2026-10-18', end: '2026-10-31', status: 'active' }], [cr], NOW, c => ({ id: c.id, name: 'Shop', url: 'https://shop.test/' }));
  assert.deepStrictEqual([out.cards.jobs[0].pl, out.slots.jobs[0].pl, out.cards.jobs[0].cid], ['card:jobs', 'line:jobs', CID]);
  assert.ok(require('../public/adslots.js').validAd(out.cards.jobs[0]));
  const ix = read('public/index.html');
  const fn = ix.slice(ix.indexOf('function adCount('), ix.indexOf('adIO.observe(a);'));
  assert.ok(fn.includes("if (!ad.cid || !ad.pl || navigator.webdriver) return;"), 'only booked campaign ads, never samples or house units');
  assert.ok(fn.includes('{ threshold: 0.5 }') && fn.includes('if (!adSeen[k])'), 'half on screen, once per page load');
  assert.ok(ix.includes("navigator.sendBeacon('/api/adstats', JSON.stringify({ e: e, cid: ad.cid, pl: ad.pl }))"), 'the beacon holds only the campaign and the spot');
  const al = ix.slice(ix.indexOf('adLink: function'), ix.indexOf('sampleAd: function'));
  assert.ok(al.includes("if (typeof adCount === 'function') adCount(a, ad);"));
  assert.ok(!/document\.cookie|localStorage/.test(fn), 'no cookie, no storage');
  assert.ok(!/\bhref\b|location|referrer/.test(read('api/_adstats.js').replace(/\/\/.*$/gm, '')), 'no page or referrer read on the server');
});

test('wiring and policy: 8 functions, the rewrite, admin page, Privacy and Advertising Policy', () => {
  const v = JSON.parse(read('vercel.json'));
  assert.deepStrictEqual(v.rewrites.filter(r => r.source === '/api/adstats').map(r => r.destination), ['/api/inbox?__route=adstats']);
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.ok(read('api/inbox.js').includes("adstats: () => require('./_adstats.js')"));
  assert.ok(read('server.js').includes("app.post('/api/adstats', express.text({ type: 'text/plain', limit: '2kb' }));"));
  const ad = read('public/admin.html');
  assert.ok(ad.includes("get('/api/adstats?cid=' + encodeURIComponent(id))") && ad.includes("'/api/adstats?format=csv&cid='") && ad.includes('Counts CSV'));
  const lg = read('public/legal.html');
  assert.ok(lg.includes('For a paid ad we count how often it’s seen and clicked, in daily totals only'));
  assert.ok(lg.includes('No cookie, ID, page address or anything about you goes with it'));
  assert.ok(lg.includes('we keep only a scrambled, one-way code made from the address and the date, never the address itself'));
  assert.ok(lg.includes('Those are counts on our own pages, not people') && lg.includes('we don’t estimate reach or audiences from them'));
  assert.ok(read('docs/legal-review.md').includes('## Ads PR 5.3: cookie-free ad counts'));
  assert.ok(read('README.md').includes('/api/adstats') && read('README.md').includes('Ad counts.'));
});
