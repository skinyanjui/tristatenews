'use strict';
// ship125: whole-word kill/stab/slay matching so violence headlines lose comments in UI and API.
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
  'Man killed in explosion at industrial plant',
  'Son stabs his mom during argument',
  'Woman slain outside a Henderson store',
  'Police investigate shooting on Lincoln Ave',
  'Murder charges filed after weekend fight',
  'Suspect kills neighbor during argument',
  'Teen stabbing leaves one in critical condition'
];

const KEEP = [
  'Killer deals on tires this weekend',
  'Pacers kill off the Heat in overtime',
  'Council passes riverfront plan',
  'Flu shot clinic opens Monday',
  'Shooting guard leads the Aces'
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
      case 'SADD': {
        const s = sets.has(k) ? sets.get(k) : new Set();
        a.forEach(x => s.add(x));
        sets.set(k, s);
        return { result: a.length };
      }
      case 'SMEMBERS': return { result: sets.has(k) ? [...sets.get(k)] : [] };
      case 'ZADD': {
        const m = z.has(k) ? z.get(k) : new Map();
        for (let i = 0; i < a.length; i += 2) m.set(a[i + 1], Number(a[i]));
        z.set(k, m);
        return { result: a.length / 2 };
      }
      case 'ZRANGE': return { result: z.has(k) ? [...z.get(k).entries()].sort((x, y) => x[1] - y[1]).map(x => x[0]) : [] };
      case 'ZREVRANGE': return { result: z.has(k) ? [...z.get(k).entries()].sort((x, y) => y[1] - x[1]).map(x => x[0]) : [] };
      case 'EXPIRE': return { result: 1 };
      case 'INCR': { const n = Number(kv.get(k) || 0) + 1; kv.set(k, String(n)); return { result: n }; }
      case 'LPUSH': { const arr = lists.has(k) ? lists.get(k) : []; arr.unshift(...a); lists.set(k, arr); return { result: arr.length }; }
      default: return { result: null };
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

test('ship125: kill/stab/slay headlines are crime; killer-deals and sports kill-off stay clear', () => {
  for (const t of BLOCK) {
    assert.equal(C.crimeTitle(t), true, t);
    assert.equal(crime.commentsBlocked({ kind: 'news', title: t }), true, t);
  }
  for (const t of KEEP) {
    assert.equal(C.crimeTitle(t), false, t);
    assert.equal(crime.commentsBlocked({ kind: 'news', title: t }), false, t);
  }
  // Ambiguous medical "stabbing pain" fails closed (err strict).
  assert.equal(C.crimeTitle('Patient reports stabbing pain in the chest'), true);
  // Inflections and whole-word boundaries.
  assert.equal(C.crimeTitle('Man kills neighbor'), true);
  assert.equal(C.crimeTitle('Killing under investigation'), true);
  assert.equal(C.crimeTitle('Son stabbed his mom'), true);
  assert.equal(C.crimeTitle('City establishes a new park'), false);
});

test('ship125: first-paint cards omit comments on kill/stab headlines', () => {
  const now = Date.parse('2026-11-11T18:00:00Z');
  const items = [
    { title: BLOCK[0], summary: '', link: 'https://n.ex/killed', image: 'https://img.ex/k.jpg', published: '2026-11-11T17:00:00Z', source: 'N', sourceId: 'n' },
    { title: BLOCK[1], summary: '', link: 'https://n.ex/stabs', image: 'https://img.ex/s.jpg', published: '2026-11-11T16:00:00Z', source: 'N', sourceId: 'n' },
    { title: KEEP[2], summary: 'A zoning vote.', link: 'https://n.ex/river', image: 'https://img.ex/r.jpg', published: '2026-11-11T15:00:00Z', source: 'N', sourceId: 'n' }
  ];
  const html = Cards.cards(Cards.pick({
    updatedAt: '2026-11-11T18:00:00Z',
    sources: [{ id: 'n', name: 'N', kind: 'news' }],
    items
  }, 'news', now), now);
  for (const t of [BLOCK[0], BLOCK[1]]) {
    const art = html.split('<article').filter(x => x.includes(t))[0];
    assert.ok(art, t);
    assert.doesNotMatch(art, /cm-btn/, t);
  }
  assert.match(html.split('<article').filter(x => x.includes('riverfront plan'))[0], /cm-btn/);
});

test('ship125: GET /api/comments allowed:false for kill/stab meta', () => withStore(async (s, mod) => {
  const Cm = mod('_comments.js');
  for (const title of [BLOCK[0], BLOCK[1]]) {
    const link = 'https://n.ex/' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const id = storyId(link);
    seedStory(s, id, { kind: 'news', title, summary: '', link, sourceId: 'n' });
    const got = await call(Cm, { query: { id } });
    assert.equal(got.body.configured, true, title);
    assert.equal(got.body.allowed, false, title);
  }
  const keepLink = 'https://n.ex/killer-deals';
  const keepId = storyId(keepLink);
  seedStory(s, keepId, { kind: 'news', title: KEEP[0], summary: '', link: keepLink, sourceId: 'n' });
  assert.equal((await call(Cm, { query: { id: keepId } })).body.allowed, true);
}));

test('ship125: shared matcher is wired through page, cards, and API', () => {
  assert.match(read('public/crime.js'), /kill\(\?:s\|ed\|ing\)\?/);
  assert.match(read('public/crime.js'), /stab\(\?:s\|bed\|bing\|bings\)\?/);
  assert.match(read('public/crime.js'), /slain/);
  assert.match(read('public/assets/lib.js'), /kill\(\?:s\|ed\|ing\)\?/);
  assert.match(read('public/assets/app.js'), /function crimeStory\(it\) \{ return CR \? CR\.crimeStory\(it\) : true; \}/);
  assert.equal(crime.CRIME_RE.source, C.CRIME_RE.source);
});
