// Ads PR C: advertiser creatives. Upload needs an inquiry reference with its email, a paid order, or a signed admin
// link; the server checks the image, words and destination; everything waits as pending until an admin approves it
// with a reason (audit logged); only approved creatives fill the card, sponsor lines and side ads. No network: the
// Upstash store is faked by intercepting fetch, with placeholder keys.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const A = require('../public/adslots.js');
const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const ADMIN = 'admin-placeholder-key';

// ---- images built in memory ----
function crc(buf) { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); }
function png(w, h, opts) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, (opts && opts.fill) || 0x80);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (opts && opts.animated) parts.push(chunk('acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])));
  parts.push(chunk('IDAT', zlib.deflateSync(raw, { level: opts && opts.big ? 0 : 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
function jpeg(w, h) {
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), sof, Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0]), Buffer.alloc(200, 0x11), Buffer.from([0xff, 0xd9])]);
}
function webpX(w, h, animated) {
  const b = Buffer.alloc(200); b.write('RIFF', 0); b.writeUInt32LE(192, 4); b.write('WEBP', 8); b.write('VP8X', 12); b.writeUInt32LE(10, 16);
  b[20] = animated ? 0x02 : 0; b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b;
}
const url = (type, buf) => 'data:image/' + type + ';base64,' + buf.toString('base64');
const PNG = url('png', png(600, 300));

// ---- a small Upstash ----
function fakeStore() {
  const kv = new Map(), exp = new Map(), z = new Map(), sets = new Map(), lists = new Map(), log = [];
  const live = k => { if (exp.has(k) && exp.get(k) <= Date.now()) { kv.delete(k); exp.delete(k); } return kv.has(k); };
  const run = cmd => {
    const [op, k, ...a] = cmd; log.push(cmd);
    switch (op) {
      case 'GET': return { result: live(k) ? kv.get(k) : null };
      case 'MGET': return { result: [k, ...a].map(x => (live(x) ? kv.get(x) : null)) };
      case 'SET': { kv.set(k, a[0]); const i = a.indexOf('EX'); if (i >= 0) exp.set(k, Date.now() + Number(a[i + 1]) * 1000); else exp.delete(k); return { result: 'OK' }; }
      case 'DEL': { const had = kv.delete(k); exp.delete(k); return { result: had ? 1 : 0 }; }
      case 'PERSIST': return { result: exp.delete(k) ? 1 : 0 };
      case 'INCR': { const v = Number(kv.get(k) || 0) + 1; kv.set(k, String(v)); return { result: v }; }
      case 'EXPIRE': if (a.includes('NX') && exp.has(k)) return { result: 0 }; exp.set(k, Date.now() + Number(a[0]) * 1000); return { result: 1 };
      case 'ZADD': { const s = z.get(k) || new Map(); z.set(k, s); s.set(a[1], Number(a[0])); return { result: 1 }; }
      case 'ZREM': { const s = z.get(k); return { result: s && s.delete(a[0]) ? 1 : 0 }; }
      case 'ZRANGE': case 'ZREVRANGE': { const s = [...(z.get(k) || new Map())].sort((x, y) => (op === 'ZRANGE' ? x[1] - y[1] : y[1] - x[1])).map(x => x[0]); return { result: s.slice(Number(a[0]), Number(a[1]) + 1) }; }
      case 'SADD': { const s = sets.get(k) || new Set(); sets.set(k, s); s.add(a[0]); return { result: 1 }; }
      case 'SREM': { const s = sets.get(k); return { result: s && s.delete(a[0]) ? 1 : 0 }; }
      case 'SMEMBERS': return { result: [...(sets.get(k) || [])] };
      case 'SCARD': return { result: (sets.get(k) || new Set()).size };
      case 'LPUSH': { const l = lists.get(k) || []; lists.set(k, l); l.unshift(...a); return { result: l.length }; }
      case 'LTRIM': { const l = lists.get(k) || []; lists.set(k, l.slice(Number(a[0]), Number(a[1]) + 1)); return { result: 'OK' }; }
      case 'LRANGE': return { result: (lists.get(k) || []).slice(Number(a[0]), Number(a[1]) + 1) };
      default: throw new Error('unexpected command ' + op);
    }
  };
  const fetch = async (u, init) => {
    if (!String(u).startsWith('https://kv.test/')) throw new Error('unexpected fetch ' + u); // never the destination, never anything else
    return new Response(JSON.stringify(JSON.parse(init.body).map(run)), { status: 200 });
  };
  return { kv, exp, z, sets, lists, log, fetch };
}
const ENV = { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', LISTINGS_ADMIN_KEY: ADMIN, CREATIVE_TOKEN_SECRET: '' };
async function withStore(env, fn) {
  const saved = { ...process.env }, realFetch = global.fetch, s = fakeStore();
  const clear = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k]; };
  clear(); Object.assign(process.env, env); global.fetch = s.fetch;
  try {
    const inbox = require('../api/inbox.js');
    const call = async (method, opts) => {
      opts = opts || {};
      const out = { status: 0, headers: {}, body: null };
      const res = { setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; }, status(c) { out.status = c; return res; }, send(b) { out.body = b; return res; }, json(o) { out.body = JSON.stringify(o); return res; } };
      await inbox({ method, url: '/api/creative' + (opts.qs || ''), query: Object.assign({ __route: 'creative' }, opts.query || {}), headers: Object.assign({ 'x-forwarded-for': opts.ip || '203.0.113.9' }, opts.admin ? { 'x-admin-key': ADMIN } : {}, opts.headers || {}), body: opts.body }, res);
      let json = null; try { json = typeof out.body === 'string' ? JSON.parse(out.body) : null; } catch (_) { /* binary */ }
      return Object.assign(out, { json });
    };
    return await fn({ s, call, C: require('../api/_creative.js') });
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved); global.fetch = realFetch; clear();
  }
}
const INQ = { ref: 'AD-MB3X9QK7', email: 'owner@shop.test' };
const seedInquiry = s => s.lists.set('tsn:ads', [JSON.stringify({ ref: INQ.ref, at: '2026-10-18T15:00:00Z', business: 'Shop', name: 'Owner', email: 'Owner@Shop.test', interest: 'Section sponsorship', message: '' })]);
const good = extra => Object.assign({ headline: 'Fall sale at the shop', text: 'Twenty percent off boots this week.', cta: 'Visit website', dest: 'https://shop.test/fall', image: PNG }, INQ, extra || {});

test('validate: CTA list, text limits, no links in the words', () => withStore(ENV, async ({ C }) => {
  assert.deepStrictEqual(C.CTAS, ['Visit website', 'Call now', 'Get directions', 'Shop now', 'Learn more']);
  assert.deepStrictEqual(A.CTAS, C.CTAS, 'page and server share the list');
  const v = C.validate(good());
  assert.deepStrictEqual([v.headline, v.cta, v.dest, v.destType, v.image], ['Fall sale at the shop', 'Visit website', 'https://shop.test/fall', 'url', { type: 'png', bytes: png(600, 300).length, w: 600, h: 300 }]);
  for (const [bad, field] of [[{ headline: '' }, 'headline'], [{ headline: 'ab' }, 'headline'], [{ headline: 'x'.repeat(61) }, 'headline'], [{ text: 'y'.repeat(141) }, 'text'],
    [{ text: 'see www.shop.test' }, 'text'], [{ headline: 'Go to https://x.test' }, 'headline'], [{ text: 'shop.com today' }, 'text'], [{ cta: 'Buy' }, 'cta'], [{ cta: 'visit website' }, 'cta'], [{ cta: undefined }, 'cta'], [{ image: '' }, 'image']])
    assert.strictEqual(C.validate(good(bad)).field, field, JSON.stringify(bad).slice(0, 60));
  assert.strictEqual(C.validate(good({ headline: '  Fall\u0000 <b>sale</b>  ' })).headline, 'Fall b sale /b', 'control characters and angle brackets are stripped');
  assert.strictEqual(C.validate(good({ text: 'x'.repeat(140) })).text.length, 140);
}));

test('destinations: https only, no credentials/ports/IPs, no shorteners or redirects; tel and map links match their button', () => withStore(ENV, async ({ C }) => {
  const ok = [['https://shop.test/x?utm_source=tsn', 'Visit website', 'https://shop.test/x?utm_source=tsn'], ['https://shop.test/a/b?x=1&c=fall%20sale', 'Shop now', 'https://shop.test/a/b?x=1&c=fall%20sale'],
    ['812-555-0142', 'Call now', 'tel:+18125550142'], ['(812) 555-0142', 'Call now', 'tel:+18125550142'], ['tel:+1 812 555 0142', 'Call now', 'tel:+18125550142'],
    ['https://www.google.com/maps/place/Evansville', 'Get directions', 'https://www.google.com/maps/place/Evansville'], ['https://www.google.com/maps/dir//Evansville,+IN', 'Get directions', 'https://www.google.com/maps/dir//Evansville,+IN'],
    ['https://maps.apple.com/?q=Evansville', 'Get directions', 'https://maps.apple.com/?q=Evansville'], ['https://www.openstreetmap.org/#map=15/37.97/-87.57', 'Get directions', 'https://www.openstreetmap.org/#map=15/37.97/-87.57']];
  for (const [d, cta, want] of ok) assert.strictEqual(C.destination(d, cta).dest, want, d);
  const bad = [['http://shop.test', 'Visit website'], ['javascript:alert(1)', 'Learn more'], ['data:text/html,hi', 'Learn more'], ['//shop.test', 'Learn more'], ['https://user:pw@shop.test/', 'Learn more'],
    ['https://shop.test:8443/', 'Learn more'], ['https://127.0.0.1/', 'Learn more'], ['https://[::1]/', 'Learn more'], ['https://localhost/', 'Learn more'], ['https://intranet/', 'Learn more'], ['https://printer.local/', 'Learn more'],
    ['https://bit.ly/abc', 'Learn more'], ['https://t.co/abc', 'Learn more'], ['https://www.tinyurl.com/abc', 'Learn more'], ['https://maps.app.goo.gl/x', 'Get directions'], ['https://l.facebook.com/l.php?u=x', 'Learn more'],
    ['https://www.google.com/url?q=https://evil.test', 'Learn more'], ['https://shop.test/redirect?to=x', 'Learn more'], ['https://shop.test/out?next=https%3A%2F%2Fevil.test', 'Learn more'],
    ['https://shop.test/a?ref=https%253A%252F%252Fevil.test', 'Learn more'], ['https://shop.test//evil.test', 'Learn more'], ['https://shop.test/p?u=//evil.test', 'Learn more'], ['https://shop.test/%E0%A4%A', 'Learn more'],
    ['https://shop.test/' + 'a'.repeat(400), 'Learn more'], ['', 'Learn more'], ['https://shop.test/', 'Call now'], ['555-0142', 'Call now'], ['012-555-0142', 'Call now'], ['+44 20 7946 0958', 'Call now'],
    ['https://shop.test/maps', 'Get directions'], ['https://www.google.com/search?q=x', 'Get directions'], ['812-555-0142', 'Get directions'], ['https://www.google.com/maps/dir//x?u=https://evil.test', 'Get directions']];
  for (const [d, cta] of bad) assert.ok(C.destination(d, cta).error, d + ' (' + cta + ')');
  assert.ok(!/require\(['"](https?|net|dns)['"]\)/.test(read('api/_creative.js')), 'the server never fetches or resolves a destination');
}));

test('images: still JPEG, PNG or WebP by their bytes; size and pixel caps; no animation or GIF', () => withStore(ENV, async ({ C }) => {
  assert.deepStrictEqual(C.image(url('png', png(300, 150))), { type: 'png', bytes: png(300, 150).length, w: 300, h: 150 });
  assert.deepStrictEqual(C.image(url('jpeg', jpeg(1200, 628))), { type: 'jpeg', bytes: jpeg(1200, 628).length, w: 1200, h: 628 });
  assert.deepStrictEqual(C.image(url('webp', webpX(800, 400))), { type: 'webp', bytes: 200, w: 800, h: 400 });
  const big = png(600, 300, { big: true });
  assert.ok(big.length > C.MAX_IMAGE_BYTES);
  for (const [d, why] of [[url('png', png(299, 150)), 'too narrow'], [url('png', png(300, 149)), 'too short'], [url('png', png(4001, 200)), 'too wide'], [url('png', big), 'over 300 KB'],
    [url('png', png(600, 300, { animated: true })), 'APNG'], [url('webp', webpX(800, 400, true)), 'animated WebP'], ['data:image/gif;base64,R0lGODlhAQABAAAAACw=', 'GIF'],
    [url('png', jpeg(600, 300)), 'JPEG bytes labeled PNG'], [url('jpeg', png(600, 300)), 'PNG bytes labeled JPEG'], ['data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'), 'SVG'],
    ['https://shop.test/a.png', 'a URL, not an upload'], [url('png', Buffer.alloc(50)), 'empty'], ['data:image/png;base64,@@@', 'not base64']])
    assert.ok(C.image(d).error, why);
  assert.strictEqual(C.MAX_IMAGE_BYTES, 300 * 1024);
}));

test('upload access: inquiry reference with its email, a paid order, or a signed link; nothing is written otherwise', () => withStore(ENV, async ({ s, call, C }) => {
  seedInquiry(s);
  s.kv.set('tsn:order:cs_test_paid0000001', JSON.stringify({ status: 'fulfilled', paidCents: 9900 }));
  s.kv.set('tsn:order:cs_test_open0000001', JSON.stringify({ status: 'created', cents: 9900 }));
  s.kv.set('tsn:order:cs_test_refd0000001', JSON.stringify({ status: 'refunded', paidCents: 9900 }));
  const refused = [{ ref: '', email: '' }, { ref: INQ.ref, email: 'someone@else.test' }, { ref: INQ.ref, email: '' }, { ref: 'AD-NOTREAL1', email: INQ.email }, { ref: 'TSN-ABC123', email: INQ.email },
    { ref: 'cs_test_open0000001' }, { ref: 'cs_test_refd0000001' }, { ref: 'cs_test_none0000001' }, { ref: 'tsn:ads' }, { token: 'AD-X.zzzzzz.' + '0'.repeat(32) }, { token: C.tokenFor('AD-TOKEN1', Date.now() - 15 * 864e5) }];
  for (const who of refused) {
    const r = await call('POST', { body: Object.assign(good(), { ref: undefined, email: undefined }, who) });
    assert.strictEqual(r.status, 403, JSON.stringify(who));
  }
  assert.ok(!s.log.some(c => c[0] === 'SET' || c[0] === 'ZADD' || c[0] === 'INCR'), 'a refused upload writes nothing');
  const a = await call('POST', { body: good({ email: ' OWNER@shop.test ', ref: INQ.ref.toLowerCase() }) });
  assert.deepStrictEqual([a.status, a.json.status], [200, 'pending']);
  assert.match(a.json.id, /^cr[a-z0-9]{10}$/);
  const b = await call('POST', { body: good({ ref: 'cs_test_paid0000001', email: undefined }) });
  assert.strictEqual(b.status, 200);
  const tok = C.tokenFor('INV-2026-17');
  assert.match(tok, /^INV-2026-17\.[a-z0-9]+\.[a-f0-9]{32}$/);
  assert.strictEqual(C.tokenRef(tok), 'INV-2026-17');
  assert.strictEqual(C.tokenRef(tok.slice(0, -1) + (tok.endsWith('0') ? '1' : '0')), '', 'tampered');
  assert.strictEqual(C.tokenRef(tok.replace('INV-2026-17', 'INV-2026-18')), '', 'another reference');
  const t = await call('POST', { body: good({ token: tok, ref: 'AD-IGNORED', email: undefined }) });
  assert.strictEqual(t.status, 200);
  const rec = id => JSON.parse(s.kv.get('tsn:cr:' + id));
  assert.deepStrictEqual([rec(a.json.id).ref, rec(a.json.id).refType, rec(b.json.id).refType, rec(t.json.id).ref, rec(t.json.id).refType], [INQ.ref, 'inquiry', 'order', 'INV-2026-17', 'token']);
  assert.ok(!JSON.stringify(rec(a.json.id)).includes('owner@'), 'the inquiry email is checked, not stored again');
  assert.ok(s.exp.has('tsn:cr:' + a.json.id) && s.exp.has('tsn:cr:img:' + a.json.id), 'pending records expire');
  assert.deepStrictEqual([...s.z.get('tsn:cr:pending').keys()].sort(), [a.json.id, b.json.id, t.json.id].sort());
  const bad = await call('POST', { body: good({ dest: 'https://bit.ly/x' }) });
  assert.deepStrictEqual([bad.status, bad.json.field], [400, 'dest']);
}));

test('pending creatives are never served: not in the live list, image only with the admin key', () => withStore(ENV, async ({ s, call }) => {
  seedInquiry(s);
  const { json: { id } } = await call('POST', { body: good() });
  const live = await call('GET', { query: { live: '1' } });
  assert.deepStrictEqual([live.status, live.json.cards.jobs, live.json.slots.events, live.json.rails.right], [200, [], [], []]);
  assert.match(live.headers['cache-control'], /public, max-age=60/);
  assert.strictEqual((await call('GET', { query: { img: id } })).status, 404);
  assert.strictEqual((await call('GET', { query: { img: id }, headers: { 'x-admin-key': 'wrong' } })).status, 404);
  const img = await call('GET', { query: { img: id }, admin: true });
  assert.deepStrictEqual([img.status, img.headers['content-type'], img.headers['cache-control'], img.headers['x-content-type-options']], [200, 'image/png', 'no-store', 'nosniff']);
  assert.ok(Buffer.isBuffer(img.body) && img.body.equals(png(600, 300)));
  for (const q of [{ img: '../x' }, { img: 'cr' }, { img: 'tsn:ads' }]) assert.strictEqual((await call('GET', { query: q, admin: true })).status, 404);
}));

test('admin review: key required, reason required, placements from the fixed list; every action audit logged', () => withStore(ENV, async ({ s, call }) => {
  seedInquiry(s);
  const id1 = (await call('POST', { body: good() })).json.id, id2 = (await call('POST', { body: good({ headline: 'Second ad here' }) })).json.id;
  assert.strictEqual((await call('GET', {})).status, 404, 'no key, no list');
  assert.strictEqual((await call('POST', { body: { action: 'approve', id: id1, reason: 'Looks right', placements: ['card:jobs'] } })).status, 404, 'no key, no approval');
  assert.strictEqual((await call('POST', { body: { action: 'approve', id: id1, reason: 'ok', placements: ['card:jobs'] }, headers: { 'x-admin-key': 'nope' } })).status, 404);
  const list = await call('GET', { admin: true });
  assert.deepStrictEqual([list.json.pending.length, list.json.items.length, list.json.audit.length], [2, 2, 0]);
  assert.ok(list.json.placements.includes('card:jobs') && list.json.placements.includes('rail:right') && list.json.placements.includes('card:news') && !list.json.placements.some(p => /line:news|obit|safety|police|all|breaking/.test(p)));
  for (const body of [{ action: 'approve', id: id1, placements: ['card:jobs'] }, { action: 'approve', id: id1, reason: '  ', placements: ['card:jobs'] }, { action: 'reject', id: id2, reason: 'x' }])
    assert.deepStrictEqual([(await call('POST', { body, admin: true })).json.field], ['reason'], JSON.stringify(body));
  for (const placements of [undefined, [], ['card:obits'], ['line:news'], ['rail:top'], ['card:jobs', 'card:safety']])
    assert.strictEqual((await call('POST', { body: { action: 'approve', id: id1, reason: 'Checked the page', placements }, admin: true })).json.field, 'placements', JSON.stringify(placements));
  assert.strictEqual((await call('POST', { body: { action: 'publish', id: id1, reason: 'x y z' }, admin: true })).status, 400);
  assert.strictEqual((await call('POST', { body: { action: 'approve', id: 'crnotthere01', reason: 'Checked', placements: ['card:jobs'] }, admin: true })).status, 404);
  assert.strictEqual(s.lists.get('tsn:cr:audit'), undefined, 'refused actions log nothing');

  const ap = await call('POST', { body: { action: 'approve', id: id1, reason: 'Checked the landing page', placements: ['card:jobs', 'line:jobs', 'rail:right', 'card:jobs'] }, admin: true });
  assert.deepStrictEqual([ap.status, ap.json.status], [200, 'approved']);
  assert.ok(!s.exp.has('tsn:cr:' + id1) && !s.exp.has('tsn:cr:img:' + id1), 'approved creatives stay while they run');
  const live = (await call('GET', { query: { live: '1' } })).json;
  assert.deepStrictEqual(live.cards.jobs.map(x => x.id), [id1]);
  assert.deepStrictEqual([live.slots.jobs.length, live.rails.right.length, live.rails.left.length, live.cards.deals.length], [1, 1, 0, 0]);
  const pub = live.cards.jobs[0];
  assert.deepStrictEqual(pub, { id: id1, name: 'Fall sale at the shop', text: 'Twenty percent off boots this week.', cta: 'Visit website', url: 'https://shop.test/fall', destType: 'url', img: '/api/creative?img=' + id1, w: 600, h: 300 });
  assert.ok(A.validAd(pub), 'the page accepts what the server publishes');
  assert.ok(!('ref' in pub) && !('history' in pub), 'no reference or review notes in public');
  const img = await call('GET', { query: { img: id1 } });
  assert.deepStrictEqual([img.status, img.headers['cache-control']], [200, 'public, max-age=300, s-maxage=3600']);
  assert.strictEqual((await call('POST', { body: { action: 'reject', id: id1, reason: 'Changed my mind' }, admin: true })).status, 409, 'approved: withdraw, not reject');

  const rj = await call('POST', { body: { action: 'reject', id: id2, reason: 'Image text is unreadable' }, admin: true });
  assert.deepStrictEqual([rj.status, rj.json.status], [200, 'rejected']);
  assert.ok(!s.kv.has('tsn:cr:img:' + id2), 'rejected images are deleted');
  assert.strictEqual((await call('POST', { body: { action: 'approve', id: id2, reason: 'Retry', placements: ['card:jobs'] }, admin: true })).status, 409);
  const wd = await call('POST', { body: { action: 'withdraw', id: id1, reason: 'Landing page now redirects' }, admin: true });
  assert.strictEqual(wd.json.status, 'withdrawn');
  assert.ok(!s.kv.has('tsn:cr:img:' + id1) && !s.sets.get('tsn:cr:live').has(id1));
  assert.deepStrictEqual((await call('GET', { query: { live: '1' } })).json.cards.jobs, []);
  assert.strictEqual((await call('GET', { query: { img: id1 } })).status, 404);

  const audit = (await call('GET', { admin: true })).json.audit;
  assert.deepStrictEqual(audit.map(a => [a.action, a.id, a.from, a.to, a.reason]), [
    ['withdraw', id1, 'approved', 'withdrawn', 'Landing page now redirects'], ['reject', id2, 'pending', 'rejected', 'Image text is unreadable'], ['approve', id1, 'pending', 'approved', 'Checked the landing page']]);
  assert.deepStrictEqual(audit[2].placements, ['card:jobs', 'line:jobs', 'rail:right']);
  assert.ok(audit.every(a => a.ref === INQ.ref && !Number.isNaN(Date.parse(a.at))));
  const tok = await call('POST', { body: { action: 'token', ref: 'INV-2026-17' }, admin: true });
  assert.match(tok.json.token, /^INV-2026-17\./);
  assert.strictEqual((await call('POST', { body: { action: 'token', ref: 'INV-2026-17' } })).status, 404, 'only an admin makes upload links');
}));

test('limits: 5 open creatives per reference, 10 uploads per connection per day', () => withStore(ENV, async ({ s, call }) => {
  seedInquiry(s);
  for (let i = 0; i < 5; i++) assert.strictEqual((await call('POST', { body: good() })).status, 200, 'upload ' + i);
  assert.strictEqual((await call('POST', { body: good() })).status, 429);
  const ids = [...s.z.get('tsn:cr:pending').keys()];
  await call('POST', { body: { action: 'reject', id: ids[0], reason: 'Duplicate upload' }, admin: true });
  assert.strictEqual((await call('POST', { body: good() })).status, 200, 'a rejected creative frees its place');
  for (let i = 0; i < 3; i++) await call('POST', { body: good({ token: require('../api/_creative.js').tokenFor('INV-' + i) }) });
  assert.strictEqual((await call('POST', { body: good({ token: require('../api/_creative.js').tokenFor('INV-9') }) })).status, 429, 'per connection');
  assert.strictEqual((await call('POST', { body: good({ token: require('../api/_creative.js').tokenFor('INV-9') }), ip: '198.51.100.4' })).status, 200);
}));

test('without a store: the live list is empty and uploads are refused', () => withStore(Object.assign({}, ENV, { UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' }), async ({ call }) => {
  const live = await call('GET', { query: { live: '1' } });
  assert.deepStrictEqual([live.status, live.json.configured, live.json.cards], [200, false, {}]);
  assert.strictEqual((await call('POST', { body: good() })).status, 503);
}));

test('routing: /api/creative is a rewrite to inbox.js (no new function), local server too', () => {
  const vercel = JSON.parse(read('vercel.json'));
  assert.deepStrictEqual(vercel.rewrites.filter(r => r.source === '/api/creative').map(r => r.destination), ['/api/inbox?__route=creative']);
  assert.ok(!fs.existsSync(path.join(API, 'creative.js')));
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.ok(read('api/inbox.js').includes("creative: () => require('./_creative.js')"));
  assert.ok(read('server.js').includes("app.all(['/api/advertise', '/api/creative', '/api/campaigns', '/api/adstats', '/api/packages'], (req"));
});

test('the page fills ads only from approved creatives; images are still, lazy and described; tel links stay in the tab', () => {
  const html = read('public/index.html'), sponsors = JSON.parse(read('public/sponsors.json'));
  assert.ok(html.includes("fetch('/api/creative?live=1')"));
  assert.ok(html.includes("SPONSORS.__samples = sj && sj.samples ? sj.samples : null;"), 'from sponsors.json the page takes only the sample switch');
  assert.deepStrictEqual([...html.matchAll(/\bsj\.([a-z_]+)/g)].map(m => m[1]), ['samples', 'samples'], 'ads typed into sponsors.json are never shown');
  const vals = [].concat(Object.values(sponsors.slots), Object.values(sponsors.cards), sponsors.rails.left, sponsors.rails.right);
  assert.ok(vals.every(v => v === null), 'sponsors.json holds no ads');
  for (const bad of [{ name: 'X', url: 'https://x.test/', img: 'https://evil.test/a.png' }, { name: 'X', url: 'https://x.test/', img: '/api/creative?img=../a' }, { name: 'X', url: 'https://x.test/', cta: 'Apply' },
    { name: 'X', url: 'tel:5550142' }, { name: 'X', url: 'tel:+18125550142' + 'x' }]) assert.ok(!A.validAd(bad), JSON.stringify(bad));
  assert.ok(A.validAd({ name: 'X', url: 'tel:+18125550142', cta: 'Call now', img: '/api/creative?img=cr0123456789' }));
  const s = html.indexOf('      adLink: function (cls, ad) {'), e = html.indexOf('      // A tall ad for the side margins');
  const node = (tag, cls) => { const n = { tag, className: cls || '', children: [], attrs: {} }; n.appendChild = c => { n.children.push(c); return c; }; n.setAttribute = (k, v) => { n.attrs[k] = String(v); }; return n; };
  const UI = new Function('el', 'return {' + html.slice(s, e).replace(/,\s*$/, '') + '};')((t, c, x) => { const n = node(t, c); if (x != null) n.text = x; return n; });
  const web = UI.adLink('ad-card', { name: 'Fall sale', url: 'https://shop.test/', img: '/api/creative?img=cr0123456789', w: 600, h: 300 });
  const im = web.children.find(c => c.tag === 'img');
  assert.deepStrictEqual([web.rel, web.target, web.attrs['aria-label'], web.children[0].text, im.src, im.alt, im.loading, im.width, im.height], ['sponsored noopener noreferrer', '_blank', undefined, 'Sponsored', '/api/creative?img=cr0123456789', 'Fall sale', 'lazy', 600, 300]); // named by "Sponsored" and the image's alt
  const tel = UI.adLink('spon', { name: 'Call us', url: 'tel:+18125550142' });
  assert.deepStrictEqual([tel.href, tel.rel, tel.target, tel.children.length], ['tel:+18125550142', 'sponsored noopener noreferrer', undefined, 1]);
  const code = html.slice(s, html.indexOf('      // The one heart used everywhere.')) + html.slice(html.indexOf('      sponsor: function (slot, houseAd) {'), html.indexOf('      notice: function (text) {'));
  assert.ok(!/'video'|'iframe'|autoplay|setInterval|window\.open|\.gif/.test(code));
  assert.ok(!/\.ad-img[^}]*(animation|transition|position)/.test(html));
});

test('creative.html and admin.html: the upload form and the review screen', () => {
  const page = read('public/creative.html'), admin = read('public/admin.html');
  assert.ok(page.includes('<meta name="robots" content="noindex, nofollow">'));
  assert.ok(page.includes("fetch('/api/creative', { method: 'POST'"));
  assert.deepStrictEqual([...page.matchAll(/<option>([^<]+)<\/option>/g)].map(m => m[1]).sort(), A.CTAS.slice().sort());
  assert.ok(page.includes('accept="image/jpeg,image/png,image/webp"') && page.includes('300 * 1024'));
  assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(page));
  assert.ok(/won’t appear on the site until we approve it/.test(page));
  assert.ok(admin.includes("get('/api/creative')") && admin.includes("'x-admin-key': key"));
  assert.ok(admin.includes("if (body.reason.length < 3) { msg.textContent = 'Give a reason first.'; return; }"));
  assert.ok(admin.includes("post('/api/creative', { action: 'token'"));
  assert.ok(admin.includes('URL.createObjectURL(b)'), 'pending images load with the key, never by public URL');
  assert.ok(admin.includes('Creative review log'));
});

test('ads PR 4.2: an inquiry marked spam in the lead inbox can no longer be used to upload', () => withStore(ENV, async ({ s, call }) => {
  seedInquiry(s);
  s.kv.set('tsn:lead:' + INQ.ref, JSON.stringify({ ref: INQ.ref, status: 'spam', notes: [], history: [] }));
  const r = await call('POST', { body: good() });
  assert.strictEqual(r.status, 403);
  assert.ok(![...s.kv.keys()].some(k => k.startsWith('tsn:cr:') && !k.startsWith('tsn:cr:rl:')), 'nothing written');
  s.kv.set('tsn:lead:' + INQ.ref, JSON.stringify({ ref: INQ.ref, status: 'lost', notes: [], history: [] }));
  assert.strictEqual((await call('POST', { body: good() })).status, 200, 'any other status still can');
}));

test('ad sizes: optional finished banners per IAB size are checked, stored beside the image, reviewed and deleted with it', () => withStore(ENV, async ({ s, call, C }) => {
  seedInquiry(s);
  assert.deepStrictEqual(C.BANNER_SIZES, ['728x90', '300x250', '320x100', '160x600', '300x600']);
  // the server's checks: a size we run, a still image, at least 1x, the same shape (within 3%)
  assert.deepStrictEqual(C.banners(undefined), { sizes: {} });
  assert.deepStrictEqual(Object.keys(C.banners({ '728x90': url('png', png(1456, 180)), '300x250': url('jpeg', jpeg(300, 250)), '320x100': '' }).sizes), ['728x90', '300x250']);
  for (const [k, img, re] of [['970x250', url('png', png(970, 250)), /don’t run 970x250/], ['120x600', url('png', png(120, 600)), /don’t run/], ['728x90', url('png', png(700, 87)), /at least 728×90/],
    ['728x90', url('png', png(728, 120)), /same shape/], ['300x250', url('png', png(600, 300)), /same shape/], ['160x600', url('png', png(160, 600, { animated: true })), /Animated/], ['300x600', 'data:image/gif;base64,R0lGOD', /JPEG, PNG or WebP/]])
    assert.match(C.banners({ [k]: img }).error, re, k);
  assert.strictEqual(C.banners(['x']).field, 'sizes');
  assert.strictEqual(C.validate(good({ sizes: { '728x90': url('png', png(728, 100)) } })).field, 'size:728x90');
  const v = C.validate(good({ sizes: { '728x90': url('png', png(1456, 180)) } }));
  assert.deepStrictEqual(v.sizes, { '728x90': { type: 'png', bytes: png(1456, 180).length, w: 1456, h: 180 } });
  assert.ok(!('sizes' in C.validate(good())), 'no banners, no sizes field');
  // upload -> pending (banner only with the admin key) -> approved (public, listed in pub) -> withdrawn (deleted)
  const r = await call('POST', { body: good({ sizes: { '728x90': url('png', png(1456, 180)), '300x250': url('png', png(600, 500)) } }) });
  assert.strictEqual(r.status, 200); const id = r.json.id;
  assert.ok(s.kv.has('tsn:cr:img:' + id + ':728x90') && s.kv.has('tsn:cr:img:' + id + ':300x250') && s.exp.has('tsn:cr:img:' + id + ':728x90'));
  assert.strictEqual((await call('GET', { query: { img: id, size: '728x90' } })).status, 404, 'pending: not public');
  const adm = await call('GET', { query: { img: id, size: '728x90' }, admin: true });
  assert.ok(adm.status === 200 && adm.body.equals(png(1456, 180)));
  for (const size of ['970x250', '../x', '320x50']) assert.strictEqual((await call('GET', { query: { img: id, size }, admin: true })).status, 404, size);
  assert.strictEqual((await call('GET', { query: { img: id, size: '320x100' }, admin: true })).status, 404, 'no banner sent for that size');
  await call('POST', { body: { action: 'approve', id, reason: 'Checked all sizes', placements: ['card:news', 'card:jobs'] }, admin: true });
  assert.ok(!s.exp.has('tsn:cr:img:' + id + ':728x90'), 'kept while approved');
  const pubImg = await call('GET', { query: { img: id, size: '300x250' } });
  assert.deepStrictEqual([pubImg.status, pubImg.headers['cache-control']], [200, 'public, max-age=300, s-maxage=3600']);
  const live = await call('GET', { query: { live: '1' } });
  assert.deepStrictEqual(live.json.cards.news[0].sizes, ['728x90', '300x250']);
  await call('POST', { body: { action: 'withdraw', id, reason: 'Campaign over' }, admin: true });
  assert.ok(!s.kv.has('tsn:cr:img:' + id + ':728x90') && !s.kv.has('tsn:cr:img:' + id + ':300x250'), 'deleted with the creative');
}));

test('upload page: live previews in every size, crop and resolution warnings, optional banner per size; admin sees banners', () => {
  const page = read('public/creative.html'), admin = read('public/admin.html');
  assert.ok(page.includes('<script src="/adsizes.js"></script>') && page.includes('S.inject(document)'));
  assert.ok(page.includes('S.usedSizes().forEach') && page.includes('S.preview(document, k, ad)') && page.includes('S.check(pic.w, pic.h, k, false)') && page.includes('S.check(bn.w, bn.h, k, true)'));
  assert.ok(page.includes("['headline', 'text'].forEach(function (id) { $(id).addEventListener('input', previews); });"), 'previews follow the words as they are typed');
  assert.ok(page.includes('if (!S.fullOk(w, h, k)) return fail('), 'a banner of the wrong shape is refused before sending');
  assert.ok(page.includes('body.sizes[k] = banners[k].data'));
  assert.ok(page.includes('How your ad will look') && page.includes('We review all of them before anything runs.'));
  assert.ok(!/fetch\((?!'\/api\/creative')/.test(page), 'nothing leaves the browser but the upload itself');
  assert.ok(admin.includes("'&size=' + encodeURIComponent(k)") && admin.includes("{ headers: { 'x-admin-key': key }, cache: 'no-store' }"));
});

test('square picture: optional 1:1 (600×600 at least), stored beside the image, public only once approved, deleted with the creative', () => withStore(ENV, async ({ s, call, C }) => {
  seedInquiry(s);
  assert.strictEqual(C.squareImage(undefined), null); assert.strictEqual(C.squareImage(''), null);
  assert.deepStrictEqual(C.squareImage(url('png', png(1200, 1200))), { type: 'png', bytes: png(1200, 1200).length, w: 1200, h: 1200 });
  assert.ok(!C.squareImage(url('png', png(1200, 1180))).error, 'within 3% of square');
  for (const [img, re] of [[url('png', png(1200, 628)), /must be square/], [url('png', png(500, 500)), /at least 600×600/], [url('png', png(800, 800, { animated: true })), /Animated/], ['data:image/gif;base64,R0lGOD', /JPEG, PNG or WebP/]])
    assert.match(C.squareImage(img).error, re);
  assert.strictEqual(C.validate(good({ square: url('png', png(1200, 628)) })).field, 'square');
  assert.deepStrictEqual(C.validate(good({ square: url('jpeg', jpeg(1200, 1200)) })).square, { type: 'jpeg', bytes: jpeg(1200, 1200).length, w: 1200, h: 1200 });
  assert.ok(!('square' in C.validate(good())));
  const r = await call('POST', { body: good({ square: url('png', png(1200, 1200)), sizes: { '728x90': url('png', png(1456, 180)) } }) });
  assert.strictEqual(r.status, 200); const id = r.json.id, key = 'tsn:cr:img:' + id + ':square';
  assert.ok(s.kv.has(key) && s.exp.has(key));
  assert.strictEqual((await call('GET', { query: { img: id, size: 'square' } })).status, 404, 'pending: not public');
  const adm = await call('GET', { query: { img: id, size: 'square' }, admin: true });
  assert.ok(adm.status === 200 && adm.body.equals(png(1200, 1200)));
  const list = await call('GET', { admin: true });
  assert.deepStrictEqual(list.json.pending[0].square, { type: 'png', bytes: png(1200, 1200).length, w: 1200, h: 1200 });
  await call('POST', { body: { action: 'approve', id, reason: 'Checked both pictures', placements: ['card:news', 'rail:left'] }, admin: true });
  assert.ok(!s.exp.has(key), 'kept while approved');
  assert.strictEqual((await call('GET', { query: { img: id, size: 'square' } })).status, 200);
  const live = await call('GET', { query: { live: '1' } }), ad = live.json.cards.news[0];
  assert.deepStrictEqual([ad.sq, ad.sqW, ad.sqH, ad.sizes], ['/api/creative?img=' + id + '&size=square', 1200, 1200, ['728x90']]);
  await call('POST', { body: { action: 'withdraw', id, reason: 'Campaign over' }, admin: true });
  assert.ok(!s.kv.has(key) && !s.kv.has('tsn:cr:img:' + id + ':728x90'), 'deleted with the creative');
  // a rejected one too
  const r2 = await call('POST', { body: good({ headline: 'Another one', square: url('png', png(600, 600)) }) });
  await call('POST', { body: { action: 'reject', id: r2.json.id, reason: 'Blurry' }, admin: true });
  assert.ok(!s.kv.has('tsn:cr:img:' + r2.json.id + ':square'));
}));

test('upload page and admin: square picture input, per-size choice, nudge when crops are heavy; admin review shows it', () => {
  const page = read('public/creative.html'), admin = read('public/admin.html');
  assert.ok(page.includes('<input id="sq" type="file" accept="image/jpeg,image/png,image/webp">') && page.includes('Square picture (optional, recommended)') && page.includes('1200×1200 pixels is best, at least 600×600'));
  assert.ok(page.includes("var useSq = !bn && square && S.pick(k, dims, sqDims) === 'square', pic = useSq ? sqDims : dims;"));
  assert.ok(page.includes("c.warnings.push('Add a square picture (above) to use it here instead.')") && page.includes("$('sqnudge').hidden = !cropped;"));
  assert.ok(page.includes('if (Math.abs(w / h - 1) > 0.03) return fail(') && page.includes('if (w < 600 || h < 600) return fail('));
  assert.ok(page.includes('if (square) body.square = square;'));
  assert.ok(admin.includes("'&size=square'") && admin.includes('Square picture · '));
});
