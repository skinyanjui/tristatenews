// Feed wiring in api/alerts.js: the Daviess County feed is disabled with a reason, and the undated
// City of Owensboro feed is timed from first sight with the first load as a baseline.
const test = require('node:test');
const assert = require('node:assert/strict');
const alerts = require('../api/alerts.js');
const reg = require('../scripts/alert-sources.json');

const rss = items => '<?xml version="1.0"?><rss version="2.0"><channel><title>owensboroky - RSS</title>' +
  items.map(t => '<item><title>' + t + '</title><description>x</description><link>news_detail_T3_R' + t.length + '.php</link><guid>0.00</guid></item>').join('') + '</channel></rss>';
function withFeed(xml, fn) {
  const real = global.fetch;
  global.fetch = async () => new Response(xml, { status: 200, headers: { 'content-type': 'text/xml' } });
  return Promise.resolve(fn()).finally(() => { global.fetch = real; });
}

test('daviessco is disabled with a dated reason, and so is its registry entry', () => {
  const f = alerts.FEEDS.find(x => x.id === 'daviessco');
  assert.match(f.disabled, /^2026-10-17: HTTP 403/);
  const r = reg.sources.find(s => s.id === 'daviess-county');
  assert.equal(r.enabled, false); assert.equal(r.wired, false); assert.equal(r.feedId, 'daviessco');
});

test('owensboro-city is wired in code and in the registry', () => {
  const f = alerts.FEEDS.find(x => x.id === 'owensboro-city');
  assert.ok(f && !f.disabled && f.undated && f.keyword);
  const r = reg.sources.find(s => s.id === 'owensboro-city');
  assert.equal(r.wired, true); assert.equal(r.verified, 'verified-feed'); assert.equal(r.url, f.url);
});

test('undated feed: first load is a baseline, new items start when first seen, links are absolute', async () => {
  const f = alerts.FEEDS.find(x => x.id === 'owensboro-city');
  const t0 = Date.parse('2026-10-18T03:00:00Z');
  const old = 'Boil water advisory for Parrish Avenue';
  const first = await withFeed(rss([old, 'Grand opening of the senior center']), () => alerts.loadFeed(f, t0, null));
  assert.equal(first.length, 1);                       // keyword match only
  assert.equal(Object.keys(first.seen).length, 2);     // same <guid>0.00</guid> on both, still two items
  assert.equal(first[0].start, null);                  // baseline: never active
  assert.equal(first[0].link, 'https://owensboro.org/news_detail_T3_R' + old.length + '.php');
  const prev = { items: first, seen: first.seen };
  const t1 = t0 + 20 * 60e3, fresh = 'Shelter in place ordered near West 2nd Street';
  const second = await withFeed(rss([fresh, old]), () => alerts.loadFeed(f, t1, prev));
  const byTitle = Object.fromEntries(second.map(c => [c.title, c]));
  assert.equal(byTitle[fresh].start, t1);
  assert.equal(byTitle[fresh].tier, 1);
  assert.equal(byTitle[old].start, null);
  const third = await withFeed(rss([fresh, old]), () => alerts.loadFeed(f, t1 + 30 * 60e3, { seen: second.seen }));
  assert.equal(third.find(c => c.title === fresh).start, t1); // keeps its first-seen time
});

test('refresh skips disabled feeds and keeps the seen map in state', async () => {
  const real = global.fetch;
  global.fetch = async url => /owensboro/.test(String(url)) ? new Response(rss(['Boil water notice issued']), { status: 200 }) : new Response('nope', { status: 500 });
  try {
    const { states, snapshot } = await alerts.refresh({}, Date.now(), new Set(), null);
    assert.ok(!snapshot.sources.some(s => s.id === 'daviessco' || s.id === 'gibsonco'));
    assert.ok(states['owensboro-city'].seen && Object.keys(states['owensboro-city'].seen).length === 1);
    const two = await alerts.loadFeed(alerts.FEEDS.find(x => x.id === 'owensboro-city'), Date.now(), null);
    assert.ok(two.seen);
    assert.equal(snapshot.alerts.filter(a => a.sourceId === 'owensboro-city').length, 0); // baseline, not breaking
  } finally { global.fetch = real; }
});
