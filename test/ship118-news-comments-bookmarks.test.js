'use strict';
// ship118: public news comments (report + admin queue, off on crime) and separate browser bookmarks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const API = path.join(root, 'api');
const js = read('public/assets/app.js');
const css = read('public/assets/app.css');
const admin = read('public/admin.html');
const vercel = JSON.parse(read('vercel.json'));
const { storyId, idsCmds, KEY, META } = require('../api/_storyid.js');
const crime = require('../api/_crime.js');

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
      case 'RENAME': { if (sets.has(k)) { sets.set(a[0], sets.get(k)); sets.delete(k); } if (kv.has(k)) { kv.set(a[0], kv.get(k)); kv.delete(k); } return { result: 'OK' }; }
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
      case 'LPUSH': { const l = lists.get(k) || []; a.forEach(x => l.unshift(String(x))); lists.set(k, l); return { result: l.length }; }
      case 'LTRIM': { const l = lists.get(k) || []; lists.set(k, l.slice(Number(a[0]), Number(a[1]) + 1)); return { result: 'OK' }; }
      case 'LRANGE': { const l = lists.get(k) || []; return { result: l.slice(Number(a[0]), Number(a[1]) + 1) }; }
      case 'LLEN': return { result: (lists.get(k) || []).length };
      default: throw new Error('fake store: ' + c);
    }
  };
  const fetch = async (url, init) => ({ ok: true, status: 200, json: async () => JSON.parse(init.body).map(run) });
  return { kv, sets, z, lists, log, fetch };
}
const ENV = { KV_REST_API_URL: 'https://fake.store', KV_REST_API_TOKEN: 'fake', LISTINGS_ADMIN_KEY: 'admin-test-key' };
async function withStore(fn, extraEnv) {
  const saved = {}, store = fakeStore(), realFetch = globalThis.fetch;
  const env = Object.assign({}, ENV, extraEnv || {});
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  globalThis.fetch = store.fetch;
  const mods = Object.keys(require.cache).filter(k => k.startsWith(path.join(root, 'api')));
  mods.forEach(k => delete require.cache[k]);
  try { return await fn(store, name => require(path.join(root, 'api', name))); }
  finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(env)) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
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
function seedStory(store, sid, meta) {
  const cur = store.sets.get(KEY) || new Set();
  cur.add(sid);
  store.sets.set(KEY, cur);
  const all = {}; try { Object.assign(all, JSON.parse(store.kv.get(META) || '{}')); } catch (_) {}
  all[sid] = meta;
  store.kv.set(META, JSON.stringify(all));
}
const NEWS = { kind: 'news', title: 'Council passes riverfront plan', sourceId: 'n' };

test('ship118: still 8 functions; /api/comments is hosted by react.js', () => {
  const fns = fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).sort();
  assert.deepEqual(fns, ['alerts.js', 'inbox.js', 'listings.js', 'news.js', 'newsletter.js', 'react.js', 'stripe-webhook.js', 'unsubscribe.js']);
  const rw = vercel.rewrites.find(r => r.source === '/api/comments');
  assert.equal(rw && rw.destination, '/api/react?__route=comments');
  assert.match(read('api/react.js'), /comments: \(\) => require\('\.\/_comments\.js'\)/);
  assert.match(read('server.js'), /app\.all\('\/api\/comments'/);
  assert.match(read('api/_comments.js'), /fail\('comments', e\)/);
});

test('ship118: CRIME_RE matches the page; unknown metadata fail closed', () => {
  const m = /var CRIME_RE = (\/\\b\(\?:[\s\S]*?\/i);/.exec(js);
  assert.ok(m, 'page CRIME_RE');
  assert.equal(String(crime.CRIME_RE), m[1]);
  assert.equal(crime.commentsBlocked(null), true);
  assert.equal(crime.commentsBlocked({}), true);
  assert.equal(crime.commentsBlocked({ kind: '', title: 'Riverfront plan' }), true);
  assert.equal(crime.commentsBlocked({ kind: 'police', title: 'Annual report' }), true);
  assert.equal(crime.commentsBlocked({ kind: 'courts', title: 'Docket for Monday' }), true);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Man arrested in Evansville' }), true);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Council passes riverfront plan' }), false);
  assert.equal(crime.commentsBlocked({ kind: 'institution', title: 'USI opens a lab' }), false);
  assert.equal(crime.crimeTitle('Shooting guard leads the Aces'), false);
});

const HOMICIDE = 'Woman allegedly killed by husband texted sister she was \u2018not good\u2019 days before her body was found';
test('ship118: homicide/DV headlines fail closed; weather/sports keep comments; stored reads stay empty', () => withStore(async (s, mod) => {
  const C = mod('_comments.js');
  assert.equal(crime.crimeTitle(HOMICIDE), true, 'live homicide headline');
  assert.equal(crime.commentsBlocked({ kind: 'news', title: HOMICIDE, sourceId: 'n' }), true);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Woman killed by husband in Henderson', sourceId: 'n' }), true);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Man kills his wife after argument, police say', sourceId: 'n' }), true);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: "Woman's body was found in a creek", sourceId: 'n' }), true);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Husband charged in domestic violence case', sourceId: 'n' }), true);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Man arrested downtown after overnight chase', sourceId: 'n' }), true);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Storm kills 3 in western Kentucky after overnight flooding', sourceId: 'n' }), false);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Heat wave deaths climb in the Ohio Valley', sourceId: 'n' }), false);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Pacers kill off the Heat in overtime', sourceId: 'n' }), false);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Shooting guard leads the Aces', sourceId: 'n' }), false);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Council passes riverfront plan', sourceId: 'n' }), false);
  const okFn = js.slice(js.indexOf('function commentsOk('), js.indexOf('function rememberOpener('));
  assert.doesNotMatch(okFn, /state\.cat/, 'commentsOk ignores client category');

  const Cards = require('../api/_cards.js');
  const html = Cards.cards(Cards.pick({
    updatedAt: '2026-11-08T22:00:00Z',
    sources: [{ id: 'n', name: 'N', kind: 'news' }],
    items: [{ title: HOMICIDE, summary: 'Fixture.', link: 'https://n.ex/homicide', image: 'https://img.ex/mug.jpg', published: '2026-11-08T21:00:00Z', source: 'N', sourceId: 'n' }]
  }, 'news', Date.parse('2026-11-08T22:00:00Z')), Date.parse('2026-11-08T22:00:00Z'));
  assert.match(html, /allegedly killed by husband/);
  assert.doesNotMatch(html, /cm-btn/);
  assert.doesNotMatch(html, /mug\.jpg|ns-pic/);

  const id = storyId('https://n.ex/homicide');
  seedStory(s, id, { kind: 'news', title: HOMICIDE, sourceId: 'n' });
  s.kv.set('tsn:cm:cpreexist01', JSON.stringify({ id: 'cpreexist01', storyId: id, text: 'should not leak', at: '2026-11-08T12:00:00Z' }));
  s.z.set('tsn:cm:vis:' + id, new Map([['cpreexist01', Math.floor(Date.now() / 1000) + 86400]]));
  const got = await call(C, { query: { id } });
  assert.equal(got.body.allowed, false);
  assert.deepEqual(got.body.comments, []);
  assert.equal(got.body.count, 0);
  const counts = await call(C, { query: { ids: id } });
  assert.ok(!counts.body.counts[id]);
  const post = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '8.8.8.8' }, origin), body: { id, uid: 'reader-0001', text: 'Hi river.', cat: 'news' } });
  assert.equal(post.code, 400);
  assert.match(String(post.body.error || ''), /comments off/i);
  assert.equal(s.kv.get('tsn:cm:cpreexist01') && JSON.parse(s.kv.get('tsn:cm:cpreexist01')).text, 'should not leak');
}));

test('ship118: idsCmds writes trusted meta from sources, not the client', () => {
  const cmds = idsCmds(
    [{ link: 'https://n.ex/a', title: 'Riverfront', sourceId: 'n' }, { link: 'https://n.ex/a', title: 'Riverfront', sourceId: 'n' }, { link: 'https://p.ex/b', title: 'Arrest made', sourceId: 'p' }],
    100,
    [{ id: 'n', kind: 'news' }, { id: 'p', kind: 'police' }]
  );
  assert.deepEqual(cmds.map(c => c[0]), ['DEL', 'SADD', 'RENAME', 'EXPIRE', 'SET']);
  assert.equal(cmds[2][2], KEY);
  assert.equal(cmds[4][1], META);
  const meta = JSON.parse(cmds[4][2]);
  assert.equal(meta[storyId('https://n.ex/a')].kind, 'news');
  assert.equal(meta[storyId('https://p.ex/b')].kind, 'police');
  assert.match(read('api/news.js'), /idsCmds\(snap\.items, 2 \* 86400, snap\.sources\)/);
});

test('ship118: no store → configured false, no private fallback', async () => {
  for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
  Object.keys(require.cache).filter(k => k.startsWith(path.join(root, 'api'))).forEach(k => delete require.cache[k]);
  const h = require('../api/_comments.js');
  const r = await call(h, { query: { id: storyId('https://n.ex/a') } });
  assert.equal(r.body.configured, false);
  assert.equal(r.body.allowed, false);
  assert.deepEqual(r.body.comments, []);
});

test('ship118: allowlist, crime, unknown, expired, XSS, links, CSRF, size, method', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), good = storyId('https://n.ex/good');
  const crimeId = storyId('https://n.ex/crime'), policeId = storyId('https://p.ex/p'), other = storyId('https://gone.ex/x');
  seedStory(s, good, NEWS);
  seedStory(s, crimeId, { kind: 'news', title: 'Man arrested downtown', sourceId: 'n' });
  seedStory(s, policeId, { kind: 'police', title: 'Annual report published', sourceId: 'p' });
  const post = (body, hdr) => call(C, { method: 'POST', url: '/api/comments', headers: Object.assign({ 'x-real-ip': '1.1.1.1' }, origin, hdr || {}), body });
  assert.equal((await post({ id: good, uid: 'reader-0001', text: 'Nice work.' }, { origin: '' })).code, 403, 'no origin');
  assert.equal((await post({ id: good, uid: 'reader-0001', text: 'Nice work.' }, { origin: 'https://evil.test', host: '127.0.0.1:3077' })).code, 403);
  assert.equal((await call(C, { method: 'PUT', headers: origin, body: {} })).code, 405);
  const unknown = await post({ id: other, uid: 'reader-0001', text: 'Hi' });
  assert.deepEqual([unknown.code, unknown.body.error], [400, 'unknown story']);
  const cr = await post({ id: crimeId, uid: 'reader-0001', text: 'Hi' });
  assert.deepEqual([cr.code, cr.body.error], [400, 'comments off']);
  const pol = await post({ id: policeId, uid: 'reader-0001', text: 'Hi' });
  assert.deepEqual([pol.code, pol.body.error], [400, 'comments off']);
  const link = await post({ id: good, uid: 'reader-0001', text: 'see https://evil.com' });
  assert.equal(link.code, 400);
  assert.equal((await post({ id: good, uid: 'reader-0001', text: 'see example.co/x' })).code, 400);
  assert.equal((await post({ id: good, uid: 'reader-0001', text: 'bit.ly/abcd' })).code, 400);
  assert.equal((await post({ id: good, uid: 'reader-0001', text: 't.co/x9' })).code, 400);
  const prose = await post({ id: good, uid: 'reader-0001', text: 'Meet on U.S. 41 near Mr. Smith.' });
  assert.equal(prose.code, 200, 'prose with initials is not a link');
  const xss = await post({ id: good, uid: 'reader-0001', text: '<script>alert(1)</script> hello' });
  assert.equal(xss.code, 200);
  assert.equal(xss.body.comment.text.includes('<'), false);
  assert.ok(!xss.body.comment.uid);
  const stored = JSON.parse(s.kv.get('tsn:cm:' + xss.body.comment.id));
  assert.ok(!('uid' in stored), 'browser id is not stored on the comment');
  const ok = await post({ id: good, uid: 'reader-0001', text: 'The riverfront looks great.' });
  assert.equal(ok.code, 200);
  const got = await call(C, { query: { id: good } });
  assert.equal(got.body.allowed, true);
  assert.ok(got.body.comments.every(c => !('uid' in c) && !/[<>]/.test(c.text)));
  assert.ok(got.body.comments.some(c => /hello/i.test(c.text)));
  const crimeGet = await call(C, { query: { id: crimeId } });
  assert.equal(crimeGet.body.allowed, false);
  assert.deepEqual(crimeGet.body.comments, []);
  const raw = JSON.stringify({ id: good, uid: 'reader-0001', text: 'x'.repeat(5000) });
  const big = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '1.1.1.1' }, origin), body: raw });
  assert.ok(big.code === 413 || big.code === 400);
  assert.ok(!s.log.some(c => String(c).includes('1.1.1.1')), 'no raw IP in commands');
  assert.ok(!JSON.stringify([...s.kv.keys(), ...s.sets.keys()]).includes('1.1.1.1'));
}));

test('ship118: classification change hides stored comments; counts skip blocked ids', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/flip');
  seedStory(s, id, NEWS);
  const post = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '8.8.8.8' }, origin), body: { id, uid: 'reader-0001', text: 'Was fine.' } });
  assert.equal(post.code, 200);
  const all = JSON.parse(s.kv.get(META));
  all[id] = { kind: 'news', title: 'Suspect arrested overnight', sourceId: 'n' };
  s.kv.set(META, JSON.stringify(all));
  const got = await call(C, { query: { id } });
  assert.equal(got.body.allowed, false);
  assert.deepEqual(got.body.comments, []);
  const counts = await call(C, { query: { ids: id } });
  assert.ok(!counts.body.counts[id]);
}));

test('ship118: rate limits uid+IP; report unique-IP hide; admin restore/delete; wrong key 404', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/rl');
  seedStory(s, id, NEWS);
  const post = (uid, ip, text) => call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': ip }, origin), body: { id, uid, text: text || 'A comment about the river.' } });
  for (let i = 0; i < C.STORY_PER_IP; i++) assert.equal((await post('reader-000' + i, '9.9.9.9', 'Comment number ' + i)).code, 200);
  assert.equal((await post('reader-0099', '9.9.9.9', 'One more')).code, 429);
  assert.equal((await post('reader-0099', '8.8.8.8', 'Other IP')).code, 200);
  const thread = await call(C, { query: { id } });
  const cid = thread.body.comments[0].id;
  const report = (ip) => call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': ip }, origin), body: { action: 'report', id: cid, uid: 'reporter01' } });
  assert.equal((await report('1.1.1.1')).code, 200);
  assert.equal((await report('1.1.1.1')).code, 200, 'same IP does not extra-count');
  await report('2.2.2.2');
  await report('3.3.3.3');
  const hidden = await call(C, { query: { id } });
  assert.ok(!hidden.body.comments.some(c => c.id === cid));
  assert.equal((await call(C, { query: { review: '1' } })).code, 404);
  assert.equal((await call(C, { query: { review: '1' }, headers: { 'x-admin-key': 'nope' } })).code, 404);
  const q = await call(C, { query: { review: '1' }, headers: { 'x-admin-key': 'admin-test-key' } });
  assert.equal(q.code, 200);
  assert.ok(q.body.items.some(x => x.id === cid && x.hidden && !('uid' in x)));
  const rest = await call(C, { method: 'POST', headers: Object.assign({ 'x-admin-key': 'admin-test-key' }, origin), body: { action: 'restore', id: cid } });
  assert.equal(rest.body.restored, true);
  const back = await call(C, { query: { id } });
  assert.ok(back.body.comments.some(c => c.id === cid));
  await call(C, { method: 'POST', headers: Object.assign({ 'x-admin-key': 'admin-test-key' }, origin), body: { action: 'delete', id: cid } });
  const gone = await call(C, { query: { id } });
  assert.ok(!gone.body.comments.some(c => c.id === cid));
}));

test('ship118: degraded store fail closed; concurrent reports hide once', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/deg');
  seedStory(s, id, NEWS);
  const posted = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '4.4.4.4' }, origin), body: { id, uid: 'reader-0001', text: 'Hello river.' } });
  assert.equal(posted.code, 200);
  const cid = posted.body.comment.id;
  const real = s.fetch;
  s.fetch = async () => { throw new Error('down'); };
  globalThis.fetch = s.fetch;
  const bad = await call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': '4.4.4.4' }, origin), body: { id, uid: 'reader-0001', text: 'Again.' } });
  assert.ok(bad.code === 502 || bad.code === 'threw' || (bad.body && bad.body.configured === false));
  s.fetch = real; globalThis.fetch = real;
  await Promise.all(['1.1.1.1', '2.2.2.2', '3.3.3.3'].map(ip => call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': ip }, origin), body: { action: 'report', id: cid, uid: 'reporter01' } })));
  const q = await call(C, { query: { review: '1' }, headers: { 'x-admin-key': 'admin-test-key' } });
  assert.equal(q.body.items.filter(x => x.id === cid).length, 1);
  const after = await call(C, { query: { id } });
  assert.equal(after.body.total, 0);
  assert.equal(after.body.count, 0);
  assert.ok(!after.body.comments.some(c => c.id === cid));
}));

test('ship118: hasLink catches short hosts; EVAL is used for vis transitions', () => {
  const C = require('../api/_comments.js');
  const src = read('api/_comments.js');
  assert.equal(C.hasLink('https://evil.test/x'), true);
  assert.equal(C.hasLink('www.example.com'), true);
  assert.equal(C.hasLink('example.co/path'), true);
  assert.equal(C.hasLink('bit.ly/x'), true);
  assert.equal(C.hasLink('The riverfront looks great.'), false);
  assert.equal(C.hasLink('Meet Mr. Smith on U.S. 41.'), false);
  assert.match(src, /EVAL/);
  assert.match(src, /tsn:cm:vis:/);
  assert.equal(src.includes('visCount'), false);
});

test('ship118: concurrent reports decrement once; post+restore keep both; delete+restore cannot ghost', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/atom');
  seedStory(s, id, NEWS);
  const post = (uid, ip, text) => call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': ip }, origin), body: { id, uid, text } });
  const a = await post('reader-a01', '1.1.1.1', 'First live comment.');
  const b = await post('reader-b01', '1.1.1.2', 'Second live comment.');
  assert.equal(a.code, 200); assert.equal(b.code, 200);
  const cidA = a.body.comment.id, cidB = b.body.comment.id;
  await Promise.all(['8.8.8.1', '8.8.8.2', '8.8.8.3'].map(ip => call(C, { method: 'POST', headers: Object.assign({ 'x-real-ip': ip }, origin), body: { action: 'report', id: cidA, uid: 'reporter01' } })));
  const hid = await call(C, { query: { id } });
  assert.equal(hid.body.total, 1);
  assert.equal(hid.body.count, 1);
  assert.ok(hid.body.comments.some(c => c.id === cidB));
  assert.ok(!hid.body.comments.some(c => c.id === cidA));
  const vis = s.z.get('tsn:cm:vis:' + id) || new Map();
  assert.equal(vis.size, 1);

  const rest = call(C, { method: 'POST', headers: Object.assign({ 'x-admin-key': 'admin-test-key' }, origin), body: { action: 'restore', id: cidA } });
  const extra = post('reader-c01', '1.1.1.3', 'Posted during restore.');
  const both = await Promise.all([rest, extra]);
  assert.equal(both[0].body.restored, true);
  assert.equal(both[1].code, 200);
  const live = await call(C, { query: { id } });
  assert.equal(live.body.total, 3);
  assert.equal(live.body.count, 3);

  const cidC = both[1].body.comment.id;
  const del = call(C, { method: 'POST', headers: Object.assign({ 'x-admin-key': 'admin-test-key' }, origin), body: { action: 'delete', id: cidC } });
  const rest2 = call(C, { method: 'POST', headers: Object.assign({ 'x-admin-key': 'admin-test-key' }, origin), body: { action: 'restore', id: cidC } });
  await Promise.all([del, rest2]);
  const end = await call(C, { query: { id } });
  assert.ok(end.body.total >= 2);
  assert.equal(end.body.total, end.body.comments.length);
  assert.ok(!end.body.comments.some(c => c.id === cidC && !s.kv.get('tsn:cm:' + cidC)));
  const vis2 = s.z.get('tsn:cm:vis:' + id) || new Map();
  for (const cid of vis2.keys()) {
    assert.ok(s.kv.get('tsn:cm:' + cid), 'visible index has no ghost ' + cid);
  }
}));

test('ship118: live visible count is capped and pruned; thread total is X of Y', () => withStore(async (s, mod) => {
  const C = mod('_comments.js'), id = storyId('https://n.ex/page');
  seedStory(s, id, NEWS);
  const post = (i) => call(C, {
    method: 'POST',
    headers: Object.assign({ 'x-real-ip': '10.0.' + Math.floor(i / 8) + '.' + (i % 8) }, origin),
    body: { id, uid: 'reader-' + String(i).padStart(4, '0'), text: 'River comment number ' + i + '.' }
  });
  for (let i = 0; i < 25; i++) assert.equal((await post(i)).code, 200);
  const page = await call(C, { query: { id } });
  assert.equal(page.body.comments.length, 20);
  assert.equal(page.body.total, 25);
  assert.equal(page.body.count, 25);
  const page2 = await call(C, { query: { id, offset: '20' } });
  assert.equal(page2.body.comments.length, 5);
  assert.equal(page2.body.total, 25);
  s.z.get('tsn:cm:vis:' + id).set('cexpired01', Math.floor(Date.now() / 1000) - 10);
  const pruned = await call(C, { query: { id } });
  assert.equal(pruned.body.total, 25);
  assert.ok(!pruned.body.comments.some(c => c.id === 'cexpired01'));
  for (let i = 25; i < 205; i++) assert.equal((await post(i)).code, 200, 'post ' + i);
  const capped = await call(C, { query: { id } });
  assert.equal(capped.body.total, 200);
  assert.equal(capped.body.comments.length, 20);
  assert.equal(capped.body.count, 200);
}));

test('ship118: news cards/sheet have distinct save and comment; hearts use tsn.liked; crime has no comment', () => {
  const mk = js.slice(js.indexOf('function makeCard('), js.indexOf('function obitRow('));
  const st = js.slice(js.indexOf('function storySheet('), js.indexOf('function hostName('));
  assert.match(js, /tsn\.liked/);
  assert.match(js, /function persistSaved\(\)/);
  assert.match(js, /return true;[\s\S]*catch[\s\S]*return false;/);
  assert.match(js, /if \(!persistSaved\(\)\)/);
  assert.match(js, /if \(!persistLiked\(\)\)/);
  assert.match(js, /function isLiked\(/);
  assert.match(js, /function toggleLiked\(/);
  assert.match(js, /className = 'sv-btn'|el\('button', 'sv-btn'\)/);
  assert.match(js, /className = 'cm-btn'|el\('button', 'cm-btn'\)/);
  assert.match(mk, /newsActs\(/);
  assert.match(st, /newsActs\(/);
  assert.match(js, /aria-pressed/);
  assert.ok(!/toggleLiked\([\s\S]{0,80}tsn\.saved/.test(js));
  assert.match(js, /fetch\('\/api\/react'/);
  assert.ok(!/fetch\('\/api\/react'[\s\S]{0,200}liked: isSaved/.test(js));
  assert.match(js, /commentsOk\(/);
  assert.match(js, /dialog', 'cm-sheet'|el\('dialog', 'cm-sheet'\)/);
  assert.match(js, /dialog', 'sv-sheet'|el\('dialog', 'sv-sheet'\)/);
  assert.match(js, /textContent/);
  assert.match(js, /function restoreOpener\(/);
  assert.match(js, /function rememberOpener\(/);
  assert.match(js, /if \(!o\.ok\)/);
  assert.match(js, /Showing ' \+ shown \+ ' of '/);
  assert.match(js, /cm-more/);
  assert.match(js, /function savedPic\(/);
  assert.match(js, /image: savedPic\(it\)/);
  assert.match(js, /function scrubSavedPics\(/);
  const sv = js.slice(js.indexOf('function savedSheet('), js.indexOf('function storySheet('));
  assert.match(sv, /savedPic\(/);
  assert.match(sv, /sv-pic/);
  assert.match(css, /\.sv-btn/);
  assert.match(css, /\.cm-btn/);
  assert.match(css, /\.news-story \.ns-foot :is\(\.like, \.share, \.cm-btn, \.sv-btn\)|\.ns-foot :is\(\.like, \.share, \.cm-btn, \.sv-btn\)/);
  const job = js.slice(js.indexOf('function jobCard('), js.indexOf('function dealCard('));
  assert.ok(!/cm-btn|sv-btn/.test(job));
});

test('ship118: admin Reported comments is reachable with the existing key field; no secret in UI', () => {
  assert.match(admin, /id="cmh"/);
  assert.match(admin, /Reported comments/);
  assert.match(admin, /\/api\/comments\?review=1/);
  assert.match(admin, /action: 'restore'/);
  assert.match(admin, /\/api\/comments/);
  assert.ok(!/LISTINGS_ADMIN_KEY\s*=/.test(admin));
  assert.ok(!/admin-test-key/.test(admin));
  assert.match(admin, /loadComments|\/api\/comments\?review=1/);
});
