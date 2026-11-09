'use strict';
// ship119: filter + cookie ownership on /api/comments. Copies the ship118 fake store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const { storyId, KEY, META } = require('../api/_storyid.js');
const COOKIE = require('../api/_cmcookie.js');

function fakeStore() {
  const kv = new Map(), sets = new Map(), z = new Map(), lists = new Map(), log = [];
  const run = ([c, k, ...a]) => {
    log.push([c, k, ...a]);
    switch (c) {
      case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
      case 'SET': { if (a.includes('NX') && kv.has(k)) return { result: null }; kv.set(k, a[0]); return { result: 'OK' }; }
      case 'DEL': { const had = kv.delete(k) | sets.delete(k) | z.delete(k) | lists.delete(k); return { result: had ? 1 : 0 }; }
      case 'INCR': { const n = (Number(kv.get(k)) || 0) + 1; kv.set(k, String(n)); return { result: n }; }
      case 'EXPIRE': return { result: 1 };
      case 'EXISTS': return { result: kv.has(k) || sets.has(k) || z.has(k) || lists.has(k) ? 1 : 0 };
      case 'SADD': { const s = sets.get(k) || new Set(); sets.set(k, s); let n = 0; a.forEach(x => { if (!s.has(x)) { s.add(x); n++; } }); return { result: n }; }
      case 'SREM': { const s = sets.get(k); let n = 0; if (s) a.forEach(x => { if (s.delete(x)) n++; }); return { result: n }; }
      case 'SCARD': return { result: (sets.get(k) || new Set()).size };
      case 'SISMEMBER': return { result: (sets.get(k) || new Set()).has(a[0]) ? 1 : 0 };
      case 'ZADD': { const m = z.get(k) || new Map(); z.set(k, m); m.set(a[1], Number(a[0])); return { result: 1 }; }
      case 'ZREM': { const m = z.get(k); let n = 0; if (m) a.forEach(x => { if (m.delete(x)) n++; }); return { result: n }; }
      case 'ZCARD': return { result: (z.get(k) || new Map()).size };
      case 'ZREMRANGEBYSCORE': {
        const m = z.get(k); if (!m) return { result: 0 };
        const min = String(a[0]) === '-inf' ? -Infinity : Number(a[0]);
        const max = String(a[1]) === '+inf' ? Infinity : Number(a[1]);
        let n = 0; [...m].forEach(([mem, s]) => { if (s >= min && s <= max) { m.delete(mem); n++; } }); return { result: n };
      }
      case 'ZREMRANGEBYRANK': {
        const m = z.get(k); if (!m) return { result: 0 };
        const sorted = [...m].sort((x, y) => x[1] - y[1]).slice(Number(a[0]), Number(a[1]) + 1);
        let n = 0; sorted.forEach(([mem]) => { if (m.delete(mem)) n++; }); return { result: n };
      }
      case 'PTTL': return { result: kv.has(k) || sets.has(k) || z.has(k) || lists.has(k) ? 180 * 86400 * 1000 : -2 };
      case 'EVAL': {
        const ATOM = require('../api/_cmatom.js');
        const nkeys = Number(a[0]);
        const keys = a.slice(1, 1 + nkeys);
        const argv = a.slice(1 + nkeys);
        return { result: ATOM.run(k, ATOM.wrap(run), keys, argv) };
      }
      case 'ZREVRANGE': {
        const m = z.get(k) || new Map();
        const arr = [...m].sort((x, y) => y[1] - x[1]).slice(Number(a[0]), Number(a[1]) + 1);
        return { result: a.includes('WITHSCORES') ? arr.flatMap(([m2, s]) => [m2, String(s)]) : arr.map(x => x[0]) };
      }
      default: throw new Error('fake store: ' + c);
    }
  };
  const fetch = async (url, init) => ({ ok: true, status: 200, json: async () => JSON.parse(init.body).map(run) });
  return { kv, sets, z, lists, log, fetch };
}
const ENV = { KV_REST_API_URL: 'https://fake.store', KV_REST_API_TOKEN: 'fake', LISTINGS_ADMIN_KEY: 'admin-test-key' };
async function withStore(fn) {
  const saved = {}, store = fakeStore(), realFetch = globalThis.fetch;
  for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k]; }
  globalThis.fetch = store.fetch;
  Object.keys(require.cache).filter(k => k.startsWith(path.join(root, 'api'))).forEach(k => delete require.cache[k]);
  try { return await fn(store, name => require(path.join(root, 'api', name))); }
  finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(ENV)) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
    Object.keys(require.cache).filter(k => k.startsWith(path.join(root, 'api'))).forEach(k => delete require.cache[k]);
  }
}
function call(handler, req) {
  return new Promise(resolve => {
    const res = {
      headers: {}, code: 200,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.code = c; return this; },
      send(b) { let body = b; try { body = JSON.parse(b); } catch (_) {} resolve({ code: this.code, headers: this.headers, body }); },
      json(o) { resolve({ code: this.code, headers: this.headers, body: o }); },
      end() { resolve({ code: this.code, headers: this.headers }); }
    };
    Promise.resolve(handler(Object.assign({ method: 'GET', headers: {}, query: {}, url: '/api/comments' }, req), res)).catch(e => resolve({ code: 'threw', error: e }));
  });
}
const origin = { host: '127.0.0.1:3077', origin: 'http://127.0.0.1:3077' };
const NEWS = { kind: 'news', title: 'Council passes riverfront plan', sourceId: 'n' };
function seedStory(store, sid, meta) {
  const cur = store.sets.get(KEY) || new Set();
  cur.add(sid);
  store.sets.set(KEY, cur);
  const all = {}; try { Object.assign(all, JSON.parse(store.kv.get(META) || '{}')); } catch (_) {}
  all[sid] = meta;
  store.kv.set(META, JSON.stringify(all));
}
function cookieHeader(setCookie) {
  const m = String(setCookie || '').match(/(?:__Host-)?tsn_cm=([^;]+)/);
  return m ? 'tsn_cm=' + m[1] : '';
}
function tokenOf(setCookie) {
  const m = String(setCookie || '').match(/(?:__Host-)?tsn_cm=([^;]+)/);
  return m ? m[1] : '';
}
function CookieJar() { this.cookie = ''; }
CookieJar.prototype.apply = function (setCookie) {
  const h = cookieHeader(setCookie);
  if (h) this.cookie = h;
};
CookieJar.prototype.hdr = function (extra) {
  return Object.assign({ cookie: this.cookie }, origin, extra || {});
};
async function issue(C, extra) {
  const r1 = await call(C, { method: 'POST', headers: Object.assign({}, origin, extra || {}), body: { action: 'ready' } });
  const cookie = cookieHeader(r1.headers['set-cookie']);
  const token = tokenOf(r1.headers['set-cookie']);
  const r2 = await call(C, { method: 'POST', headers: Object.assign({}, origin, extra || {}, { cookie }), body: { action: 'ready' } });
  return { cookie, token, r1, r2 };
}

test('ship119: still 8 functions; comments stay on react.js; no new secret', () => {
  const fns = fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_')).sort();
  assert.equal(fns.length, 8);
  const src = read('api/_comments.js') + read('api/_cmcookie.js');
  assert.equal(src.includes('LISTINGS_ADMIN_KEY') && src.includes("require('./_cmcookie.js')"), true);
  assert.equal(read('api/_cmcookie.js').includes('createHmac'), false);
  assert.equal(read('api/_cmcookie.js').includes('localStorage'), false);
});

test('ship119: ready round-trip; create without cookie does not publish; no mine:true as Set-Cookie proof', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/ready');
  seedStory(s, id, NEWS);
  const r1 = await call(C, { method: 'POST', headers: origin, body: { action: 'ready' } });
  assert.equal(r1.code, 200);
  assert.equal(r1.body.ready, false);
  assert.ok(r1.headers['set-cookie']);
  assert.ok(!('mine' in r1.body));
  const cookie = cookieHeader(r1.headers['set-cookie']);
  const r2 = await call(C, { method: 'POST', headers: Object.assign({}, origin, { cookie }), body: { action: 'ready' } });
  assert.equal(r2.body.ready, true);
  assert.equal(r2.headers['set-cookie'], undefined);
  const nope = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '1.1.1.1' }, origin), body: { id, uid: 'reader-0001', text: 'Hello riverfront.' } });
  assert.equal(nope.code, 400);
  assert.match(String(nope.body.error), /cookie/i);
  assert.equal([...s.kv.keys()].some(k => String(k).startsWith('tsn:cm:c')), false);
  const ok = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '1.1.1.1', cookie }, origin), body: { id, uid: 'reader-0001', text: 'Hello riverfront.' } });
  assert.equal(ok.code, 200);
  assert.ok(ok.body.comment && ok.body.comment.id);
  assert.equal(ok.body.mine, undefined);
  assert.ok(ok.headers['set-cookie']);
  const rec = JSON.parse(s.kv.get('tsn:cm:' + ok.body.comment.id));
  assert.ok(!('uid' in rec));
  const own = s.kv.get('tsn:cm:own:' + ok.body.comment.id);
  assert.equal(own, COOKIE.tokenHash(tokenOf(cookie)));
  assert.equal(own.includes(tokenOf(cookie)), false);
}));

test('ship119: GET stays public/unpersonalized; cookie on GET does not leak mine or Set-Cookie', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/cdn');
  seedStory(s, id, NEWS);
  const { cookie } = await issue(C);
  await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '1.1.1.1', cookie }, origin), body: { id, uid: 'reader-0001', text: 'Public text only.' } });
  const got = await call(C, { query: { id }, headers: { cookie } });
  assert.match(got.headers['cache-control'], /public/);
  assert.ok(!/private|no-store/.test(got.headers['cache-control']));
  assert.equal(got.headers['set-cookie'], undefined);
  assert.equal(got.body.mine, undefined);
  assert.ok(got.body.comments.every(c => !('mine' in c) && !('uid' in c)));
  const dump = JSON.stringify(got.body);
  assert.equal(dump.includes(tokenOf(cookie)), false);
  assert.equal(/[a-f0-9]{64}/.test(dump), false);
  const mine = await call(C, { method: 'POST', headers: Object.assign({ cookie }, origin), body: { action: 'mine', ids: got.body.comments.map(c => c.id) } });
  assert.match(mine.headers['cache-control'], /no-store/);
  assert.deepEqual(mine.body.mine, got.body.comments.map(c => c.id));
}));

test('ship119: reject does not publish; hold is not public; owner can delete held; review why categories', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/filt');
  seedStory(s, id, NEWS);
  const { cookie } = await issue(C);
  const post = (text, ip) => call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': ip || '2.2.2.2', cookie }, origin), body: { id, uid: 'reader-0001', text } });
  const rej = await post('this is shit');
  assert.equal(rej.code, 400);
  assert.equal(rej.body.error, C.REJECT_MSG);
  assert.equal(rej.headers['set-cookie'], undefined);
  const vis0 = s.z.get('tsn:cm:vis:' + id) || new Map();
  assert.equal(vis0.size, 0);
  const mention = await post('Don’t use the word nigger here', '2.2.2.4');
  assert.equal(mention.code, 200);
  assert.equal(mention.body.pending, true);
  assert.ok(mention.body.id);
  const bait = await post('don’t say nigger you nigger', '2.2.2.5');
  assert.equal(bait.code, 400);
  const held = await post('I hate all muslims', '2.2.2.3');
  assert.equal(held.code, 200);
  assert.equal(held.body.pending, true);
  assert.ok(held.body.id);
  assert.equal(held.body.comment, undefined);
  const pub = await call(C, { query: { id } });
  assert.deepEqual(pub.body.comments, []);
  const q = await call(C, { query: { review: '1' }, headers: { 'x-admin-key': 'admin-test-key' } });
  const row = q.body.items.find(x => x.id === held.body.id);
  assert.ok(row);
  assert.equal(row.why, 'hold');
  assert.ok(!('hash' in row) && !('token' in row));
  const del = await call(C, { method: 'POST', headers: Object.assign({ cookie }, origin), body: { action: 'delete', id: held.body.id } });
  assert.equal(del.code, 200);
  assert.equal(s.kv.get('tsn:cm:' + held.body.id), undefined);
  const q2 = await call(C, { query: { review: '1' }, headers: { 'x-admin-key': 'admin-test-key' } });
  assert.ok(!q2.body.items.some(x => x.id === held.body.id));
}));

test('ship119: owner delete is hash-bound; wrong cookie and second delete are generic 404; no resurrection', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/own');
  seedStory(s, id, NEWS);
  const a = await issue(C, { 'x-real-ip': '3.3.3.1' });
  const b = await issue(C, { 'x-real-ip': '3.3.3.2' });
  // Two browsers get different tokens; hash compare is per cookie, not per IP.
  const posted = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '3.3.3.3', cookie: a.cookie }, origin), body: { id, uid: 'reader-0001', text: 'My comment on the river.' } });
  const cid = posted.body.comment.id;
  const wrong = await call(C, { method: 'POST', headers: Object.assign({ cookie: b.cookie }, origin), body: { action: 'delete', id: cid } });
  assert.equal(wrong.code, 404);
  assert.equal(wrong.body.error, 'not found');
  assert.ok(s.kv.get('tsn:cm:' + cid));
  const ok = await call(C, { method: 'POST', headers: Object.assign({ cookie: a.cookie }, origin), body: { action: 'delete', id: cid } });
  assert.equal(ok.code, 200);
  assert.equal(s.kv.get('tsn:cm:' + cid), undefined);
  assert.equal(s.kv.get('tsn:cm:own:' + cid), undefined);
  const again = await call(C, { method: 'POST', headers: Object.assign({ cookie: a.cookie }, origin), body: { action: 'delete', id: cid } });
  assert.equal(again.code, 404);
  const rest = await call(C, { method: 'POST', headers: Object.assign({ 'x-admin-key': 'admin-test-key' }, origin), body: { action: 'restore', id: cid } });
  assert.equal(rest.body.restored, false);
  const pub = await call(C, { query: { id } });
  assert.ok(!pub.body.comments.some(c => c.id === cid));
}));

test('ship119: legacy without own key is never claimable; public GET omits without writing hide; sweep then restore', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/leg');
  seedStory(s, id, NEWS);
  const { cookie } = await issue(C);
  const cleanId = 'clegacy01', slurId = 'clegacyslur1';
  const now = new Date().toISOString();
  s.kv.set('tsn:cm:' + cleanId, JSON.stringify({ id: cleanId, storyId: id, text: 'An old river comment.', at: now }));
  s.kv.set('tsn:cm:' + slurId, JSON.stringify({ id: slurId, storyId: id, text: 'nigger', at: now }));
  const vis = new Map();
  vis.set(cleanId, Date.now() / 1000 + 86400);
  vis.set(slurId, Date.now() / 1000 + 86400);
  s.z.set('tsn:cm:vis:' + id, vis);
  const got = await call(C, { query: { id } });
  assert.ok(got.body.comments.some(c => c.id === cleanId));
  assert.ok(!got.body.comments.some(c => c.id === slurId));
  assert.equal(got.body.total, 1);
  assert.equal(got.body.count, 1);
  assert.equal(s.kv.get('tsn:cm:hide:' + slurId), undefined, 'opening a thread must not hide for the first reader');
  assert.ok((s.z.get('tsn:cm:vis:' + id) || new Map()).has(slurId), 'filter omit is a view; vis member stays until sweep');
  const before = await call(C, { query: { review: '1' }, headers: { 'x-admin-key': 'admin-test-key' } });
  assert.ok(!before.body.items.some(x => x.id === slurId));
  const mine = await call(C, { method: 'POST', headers: Object.assign({ cookie }, origin), body: { action: 'mine', ids: [cleanId, slurId] } });
  assert.deepEqual(mine.body.mine, []);
  const claim = await call(C, { method: 'POST', headers: Object.assign({ cookie }, origin), body: { action: 'delete', id: cleanId } });
  assert.equal(claim.code, 404);
  assert.ok(s.kv.get('tsn:cm:' + cleanId));
  const sw = await call(C, { method: 'POST', headers: Object.assign({ 'x-admin-key': 'admin-test-key' }, origin), body: { action: 'sweep' } });
  assert.equal(sw.code, 200);
  assert.ok(sw.body.hid >= 1);
  const q = await call(C, { query: { review: '1' }, headers: { 'x-admin-key': 'admin-test-key' } });
  const slur = q.body.items.find(x => x.id === slurId);
  assert.equal(slur && slur.why, 'filter');
  assert.ok(!s.z.get('tsn:cm:vis:' + id).has(slurId));
  const rest = await call(C, { method: 'POST', headers: Object.assign({ 'x-admin-key': 'admin-test-key' }, origin), body: { action: 'restore', id: slurId } });
  assert.equal(rest.body.restored, true);
  assert.ok(s.kv.get('tsn:cm:ok:' + slurId));
  const back = await call(C, { query: { id } });
  assert.ok(back.body.comments.some(c => c.id === slurId), 'admin restore must skip the filter view');
  const noKey = await call(C, { method: 'POST', headers: origin, body: { action: 'sweep' } });
  assert.equal(noKey.code, 404);
  const missing = await call(C, { method: 'POST', headers: Object.assign({ 'x-admin-key': 'admin-test-key' }, origin), body: { action: 'restore', id: 'cmissing1' } });
  assert.equal(missing.body.restored, false);
  await call(C, { method: 'POST', headers: Object.assign({ 'x-admin-key': 'admin-test-key' }, origin), body: { action: 'delete', id: cleanId } });
  assert.equal(s.kv.get('tsn:cm:' + cleanId), undefined);
  assert.equal(s.kv.get('tsn:cm:own:' + cleanId), undefined);
  assert.equal(s.kv.get('tsn:cm:ok:' + cleanId), undefined);
}));

test('ship119: public counts match the filtered thread across pages and stories; GET is not a mod write', () => withStore(async (s, mod) => {
  const C = mod('_comments.js');
  const a = storyId('https://n.ex/cnt-a'), b = storyId('https://n.ex/cnt-b');
  seedStory(s, a, NEWS);
  seedStory(s, b, NEWS);
  const now = new Date().toISOString();
  const exp = Date.now() / 1000 + 86400;
  const visA = new Map(), visB = new Map();
  for (let i = 0; i < 25; i++) {
    const cid = 'cok' + String(i).padStart(4, '0');
    s.kv.set('tsn:cm:' + cid, JSON.stringify({ id: cid, storyId: a, text: 'River comment number ' + i + '.', at: now }));
    visA.set(cid, exp - i);
  }
  for (let i = 0; i < 5; i++) {
    const cid = 'cslur' + i;
    s.kv.set('tsn:cm:' + cid, JSON.stringify({ id: cid, storyId: a, text: 'nigger', at: now }));
    visA.set(cid, exp + 10 + i);
  }
  s.z.set('tsn:cm:vis:' + a, visA);
  const bOk = 'cbok0001', bSlur = 'cbslur01';
  s.kv.set('tsn:cm:' + bOk, JSON.stringify({ id: bOk, storyId: b, text: 'Nice riverfront work.', at: now }));
  s.kv.set('tsn:cm:' + bSlur, JSON.stringify({ id: bSlur, storyId: b, text: 'nigger', at: now }));
  visB.set(bOk, exp); visB.set(bSlur, exp + 1);
  s.z.set('tsn:cm:vis:' + b, visB);
  const page = await call(C, { query: { id: a } });
  assert.equal(page.body.comments.length, 20);
  assert.equal(page.body.total, 25);
  assert.equal(page.body.count, 25);
  assert.ok(page.body.comments.every(c => !/nigger/i.test(c.text)));
  const page2 = await call(C, { query: { id: a, offset: '20' } });
  assert.equal(page2.body.comments.length, 5);
  assert.equal(page2.body.total, 25);
  assert.ok(page2.body.comments.every(c => !/nigger/i.test(c.text)));
  assert.equal(s.kv.get('tsn:cm:hide:cslur0'), undefined);
  assert.equal((s.z.get('tsn:cm:vis:' + a) || new Map()).size, 30);
  const counts = await call(C, { query: { ids: a + ',' + b } });
  assert.equal(counts.body.counts[a], 25);
  assert.equal(counts.body.counts[b], 1);
  const quoteId = 'cquote01';
  s.kv.set('tsn:cm:' + quoteId, JSON.stringify({ id: quoteId, storyId: b, text: 'Don’t use the word nigger here', at: now }));
  visB.set(quoteId, exp + 2);
  const bThread = await call(C, { query: { id: b } });
  assert.equal(bThread.body.total, 1);
  assert.ok(!bThread.body.comments.some(c => c.id === quoteId), 'held mention is not public without review');
  assert.equal(s.kv.get('tsn:cm:hide:' + quoteId), undefined);
  const okId = 'cbokslur1';
  s.kv.set('tsn:cm:' + okId, JSON.stringify({ id: okId, storyId: b, text: 'nigger', at: now }));
  s.kv.set('tsn:cm:ok:' + okId, '1');
  visB.set(okId, exp + 3);
  const overridden = await call(C, { query: { id: b } });
  assert.ok(overridden.body.comments.some(c => c.id === okId), 'admin ok-key keeps a reviewed rec public');
  const sw = await call(C, { method: 'POST', headers: Object.assign({ 'x-admin-key': 'admin-test-key' }, origin), body: { action: 'sweep' } });
  assert.equal(sw.code, 200);
  assert.ok(s.z.get('tsn:cm:vis:' + b).has(okId), 'sweep must not autohide a restored rec');
  assert.equal(s.kv.get('tsn:cm:hide:' + okId), undefined);
}));

test('ship119: cookie jar last Set-Cookie wins; overlapping ready without a cookie may rotate; mine stays honest', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/jar');
  seedStory(s, id, NEWS);
  const jar = new CookieJar();
  const hdr = Object.assign({ 'x-real-ip': '4.4.5.9' }, origin);
  const [t1, t2] = await Promise.all([
    call(C, { method: 'POST', headers: hdr, body: { action: 'ready' } }),
    call(C, { method: 'POST', headers: hdr, body: { action: 'ready' } })
  ]);
  jar.apply(t1.headers['set-cookie']);
  jar.apply(t2.headers['set-cookie']);
  const issued = [t1, t2].filter(r => r.headers['set-cookie']);
  assert.equal(issued.length, 2, 'no IP issuance lock: both first-use readies may Set-Cookie');
  assert.equal([...s.kv.keys()].some(k => String(k).includes('tsn:cm:issue:')), false);
  assert.ok(jar.cookie);
  const prove = await call(C, { method: 'POST', headers: jar.hdr({ 'x-real-ip': '4.4.5.9' }), body: { action: 'ready' } });
  assert.equal(prove.body.ready, true);
  assert.equal(prove.headers['set-cookie'], undefined);
  const a = await call(C, { method: 'POST', headers: jar.hdr({ 'x-real-ip': '4.4.5.1' }), body: { id, uid: 'reader-j01', text: 'First after both readies.' } });
  jar.apply(a.headers['set-cookie']);
  const b = await call(C, { method: 'POST', headers: jar.hdr({ 'x-real-ip': '4.4.5.2' }), body: { id, uid: 'reader-j02', text: 'Second from the same jar.' } });
  jar.apply(b.headers['set-cookie']);
  assert.equal(a.code, 200); assert.equal(b.code, 200);
  assert.equal((await call(C, { method: 'POST', headers: jar.hdr(), body: { action: 'delete', id: a.body.comment.id } })).code, 200);
  assert.equal((await call(C, { method: 'POST', headers: jar.hdr(), body: { action: 'delete', id: b.body.comment.id } })).code, 200);
}));

test('ship119: ready with the jar cookie does not rotate; Delete follows mine not the in-flight Set-Cookie', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/inflight');
  seedStory(s, id, NEWS);
  const jar = new CookieJar();
  const ip = { 'x-real-ip': '4.4.6.9' };
  const t1 = await call(C, { method: 'POST', headers: Object.assign({}, origin, ip), body: { action: 'ready' } });
  jar.apply(t1.headers['set-cookie']);
  const prove = await call(C, { method: 'POST', headers: jar.hdr(ip), body: { action: 'ready' } });
  assert.equal(prove.body.ready, true);
  const createCookie = jar.cookie;
  const t2 = await call(C, { method: 'POST', headers: jar.hdr(ip), body: { action: 'ready' } });
  jar.apply(t2.headers['set-cookie']);
  assert.equal(t2.headers['set-cookie'], undefined, 'ready that already has the jar cookie must not issue a new token');
  const posted = await call(C, { method: 'POST', headers: Object.assign({ cookie: createCookie, 'x-real-ip': '4.4.6.1' }, origin), body: { id, uid: 'reader-if1', text: 'Posted while the other tab called ready.' } });
  jar.apply(posted.headers['set-cookie']);
  assert.equal(posted.code, 200);
  const mine = await call(C, { method: 'POST', headers: jar.hdr(), body: { action: 'mine', ids: [posted.body.comment.id] } });
  assert.deepEqual(mine.body.mine, [posted.body.comment.id], 'UI may show Delete only when mine agrees with the jar');
  assert.equal((await call(C, { method: 'POST', headers: jar.hdr(), body: { action: 'delete', id: posted.body.comment.id } })).code, 200);
}));

test('ship119: two browsers (different IPs) each get a cookie; the other cannot delete', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/race');
  seedStory(s, id, NEWS);
  const t1 = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '4.4.4.1' }, origin), body: { action: 'ready' } });
  const t2 = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '4.4.4.2' }, origin), body: { action: 'ready' } });
  const c1 = cookieHeader(t1.headers['set-cookie']), c2 = cookieHeader(t2.headers['set-cookie']);
  assert.notEqual(tokenOf(c1), tokenOf(c2));
  const a = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '4.4.4.1', cookie: c1 }, origin), body: { id, uid: 'reader-0001', text: 'From browser one.' } });
  const b = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '4.4.4.2', cookie: c2 }, origin), body: { id, uid: 'reader-0002', text: 'From browser two.' } });
  assert.equal(a.code, 200); assert.equal(b.code, 200);
  const mineWrong = await call(C, { method: 'POST', headers: Object.assign({ cookie: c2 }, origin), body: { action: 'mine', ids: [a.body.comment.id] } });
  assert.deepEqual(mineWrong.body.mine, []);
  assert.equal((await call(C, { method: 'POST', headers: Object.assign({ cookie: c2 }, origin), body: { action: 'delete', id: a.body.comment.id } })).code, 404);
  assert.equal((await call(C, { method: 'POST', headers: Object.assign({ cookie: c1 }, origin), body: { action: 'delete', id: a.body.comment.id } })).code, 200);
  assert.equal((await call(C, { method: 'POST', headers: Object.assign({ cookie: c1 }, origin), body: { action: 'delete', id: b.body.comment.id } })).code, 404);
  assert.equal((await call(C, { method: 'POST', headers: Object.assign({ cookie: c2 }, origin), body: { action: 'delete', id: b.body.comment.id } })).code, 200);
}));

test('ship119: malformed/duplicate/oversized cookies rejected; prod __Host- Secure; loopback not spoofable', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/ck');
  seedStory(s, id, NEWS);
  const { cookie, token } = await issue(C);
  const post = (hdr) => call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '5.5.5.5' }, origin, hdr), body: { id, uid: 'reader-0001', text: 'Cookie check comment.' } });
  assert.equal((await post({ cookie: 'tsn_cm=' + token + '; tsn_cm=' + token })).code, 400);
  assert.equal((await post({ cookie: 'tsn_cm=short' })).code, 400);
  assert.equal((await post({ cookie: 'x'.repeat(5000) })).code, 400);
  assert.equal((await post({ cookie })).code, 200);
  const prod = { host: 'www.tristatenow.com', origin: 'https://www.tristatenow.com', 'x-forwarded-proto': 'https', 'x-vercel-id': 'sfo1', 'x-real-ip': '5.5.5.80' };
  const r = await call(C, { method: 'POST', headers: Object.assign({}, origin, prod), body: { action: 'ready' } });
  assert.match(String(r.headers['set-cookie']), /__Host-tsn_cm=/);
  assert.match(String(r.headers['set-cookie']), /Secure/);
  assert.match(String(r.headers['set-cookie']), /HttpOnly/);
  assert.match(String(r.headers['set-cookie']), /SameSite=Lax/);
  assert.ok(!/Domain=/i.test(String(r.headers['set-cookie'])));
  const spoof = await call(C, { method: 'POST', headers: { host: 'evil.test', origin: 'https://evil.test', 'x-forwarded-proto': 'https', 'x-real-ip': '5.5.5.81' }, body: { action: 'ready' } });
  assert.equal(spoof.code, 200);
  assert.ok(!/__Host-/.test(String(spoof.headers['set-cookie'] || '')));
  assert.ok(!/Secure/.test(String(spoof.headers['set-cookie'] || '')));
}));

test('ship119: owner can delete after story becomes crime; GET stays empty and does not leak text; IP quota survives new cookie', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/crimeflip');
  seedStory(s, id, NEWS);
  const { cookie } = await issue(C);
  const posted = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '6.6.6.6', cookie }, origin), body: { id, uid: 'reader-0001', text: 'Was a normal comment.' } });
  const cid = posted.body.comment.id;
  const all = JSON.parse(s.kv.get(META));
  all[id] = { kind: 'news', title: 'Man arrested downtown after chase', sourceId: 'n' };
  s.kv.set(META, JSON.stringify(all));
  const got = await call(C, { query: { id } });
  assert.equal(got.body.allowed, false);
  assert.deepEqual(got.body.comments, []);
  assert.equal(JSON.stringify(got.body).includes('Was a normal comment'), false);
  const del = await call(C, { method: 'POST', headers: Object.assign({ cookie }, origin), body: { action: 'delete', id: cid } });
  assert.equal(del.code, 200);
  assert.equal(s.kv.get('tsn:cm:' + cid), undefined);

  const sid = storyId('https://n.ex/quota');
  seedStory(s, sid, NEWS);
  const first = await issue(C, { 'x-real-ip': '9.9.9.8' });
  for (let i = 0; i < C.STORY_PER_IP; i++) {
    const r = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '9.9.9.9', cookie: first.cookie }, origin), body: { id: sid, uid: 'reader-q' + i, text: 'Quota comment ' + i } });
    assert.equal(r.code, 200);
  }
  const fresh = await issue(C, { 'x-real-ip': '9.9.9.7' });
  const over = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '9.9.9.9', cookie: fresh.cookie }, origin), body: { id: sid, uid: 'reader-q99', text: 'After cookie clear' } });
  assert.equal(over.code, 429);
}));

test('ship119: client Delete/ready/draft; legal cookie copy; admin why; no document.cookie', () => {
  const js = read('public/assets/app.js');
  const css = read('public/assets/app.css');
  const legal = read('public/legal.html');
  const admin = read('public/admin.html');
  assert.match(js, /action: 'ready'/);
  assert.match(js, /action: 'mine'/);
  assert.match(js, /action: 'delete'/);
  const readyFn = js.slice(js.indexOf('function cmReadyRoundTrip('), js.indexOf('function rememberOpener('));
  assert.match(readyFn, /setTimeout/, 'ready retries until the jar cookie proves or the window ends');
  assert.match(readyFn, /navigator\.locks/, 'same-browser tabs serialize ready instead of an IP lock');
  assert.match(readyFn, /Math\.random/, 'retry delay is jittered so two devices do not sync-fail');
  assert.match(readyFn, /again\(12\)/);
  assert.equal(js.includes('form.hidden = cookieOk === false'), false, 'failed ready must not hide the form');
  const pendingRow = js.slice(js.indexOf("if (pending) {"), js.indexOf("var rp = el('button', 'cm-report')"));
  assert.equal(pendingRow.includes('addDel'), false, 'held rows must not show Delete before mine');
  const subAt = js.indexOf("form.addEventListener('submit'");
  const submit = js.slice(subAt, js.indexOf('document.body.appendChild(d)', subAt));
  assert.match(submit, /markMine\(\)/, 'create/hold re-sync Delete from mine, not from the create response');
  assert.match(submit, /if \(cookieOk\) \{ send\(\); return; \}/);
  assert.match(submit, /cmReady\(\)\.then\(goSend\)/);
  assert.match(js, /cm-del/);
  assert.match(js, /confirm\(/);
  assert.match(js, /credentials: 'same-origin'/);
  assert.equal(js.includes('document.cookie'), false);
  assert.match(css, /\.cm-del/);
  assert.match(css, /min-height:44px/);
  assert.match(legal, /__Host-tsn_cm|tsn_cm/);
  assert.match(legal, /180 days after the last successful comment/);
  assert.match(legal, /not an account/i);
  assert.match(legal, /slurs|profanity|held for review/);
  assert.ok(!/TRISTATENOW itself doesn’t set cookies/.test(legal));
  assert.match(admin, /why/);
  assert.match(admin, /action: 'sweep'|action:'sweep'/);
  assert.match(admin, /stays in vis until you run Apply filter|Matching stored text stays in vis/);
  assert.match(legal, /TTL prune|timed out/);
  assert.match(read('api/_comments.js'), /no IP lock/);
  assert.equal(read('api/_comments.js').includes('tsn:cm:issue:'), false);
  assert.match(legal, /not a hate-speech model|not an AI|word list/i);
});

test('ship119: ready issuance and mine have their own burst caps, not the post IP quota', () => withStore(async (s, mod) => {
  const C = mod('_comments.js');
  const hdr = Object.assign({ 'x-real-ip': '10.9.8.7' }, origin);
  for (let i = 0; i < C.READY_PER_IP; i++) {
    const r = await call(C, { method: 'POST', headers: hdr, body: { action: 'ready' } });
    assert.equal(r.code, 200);
    assert.equal(r.body.ready, false);
  }
  const over = await call(C, { method: 'POST', headers: hdr, body: { action: 'ready' } });
  assert.equal(over.code, 429);
  const { cookie } = await issue(C, { 'x-real-ip': '10.9.8.8' });
  for (let i = 0; i < C.MINE_PER_IP; i++) {
    const r = await call(C, { method: 'POST', headers: Object.assign({ cookie, 'x-real-ip': '10.9.8.8' }, origin), body: { action: 'mine', ids: ['cabc123'] } });
    assert.equal(r.code, 200);
  }
  const mineOver = await call(C, { method: 'POST', headers: Object.assign({ cookie, 'x-real-ip': '10.9.8.8' }, origin), body: { action: 'mine', ids: ['cabc123'] } });
  assert.equal(mineOver.code, 429);
}));

test('ship119: shared-NAT devices on one public IP each get a cookie and can post', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/cgnat');
  seedStory(s, id, NEWS);
  const ip = { 'x-real-ip': '100.64.1.8' };
  const a = await call(C, { method: 'POST', headers: Object.assign({}, origin, ip), body: { action: 'ready' } });
  const b = await call(C, { method: 'POST', headers: Object.assign({}, origin, ip), body: { action: 'ready' } });
  assert.equal(a.code, 200); assert.equal(b.code, 200);
  assert.equal(a.body.ready, false); assert.equal(b.body.ready, false);
  assert.ok(a.headers['set-cookie']); assert.ok(b.headers['set-cookie']);
  assert.notEqual(tokenOf(a.headers['set-cookie']), tokenOf(b.headers['set-cookie']));
  assert.equal([...s.kv.keys()].some(k => String(k).includes('tsn:cm:issue:')), false);
  const ca = cookieHeader(a.headers['set-cookie']), cb = cookieHeader(b.headers['set-cookie']);
  const pa = await call(C, { method: 'POST', headers: Object.assign({ cookie: ca, 'x-real-ip': '100.64.1.8' }, origin), body: { id, uid: 'reader-na1', text: 'From phone A on CGNAT.' } });
  const pb = await call(C, { method: 'POST', headers: Object.assign({ cookie: cb, 'x-real-ip': '100.64.1.8' }, origin), body: { id, uid: 'reader-nb1', text: 'From phone B on CGNAT.' } });
  assert.equal(pa.code, 200); assert.equal(pb.code, 200);
  assert.equal((await call(C, { method: 'POST', headers: Object.assign({ cookie: cb }, origin), body: { action: 'delete', id: pa.body.comment.id } })).code, 404);
  assert.equal((await call(C, { method: 'POST', headers: Object.assign({ cookie: ca }, origin), body: { action: 'delete', id: pa.body.comment.id } })).code, 200);
  assert.equal((await call(C, { method: 'POST', headers: Object.assign({ cookie: cb }, origin), body: { action: 'delete', id: pb.body.comment.id } })).code, 200);
}));

test('ship119: GET thread TTL-prunes vis; classification still does not hide; ?ids= is cached and bounded', () => withStore(async (s, mod) => {
  const C = mod('_comments.js');
  const keep = storyId('https://n.ex/prune-keep');
  seedStory(s, keep, NEWS);
  const now = new Date().toISOString();
  const liveId = 'clive001', deadId = 'cdead001';
  s.kv.set('tsn:cm:' + liveId, JSON.stringify({ id: liveId, storyId: keep, text: 'Still on the river.', at: now }));
  s.kv.set('tsn:cm:' + deadId, JSON.stringify({ id: deadId, storyId: keep, text: 'Expired row.', at: now }));
  const vis = new Map();
  vis.set(liveId, Math.floor(Date.now() / 1000) + 86400);
  vis.set(deadId, 10);
  s.z.set('tsn:cm:vis:' + keep, vis);
  const page = await call(C, { query: { id: keep } });
  assert.equal(page.body.total, 1);
  assert.equal(page.body.comments[0].id, liveId);
  assert.equal((s.z.get('tsn:cm:vis:' + keep) || new Map()).has(deadId), false, 'GET thread may TTL-prune');
  assert.equal(s.kv.get('tsn:cm:hide:' + deadId), undefined, 'prune is not a filter hide');
  assert.ok(s.log.some(c => c[0] === 'ZREMRANGEBYSCORE'));

  const stories = [];
  for (let i = 0; i < C.MAX_COUNT_STORIES + 1; i++) {
    const sid = storyId('https://n.ex/count-' + i);
    seedStory(s, sid, NEWS);
    stories.push(sid);
    const cid = ('cbound' + i).slice(0, 12);
    s.kv.set('tsn:cm:' + cid, JSON.stringify({ id: cid, storyId: sid, text: 'Count bound ' + i, at: now }));
    const z = new Map();
    z.set(cid, Math.floor(Date.now() / 1000) + 86400);
    s.z.set('tsn:cm:vis:' + sid, z);
  }
  const bounded = await call(C, { query: { ids: stories.join(',') } });
  assert.equal(Object.keys(bounded.body.counts).length, C.MAX_COUNT_STORIES);
  const cachedKeys = [...s.kv.keys()].filter(k => String(k).startsWith('tsn:cm:n:'));
  assert.equal(cachedKeys.length, C.MAX_COUNT_STORIES);

  const first = stories[0];
  const extra = 'cextra01';
  s.kv.set('tsn:cm:' + extra, JSON.stringify({ id: extra, storyId: first, text: 'After cache fill.', at: now }));
  s.z.get('tsn:cm:vis:' + first).set(extra, Math.floor(Date.now() / 1000) + 86400);
  const cached = await call(C, { query: { ids: first } });
  assert.equal(cached.body.counts[first], 1, 'count cache serves until dropCount');
  const { cookie } = await issue(C, { 'x-real-ip': '8.8.4.4' });
  const posted = await call(C, { method: 'POST', headers: Object.assign({ cookie, 'x-real-ip': '8.8.4.4' }, origin), body: { id: first, uid: 'reader-cc1', text: 'Invalidate the count cache.' } });
  assert.equal(posted.code, 200);
  const fresh = await call(C, { query: { ids: first } });
  assert.equal(fresh.body.counts[first], 3);
}));

test('ship119: GET ?ids= stops classifying once rec GETs would exceed MAX_COUNT_RECS', () => withStore(async (s, mod) => {
  const C = mod('_comments.js');
  const now = new Date().toISOString();
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const stories = [];
  for (let i = 0; i < 5; i++) {
    const sid = storyId('https://n.ex/recs-' + i);
    seedStory(s, sid, NEWS);
    stories.push(sid);
    const z = new Map();
    for (let j = 0; j < C.MAX_VIS; j++) {
      const cid = ('c' + i + 'r' + String(j).padStart(4, '0')).slice(0, 12);
      s.kv.set('tsn:cm:' + cid, JSON.stringify({ id: cid, storyId: sid, text: 'Rec ' + i + ' ' + j, at: now }));
      z.set(cid, exp + j);
    }
    s.z.set('tsn:cm:vis:' + sid, z);
  }
  const got = await call(C, { query: { ids: stories.join(',') } });
  const n = Object.keys(got.body.counts).length;
  assert.ok(n >= 1 && n < 5, 'rec budget omits later stories, got ' + n);
  assert.ok(n * C.MAX_VIS <= C.MAX_COUNT_RECS || n === Math.ceil(C.MAX_COUNT_RECS / C.MAX_VIS));
}));

test('ship119: malformed JSON is 400; prod legacy tsn_cm migrates; GET XSS-strips', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/json');
  seedStory(s, id, NEWS);
  const bad = await call(C, { method: 'POST', headers: origin, body: '{' });
  assert.equal(bad.code, 400);
  const csrf = await call(C, { method: 'POST', headers: { host: '127.0.0.1:3077', origin: 'https://evil.test' }, body: { action: 'ready' } });
  assert.equal(csrf.code, 403);
  const { token } = await issue(C, { 'x-real-ip': '5.5.5.70' });
  const prod = {
    host: 'www.tristatenow.com',
    origin: 'https://www.tristatenow.com',
    'x-forwarded-proto': 'https',
    'x-vercel-id': 'sfo1',
    'x-real-ip': '5.5.5.71',
    cookie: 'tsn_cm=' + token
  };
  const mig = await call(C, { method: 'POST', headers: Object.assign({}, origin, prod), body: { action: 'ready' } });
  assert.equal(mig.body.ready, true);
  assert.match(String(mig.headers['set-cookie']), /__Host-tsn_cm=/);
  const posted = await call(C, { method: 'POST', headers: Object.assign({}, origin, prod, { 'x-real-ip': '5.5.5.72' }), body: { id, uid: 'reader-leg1', text: '<script>alert(1)</script> river' } });
  assert.equal(posted.code, 200);
  assert.equal(posted.body.comment.text.includes('<'), false);
  const got = await call(C, { query: { id } });
  assert.ok(got.body.comments.every(c => !/[<>]/.test(c.text)));
}));
