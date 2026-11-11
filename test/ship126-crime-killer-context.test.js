'use strict';
// ship126: standalone killer/killers only trip comments when crime context is also present.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const crime = require('../api/_crime.js');
const C = require('../public/crime.js');
const { storyId, KEY, META } = require('../api/_storyid.js');
const Cards = require('../api/_cards.js');

const BLOCK = [
  'Police search for serial killer',
  'The killer fled',
  'Jury convicts killer in 2019 case',
  'Sheriff says killers remain at large',
  'Victim identifies the killer in court'
];

const KEEP = [
  'Killer deals this weekend',
  'Killer deals on tires this weekend',
  'Band delivers a killer performance',
  'Startup ships a killer app',
  'Condo boasts a killer view',
  'Pacers kill off the Heat in overtime',
  'Council passes riverfront plan'
];

function fakeStore() {
  const kv = new Map(), sets = new Map(), z = new Map(), lists = new Map(), log = [];
  const run = ([c, k, ...a]) => {
    log.push([c, k, ...a]);
    switch (c) {
      case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
      case 'SET': { kv.set(k, a[0]); return { result: 'OK' }; }
      case 'DEL': { const had = kv.delete(k) | sets.delete(k) | z.delete(k) | lists.delete(k); return { result: had ? 1 : 0 }; }
      case 'EXISTS': return { result: kv.has(k) || sets.has(k) || z.has(k) || lists.has(k) ? 1 : 0 };
      case 'SADD': { const s = sets.get(k) || new Set(); sets.set(k, s); a.forEach(x => s.add(x)); return { result: 1 }; }
      case 'SMEMBERS': return { result: [...(sets.get(k) || new Set())] };
      case 'SISMEMBER': return { result: (sets.get(k) || new Set()).has(a[0]) ? 1 : 0 };
      case 'RENAME': { if (sets.has(k)) { sets.set(a[0], sets.get(k)); sets.delete(k); } if (kv.has(k)) { kv.set(a[0], kv.get(k)); kv.delete(k); } return { result: 'OK' }; }
      case 'EXPIRE': return { result: 1 };
      case 'ZREVRANGE': return { result: [] };
      case 'ZREMRANGEBYSCORE': return { result: 0 };
      case 'ZCARD': return { result: 0 };
      default: throw new Error('fake store: ' + c);
    }
  };
  const fetch = async (url, init) => ({ ok: true, status: 200, json: async () => JSON.parse(init.body).map(run) });
  return { kv, sets, z, lists, log, fetch };
}
async function withStore(fn) {
  const saved = {}, store = fakeStore(), realFetch = globalThis.fetch;
  const env = { KV_REST_API_URL: 'https://fake.store', KV_REST_API_TOKEN: 'fake' };
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  globalThis.fetch = store.fetch;
  Object.keys(require.cache).filter(k => k.startsWith(path.join(root, 'api'))).forEach(k => delete require.cache[k]);
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
function seedStory(store, sid, meta) {
  const cur = store.sets.get(KEY) || new Set();
  cur.add(sid);
  store.sets.set(KEY, cur);
  const all = {}; try { Object.assign(all, JSON.parse(store.kv.get(META) || '{}')); } catch (_) {}
  all[sid] = meta;
  store.kv.set(META, JSON.stringify(all));
}

test('ship126: killer needs crime context; slang and allowlists stay clear', () => {
  for (const t of BLOCK) {
    assert.equal(C.crimeTitle(t), true, t);
    assert.equal(crime.commentsBlocked({ kind: 'news', title: t }), true, t);
  }
  for (const t of KEEP) {
    assert.equal(C.crimeTitle(t), false, t);
    assert.equal(crime.commentsBlocked({ kind: 'news', title: t }), false, t);
  }
  // Context can sit in the summary while killer is in the title.
  assert.equal(C.crimeStory({
    title: 'Residents describe the killer',
    summary: 'Police ask anyone with information to call the tip line.'
  }), true);
  assert.equal(C.crimeStory({
    title: 'A killer night for the Aces',
    summary: 'Fans packed the arena for a home win.'
  }), false);
});

test('ship126: first-paint cards omit comments on contextual killer headlines', () => {
  const now = Date.parse('2026-11-11T20:00:00Z');
  const items = [
    { title: BLOCK[0], summary: '', link: 'https://n.ex/serial-killer', image: 'https://img.ex/k.jpg', published: '2026-11-11T19:00:00Z', source: 'N', sourceId: 'n' },
    { title: KEEP[2], summary: '', link: 'https://n.ex/performance', image: 'https://img.ex/p.jpg', published: '2026-11-11T18:00:00Z', source: 'N', sourceId: 'n' }
  ];
  const html = Cards.cards(Cards.pick({
    updatedAt: '2026-11-11T20:00:00Z',
    sources: [{ id: 'n', name: 'N', kind: 'news' }],
    items
  }, 'news', now), now);
  const blocked = html.split('<article').filter(x => x.includes('serial killer'))[0];
  assert.ok(blocked);
  assert.doesNotMatch(blocked, /cm-btn/);
  const allowed = html.split('<article').filter(x => x.includes('killer performance'))[0];
  assert.ok(allowed);
  assert.match(allowed, /cm-btn/);
});

test('ship126: GET /api/comments follows the same killer-context rule', () => withStore(async (s, mod) => {
  const Cm = mod('_comments.js');
  const badLink = 'https://n.ex/serial-killer';
  const badId = storyId(badLink);
  seedStory(s, badId, { kind: 'news', title: BLOCK[0], summary: '', link: badLink, sourceId: 'n' });
  assert.equal((await call(Cm, { query: { id: badId } })).body.allowed, false);

  const okLink = 'https://n.ex/killer-performance';
  const okId = storyId(okLink);
  seedStory(s, okId, { kind: 'news', title: KEEP[2], summary: '', link: okLink, sourceId: 'n' });
  assert.equal((await call(Cm, { query: { id: okId } })).body.allowed, true);
}));

test('ship126: shared matcher exports and lib bundle stay in sync', () => {
  assert.match(read('public/crime.js'), /KILLER_RE/);
  assert.match(read('public/crime.js'), /KILLER_CTX_RE/);
  assert.match(read('public/crime.js'), /KILLER_RE\.test\(soft\) && KILLER_CTX_RE\.test\(soft\)/);
  assert.match(read('public/assets/lib.js'), /KILLER_RE\.test\(soft\) && KILLER_CTX_RE\.test\(soft\)/);
  assert.equal(crime.KILLER_RE.source, C.KILLER_RE.source);
  assert.equal(crime.KILLER_CTX_RE.source, C.KILLER_CTX_RE.source);
});
