// Run: node --test test/   (Node 20+; no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../public/breaking.js');

const NOW = Date.parse('2026-10-18T01:00:00Z'); // Sat Oct 17, 8:00 PM CT
const H = 36e5, iso = t => new Date(t).toISOString();
const nws = (event, o) => Object.assign({ id: 'urn:' + event, event, status: 'Actual', messageType: 'Alert', headline: event + ' issued', areaDesc: 'Vanderburgh, IN',
  sent: iso(NOW - 10 * 6e4), effective: iso(NOW - 10 * 6e4), onset: iso(NOW - 10 * 6e4), expires: iso(NOW + H), ends: iso(NOW + 2 * H), senderName: 'NWS Paducah KY', geocode: { UGC: ['INC163'] } }, o || {});

test('two active alerts: only the higher tier shows', () => {
  const flood = B.fromNws(nws('Flood Warning', { sent: iso(NOW - 5 * 6e4), onset: iso(NOW - 5 * 6e4) })); // newer, but tier 3
  const tornado = B.fromNws(nws('Tornado Warning', { sent: iso(NOW - 20 * 6e4), onset: iso(NOW - 20 * 6e4) }));
  const r = B.pick([flood, tornado], NOW);
  assert.equal(r.top.label, 'Tornado Warning');
  assert.equal(r.top.tier, 1);
  assert.equal(r.more, 1);
});

test('inside one tier the newest wins', () => {
  const a = B.fromNws(nws('Severe Thunderstorm Warning', { id: 'a', onset: iso(NOW - 30 * 6e4) }));
  const b = B.fromNws(nws('Flash Flood Warning', { id: 'b', onset: iso(NOW - 2 * 6e4) }));
  assert.equal(B.pick([a, b], NOW).top.key, 'nws:b');
});

test('an expired alert is hidden', () => {
  const old = B.fromNws(nws('Tornado Warning', { ends: iso(NOW - 6e4), expires: iso(NOW - 6e4) }));
  const flood = B.fromNws(nws('Flood Warning'));
  assert.equal(B.isActive(old, NOW), false);
  assert.equal(B.pick([old, flood], NOW).top.label, 'Flood Warning');
  assert.equal(B.pick([old], NOW).top, null);
});

test('official alerts stay past 3 hours until their end time', () => {
  const river = B.fromNws(nws('Flood Warning', { description: 'The Ohio River at Evansville', onset: iso(NOW - 20 * H), ends: null, expires: iso(NOW + 30 * H) }));
  assert.equal(river.label, 'Ohio River Flood Warning');
  assert.equal(river.end, NOW + 30 * H, 'falls back to expires when ends is null');
  assert.equal(B.isActive(river, NOW), true);
  assert.equal(B.isActive(river, NOW + 31 * H), false);
});

test('an item with no end time disappears after 3 hours', () => {
  const bwa = { key: 'hwu:1', tier: 4, label: 'Boil-water advisory', start: NOW, end: null };
  assert.equal(B.isActive(bwa, NOW + 2.9 * H), true);
  assert.equal(B.isActive(bwa, NOW + 3 * H + 1), false);
  assert.equal(B.pick([bwa], NOW + 3.1 * H).top, null);
});

test('regular breaking story: lasts 3 h, loses to official alerts, newer one replaces it', () => {
  const s1 = { key: 's1', tier: 7, start: NOW - 2 * H, end: null };
  const s2 = { key: 's2', tier: 7, start: NOW - 1 * H, end: null };
  const bwa = { key: 'omu:1', tier: 4, start: NOW - 1 * H, end: null };
  assert.equal(B.pick([s1, s2], NOW).top.key, 's2');
  assert.equal(B.pick([s1, s2, bwa], NOW).top.key, 'omu:1');
  assert.equal(B.pick([s1], NOW + 1.5 * H).top, null);
});

test('an alert whose onset is in the future is not shown yet', () => {
  const w = B.fromNws(nws('Winter Storm Warning', { onset: iso(NOW + 6 * H), ends: iso(NOW + 30 * H) }));
  assert.equal(B.isActive(w, NOW), false);
  assert.equal(B.isActive(w, NOW + 7 * H), true);
});

test('NWS event mapping', () => {
  assert.equal(B.fromNws(nws('Child Abduction Emergency')).label, 'AMBER Alert');
  assert.equal(B.fromNws(nws('Child Abduction Emergency')).tier, 2);
  assert.equal(B.fromNws(nws('Shelter In Place Warning')).tier, 1);
  assert.equal(B.fromNws(nws('Ice Storm Warning')).tier, 3);
  assert.equal(B.fromNws(nws('Frost Advisory')), null, 'advisories stay in the weather strip');
  assert.equal(B.fromNws(nws('Tornado Warning', { messageType: 'Cancel' })), null);
  assert.equal(B.fromNws(nws('Tornado Warning', { status: 'Test' })), null);
  const ff = B.fromNws(nws('Flash Flood Warning', { parameters: { flashFloodDamageThreat: ['CATASTROPHIC'] } }));
  assert.deepEqual([ff.tier, ff.label], [1, 'Flash Flood Emergency']);
  assert.match(B.fromNws(nws('Tornado Warning')).link, /^https:\/\/forecast\.weather\.gov\/showsigwx\.php\?warnzone=&warncounty=INC163$/);
});

test('keyword tiers for official items (and cancellations never show)', () => {
  const c = t => (B.classifyOfficial({ title: t }) || {}).tier || null;
  assert.equal(c('Precautionary boil advisory issued for Green Street area'), 4);
  assert.equal(c('Boil advisory lifted for Green Street area'), null);
  assert.equal(c('Silver Alert issued for missing Evansville man'), 2);
  assert.equal(c('Silver Alert cancelled for Evansville man'), null);
  assert.equal(c('I-69 northbound closed at mile marker 12 after crash'), 5);
  assert.equal(c('Twin Bridges closed overnight for inspection'), 5);
  assert.equal(c('Shelter in place lifted near North Park'), null);
  assert.equal(c('Residents near the plant told to shelter in place'), 1);
  assert.equal(c('EVSC schools closed Friday due to ice'), 6);
  assert.equal(c('Deputies arrest man after pursuit'), null);
});

test('"until" line is America/Chicago', () => {
  assert.equal(B.untilText(Date.parse('2026-10-18T02:45:00Z'), NOW), 'until 9:45 PM CT');
  assert.equal(B.untilText(Date.parse('2026-10-18T13:00:00Z'), NOW), 'until Sun 8:00 AM CT');
  assert.equal(B.untilText(null, NOW), '');
});

test('api/alerts: WZDx and RSS parsing (mocked fetch)', async () => {
  const A = require('../api/alerts.js');
  const line = (lon, lat) => ({ type: 'LineString', coordinates: [[lon, lat], [lon + 0.01, lat + 0.01]] });
  const wz = { type: 'FeatureCollection', features: [
    { id: 'full', type: 'Feature', geometry: line(-87.55, 37.98), properties: { core_details: { road_names: ['I 69'], description: 'Closed, Detour In Operation', direction: 'northbound' }, vehicle_impact: 'unknown', start_date: iso(NOW - H), end_date: iso(NOW + 5 * H) } },
    { id: 'lane', type: 'Feature', geometry: line(-87.55, 37.98), properties: { core_details: { road_names: ['US 41'], description: 'Reduced To One Lane' }, vehicle_impact: 'some-lanes-closed', start_date: iso(NOW - H), end_date: iso(NOW + 5 * H) } },
    { id: 'far', type: 'Feature', geometry: line(-86.1, 39.7), properties: { core_details: { road_names: ['I-69'], description: 'Closed' }, vehicle_impact: 'all-lanes-closed', start_date: iso(NOW - H), end_date: iso(NOW + 5 * H) } },
    { id: 'old', type: 'Feature', geometry: line(-87.55, 37.98), properties: { core_details: { road_names: ['US-41'], description: 'Closed' }, vehicle_impact: 'all-lanes-closed', start_date: iso(NOW - 9 * H), end_date: iso(NOW - H) } },
  ] };
  const rss = '<rss><channel><item><title>Boil Water Advisory - Elm St</title><link>https://hkywater.org/AlertCenter.aspx?AID=1</link><pubDate>' + new Date(NOW - H).toUTCString() + '</pubDate></item>'
    + '<item><title>Boil Water Advisory Lifted - Oak St</title><link>https://hkywater.org/AlertCenter.aspx?AID=2</link><pubDate>' + new Date(NOW - H).toUTCString() + '</pubDate></item></channel></rss>';
  const real = global.fetch;
  global.fetch = async (url) => ({ ok: true, status: 200, json: async () => wz, text: async () => rss });
  try {
    const road = await A.loadFeed(A.FEEDS.find(f => f.id === 'indot-wzdx'), NOW);
    assert.equal(road.length, 1);
    assert.deepEqual([road[0].tier, road[0].label, road[0].end], [5, 'I-69 closure', NOW + 5 * H]);
    const bwa = await A.loadFeed(A.FEEDS.find(f => f.id === 'hwu-bwa'), NOW);
    assert.equal(bwa.length, 1);
    assert.deepEqual([bwa[0].tier, bwa[0].label, bwa[0].end], [4, 'Boil-water advisory', null]);
  } finally { global.fetch = real; }
});
