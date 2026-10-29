// Ship 67: abuse limits (hearts, reports, signups, Stripe event claims), the shared client-IP helper, cacheable board
// reads, /api/news paging and the stale/missing snapshot behavior.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// A small in-memory Upstash /pipeline stand-in (only what these handlers use).
function fakeStore() {
  const kv = new Map(), sets = new Map(), z = new Map(), log = [];
  const run = ([c, k, ...a]) => {
    log.push([c, k, ...a]);
    switch (c) {
      case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
      case 'SET': { if (a.includes('NX') && (kv.has(k) || sets.has(k))) return { result: null }; kv.set(k, a[0]); return { result: 'OK' }; }
      case 'DEL': { const had = kv.delete(k) | sets.delete(k) | z.delete(k); return { result: had ? 1 : 0 }; }
      case 'INCR': { const n = (Number(kv.get(k)) || 0) + 1; kv.set(k, String(n)); return { result: n }; }
      case 'EXPIRE': return { result: 1 };
      case 'EXISTS': return { result: kv.has(k) || sets.has(k) || z.has(k) ? 1 : 0 };
      case 'SADD': { const s = sets.get(k) || new Set(); sets.set(k, s); let n = 0; a.forEach(x => { if (!s.has(x)) { s.add(x); n++; } }); return { result: n }; }
      case 'SREM': { const s = sets.get(k); let n = 0; if (s) a.forEach(x => { if (s.delete(x)) n++; }); return { result: n }; }
      case 'SCARD': return { result: (sets.get(k) || new Set()).size };
      case 'SISMEMBER': return { result: (sets.get(k) || new Set()).has(a[0]) ? 1 : 0 };
      case 'RENAME': { sets.set(a[0], sets.get(k)); sets.delete(k); return { result: 'OK' }; }
      case 'ZADD': { const m = z.get(k) || new Map(); z.set(k, m); m.set(a[1], Number(a[0])); return { result: 1 }; }
      case 'ZREM': { const m = z.get(k); let n = 0; if (m) a.forEach(x => { if (m.delete(x)) n++; }); return { result: n }; }
      case 'ZREVRANGE': { const m = z.get(k) || new Map(); const arr = [...m].sort((x, y) => y[1] - x[1]).slice(Number(a[0]), Number(a[1]) + 1); return { result: a.includes('WITHSCORES') ? arr.flatMap(([m2, s]) => [m2, String(s)]) : arr.map(x => x[0]) }; }
      case 'ZREVRANGEBYSCORE': { const m = z.get(k) || new Map(); const min = Number(String(a[1]).replace('(', '')); return { result: [...m].filter(x => x[1] > min).sort((x, y) => y[1] - x[1]).map(x => x[0]) }; }
      case 'ZRANGEBYSCORE': { const m = z.get(k) || new Map(); const min = Number(String(a[0]).replace('(', '')); return { result: [...m].filter(x => x[1] > min).sort((x, y) => x[1] - y[1]).map(x => x[0]) }; }
      case 'ZREMRANGEBYSCORE': return { result: 0 };
      default: throw new Error('fake store: ' + c);
    }
  };
  const fetch = async (url, init) => ({ ok: true, status: 200, json: async () => JSON.parse(init.body).map(run) });
  return { kv, sets, z, log, fetch };
}
const ENV = { KV_REST_API_URL: 'https://fake.store', KV_REST_API_TOKEN: 'fake', LISTINGS_ADMIN_KEY: 'admin-test-key' };
async function withStore(fn) {
  const saved = {}, store = fakeStore(), realFetch = globalThis.fetch;
  for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k]; }
  globalThis.fetch = store.fetch;
  const mods = Object.keys(require.cache).filter(k => k.startsWith(path.join(root, 'api')));
  mods.forEach(k => delete require.cache[k]);
  try { return await fn(store, name => require(path.join(root, 'api', name))); }
  finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(ENV)) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
    Object.keys(require.cache).filter(k => k.startsWith(path.join(root, 'api'))).forEach(k => delete require.cache[k]);
  }
}
function call(handler, req) {
  return new Promise(resolve => {
    const res = { headers: {}, code: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; },
      send(b) { let body = b; try { body = JSON.parse(b); } catch (_) {} resolve({ code: this.code, headers: this.headers, body }); }, json(o) { resolve({ code: this.code, headers: this.headers, body: o }); }, end() { resolve({ code: this.code, headers: this.headers }); } };
    Promise.resolve(handler(Object.assign({ method: 'GET', headers: {}, query: {}, url: '/' }, req), res)).catch(e => resolve({ code: 'threw', error: e }));
  });
}

test('client IP: x-real-ip, then x-vercel-forwarded-for, then the first x-forwarded-for; used by every limiter', () => {
  const { clientIp, ipHash } = require('../api/_ip.js');
  assert.equal(clientIp({ headers: { 'x-real-ip': '1.2.3.4', 'x-vercel-forwarded-for': '5.6.7.8', 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }), '1.2.3.4');
  assert.equal(clientIp({ headers: { 'x-vercel-forwarded-for': '5.6.7.8', 'x-forwarded-for': '9.9.9.9' } }), '5.6.7.8');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }), '9.9.9.9');
  assert.equal(clientIp({ headers: { 'x-real-ip': '<script>' } }), 'c');
  assert.equal(clientIp({}), '');
  assert.equal(ipHash('1.2.3.4', 'a'), ipHash('1.2.3.4', 'a')); assert.notEqual(ipHash('1.2.3.4', 'a'), ipHash('1.2.3.4', 'b'));
  assert.ok(!/1\.2\.3\.4/.test(ipHash('1.2.3.4', 'a')));
  for (const f of fs.readdirSync(path.join(root, 'api'))) if (f !== '_ip.js') assert.ok(!read('api/' + f).includes("headers['x-forwarded-for']"), f + ' uses api/_ip.js');
});

test('story ids: the server computes the same id as the page', () => {
  const src = read('public/assets/app.js'), m = /function storyId\(link\) \{[\s\S]*?\n  \}/.exec(src);
  const pageId = new Function(m[0] + '; return storyId;')();
  const { storyId, idsCmds, KEY } = require('../api/_storyid.js');
  for (const l of ['https://www.14news.com/2026/10/29/a/', 'https://x.org/?q=ü&z=1', '']) assert.equal(storyId(l), pageId(l), l);
  const cmds = idsCmds([{ link: 'https://a/1' }, { link: 'https://a/1' }, { link: 'https://a/2' }]);
  assert.deepEqual(cmds.map(c => c[0]), ['DEL', 'SADD', 'RENAME', 'EXPIRE']);
  assert.equal(cmds[1].length, 4, 'deduplicated'); assert.equal(cmds[2][2], KEY);
  assert.match(read('api/news.js'), /_storyid\.js'\)\.idsCmds\(snap\.items/);
});

test('hearts: only for current stories once the id set exists; un-heart always; per-IP daily cap', () => withStore(async (s, mod) => {
  const react = mod('react.js'), { storyId } = mod('_storyid.js');
  const good = storyId('https://www.14news.com/a'), other = storyId('https://elsewhere/b');
  const post = (id, liked, ip) => call(react, { method: 'POST', headers: { 'x-real-ip': ip || '1.1.1.1' }, body: { id, uid: 'reader-0001', liked } });
  assert.equal((await post(other, true)).code, 200, 'before the first refresh any well-formed id passes');
  s.sets.set('tsn:news:ids', new Set([good]));
  assert.equal((await post(good, true)).body.count, 1);
  const bad = await post(other, true);
  assert.deepEqual([bad.code, bad.body.error], [400, 'unknown story']);
  assert.equal((await post(other, false)).code, 200, 'removing a heart is always allowed');
  for (let i = 0; i < react.DAILY_PER_IP - 4; i++) await post(good, i % 2 === 0, '2.2.2.2');
  let last; for (let i = 0; i < 6; i++) last = await post(good, true, '2.2.2.2');
  assert.equal(last.code, 429);
  assert.equal((await post(good, true, '3.3.3.3')).code, 200, 'another IP is unaffected');
  assert.ok(![...s.kv.keys()].some(k => k.includes('2.2.2.2')), 'no raw IP in store keys');
}));

const LIST = (o) => JSON.stringify(Object.assign({ title: 'Couch', town: 'Evansville', desc: '', contact: '812-555-0142', uid: 'poster-0001', at: new Date().toISOString() }, o));
test('reports: hidden (not deleted) at 3 and queued; Featured never hidden; per-IP daily cap; admin restore', () => withStore(async (s, mod) => {
  const L = mod('listings.js'), now = Date.now();
  s.kv.set('tsn:ls:plain0001', LIST()); s.z.set('tsn:ls:index', new Map([['plain0001', now]]));
  s.kv.set('tsn:ls:feat00001', LIST({ featuredUntil: now + 864e5 })); s.z.get('tsn:ls:index').set('feat00001', now);
  const report = (id, ip) => call(L, { method: 'POST', headers: { 'x-real-ip': ip }, body: { action: 'report', id, uid: 'reader-0009' } });
  for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) { await report('plain0001', ip); await report('feat00001', ip); }
  const plain = JSON.parse(s.kv.get('tsn:ls:plain0001')), feat = JSON.parse(s.kv.get('tsn:ls:feat00001'));
  assert.equal(plain.hidden, true, 'hidden, still stored');
  assert.ok(!feat.hidden, 'Featured stays up');
  assert.ok(s.z.get('tsn:ls:review').has('plain0001') && s.z.get('tsn:ls:review').has('feat00001'));
  const pub = await call(L, { query: { kind: 'item' } });
  assert.deepEqual(pub.body.items.map(i => i.id), ['feat00001'], 'hidden post left off the board');
  assert.match(pub.headers['cache-control'], /s-maxage=30, stale-while-revalidate=120/);
  assert.ok(!s.log.some(c => c[0] === 'ZREMRANGEBYSCORE' && c[1] === 'tsn:ls:index' && s.log.indexOf(c) > s.log.length - 3), 'board read is read-only');
  // admin queue
  assert.equal((await call(L, { query: { review: '1' } })).code, 404);
  const q = await call(L, { query: { review: '1' }, headers: { 'x-admin-key': 'admin-test-key' } });
  assert.deepEqual(q.body.items.map(i => [i.id, i.hidden, i.featured]).sort(), [['feat00001', false, true], ['plain0001', true, false]]);
  assert.ok(q.body.items.every(i => !('uid' in i)), 'poster uid not shown');
  assert.equal((await call(L, { method: 'POST', headers: { 'x-admin-key': 'admin-test-key' }, body: { action: 'restore', id: 'plain0001' } })).body.restored, true);
  assert.ok(!JSON.parse(s.kv.get('tsn:ls:plain0001')).hidden && !s.z.get('tsn:ls:review').has('plain0001'));
  assert.equal((await call(L, { method: 'POST', body: { action: 'restore', id: 'plain0001' } })).code, 404, 'restore is admin only');
  // per-IP cap
  let r; for (let i = 0; i < 11; i++) r = await report('plain0001', '9.9.9.9');
  assert.equal(r.code, 429);
}));

test('board reads are cacheable and read-only; the refresh cron prunes every board index', () => {
  const L = read('api/listings.js');
  assert.ok(!/ZREMRANGEBYSCORE', INDEX, '-inf', String\(cutoff\)\], \[kind/.test(L));
  const { pruneCmds, indexFor } = require('../api/listings.js');
  assert.deepEqual(pruneCmds(Date.now()).map(c => c[1]).sort(), ['item', 'deal', 'event', 'job', 'obit'].map(indexFor).sort());
  assert.match(read('api/_refresh.js'), /pruneCmds\(Date\.now\(\)\)/);
  assert.match(read('public/admin.html'), /\/api\/listings\?review=1/);
});

test('newsletter: one confirmation per address per day, same answer either way', () => withStore(async (s, mod) => {
  const sub = mod('_subscribe.js');
  const ask = ip => call(sub, { method: 'POST', headers: { 'x-real-ip': ip }, body: { email: 'reader@example.com' } });
  const a = await ask('1.1.1.1'), b = await ask('2.2.2.2');
  assert.equal(a.code, 200); assert.deepEqual(b.body, a.body, 'the cooldown answer looks the same');
  assert.equal(s.log.filter(c => c[0] === 'ZADD' && c[1] === sub.K.pending).length, 1, 'one pending signup, one email');
  assert.equal(sub.EMAIL_COOLDOWN, 86400);
}));

test('Stripe: the event is claimed (SET NX) before processing, briefly; the claim is dropped on failure', () => {
  const w = read('api/stripe-webhook.js');
  assert.match(w, /\['SET', evKey, 'processing', 'NX', 'EX', String\(CLAIM_TTL\)\]/);
  assert.match(w, /if \(claimed\) \{ try \{ await pipeline\(\[\['DEL', claimed\]\]\)/);
  assert.match(w, /const CLAIM_TTL = 300;/);
  assert.ok(w.indexOf("'processing', 'NX'") < w.indexOf('await onSession'), 'claim first');
});

test('/api/news paging: every event and obituary, the newest NEWS_PAGE stories, ?before= for older; no isEvent/isObit', () => {
  const news = require('../api/news.js'), N = news.NEWS_PAGE;
  const t0 = Date.parse('2026-10-29T12:00:00Z');
  const sources = [{ id: 'n', kind: 'news' }, { id: 'o', kind: 'obits' }, { id: 'e', kind: 'events' }, { id: 'p', kind: 'police' }];
  const items = [];
  for (let i = 0; i < N + 50; i++) items.push({ id: 's' + i, link: 'l' + i, sourceId: i % 2 ? 'p' : 'n', published: new Date(t0 - i * 6e4).toISOString(), isEvent: false });
  for (let i = 0; i < 30; i++) items.push({ id: 'o' + i, sourceId: 'o', isObit: true, published: new Date(t0 - i * 864e5).toISOString() });
  for (let i = 0; i < 20; i++) items.push({ id: 'e' + i, sourceId: 'e', isEvent: true, published: new Date(t0 + i * 864e5).toISOString() });
  const first = news.page({ updatedAt: 'x', sources, items });
  assert.equal(first.items.filter(i => /^s/.test(i.id)).length, N);
  assert.equal(first.items.filter(i => /^o/.test(i.id)).length, 30); assert.equal(first.items.filter(i => /^e/.test(i.id)).length, 20);
  assert.ok(first.items.every(i => !('isEvent' in i) && !('isObit' in i)));
  assert.equal(first.more.before, items[N - 1].published);
  assert.ok(first.sources, 'first page keeps sources');
  const next = news.page({ updatedAt: 'x', sources, items }, first.more.before);
  assert.deepEqual(next.items.map(i => i.id), items.slice(N, N + 50).map(i => i.id));
  assert.ok(!next.more && !('sources' in next));
  assert.equal(news.page({ sources, items }, 'nope').error, 'before must be an ISO time');
  const small = news.page({ sources, items: items.slice(0, 5) });
  assert.ok(!('more' in small), 'no more key when everything fits');
});

test('/api/news: stale -> served at once, refreshed in the background; missing + locked -> 503 Retry-After; short cache (ship71)', () => {
  const src = read('api/news.js');
  assert.match(src, /if \(!snap && locked\) \{\s*res\.setHeader\('Cache-Control', 'no-store'\); res\.setHeader\('Retry-After', '15'\);/);
  assert.match(src, /else if \(!locked\) background\(refreshAll\(\{\}\)/);
  assert.match(src, /Symbol\.for\('@vercel\/request-context'\)/);
  assert.match(src, /res\.setHeader\('Cache-Control', NEWS_CACHE\)/);
  const news = require('../api/news.js');
  let ran = false; const p = Promise.resolve().then(() => { ran = true; });
  return news.background(p).then(() => assert.ok(ran));
});

test('the page pages in older stories at the end of News; still 8 functions', () => {
  const js = read('public/assets/app.js');
  assert.match(js, /function loadOlder\(\)/);
  assert.match(js, /'before=' \+ encodeURIComponent\(m\.before\)/);
  assert.match(js, /state\.cat === 'news' && state\.more && !state\.q\.trim\(\)/);
  assert.equal(fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
});
