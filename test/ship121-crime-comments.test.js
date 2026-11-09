'use strict';
// ship121: comments off for police/EMS logs, burglary and a broader crime corpus. Shared matcher
// (public/crime.js) is used by the page, first-paint cards, and GET /api/comments. Live headlines were
// confirmed allowed:true on GET https://www.tristatenow.com/api/comments (2026-11-09) before this change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const crime = require('../api/_crime.js');
const C = require('../public/crime.js');
const { storyId, idsCmds, KEY, META } = require('../api/_storyid.js');
const Cards = require('../api/_cards.js');

const LIVE = [
  {
    title: 'Auto Repair Shop Burglarized',
    summary: 'Evansville Police are investigating a burglary at an auto repair shop. Officers were checking out a commercial burglary report at A1 Auto and Diesel R...',
    link: 'https://hot96.com/2026/11/09/auto-repair-shop-burglarized/',
    source: 'WSTO Radio',
    sourceId: 'wsto',
    id: 'h1db6aljebqv'
  },
  {
    title: 'Martin County, Ind. Police & EMT Log (Nov. 2-9)',
    summary: 'Monday, November 2, 2026 2:30 a.m.- Received a 911 call requesting an ambulance in Loogootee. Martin County Medic 1 and Loogootee Fire Department responded. Medic 1 transported one patient to Deaconess Memorial…',
    link: 'https://loogooteetimes.com/2026/11/09/martin-county-ind-police-emt-log-nov-2-9/?utm_source=rss&utm_medium=rss&utm_campaign=martin-county-ind-police-emt-log-nov-2-9',
    source: 'The Loogootee Times',
    sourceId: 'loogtimes',
    id: 'h1wjb92yhqem'
  },
  {
    title: 'Loogootee, Ind. Police Department Log (Nov. 2-9)',
    summary: 'Monday, November 2, 2026 2:30 am- Loogootee Fire Dept. responded to a medical call on Bellbrook Rd. 11:43 am- Loogootee Fire Dept. responded to a medical call on Mount Pleasant Rd. 11:46 am- A caller reported a large…',
    link: 'https://loogooteetimes.com/2026/11/09/loogootee-ind-police-department-log-nov-2-9/?utm_source=rss&utm_medium=rss&utm_campaign=loogootee-ind-police-department-log-nov-2-9',
    source: 'The Loogootee Times',
    sourceId: 'loogtimes',
    id: 'hvfvjmk2bgx'
  }
];

const CRIME = [
  'Auto Repair Shop Burglarized',
  'Shop burglarized overnight on First Avenue',
  'Burglary reported at an auto repair shop',
  'Suspect burglar seen on video',
  'Break-in at a downtown garage',
  'Someone broke into the school overnight',
  'Woman robbed at an ATM',
  'Armed robbery at a convenience store',
  'Catalytic converter thefts spike',
  'Laptop stolen from a locked car',
  'Teen accused of shoplifting at the mall',
  'Vandalism at the courthouse',
  'Arson suspected in warehouse fire',
  'Assault reported near the riverfront',
  'Battery charge filed after a bar fight',
  'Carjacking on the Lloyd Expressway',
  'Man shot on Main Street',
  'Police investigating shooting on Lincoln Ave',
  'Stabbing outside a Henderson bar',
  'Overdose death under investigation',
  'Driver charged with DUI after a crash',
  'OWI arrest on US 41',
  'Warrant served in Gibson County',
  'Grand jury indictment unsealed',
  'Man sentenced to 12 years',
  'Woman convicted in fraud case',
  'Defendant pleads guilty to theft',
  'Inmate dies at the county jail',
  'Suspect taken into custody',
  'Two booked into the Vanderburgh County jail',
  'Standoff ends after three hours',
  'Manhunt underway in Henderson',
  'High-speed pursuit ends in a crash',
  'Missing person reported in Posey County',
  'Amber Alert issued for a toddler',
  'Fatal crash investigation continues on I-69',
  'Police blotter for Nov. 3',
  "Sheriff's log: weekend calls",
  'Sheriff’s log: weekend calls',
  'Fire/EMS runs Nov. 1-7',
  'EMT log for the week',
  'Jail bookings, Nov. 2',
  'Incident report: damaged mailbox',
  'Woman allegedly killed by husband texted sister she was \u2018not good\u2019 days before her body was found',
  'Man arrested downtown after overnight chase',
  'Registered sex offender arrested for recording children'
];

const KEEP = [
  'Shooting guard leads the Aces',
  'Aces shooting woes continue',
  'Aces shooting percentage drops in November',
  'Storm kills 3 in western Kentucky after overnight flooding',
  'Pacers kill off the Heat in overtime',
  'Heat wave deaths climb in the Ohio Valley',
  'Council passes riverfront plan',
  'Mater Dei band preps for state',
  'New Kroger Marketplace opens Thursday on Fairview Drive',
  'USI opens a lab',
  'DNC Chairman shares party message',
  'SIU to host Nov. 13 small business workshop',
  'Flu shot clinic opens Monday',
  'COVID booster shot available this week',
  'Shot clock violation costs the Aces',
  'Pacers steal Game 2 from the Heat',
  'Tips to prevent identity theft this holiday',
  'How to prevent package theft on your porch',
  'Old Jail Museum reopens downtown',
  'Jailhouse Cafe adds weekend hours',
  'Historic jail tour sells out',
  'Car battery dies in the cold',
  'Help wanted at the bakery',
  'Restaurant fully booked for Saturday',
  'In pursuit of a state title',
  'Annual report published'
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

test('ship121: still 8 functions; UI, cards and comments share public/crime.js', () => {
  const fns = fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_')).sort();
  assert.deepEqual(fns, ['alerts.js', 'inbox.js', 'listings.js', 'news.js', 'newsletter.js', 'react.js', 'stripe-webhook.js', 'unsubscribe.js']);
  const js = read('public/assets/app.js');
  assert.match(js, /window\.TSNCrime/);
  assert.match(js, /function crimeStory\(it\) \{ return CR \? CR\.crimeStory\(it\) : true; \}/);
  assert.match(read('api/_crime.js'), /require\('\.\.\/public\/crime\.js'\)/);
  assert.match(read('api/_cards.js'), /crime\.crimeStory\(it\)/);
  assert.match(read('scripts/build-assets.js'), /'crime\.js'/);
  assert.equal(crime.crimeTitle, C.crimeTitle);
  assert.equal(crime.CRIME_RE.source, C.CRIME_RE.source);
});

test('ship121: live police-log and burglary headlines fail closed on title, dek and slug', () => {
  for (const it of LIVE) {
    assert.equal(storyId(it.link), it.id, it.title);
    assert.equal(C.crimeStory(it), true, it.title);
    assert.equal(C.crimeTitle(it.title), true, it.title + ' title-only');
    assert.equal(crime.commentsBlocked({ kind: 'news', title: it.title, summary: it.summary, link: it.link, sourceId: it.sourceId }), true);
  }
  assert.equal(C.crimeStory({ title: 'Weekly roundup', summary: '', link: 'https://hot96.com/2026/11/09/auto-repair-shop-burglarized/' }), true, 'slug-only burglarized');
  assert.equal(C.crimeStory({ title: 'City brief', summary: 'Officers were checking out a commercial burglary report.', link: 'https://n.ex/brief' }), true, 'dek-only burglary');
});

test('ship121: crime corpus is off; sports, weather, health and place-name jail stay on', () => {
  for (const t of CRIME) assert.equal(C.crimeTitle(t), true, t);
  for (const t of KEEP) assert.equal(C.crimeTitle(t), false, t);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: 'Council passes riverfront plan' }), false);
  assert.equal(crime.commentsBlocked({ kind: 'institution', title: 'USI opens a lab' }), false);
  assert.equal(crime.commentsBlocked({ kind: 'news', title: LIVE[0].title }), true);
});

test('ship121: first-paint cards omit the comment button on live crime headlines', () => {
  const now = Date.parse('2026-11-09T22:00:00Z');
  const items = LIVE.map((it, i) => ({
    title: it.title, summary: it.summary, link: it.link, image: 'https://img.ex/' + i + '.jpg',
    published: '2026-11-09T21:00:00Z', source: it.source, sourceId: it.sourceId
  }));
  items.push({ title: 'Council passes riverfront plan', summary: 'A zoning vote.', link: 'https://n.ex/river', image: 'https://img.ex/r.jpg', published: '2026-11-09T20:00:00Z', source: 'N', sourceId: 'n' });
  const html = Cards.cards(Cards.pick({
    updatedAt: '2026-11-09T22:00:00Z',
    sources: [{ id: 'wsto', name: 'WSTO Radio', kind: 'news' }, { id: 'loogtimes', name: 'The Loogootee Times', kind: 'news' }, { id: 'n', name: 'N', kind: 'news' }],
    items
  }, 'news', now), now);
  for (const it of LIVE) {
    const needle = it.title.replace(/&/g, '&amp;');
    const art = html.split('<article').filter(x => x.includes(needle))[0];
    assert.ok(art, it.title);
    assert.doesNotMatch(art, /cm-btn/, it.title);
    assert.doesNotMatch(art, /ns-pic|img\.ex/, it.title);
  }
  const river = html.split('<article').filter(x => x.includes('riverfront plan'))[0];
  assert.match(river, /cm-btn/);
});

test('ship121: GET /api/comments allowed:false for live crime meta, including dek/slug-only', () => withStore(async (s, mod) => {
  const Cm = mod('_comments.js');
  for (const it of LIVE) {
    const id = storyId(it.link);
    seedStory(s, id, { kind: 'news', title: it.title, summary: it.summary, link: it.link, sourceId: it.sourceId });
    const got = await call(Cm, { query: { id } });
    assert.equal(got.body.configured, true, it.title);
    assert.equal(got.body.allowed, false, it.title);
    assert.deepEqual(got.body.comments, []);
  }
  const slugId = storyId('https://n.ex/slug-only');
  seedStory(s, slugId, { kind: 'news', title: 'Weekly roundup', summary: '', link: 'https://hot96.com/2026/11/09/auto-repair-shop-burglarized/', sourceId: 'n' });
  assert.equal((await call(Cm, { query: { id: slugId } })).body.allowed, false);
  const keepId = storyId('https://n.ex/keep');
  seedStory(s, keepId, { kind: 'news', title: 'Council passes riverfront plan', summary: 'A zoning vote.', link: 'https://n.ex/keep', sourceId: 'n' });
  assert.equal((await call(Cm, { query: { id: keepId } })).body.allowed, true);
}));

test('ship121: idsCmds stores summary and link so comments can see dek and slug', () => {
  const cmds = idsCmds(
    [{ link: LIVE[0].link, title: LIVE[0].title, summary: LIVE[0].summary, sourceId: 'wsto' }],
    100,
    [{ id: 'wsto', kind: 'news' }]
  );
  const meta = JSON.parse(cmds[4][2]);
  const row = meta[LIVE[0].id];
  assert.equal(row.kind, 'news');
  assert.equal(row.title, LIVE[0].title);
  assert.equal(row.summary, LIVE[0].summary);
  assert.equal(row.link, LIVE[0].link);
  assert.equal(cmds[4][1], META);
});
