// ship110: news timing. Publication dates read in the publisher's zone (never the server's), day-only dates kept as
// days, one record per story across a publisher feed and its Google News fallback, Google's " - Publisher" suffix off
// short titles, "COURT NEWS" on different days kept apart, undated stories on the first page only, due-source
// scheduling (fair, rate-limited, inside the function limit), one refresh lock, stale-source diagnostics, the
// workflow schedule, and a per-story heart cap. Fake feeds and a fake store only: no network, no real Redis.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const STORE_ENV = { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake-token' };
const CLEAN = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'KV_URL', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'CRON_SECRET', 'EXTRA_FEEDS', 'SITE_URL'];

function load(env) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k];
  CLEAN.forEach(k => delete process.env[k]);
  Object.assign(process.env, env || {});
  require(path.join(API, '_safe.js')).guard.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  return f => require(path.join(API, f + '.js'));
}
test.afterEach(() => CLEAN.forEach(k => delete process.env[k]));
const N = load()('news');

function fakeStore() {
  const kv = new Map(), log = [];
  const run = ([op, ...a]) => {
    log.push(op);
    switch (op) {
      case 'GET': return { result: kv.has(a[0]) ? kv.get(a[0]) : null };
      case 'MGET': return { result: a.map(k => (kv.has(k) ? kv.get(k) : null)) };
      case 'SET': { const [k, v, ...o] = a; if (o.includes('NX') && kv.has(k)) return { result: null }; kv.set(k, v); return { result: 'OK' }; }
      case 'DEL': { let n = 0; a.forEach(k => { if (kv.delete(k)) n++; }); return { result: n }; }
      case 'HGETALL': case 'SMEMBERS': return { result: [] };
      default: return { result: op === 'RENAME' ? 'OK' : 0 };
    }
  };
  return { kv, log, handle: body => JSON.parse(body).map(run) };
}
// feeds(url) -> Response; the store answers /pipeline; no real waiting.
function install(store, feeds) {
  const realFetch = global.fetch, realTimeout = global.setTimeout, asked = [];
  global.fetch = async (url, init) => {
    url = String(url);
    if (url === 'https://kv.test/pipeline') return new Response(JSON.stringify(store.handle(init.body)), { status: 200 });
    asked.push(url);
    return feeds(url);
  };
  global.setTimeout = (fn, ms, ...a) => realTimeout(fn, 0, ...a);
  return { asked, restore() { global.fetch = realFetch; global.setTimeout = realTimeout; } };
}
const rss = items => '<?xml version="1.0"?><rss><channel>' + items.map(i => '<item><title>' + i.title + '</title><link>' + i.link + '</link>' +
  (i.date ? '<pubDate>' + i.date + '</pubDate>' : '') + (i.source ? '<source url="https://x">' + i.source + '</source>' : '') + '<description>' + (i.desc || i.title) + '</description></item>').join('') + '</channel></rss>';
const iso = t => new Date(t).toISOString();

// ---------- dates ----------
test('parseDate: a zone-less time is the publisher\'s wall clock, the same under any server TZ', () => {
  const code = "const N=require('./api/news.js');process.stdout.write(JSON.stringify(['2026-11-07 09:00:00','2026-11-07T09:00','Sat, 07 Nov 2026 09:00:00'].map(s=>new Date(N.parseDate(s,'America/Chicago').ts).toISOString())))";
  const outs = ['UTC', 'America/Chicago', 'Asia/Tokyo'].map(TZ => execFileSync(process.execPath, ['-e', code], { cwd: root, env: { PATH: process.env.PATH, TZ } }).toString());
  for (const o of outs) assert.deepEqual(JSON.parse(o), ['2026-11-07T15:00:00.000Z', '2026-11-07T15:00:00.000Z', '2026-11-07T15:00:00.000Z']);
  assert.equal(iso(N.parseDate('2026-11-07 09:00', 'America/Indiana/Vincennes').ts), '2026-11-07T14:00:00.000Z', 'Eastern Indiana paper');
  assert.equal(iso(N.parseDate('2026-07-04 09:00', 'America/Chicago').ts), '2026-07-04T14:00:00.000Z', 'daylight time');
  assert.equal(N.parseDate('2026-11-07 09:00', 'America/Chicago').precision, 'time');
});

test('parseDate: an explicit zone is read as written; garbage is null (never the fetch time)', () => {
  for (const [s, want] of [['Sat, 07 Nov 2026 09:00:00 -0600', '2026-11-07T15:00:00.000Z'], ['Sat, 07 Nov 2026 09:00:00 EST', '2026-11-07T14:00:00.000Z'],
    ['Sat, 07 Nov 2026 15:00:00 GMT', '2026-11-07T15:00:00.000Z'], ['2026-11-07T09:00:00-05:00', '2026-11-07T14:00:00.000Z'], ['2026-11-07T15:00:00Z', '2026-11-07T15:00:00.000Z'], ['2026-11-07T15:00:00.123+00:00', '2026-11-07T15:00:00.123Z']]) {
    const d = N.parseDate(s, 'America/Indiana/Vincennes');
    assert.equal(iso(d.ts), want, s); assert.equal(d.precision, 'time', s);
  }
  for (const s of ['', 'soon', 'tomorrow 9am', null, undefined]) assert.equal(N.parseDate(s, 'America/Chicago'), null, String(s));
});

test('parseDate: a date without a time is that calendar day (stored as its Chicago start), precision day', () => {
  for (const s of ['2026-11-07', '7 Nov 2026', 'Sat, 07 Nov 2026', 'November 7, 2026', 'Nov. 7, 2026']) {
    const d = N.parseDate(s, 'America/Chicago');
    assert.deepEqual([iso(d.ts), d.precision], ['2026-11-07T06:00:00.000Z', 'day'], s);
  }
  assert.equal(iso(N.parseDate('2026-11-07', 'America/Indiana/Vincennes').ts), '2026-11-07T06:00:00.000Z', 'the same day for an Eastern paper');
  assert.equal(N.chicagoDate(N.parseDate('2026-11-07', 'America/Indiana/Vincennes').ts), '2026-11-07');
});

test('feeds: <pubDate>/<published> is the date; Atom <updated> only when it is the only one; no date stays undated', () => {
  const src = { id: 't', name: 'Test', area: 'Evansville', url: 'https://t.example/feed' };
  const atom = '<feed><entry><title>Evansville council approves budget</title><link href="https://t.example/a"/><published>2026-11-07T09:00:00-06:00</published><updated>2026-11-07T12:30:00-06:00</updated></entry>' +
    '<entry><title>Evansville bridge closes for work</title><link href="https://t.example/b"/><updated>2026-11-07T10:00:00-06:00</updated></entry>' +
    '<entry><title>Evansville zoo opens a new exhibit</title><link href="https://t.example/c"/></entry></feed>';
  const items = N.parseFeed(atom, src);
  assert.deepEqual(items.map(i => i.published), ['2026-11-07T15:00:00.000Z', '2026-11-07T16:00:00.000Z', null]);
  const zoneless = N.parseFeed(rss([{ title: 'Jasper council meets', link: 'https://dch.example/1', date: '2026-11-07 09:00:00' }]), { id: 'd', name: 'D', area: 'Jasper', tz: 'America/Indiana/Vincennes', url: 'https://dch.example/rss' });
  assert.equal(zoneless[0].published, '2026-11-07T14:00:00.000Z');
  const dayOnly = N.parseFeed(rss([{ title: 'Jasper council meets', link: 'https://dch.example/2', date: '2026-11-07' }]), { id: 'd', name: 'D', area: 'Jasper', url: 'https://dch.example/rss' });
  assert.deepEqual([dayOnly[0].published, dayOnly[0].datePrecision], ['2026-11-07T06:00:00.000Z', 'day']);
});

// ---------- Google News suffix and midnight dates (live 2026-11-07: "BILLBOARD - Dubois County Herald") ----------
const DCH = { id: 'dcherald', name: 'Dubois County Herald', area: 'Jasper', tz: 'America/Indiana/Vincennes', url: 'https://news.google.com/rss/search?q=site%3Aduboiscountyherald.com' };
const gLink = n => 'https://news.google.com/rss/articles/CBMi' + n;
test('Google News: the publisher suffix comes off short titles, so standing pages are dropped; midnight is a day', () => {
  const xml = rss([
    { title: 'BILLBOARD - Dubois County Herald', link: gLink(1), date: 'Sat, 07 Nov 2026 06:00:00 GMT', source: 'Dubois County Herald' },
    { title: 'CALENDAR - Dubois County Herald', link: gLink(2), date: 'Sat, 07 Nov 2026 06:00:00 GMT', source: 'Dubois County Herald' },
    { title: 'Fire - The Dubois County Herald', link: gLink(3), date: 'Sat, 07 Nov 2026 06:00:00 GMT' },
    { title: 'Dubois County council approves budget - Dubois County Herald', link: gLink(4), date: 'Sat, 07 Nov 2026 06:00:00 GMT', source: 'Dubois County Herald' },
    { title: 'Dubois County man honored for decades of service - Herald Weekly', link: gLink(5), date: 'Sat, 07 Nov 2026 14:05:00 GMT' },
  ]);
  const items = N.parseFeed(xml, Object.assign({ fetchedUrl: DCH.url }, DCH));
  assert.deepEqual(items.map(i => i.title), ['BILLBOARD', 'CALENDAR', 'Fire', 'Dubois County council approves budget', 'Dubois County man honored for decades of service']);
  const kept = items.filter(i => N.passesFilters(i, DCH, true)).map(i => i.title);
  assert.ok(!kept.includes('BILLBOARD') && !kept.includes('CALENDAR'), kept.join(' | '));
  assert.ok(kept.includes('Dubois County council approves budget'), kept.join(' | '));
  const budget = items[3];
  assert.deepEqual([budget.published, budget.datePrecision], ['2026-11-07T06:00:00.000Z', 'day'], 'Google\'s midnight is the day, not a posting time');
  assert.deepEqual([items[4].published, items[4].datePrecision], ['2026-11-07T14:05:00.000Z', undefined], 'a real Google News time is kept');
  assert.equal(N.googleTitle('Short - Somebody Else', ['Dubois County Herald']), 'Short - Somebody Else', 'an unknown tail on a short title stays');
});

// ---------- one record per story ----------
const NOW = Date.parse('2026-11-07T20:00:00Z');
const res = items => ({ items, error: items.length ? null : 'no items' });
const story = (o) => Object.assign({ title: 'Jasper council approves budget', summary: '', image: null, source: 'Dubois County Herald', sourceId: 'dcherald', isEvent: false, isObit: false }, o);
test('mergeState: Google fallback -> publisher feed keeps one story, the publisher link and its exact time; firstSeen stays', () => {
  const g = story({ link: gLink(4), published: '2026-11-07T06:00:00.000Z', datePrecision: 'day' });
  const s1 = N.mergeState(DCH, null, res([g]), NOW - 36e5);
  assert.equal(s1.items.length, 1);
  const first = s1.items[0].firstSeen;
  assert.equal(first, iso(NOW - 36e5));
  const d = story({ link: 'https://www.duboiscountyherald.com/news/local/jasper-budget', published: '2026-11-07T14:05:00.000Z', summary: 'The council voted 5-0.' });
  const s2 = N.mergeState(DCH, s1, res([d]), NOW);
  assert.equal(s2.items.length, 1, JSON.stringify(s2.items.map(i => i.link)));
  assert.deepEqual([s2.items[0].link, s2.items[0].published, s2.items[0].datePrecision, s2.items[0].firstSeen], [d.link, '2026-11-07T14:05:00.000Z', undefined, first]);
  // and back to the fallback (publisher feed down): still one story, still the publisher's link and time
  const s3 = N.mergeState(DCH, s2, res([g]), NOW + 6e5);
  assert.equal(s3.items.length, 1);
  assert.deepEqual([s3.items[0].link, s3.items[0].published, s3.items[0].summary], [d.link, '2026-11-07T14:05:00.000Z', 'The council voted 5-0.']);
});

test('mergeState: a later date for the same story is an edit (updated), never a new publication time', () => {
  const a = story({ link: 'https://p.example/1', published: '2026-11-07T14:05:00.000Z' });
  const s1 = N.mergeState(DCH, null, res([a]), NOW - 36e5);
  const s2 = N.mergeState(DCH, s1, res([Object.assign({}, a, { published: '2026-11-07T19:30:00.000Z', title: 'Jasper council approves budget (updated)' })]), NOW);
  assert.equal(s2.items.length, 1);
  assert.deepEqual([s2.items[0].published, s2.items[0].updated, s2.items[0].title], ['2026-11-07T14:05:00.000Z', '2026-11-07T19:30:00.000Z', 'Jasper council approves budget (updated)']);
  // an earlier exact time (a corrected feed) wins
  const s3 = N.mergeState(DCH, s2, res([Object.assign({}, a, { published: '2026-11-07T13:00:00.000Z' })]), NOW);
  assert.equal(s3.items[0].published, '2026-11-07T13:00:00.000Z');
});

test('mergeState: one headline on different days, or with two publisher links, is two stories', () => {
  const mon = story({ title: 'COURT NEWS', link: 'https://p.example/court-mon', published: '2026-11-02T15:00:00.000Z' });
  const tue = story({ title: 'COURT NEWS', link: 'https://p.example/court-tue', published: '2026-11-03T15:00:00.000Z' });
  const s = N.mergeState(DCH, N.mergeState(DCH, null, res([mon]), NOW), res([tue]), NOW);
  assert.equal(s.items.length, 2);
  // a Google copy dated Tuesday joins Tuesday's story only
  const gTue = story({ title: 'COURT NEWS', link: gLink(9), published: '2026-11-03T06:00:00.000Z', datePrecision: 'day' });
  const s2 = N.mergeState(DCH, s, res([gTue]), NOW);
  assert.equal(s2.items.length, 2);
  assert.deepEqual(s2.items.map(i => [i.link, i.published]).sort(), [[mon.link, mon.published], [tue.link, tue.published]].sort());
});

test('mergeState: undated stories survive a 304 (they used to vanish until the feed changed)', () => {
  const u = story({ link: 'https://p.example/undated', published: null });
  const s1 = N.mergeState(DCH, null, res([u]), NOW);
  assert.equal(s1.items.length, 1);
  const s2 = N.mergeState(DCH, s1, { items: [], notModified: true }, NOW + 6e5);
  assert.equal(s2.items.length, 1);
});

// ---------- combine ----------
const src = (id, name) => ({ id, name, area: 'Evansville', url: 'https://' + id + '.example/rss' });
const it = (s, o) => Object.assign({ summary: '', image: null, source: s.name, sourceId: s.id, isEvent: false, isObit: false, link: 'https://' + s.id + '.example/' + Math.random().toString(36).slice(2) }, o);
test('combine: the same headline is one story per Chicago day, not across days; no firstSeen/updated in the output', () => {
  const a = src('wfie', '14 News'), b = src('weht', 'Eyewitness News');
  const out = N.combine([
    { source: a, items: [it(a, { title: 'Evansville COURT NEWS', published: '2026-11-06T15:00:00.000Z', firstSeen: 'x', updated: 'y' }), it(a, { title: 'Evansville COURT NEWS', published: '2026-11-05T15:00:00.000Z' })] },
    { source: b, items: [it(b, { title: 'Evansville COURT NEWS', published: '2026-11-06T18:00:00.000Z' })] },
  ], NOW);
  assert.deepEqual(out.map(i => i.published), ['2026-11-06T15:00:00.000Z', '2026-11-05T15:00:00.000Z']);
  for (const i of out) { assert.ok(!('firstSeen' in i)); assert.ok(!('updated' in i)); }
});

test('combine: a day-only copy does not beat an exact time on the same day; it does from an earlier day', () => {
  const g = src('courier', 'Courier & Press'), p = src('wfie', '14 News');
  const t1 = 'Ex COO of Evansville company sentenced for $400K fraud scheme', t2 = 'Ex-COO of Evansville company sentenced for $400,000 fraud scheme';
  const same = N.combine([{ source: g, items: [it(g, { title: t1, published: '2026-11-06T06:00:00.000Z', datePrecision: 'day' })] }, { source: p, items: [it(p, { title: t2, published: '2026-11-06T16:00:00.000Z' })] }], NOW);
  assert.deepEqual(same.map(i => [i.sourceId, i.published]), [['wfie', '2026-11-06T16:00:00.000Z']]);
  const earlier = N.combine([{ source: g, items: [it(g, { title: t1, published: '2026-11-05T06:00:00.000Z', datePrecision: 'day' })] }, { source: p, items: [it(p, { title: t2, published: '2026-11-06T16:00:00.000Z' })] }], NOW);
  assert.deepEqual(earlier.map(i => i.sourceId), ['courier']);
  const precise = N.combine([{ source: g, items: [it(g, { title: t1, published: '2026-11-06T17:00:00.000Z' })] }, { source: p, items: [it(p, { title: t2, published: '2026-11-06T16:00:00.000Z' })] }], NOW);
  assert.deepEqual(precise.map(i => i.sourceId), ['wfie'], 'two exact times: the earliest report, as before');
});

// ---------- paging ----------
test('page: undated stories ride on the first page only, never on every older page', () => {
  const items = Array.from({ length: 230 }, (_, i) => ({ id: 'n' + i, title: 't' + i, link: 'https://x/' + i, sourceId: 'wfie', published: iso(NOW - i * 36e5) }));
  items.push({ id: 'u1', title: 'undated', link: 'https://x/u', sourceId: 'wfie', published: null });
  const snap = { updatedAt: iso(NOW), sources: [{ id: 'wfie', kind: 'news' }], items };
  const first = N.page(snap, undefined, NOW);
  assert.equal(first.items.length, N.NEWS_PAGE + 1);
  assert.ok(first.items.some(i => i.id === 'u1'));
  const older = N.page(snap, first.more.before, NOW);
  assert.equal(older.items.length, 30);
  assert.ok(!older.items.some(i => i.id === 'u1'));
  assert.equal(older.more, undefined);
});

// ---------- scheduler ----------
const S = N.SCHED;
const mk = (id, o) => Object.assign({ id, name: id, area: 'Evansville', url: 'https://' + id + '.example/rss' }, o);
test('planRun: due by each source\'s interval with a minute of slack, most overdue first, never-tried first', () => {
  const srcs = [mk('a'), mk('b'), mk('c'), mk('d', { everyMin: 60 })];
  const st = { a: { lastTry: iso(NOW - 30 * 6e4) }, b: { lastTry: iso(NOW - 9.5 * 6e4) }, d: { lastTry: iso(NOW - 30 * 6e4) } };
  const p = N.planRun(srcs, st, NOW, 'due');
  assert.deepEqual(p.take.map(s => s.id), ['c', 'a', 'b']);
  assert.deepEqual(p.waiting.map(s => s.id), ['d']);
  assert.equal(S.DEFAULT_EVERY_MIN, 10);
  // tier all: sources without their own everyMin are always due; everyMin is still honored
  const justTried = { a: { lastTry: iso(NOW - 6e4) }, d: { lastTry: iso(NOW - 6e4) } };
  assert.deepEqual(N.planRun([srcs[0], srcs[3]], justTried, NOW, 'all').take.map(s => s.id), ['a']);
  assert.deepEqual(N.planRun([srcs[0], srcs[3]], justTried, NOW, 'due').take.map(s => s.id), []);
});

test('planRun: a rate group never starves a member; per-run limits defer the rest, which go first next run', () => {
  const group = Array.from({ length: 15 }, (_, i) => mk('g' + i, { rateGroup: 'gnews', everyMin: 30, url: 'https://news.google.com/rss/search?q=g' + i }));
  const st = {};
  const fetchedAt = {};
  let t = NOW;
  for (let run = 0; run < 12; run++, t += 5 * 6e4) {
    const p = N.planRun(group, st, t, 'due');
    assert.ok(p.take.length <= N.RATE_GROUPS.gnews.perRun);
    for (const s of p.take) { st[s.id] = { lastTry: iso(t) }; (fetchedAt[s.id] = fetchedAt[s.id] || []).push(t); }
  }
  for (const s of group) {
    const at = fetchedAt[s.id];
    assert.ok(at && at[0] - NOW <= 10 * 6e4, s.id + ' first fetched within 3 runs');
    for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] <= 35 * 6e4 && at[i] - at[i - 1] >= 29 * 6e4, s.id + ' every 30-35 min');
  }
});

test('planRun: at most GOOGLE_PER_RUN Google News searches per run', () => {
  const g = Array.from({ length: 14 }, (_, i) => mk('s' + i, { url: 'https://news.google.com/rss/search?q=s' + i }));
  const p1 = N.planRun(g, {}, NOW, 'due');
  assert.equal(p1.take.length, S.GOOGLE_PER_RUN);
  const st = Object.fromEntries(p1.take.map(s => [s.id, { lastTry: iso(NOW) }]));
  const p2 = N.planRun(g, st, NOW + 5 * 6e4, 'due');
  assert.deepEqual(p2.take.map(s => s.id), p1.deferred.map(s => s.id));
});

test('planRun: failures back off (x2 from the 3rd, up to an hour); a source cooling down on every URL is not due', () => {
  const a = mk('a'), slow = mk('w', { everyMin: 120 });
  assert.equal(N.intervalMs(a, { fails: 2 }, 'due'), 10 * 6e4);
  assert.equal(N.intervalMs(a, { fails: 3 }, 'due'), 20 * 6e4);
  assert.equal(N.intervalMs(a, { fails: 9 }, 'due'), 60 * 6e4);
  assert.equal(N.intervalMs(slow, { fails: 9 }, 'due'), 120 * 6e4);
  const blocked = { lastTry: iso(NOW - 864e5), blocked: { 'a.example': NOW + 2 * 36e5 } };
  assert.equal(N.dueAt(a, blocked, NOW, 'due'), NOW + 2 * 36e5);
  const withAlt = mk('a', { altUrls: ['https://news.google.com/rss/search?q=a'] });
  assert.ok(N.dueAt(withAlt, blocked, NOW, 'due') <= NOW, 'the fallback is still open');
});

test('refreshAll: no fetch starts after START_BUDGET_MS; the leftovers are first next run', async () => {
  const store = fakeStore();
  const realNow = Date.now;
  let clock = NOW;
  Date.now = () => clock;
  const io = install(store, url => { clock += 20e3; return new Response(rss([{ title: 'Evansville council meets', link: url + '#1', date: new Date(clock - 6e5).toUTCString() }])); });
  try {
    const news = load(STORE_ENV)('news');
    const r1 = await news.refreshAll({ tier: 'due' });
    assert.ok(r1.run.deferred > 0, 'some sources left over');
    assert.equal(r1.run.fetched + r1.run.deferred, news.SOURCES.length);
    clock = NOW + 5 * 6e4;
    io.asked.length = 0;
    const r2 = await news.refreshAll({ tier: 'due' });
    const left = new Set(r1.run.deferredIds);
    assert.ok(r2.run.fetched > 0);
    for (const x of r2.report) assert.ok(left.has(x.id), x.id + ': only last run\'s leftovers were due');
    const after = new Set(r2.report.map(x => x.id).concat(r2.run.deferredIds));
    for (const id of left) assert.ok(after.has(id), id + ' fetched or still first in line');
  } finally { Date.now = realNow; io.restore(); }
});

test('refreshAll: one lock for scheduled and on-demand refreshes; busy means no fetch, 200 skipped, or 503 with no snapshot', async () => {
  const store = fakeStore();
  store.kv.set(S.LOCK_KEY, 'held');
  const io = install(store, () => new Response(rss([])));
  try {
    const mod = load(Object.assign({ CRON_SECRET: 'cron-test' }, STORE_ENV));
    const news = mod('news');
    const r = await news.refreshAll({ tier: 'due' });
    assert.equal(r.busy, true);
    assert.equal(io.asked.length, 0, 'no feed fetched');
    const out = { setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
    await mod('_refresh')({ query: { tier: 'due' }, headers: { authorization: 'Bearer cron-test' } }, out);
    assert.deepEqual([out.code, out.body.ok, out.body.skipped], [200, true, 'busy']);
    const page = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; } };
    await news({ method: 'GET', url: '/api/news', query: {}, headers: {} }, page);
    assert.deepEqual([page.code, page.headers['Retry-After']], [503, '15']);
    assert.equal(store.kv.get(S.LOCK_KEY), 'held', 'someone else\'s lock is left alone');
  } finally { io.restore(); }
});

test('refreshAll: a refused host cools down without being asked again or counted as failing; staleSources says so', async () => {
  const store = fakeStore();
  const realNow = Date.now;
  let clock = NOW;
  Date.now = () => clock;
  const io = install(store, url => /fbi\.gov/.test(url) ? new Response('no', { status: 403 }) : new Response(rss([{ title: 'Evansville council meets', link: url + '#1', date: new Date(clock - 6e5).toUTCString() }])));
  try {
    const news = load(STORE_ENV)('news');
    const r1 = await news.refreshAll({ tier: 'all' });
    const fbi = r1.run.results.find(x => x.sourceId === 'fbilou');
    assert.equal(fbi.status, 'rate_limited');
    const st1 = JSON.parse(store.kv.get('tsn:src:fbilou'));
    clock = NOW + 65 * 6e4; // due again (hourly) and the first 30-minute cooldown is over: one more request each
    io.asked.length = 0;
    const r2 = await news.refreshAll({ tier: 'due' });
    const asked = io.asked.filter(u => /fbi\.gov/.test(u)).length;
    const st2 = JSON.parse(store.kv.get('tsn:src:fbilou'));
    assert.ok(asked <= 3, 'at most one request per field office after the cooldown: ' + asked);
    assert.ok(st2.fails <= st1.fails + 1);
    const stale = r2.run.staleSources.find(s => s.id === 'fbilou');
    assert.ok(stale, 'listed as stale');
    assert.deepEqual(Object.keys(stale), ['id', 'lastOkAgeMin', 'status', 'fails', 'blockedForMin', 'everyMin']);
    assert.equal(stale.lastOkAgeMin, null);
    assert.equal(stale.everyMin, 60);
    // inside the cooldown: not due, not fetched, fails unchanged
    clock += 5 * 6e4;
    io.asked.length = 0;
    const before = JSON.parse(store.kv.get('tsn:src:fbilou'));
    const r3 = await news.refreshAll({ tier: 'due' });
    assert.equal(io.asked.filter(u => /fbi\.gov/.test(u)).length, 0);
    assert.equal(JSON.parse(store.kv.get('tsn:src:fbilou')).fails, before.fails);
    assert.ok(r3.run.staleSources.find(s => s.id === 'fbilou').blockedForMin > 0);
    assert.ok(!r3.report.some(x => x.id === 'fbilou'));
    assert.ok(r3.run.discovery && 'medianMin' in r3.run.discovery);
  } finally { Date.now = realNow; io.restore(); }
});

test('refreshAll: firstSeen marks new stories for the discovery lag, and never reaches readers', async () => {
  const store = fakeStore();
  const realNow = Date.now;
  let clock = NOW;
  Date.now = () => clock;
  const io = install(store, url => new Response(rss([{ title: 'Evansville council meets on budget', link: url + '#1', date: new Date(NOW - 12 * 6e4).toUTCString() }])));
  try {
    const news = load(STORE_ENV)('news');
    const r = await news.refreshAll({ tier: 'all' });
    assert.ok(r.run.discovery.newStories > 0);
    assert.equal(r.run.discovery.medianMin, 12);
    const snap = JSON.parse(store.kv.get('tsn:news:snapshot'));
    assert.ok(snap.items.length > 0 && snap.items.every(i => !('firstSeen' in i) && !('updated' in i)));
    assert.ok(snap.items.every(i => i.published === new Date(NOW - 12 * 6e4).toISOString()), 'published is the feed\'s time, not the fetch time');
  } finally { Date.now = realNow; io.restore(); }
});

// ---------- registry, workflows ----------
test('registry: Eastern-time publishers carry their zone; every tz is valid; cadences are within limits', () => {
  const reg = require('../api/_sources.js');
  assert.deepEqual(reg.validate(reg.FILES.concat(reg.BATCHES)), []);
  const all = reg.FILES.concat(reg.BATCHES).flatMap(f => f.sources);
  const byId = Object.fromEntries(all.map(s => [s.id, s]));
  for (const id of ['dcherald', 'ob-dcherald', 'wth', 'sunc', 'loogtimes', 'pressdisp', 'inchron', 'kylantern', 'fbilou']) assert.ok(byId[id].tz && byId[id].tz !== 'America/Chicago', id);
  for (const id of ['wfie', 'owtimes', 'kfvs', 'capnewsil', 'fbispr', 'wkms']) assert.equal(byId[id].tz, undefined, id + ' is Central');
  for (const id of ['fbilou', 'fbiind', 'fbispr']) assert.equal(byId[id].everyMin, 60, id);
  for (const s of all.filter(x => x.rateGroup === 'gnews')) assert.ok(s.everyMin <= 60, s.id);
  assert.match(reg.validate([{ file: 'x', sources: [{ seq: 1, id: 'a', name: 'A', area: 'Z', url: 'https://a/', tz: 'Mars/Olympus', everyMin: 1 }] }]).join('\n'), /tz must be an IANA time zone[\s\S]*everyMin must be 5-1440/);
});

test('workflows: news every 5 minutes (tier due), canonical www default, crawler identity kept, no new auto issues', () => {
  const y = read('.github/workflows/refresh-news.yml');
  assert.deepEqual(y.match(/- cron: '[^']+'/g), ["- cron: '4-59/5 * * * *'"]);
  assert.match(y, /TIER=due;/);
  assert.match(y, /staleSources\[\]\?/);
  assert.equal((y.match(/gh issue create/g) || []).length, 1, 'only the existing refresh-failing issue');
  for (const f of ['refresh-news.yml', 'refresh-alerts.yml', 'newsletter.yml']) {
    const w = read('.github/workflows/' + f);
    assert.match(w, /secrets\.SITE_URL \|\| 'https:\/\/www\.tristatenow\.com'/, f);
    assert.ok(!w.includes('tristatenewss.vercel.app'), f);
  }
  assert.match(read('api/news.js'), /USER_AGENT = 'Mozilla\/5\.0 \(compatible; TriStateNews\/1\.1; \+https:\/\/tristatenewss\.vercel\.app\)'/);
  assert.equal(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
});

// ---------- hearts ----------
test('hearts: at most STORY_PER_IP new hearts per story per IP per day; un-heart and re-heart by the same reader are free', async () => {
  const kv = new Map(), sets = new Map();
  const run = ([op, k, ...a]) => {
    switch (op) {
      case 'INCR': { const n = (Number(kv.get(k)) || 0) + 1; kv.set(k, String(n)); return { result: n }; }
      case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
      case 'EXPIRE': return { result: 1 };
      case 'EXISTS': return { result: sets.has(k) ? 1 : 0 };
      case 'SISMEMBER': return { result: (sets.get(k) || new Set()).has(a[0]) ? 1 : 0 };
      case 'SADD': { const s = sets.get(k) || new Set(); sets.set(k, s); s.add(a[0]); return { result: 1 }; }
      case 'SREM': { const s = sets.get(k); if (s) s.delete(a[0]); return { result: 1 }; }
      case 'SCARD': return { result: (sets.get(k) || new Set()).size };
      default: throw new Error('fake store: ' + op);
    }
  };
  const realFetch = global.fetch;
  global.fetch = async (url, init) => new Response(JSON.stringify(JSON.parse(init.body).map(run)), { status: 200 });
  try {
    const react = load(STORE_ENV)('react');
    const call = (id, uid, liked, ip) => new Promise(resolve => react({ method: 'POST', headers: { 'x-real-ip': ip || '1.1.1.1' }, body: { id, uid, liked } },
      { setHeader() {}, status(c) { this.code = c; return this; }, send(b) { resolve({ code: this.code, body: JSON.parse(b) }); } }));
    for (let i = 0; i < react.STORY_PER_IP; i++) assert.equal((await call('story0001', 'reader-000' + i, true)).code, 200);
    const sixth = await call('story0001', 'reader-0099', true);
    assert.deepEqual([sixth.code, sixth.body.error, sixth.body.count], [429, 'too many', react.STORY_PER_IP]);
    assert.equal((await call('story0001', 'reader-0000', true)).code, 200, 'a reader who already hearted it');
    assert.equal((await call('story0001', 'reader-0000', false)).code, 200, 'un-heart always');
    assert.equal((await call('story0002', 'reader-0099', true)).code, 200, 'another story');
    assert.equal((await call('story0001', 'reader-0099', true, '2.2.2.2')).code, 200, 'another IP');
    assert.ok(![...kv.keys()].some(k => k.includes('1.1.1.1')), 'no raw IP in keys');
  } finally { global.fetch = realFetch; }
});
