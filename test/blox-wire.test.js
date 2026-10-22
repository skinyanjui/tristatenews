// 2026-10-22 regression: the Messenger-Inquirer (and five other BLOX papers) showed zero stories. Not a parser bug:
// their feed URL was the unfiltered BLOX search feed (/search/?f=rss&t=article&l=25), which is the newest 25 articles
// site-wide, and AP wire copy (links under /ap/) filled all of them, so every item was rejected as wire. Measured with
// real fetches the same day: messinq 30 received / 0 accepted before, 29 accepted on the news/local section feed.
// The Gleaner, WTHI and the Kentucky Lantern had zero for a different, correct reason (geo sources with nothing local
// at the time), so they are unchanged. Also: WFIW obituaries kept out of news; Ohio County Times-News paused.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const API = path.join(__dirname, '..', 'api');
const CLEAN = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'UPSTASH_REDIS_URL', 'EXTRA_FEEDS', 'EXPANDED_SOURCES_ENABLED', 'SOURCE_BATCHES'];
function fresh(env) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k];
  CLEAN.forEach(k => delete process.env[k]); Object.assign(process.env, env || {});
  const news = require('../api/news.js');
  require('../api/_safe.js').guard.lookup = async () => [{ address: '93.184.216.34', family: 4 }]; // no real DNS
  return news;
}
const item = (t, link, d) => '<item><title>' + t + '</title><link>' + link + '</link><pubDate>' + new Date(Date.now() - (d || 1) * 36e5).toUTCString() + '</pubDate><description>' + t + '</description></item>';
const rss = items => '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>' + items.join('') + '</channel></rss>';
const H = 'https://www.messenger-inquirer.com';
const AP = Array.from({ length: 25 }, (_, i) => item('Wire story number ' + i + ' from Washington', H + '/ap/national/story-' + i + '/article_' + i + '.html'));
const LOCAL = ['Owensboro commission approves riverfront budget', 'Daviess County schools name new principal', 'Owensboro police seek driver in hit-and-run'].map((t, i) => item(t, H + '/news/local/story-' + i + '/article_l' + i + '.html'));

async function withFeed(body, fn) {
  const real = global.fetch, realT = global.setTimeout;
  global.fetch = async url => { url = String(url); if (url.includes('kv.test') || /upstash|redis/.test(url)) throw new Error('no store in this test'); return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml' } }); };
  global.setTimeout = (f, ms, ...a) => realT(f, 0, ...a);
  try { return await fn(); } finally { global.fetch = real; global.setTimeout = realT; }
}

test('an all-AP BLOX feed accepts nothing and is reported as all_wire, not as an empty feed', async () => {
  const news = fresh();
  const src = news.SOURCES.find(s => s.id === 'messinq');
  const r = await withFeed(rss(AP), () => news.loadSource(src, null, Date.now()));
  assert.equal(r.items.length, 0);
  const a = news.adapterResult(Object.assign({ source: src }, r), { runId: 't' });
  assert.equal(a.itemsReceived, 25);
  assert.deepEqual(a.rejectionReasons, { wire: 25 });
  assert.ok(a.warnings.includes('all_wire'));
});

test('the section feed shape (local stories among wire) is accepted; mostly-wire is flagged', async () => {
  const news = fresh();
  const src = news.SOURCES.find(s => s.id === 'messinq');
  const r = await withFeed(rss(AP.slice(0, 5).concat(LOCAL)), () => news.loadSource(src, null, Date.now()));
  assert.equal(r.items.length, 3);
  const a = news.adapterResult(Object.assign({ source: src }, r), { runId: 't' });
  assert.equal(a.rejectionReasons.wire, 5);
  assert.ok(a.warnings.includes('mostly_wire'));
  const clean = await withFeed(rss(LOCAL), () => news.loadSource(src, null, Date.now()));
  const w = news.adapterResult(Object.assign({ source: src }, clean), { runId: 't' }).warnings;
  assert.ok(!w.includes('all_wire') && !w.includes('mostly_wire'));
});

test('the six BLOX papers use a section-filtered feed, never the unfiltered site-wide search', () => {
  const news = fresh();
  const all = news.SOURCES.concat(news.DISABLED_SOURCES);
  for (const id of ['messinq', 'dcherald', 'wth', 'sunc', 'pdclarion', 'mtcarmel']) {
    const s = all.find(x => x.id === id); assert.ok(s, id);
    const u = new URL(s.url);
    assert.equal(u.pathname, '/search/', id); assert.equal(u.searchParams.get('f'), 'rss', id);
    assert.ok(u.searchParams.get('c') || u.searchParams.get('c[]'), id + ' has a section filter');
  }
  // Other BLOX search feeds (wpsd, southern) were measured the same day with mostly local items, so they stay unfiltered.
});

test('WFIW uses its local-news category feed and obituary-shaped titles stay out of news', () => {
  const b2 = require('../data/sources/batches/batch-2.json');
  const w = b2.sources.find(s => s.id === 'wfiw');
  assert.equal(w.url, 'https://www.wfiwradio.com/category/local-news/feed/');
  const news = fresh({ EXPANDED_SOURCES_ENABLED: 'true', SOURCE_BATCHES: 'b2' });
  const src = news.SOURCES.find(s => s.id === 'wfiw'); assert.ok(src);
  const it = (title, link) => ({ title, link: link || 'https://www.wfiwradio.com/2026/10/22/x/', description: '', published: new Date().toISOString() });
  for (const t of ['John Henry Adams, 61, of Mill Shoals', 'Mary "Sue" O\'Neal, 88, of Fairfield', 'Robert Smith Jr., 70, Carmi'])
    assert.equal(news.passesFilters(it(t), src, false), false, t);
  for (const t of ['Fairfield man, 45, of Wayne City arrested after chase', 'Wayne County board approves road budget'])
    assert.equal(news.passesFilters(it(t), src, false), true, t);
});

test('Ohio County Times-News is paused (members-only) and never fetched, even with batch 2 on', () => {
  const b2 = require('../data/sources/batches/batch-2.json');
  const o = b2.sources.find(s => s.id === 'octimes');
  assert.match(o.disabled, /paywall|members/i);
  const news = fresh({ EXPANDED_SOURCES_ENABLED: 'true', SOURCE_BATCHES: 'b1,b2' });
  assert.ok(!news.SOURCES.some(s => s.id === 'octimes'));
  assert.ok(news.DISABLED_SOURCES.some(s => s.id === 'octimes'));
});
