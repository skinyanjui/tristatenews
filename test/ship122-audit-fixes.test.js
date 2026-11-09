'use strict';
// ship122: social/psychological design audit — obituaries, ad adjacency, comment norms,
// PII/accusation filter, report reasons, tragedy clustering, utility pages, empty boards,
// end-of-deck, readability, borderless reactions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const O = require('../public/obit.js');
const T = require('../public/tragedy.js');
const U = require('../public/utility.js');
const CL = require('../public/cluster.js');
const F = require('../api/_cmfilter.js');
const crime = require('../api/_crime.js');
const A = require('../public/adslots.js');
const Cards = require('../api/_cards.js');
const { storyId, KEY, META } = require('../api/_storyid.js');

const MORRIS = {
  title: 'Marilyn Kay Morris, age 73, of Montgomery, TX (formerly of McLeansboro)',
  summary: 'Marilyn Kay Morris, age 73, of Montgomery, TX (formerly of McLeansboro), passed away.',
  link: 'https://news.google.com/rss/articles/obituary-morris',
  source: 'Hamilton County news',
  sourceId: 'gn-hamilton',
  kind: 'news'
};

test('ship122: still 8 functions; shared obit/tragedy/utility/cluster modules wired', () => {
  const fns = fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_')).sort();
  assert.deepEqual(fns, ['alerts.js', 'inbox.js', 'listings.js', 'news.js', 'newsletter.js', 'react.js', 'stripe-webhook.js', 'unsubscribe.js']);
  const build = read('scripts/build-assets.js');
  for (const f of ['obit.js', 'tragedy.js', 'utility.js', 'cluster.js']) {
    assert.match(build, new RegExp("'" + f + "'"));
    assert.match(read('package.json'), new RegExp('public/' + f.replace('.', '\\.')));
    assert.match(read('vercel.json'), new RegExp(f.replace('.', '\\.')));
  }
  assert.match(read('api/_crime.js'), /require\('\.\.\/public\/obit\.js'\)/);
  assert.match(read('public/assets/app.js'), /window\.TSNObit/);
  assert.match(read('public/assets/app.js'), /window\.TSNTragedy/);
  assert.match(read('public/assets/app.js'), /window\.TSNCluster/);
  assert.match(read('public/assets/app.js'), /window\.TSNUtility/);
});

test('ship122: Marilyn Kay Morris and obituary patterns fail closed for comments and photos', () => {
  assert.equal(O.obitStory(MORRIS), true);
  assert.equal(O.obitTitle(MORRIS.title), true);
  assert.equal(crime.commentsBlocked({
    kind: 'news', title: MORRIS.title, summary: MORRIS.summary, link: MORRIS.link, sourceId: MORRIS.sourceId
  }), true);
  assert.equal(crime.obitStory({ title: 'Council passes riverfront plan' }), false);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Council passes riverfront plan' }), false);
  assert.equal(O.obitStory({ title: 'Local news brief', link: 'https://paper.example/obituaries/jane-doe' }), true);
  // Strong text "obituary" still trips; a lone memorial phrase without a second hint does not.
  assert.equal(O.obitStory({ title: 'Obituary: Sam Rivera of Evansville' }), true);
  assert.equal(O.obitStory({ title: 'Jane Doe funeral visitation set Saturday' }), true);
  assert.equal(O.obitStory({ title: 'Celebration of life set for Friday' }), false);
  const js = read('public/assets/app.js');
  assert.match(js, /function obitStory\(it\)/);
  assert.match(js, /crimeStory\(it\) \|\| obitStory\(it\)/);
  assert.match(js, /if \(crimeStory\(it\) \|\| obitStory\(it\)\) return false;/);
});

test('ship122: obit detector does not trip on weak hints alone', () => {
  for (const title of [
    'New policy requires age 18 and older to attend',
    'Voters must be age 21 to purchase cannabis',
    'Funeral home fire destroys historic building',
    'School sets visitation day for incoming freshmen',
    'The plant, formerly of Evansville, is relocating'
  ]) {
    assert.equal(O.obitStory({ title }), false, title);
    assert.equal(crime.commentsBlocked({ kind: 'news', title }), false, title);
  }
  // Marilyn Kay Morris (gn-hamilton news kind) still detected via name+age.
  assert.equal(O.obitStory(MORRIS), true);
  assert.equal(O.obitStory({
    title: 'Community calendar',
    summary: 'Visitation and funeral for Mary Ellen Brooks of Princeton are Saturday.'
  }), true);
});

test('ship122: first-paint cards omit comments and photos on news-feed obituaries', () => {
  const now = Date.parse('2026-11-09T22:00:00Z');
  const html = Cards.cards(Cards.pick({
    updatedAt: '2026-11-09T22:00:00Z',
    sources: [{ id: 'gn-hamilton', name: 'Hamilton County', kind: 'news' }, { id: 'n', name: 'N', kind: 'news' }],
    items: [
      { title: MORRIS.title, summary: MORRIS.summary, link: 'https://n.ex/morris', image: 'https://img.ex/m.jpg', published: '2026-11-09T21:00:00Z', source: 'Hamilton County', sourceId: 'gn-hamilton' },
      { title: 'Council passes riverfront plan', summary: 'A zoning vote.', link: 'https://n.ex/river', image: 'https://img.ex/r.jpg', published: '2026-11-09T20:00:00Z', source: 'N', sourceId: 'n' }
    ]
  }, 'news', now), now);
  const art = html.split('<article').filter(x => x.includes('Marilyn Kay Morris'))[0];
  assert.ok(art);
  assert.doesNotMatch(art, /cm-btn/);
  assert.doesNotMatch(art, /ns-pic|img\.ex\/m/);
  assert.match(html.split('<article').filter(x => x.includes('riverfront plan'))[0], /cm-btn/);
});

test('ship122: newsSlots shifts past crime, obituary, and death/tragedy neighbors', () => {
  const none = n => Array(n).fill(false);
  const f = none(30);
  f[5] = true; // sensitive before slot 6
  assert.equal(A.newsSlots(f, 6)[0], 7);
  assert.match(read('public/assets/app.js'), /feedSensitive\(it\)/);
  assert.match(read('public/adslots.js'), /crime, obituary, or death\/tragedy/);
  assert.equal(T.deathTitle("Witnesses say the crash victims were local"), true);
  assert.equal(T.deathTitle('Council passes riverfront plan'), false);
  assert.equal(T.deathTitle('Pacers kill off the Heat in overtime'), false);
});

test('ship122: comment norms and browser-delete note in the composer', () => {
  const js = read('public/assets/app.js');
  assert.match(js, /cm-norms/);
  assert.match(js, /Comments are public and anonymous/);
  assert.match(js, /must be 18 or older/);
  assert.match(js, /Naming a private person as a criminal/);
  assert.match(js, /legalA\.href = '\/legal'/);
  assert.match(js, /Only this browser can delete its comments/);
  assert.match(read('public/assets/app.css'), /\.cm-norms/);
});

test('ship122: PII rejects; accusations hold; false positives stay ok', () => {
  assert.equal(F.VERSION, 4);
  assert.equal(F.classify('Call me at 812-555-1212 tonight').action, 'reject');
  assert.equal(F.classify('Call me at 812-555-1212 tonight').rule, 'pii');
  assert.equal(F.classify('Email jane.doe@example.com for details').action, 'reject');
  assert.equal(F.classify('He lives at 123 Main Street in Evansville').action, 'reject');
  assert.equal(F.classify('John is a thief').action, 'hold');
  assert.equal(F.classify('John is a thief').rule, 'accusation');
  assert.equal(F.classify('I know who did it, it was Mike').action, 'hold');
  assert.equal(F.classify('She is a pedophile').action, 'hold');
  assert.equal(F.classify('my neighbor is a drug dealer').action, 'hold');
  assert.equal(F.classify('Please call 911 if you see smoke').action, 'ok');
  assert.equal(F.classify('Looking ahead to 2026 and the riverfront').action, 'ok');
  assert.equal(F.classify('Main Street festival starts Saturday').action, 'ok');
  assert.equal(F.classify('Great game last night').action, 'ok');
});

test('ship122: address reject is house-number only; years and crowds post', () => {
  for (const text of [
    'There were 200 people on Main Street',
    'the 2024 basketball court was packed',
    'I watched game 7 at the basketball court'
  ]) {
    assert.equal(F.classify(text).action, 'ok', text);
  }
  assert.equal(F.classify('He lives at 123 Main Street').action, 'reject');
  assert.equal(F.classify('Meet at 45 Oak Avenue Apt 2').action, 'reject');
});

test('ship122: accusation hold needs a person target; metaphors publish', () => {
  for (const text of [
    'It was clear that the council voted no',
    'It was later that I found out',
    'They killed it last night',
    'This is a killer deal',
    'The heat is a killer'
  ]) {
    assert.equal(F.classify(text).action, 'ok', text);
  }
  assert.equal(F.classify('John Smith is a pedophile').action, 'hold');
  assert.equal(F.classify('my neighbor is a drug dealer').action, 'hold');
  assert.equal(F.classify('I know who did it, it was Mike').action, 'hold');
});

test('ship122: report reasons UI, API store, and admin display', () => {
  const js = read('public/assets/app.js');
  assert.match(js, /Harassment or hate/);
  assert.match(js, /Personal info/);
  assert.match(js, /False accusation/);
  assert.match(js, /reason: r\.k/);
  const Cm = read('api/_comments.js');
  assert.match(Cm, /REPORT_REASONS/);
  assert.match(Cm, /tsn:cm:reprsn:/);
  assert.match(Cm, /Personal details aren’t allowed/);
  assert.match(read('public/admin.html'), /x\.reasons/);
});

test('ship122: tragedy clustering needs a distinctive shared token', () => {
  const a = {
    title: "Patoka man sentenced to 45 years for wife's death",
    published: '2026-11-08T18:00:00Z',
    source: 'Courier & Press',
    link: 'https://a.ex/patoka',
    sourceId: 'cp'
  };
  const b = {
    title: "Gibson County man sentenced in wife's murder",
    published: '2026-11-08T12:00:00Z',
    source: 'Princeton Daily',
    link: 'https://b.ex/gibson',
    sourceId: 'pd'
  };
  const c = {
    title: 'Council passes riverfront plan',
    published: '2026-11-08T16:00:00Z',
    source: 'N',
    link: 'https://n.ex/river',
    sourceId: 'n'
  };
  // Title-only Patoka vs Gibson: no shared place/name/term of years → stay separate.
  assert.equal(CL.sameIncident(a, b), false);
  assert.equal(CL.clusterTragedies([a, b, c]).length, 3);
  // Distinctive link via "45 years" in the other outlet's summary may cluster.
  const bLinked = Object.assign({}, b, { summary: 'A Gibson County man received 45 years in his wife\'s murder.' });
  assert.equal(CL.sameIncident(a, bLinked), true);
  const out = CL.clusterTragedies([a, bLinked, c]);
  assert.equal(out.length, 2);
  const lead = out.find(x => /Patoka/.test(x.title));
  assert.ok(lead);
  assert.ok(lead.alsoCovered && lead.alsoCovered.length === 1);
  assert.equal(lead.alsoCovered[0].source, 'Princeton Daily');
  assert.ok(out.some(x => /riverfront/.test(x.title)));
  assert.match(read('public/assets/app.js'), /Also covered by/);
  assert.match(read('public/assets/app.js'), /alsoCovered/);
});

test('ship122: clustering keeps unrelated tragedies and cruelty cases separate', () => {
  const hwyA = { title: 'Man killed in crash on Highway 41 near Evansville', published: '2026-11-07T10:00:00Z', source: 'A', link: 'https://a.ex/41', sourceId: 'a' };
  const hwyB = { title: 'Woman killed in crash on Highway 66 near Princeton', published: '2026-11-07T11:00:00Z', source: 'B', link: 'https://b.ex/66', sourceId: 'b' };
  assert.equal(CL.sameIncident(hwyA, hwyB), false);

  const patoka = { title: "Patoka man sentenced to 45 years for wife's death", published: '2026-11-08T18:00:00Z', source: 'A', link: 'https://a.ex/p', sourceId: 'a' };
  const warrick = { title: "Warrick man sentenced in wife's death", published: '2026-11-08T12:00:00Z', source: 'B', link: 'https://b.ex/w', sourceId: 'b' };
  assert.equal(CL.sameIncident(patoka, warrick), false);

  const dog = { title: 'Couple charged with animal cruelty after dogs found in home', published: '2026-11-07T10:00:00Z', source: 'A', link: 'https://a.ex/1', sourceId: 'a' };
  const cat = { title: 'Evansville couple charged in animal cruelty case involving cats', published: '2026-11-07T14:00:00Z', source: 'B', link: 'https://b.ex/2', sourceId: 'b' };
  assert.equal(CL.sameIncident(dog, cat), false);
  assert.equal(CL.SYN.dog, undefined);
  assert.equal(CL.SYN.cat, undefined);

  // Same distinctive place may still cluster two cruelty writeups.
  const dogEv = { title: 'Evansville couple charged with animal cruelty after dogs found', published: '2026-11-07T10:00:00Z', source: 'A', link: 'https://a.ex/1', sourceId: 'a' };
  const dogEv2 = { title: 'Evansville pair charged in animal cruelty case after dogs seized', published: '2026-11-07T14:00:00Z', source: 'B', link: 'https://b.ex/2', sourceId: 'b' };
  assert.equal(CL.sameIncident(dogEv, dogEv2), true);
  const out = CL.clusterTragedies([dogEv, dogEv2, hwyA, hwyB]);
  assert.equal(out.length, 3);
});

test('ship122: utility pages drop at ingestion matcher and on render', () => {
  for (const t of ['Contact WFIE', 'Contact Us', 'About Us', 'Advertise with us', 'Newsletter sign up', 'Privacy Policy', 'Terms of Service', 'Watch live', 'Download our app']) {
    assert.equal(U.utilityTitle(t), true, t);
  }
  assert.equal(U.utilityTitle('Council passes riverfront plan'), false);
  const news = read('api/news.js');
  assert.match(news, /utility\.js/);
  assert.match(news, /isUtilityPage/);
  assert.match(read('public/assets/app.js'), /UT\.utilityStory/);
});

test('ship122: empty Jobs/Deals lead with empty state then labeled examples', () => {
  const js = read('public/assets/app.js');
  assert.match(js, /No local listings yet\. Post the first one/);
  assert.match(js, /Examples of what listings look like/);
  assert.match(js, /cl-examples/);
  assert.match(js, /emptyBoard/);
  assert.match(read('public/assets/app.css'), /\.cl-examples/);
});

test('ship122: end-of-deck caught-up card instead of looping', () => {
  const js = read('public/assets/app.js');
  assert.match(js, /You\\u2019re all caught up/);
  assert.match(js, /Back to top/);
  assert.match(js, /Show older stories/);
  assert.match(js, /showEnd/);
  assert.match(js, /st-caught/);
  assert.match(read('public/assets/app.css'), /\.st-caught/);
});

test('ship122: larger text toggle and 40px fine-pointer reaction targets', () => {
  const js = read('public/assets/app.js');
  const css = read('public/assets/app.css');
  const html = read('data/pages/index.html');
  assert.match(html, /id="textBtn"/);
  assert.match(js, /tsn\.text/);
  assert.match(js, /text-lg/);
  assert.match(js, /applyTextSize/);
  assert.match(css, /html\.text-lg body \{ font-size:16px/);
  assert.match(css, /@media \(min-width:900px\) and \(pointer:fine\) \{[\s\S]*?min-height:40px/);
  assert.doesNotMatch(css, /min-height:34px/);
});

test('ship122: reaction buttons have no border at rest', () => {
  const css = read('public/assets/app.css');
  assert.match(css, /:is\(\.like, \.share, \.cm-btn, \.sv-btn, \.ns-more-btn, \.cl-ico, \.evc-like\) \{\s*border:0 !important/);
  assert.match(css, /article\.card\.news-story \.ns-foot :is\(\.like, \.share, \.cm-btn, \.sv-btn\) \{[\s\S]*?border:0;/);
  assert.match(css, /ship122 final: reaction buttons \+ rows stay borderless/);
  assert.match(css, /\.acts, \.ns-foot \.acts, \.st-acts, \.evc-foot \.acts, \.bd-sheet \.acts \{\s*border:0; box-shadow:none; outline:none; background-color:transparent/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /--react-hover/);
  assert.doesNotMatch(css, /\.ev \.acts \.like, \.ev \.acts \.share \{ background:var\(--background\); box-shadow:0 1px 4px/);
});

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
      case 'SMEMBERS': return { result: [...(sets.get(k) || new Set())] };
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
function seedStory(store, sid, meta) {
  const cur = store.sets.get(KEY) || new Set();
  cur.add(sid);
  store.sets.set(KEY, cur);
  const all = {}; try { Object.assign(all, JSON.parse(store.kv.get(META) || '{}')); } catch (_) {}
  all[sid] = meta;
  store.kv.set(META, JSON.stringify(all));
}

test('ship122: GET /api/comments allowed:false for Morris-style news obituary', () => withStore(async (s, mod) => {
  const Cm = mod('_comments.js');
  const id = storyId('https://n.ex/morris');
  seedStory(s, id, { kind: 'news', title: MORRIS.title, summary: MORRIS.summary, link: MORRIS.link, sourceId: MORRIS.sourceId });
  const got = await call(Cm, { query: { id } });
  assert.equal(got.body.allowed, false);
}));

test('ship122: create rejects PII with personal-details message; accusations pending', () => withStore(async (s, mod) => {
  const Cm = mod('_comments.js');
  const COOKIE = mod('_cmcookie.js');
  const id = storyId('https://n.ex/keep');
  seedStory(s, id, { kind: 'news', title: 'Council passes riverfront plan', summary: 'A zoning vote.', link: 'https://n.ex/keep', sourceId: 'n' });
  const origin = { host: '127.0.0.1:3077', origin: 'http://127.0.0.1:3077' };
  const ready = await call(Cm, { method: 'POST', headers: origin, body: { action: 'ready' } });
  const cookie = String(ready.headers['set-cookie'] || '').match(/(?:__Host-)?tsn_cm=([^;]+)/);
  const hdr = Object.assign({ cookie: 'tsn_cm=' + cookie[1], 'content-type': 'application/json' }, origin);
  const pii = await call(Cm, { method: 'POST', headers: hdr, body: { id, uid: 'uid-test-01', text: 'Call 812-555-9999' } });
  assert.equal(pii.code, 400);
  assert.match(String(pii.body.error || ''), /Personal details/);
  const acc = await call(Cm, { method: 'POST', headers: hdr, body: { id, uid: 'uid-test-01', text: 'Dan is a drug dealer' } });
  assert.equal(acc.code, 200);
  assert.equal(acc.body.pending, true);
  void COOKIE;
}));

test('ship122: report stores reason and admin review returns it', () => withStore(async (s, mod) => {
  const Cm = mod('_comments.js');
  const origin = { host: '127.0.0.1:3077', origin: 'http://127.0.0.1:3077' };
  const id = storyId('https://n.ex/keep2');
  seedStory(s, id, { kind: 'news', title: 'Council passes riverfront plan', summary: 'A zoning vote.', link: 'https://n.ex/keep2', sourceId: 'n' });
  const ready = await call(Cm, { method: 'POST', headers: origin, body: { action: 'ready' } });
  const cookie = String(ready.headers['set-cookie'] || '').match(/(?:__Host-)?tsn_cm=([^;]+)/);
  const hdr = Object.assign({ cookie: 'tsn_cm=' + cookie[1], 'content-type': 'application/json' }, origin);
  const created = await call(Cm, { method: 'POST', headers: hdr, body: { id, uid: 'uid-test-02', text: 'Nice work on the riverfront' } });
  assert.equal(created.code, 200);
  const cid = created.body.comment.id;
  await call(Cm, { method: 'POST', headers: hdr, body: { action: 'report', id: cid, uid: 'uid-test-02', reason: 'personal' } });
  assert.ok((s.sets.get('tsn:cm:reprsn:' + cid) || new Set()).has('personal'));
  // Force into review queue by hiding
  s.kv.set('tsn:cm:hide:' + cid, '1');
  const z = s.z.get('tsn:cm:review') || new Map();
  z.set(cid, Math.floor(Date.now() / 1000));
  s.z.set('tsn:cm:review', z);
  const rev = await call(Cm, { method: 'GET', query: { review: '1' }, headers: { 'x-admin-key': 'admin-test-key' } });
  const row = (rev.body.items || []).find(x => x.id === cid);
  assert.ok(row);
  assert.deepEqual(row.reasons, ['Personal info']);
}));
