// Ship 70: CI, error logging, Chicago-day events and calendar time zones, tabs built once with tabpanels, robots,
// shared escaping, CDATA decoding, dead files.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const N = require('../api/news.js');
const LOG = require('../api/_log.js');
const H = require('../api/_html.js');

test('CI runs lint, the asset check and the tests on PRs and pushes to main, with no secrets and blank store vars', () => {
  const y = read('.github/workflows/ci.yml');
  assert.match(y, /^name: CI$/m); assert.match(y, /^  test:$/m);
  assert.match(y, /pull_request:/); assert.match(y, /push:\n\s+branches: \[main\]/);
  assert.match(y, /node-version: 20/);
  for (const v of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'REDIS_URL', 'EXTRA_FEEDS']) assert.match(y, new RegExp('^\\s+' + v + ": ''$", 'm'), v);
  assert.ok(!/secrets\./.test(y), 'no secrets');
  assert.match(y, /npm run lint/); assert.match(y, /node scripts\/build-assets\.js/); assert.match(y, /npm test/);
  assert.match(y, /permissions:\n\s+contents: read/);
});

test('calendar times: Z, TZID (New York, Indiana, quoted), floating = Chicago, all-day, unknown zone = Chicago', () => {
  const d = l => N.icalDate(l);
  assert.equal(d('DTSTART;TZID=America/New_York:20261030T190000'), '2026-10-30T23:00:00.000Z');
  assert.equal(d('DTSTART;TZID="America/Indiana/Indianapolis":20261030T190000'), '2026-10-30T23:00:00.000Z');
  assert.equal(d('DTSTART;TZID=America/Indiana/Vincennes:20261205T190000'), '2026-12-06T00:00:00.000Z');
  assert.equal(d('DTSTART:20261030T190000'), '2026-10-31T00:00:00.000Z');
  assert.equal(d('DTSTART:20261031T000000Z'), '2026-10-31T00:00:00.000Z');
  assert.equal(d('DTSTART;VALUE=DATE:20261101'), '2026-11-01T05:00:00.000Z');
  assert.equal(d('DTSTART;TZID=Bogus/Zone:20261030T190000'), '2026-10-31T00:00:00.000Z');
  assert.equal(d('DTSTART;TZID=America/Chicago;X-FOO=1:20261030T190000'), '2026-10-31T00:00:00.000Z');
});

test('DST: fall-back 1:30 AM is the first (daylight) one; spring-forward 2:30 AM moves an hour on; evenings across the change', () => {
  assert.equal(N.icalDate('DTSTART;TZID=America/Chicago:20261101T013000'), '2026-11-01T06:30:00.000Z');
  assert.equal(N.icalDate('DTSTART;TZID=America/Chicago:20260308T023000'), '2026-03-08T08:30:00.000Z');
  assert.equal(N.icalDate('DTSTART;TZID=America/New_York:20260308T023000'), '2026-03-08T07:30:00.000Z');
  assert.equal(N.icalDate('DTSTART:20261031T190000'), '2026-11-01T00:00:00.000Z'); // CDT
  assert.equal(N.icalDate('DTSTART:20261101T190000'), '2026-11-02T01:00:00.000Z'); // CST
  assert.equal(N.zonedToUtc('America/Chicago', 2026, 3, 7, 19, 0).toISOString(), '2026-03-08T01:00:00.000Z');
  assert.equal(N.zonedToUtc('America/Chicago', 2026, 3, 8, 19, 0).toISOString(), '2026-03-09T00:00:00.000Z');
});

test('Chicago dates: 6, 7 and 8 PM CT are the same day though 7 and 8 PM are the next UTC day; day start honors DST', () => {
  for (const h of ['23:00', '00:30', '01:59']) {
    const t = Date.parse((h === '23:00' ? '2026-10-30T' : '2026-10-31T') + h + ':00Z');
    assert.equal(N.chicagoDate(t), '2026-10-30', h);
  }
  assert.equal(new Date(N.chicagoDayStart(Date.parse('2026-10-31T01:00:00Z'))).toISOString(), '2026-10-30T05:00:00.000Z');
  assert.equal(new Date(N.chicagoDayStart(Date.parse('2026-12-01T03:00:00Z'))).toISOString(), '2026-11-30T06:00:00.000Z');
});

const evSource = N.SOURCES.find(s => s.kind === 'events');
const ev = (title, published, link) => ({ title, link: link || 'https://ex.com/' + encodeURIComponent(title) + published, summary: '', image: '', published, source: evSource.name, sourceId: evSource.id, isEvent: true, venue: '', area: evSource.area });

test('events: one per title per Chicago day (6:30 PM and 7:30 PM CT listings of one show are one event)', () => {
  const now = Date.parse('2026-10-30T15:00:00Z');
  const out = N.combine([{ source: evSource, items: [ev('Fall Fest Concert', '2026-10-30T23:30:00Z'), ev('Fall Fest Concert', '2026-10-31T00:30:00Z'), ev('Fall Fest Concert', '2026-10-31T23:30:00Z')] }], now);
  const got = out.filter(i => i.isEvent || i.title === 'Fall Fest Concert').map(i => i.published);
  assert.deepEqual(got.sort(), ['2026-10-30T23:30:00Z', '2026-10-31T23:30:00Z'].sort());
});

test('events: the window starts at the start of today in Chicago, not 24 hours ago', () => {
  const now = Date.parse('2026-10-30T15:00:00Z'); // 10 AM CDT
  const out = N.combine([{ source: evSource, items: [ev('Breakfast this morning', '2026-10-30T12:00:00Z'), ev('Last night show', '2026-10-30T02:00:00Z')] }], now);
  const titles = out.map(i => i.title);
  assert.ok(titles.includes('Breakfast this morning'));
  assert.ok(!titles.includes('Last night show'), 'yesterday evening (CT) is gone');
});

test('CDATA text decodes like plain text (double-encoded entities read the same)', () => {
  const src = { id: 't', name: 'T', url: 'https://ex.com/feed', area: 'Evansville', kind: 'news' };
  const rss = t => '<rss><channel><item><title>' + t + '</title><link>https://ex.com/a</link><pubDate>Thu, 29 Oct 2026 09:00:00 CDT</pubDate></item></channel></rss>';
  const a = N.parseFeed(rss('<![CDATA[Mayor&#8217;s &amp;quot;plan&quot; Q&amp;A]]>'), src)[0].title;
  const b = N.parseFeed(rss('Mayor&amp;#8217;s &amp;quot;plan&amp;quot; Q&amp;amp;A'), src)[0].title;
  assert.equal(a, 'Mayor’s "plan" Q&A'); assert.equal(b, a);
  assert.equal(N.parseFeed(rss('<![CDATA[Fish & Chips <b>night</b>]]>'), src)[0].title, 'Fish & Chips night');
});

test('_log: one line, URLs, emails and tokens masked, extra fields only', t => {
  const lines = []; t.mock.method(console, 'error', m => lines.push(m));
  LOG.fail('stripe-webhook', new Error('store HTTP 500 at https://x.upstash.io/pipeline?token=abc for bob@example.com Bearer sk_live_123'), { event: 'evt_1', type: 'checkout.session.completed', empty: '' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0], '[tsn] stripe-webhook failed: store HTTP 500 at https://x.upstash.io/… for [email] Bearer [hidden] (event=evt_1 type=checkout.session.completed)');
  LOG.fail('x', null); LOG.fail('y', 'plain'); assert.equal(lines.length, 3);
});

test('every endpoint logs its top-level failure (no body, no env); the webhook logs event id and type', () => {
  const where = { 'api/alerts.js': 'alerts', 'api/listings.js': 'listings', 'api/newsletter.js': 'newsletter', 'api/react.js': 'react', 'api/unsubscribe.js': 'unsubscribe',
    'api/_submit.js': 'submit', 'api/_advertise.js': 'advertise', 'api/_creative.js': 'creative', 'api/_campaigns.js': 'campaigns', 'api/_packages.js': 'packages',
    'api/_checkout.js': 'checkout', 'api/_orders.js': 'orders', 'api/_subscribe.js': 'subscribe', 'api/_coverage.js': 'coverage', 'api/_locations.js': 'locations', 'api/_refresh.js': 'refresh', 'api/news.js': 'news' };
  for (const [f, w] of Object.entries(where)) assert.match(read(f), new RegExp("require\\('\\./_log\\.js'\\)\\.fail\\('" + w + "', e\\)"), f);
  assert.match(read('api/stripe-webhook.js'), /fail\('stripe-webhook', e, \{ event: ev && ev\.id, type: ev && ev\.type \}\)/);
});

test('dispatch: a route that throws or rejects is logged and answers 500; a sent answer is left alone', async t => {
  const lines = []; t.mock.method(console, 'error', m => lines.push(m));
  const D = require('../api/_dispatch.js');
  const mk = () => { const r = { headersSent: false, h: {}, code: 0, body: null, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; } }; return r; };
  const h = D.host({ boom: () => () => { throw new Error('sync boom'); }, rej: () => async () => { throw new Error('async boom'); }, ok: () => (req, res) => res.status(200).json({ ok: 1 }) });
  let res = mk(); await h({ query: { __route: 'boom' } }, res); assert.equal(res.code, 500);
  res = mk(); await h({ query: { __route: 'rej' } }, res); assert.equal(res.code, 500);
  res = mk(); await h({ query: { __route: 'ok' } }, res); assert.equal(res.code, 200);
  assert.deepEqual(lines, ['[tsn] route boom failed: sync boom', '[tsn] route rej failed: async boom']);
});

test('one escaping module: every HTML builder uses api/_html.js; the regex helper in _places.js is escRe', () => {
  assert.equal(H.esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(H.esc(null), ''); assert.equal(H.esc(0), '0');
  assert.equal(H.jsonScript({ a: '</script>\u2028\u2029<!--&' }), '{"a":"\\u003c/script\\u003e\\u2028\\u2029\\u003c!--\\u0026"}');
  for (const f of ['api/_advertise.js', 'api/_submit.js', 'api/_geopage.js', 'api/_subscribe.js', 'api/newsletter.js', 'api/_cards.js', 'api/_tabpage.js']) {
    const s = read(f);
    assert.match(s, /require\('\.\/_html\.js'\)/, f);
    assert.ok(!/const esc = s =>/.test(s), f + ' has its own esc');
  }
  const p = read('api/_places.js'); assert.match(p, /const escRe = /); assert.ok(!/\besc\(|\.map\(esc\)/.test(p));
});

test('tabs are built once and updated in place, with aria-controls and labelled tabpanels', () => {
  const js = read('public/assets/app.js');
  const fn = js.slice(js.indexOf('function renderTabs()'), js.indexOf('// Prefetch on intent'));
  assert.match(fn, /if \(key !== tabsKey\)/, 'rebuilt only when the set of tabs changes');
  assert.match(fn, /b\.setAttribute\('aria-controls', TAB_PANEL\[c\.id\]\)/);
  assert.match(fn, /p\.setAttribute\('role', 'tabpanel'\)/); assert.match(fn, /p\.setAttribute\('aria-labelledby', 'tab-' \+ by\)/);
  assert.match(fn, /back\.focus\(\)/, 'focus kept across a rebuild');
  const html = read('data/pages/index.html');
  for (const id of ['list', 'ev', 'ob', 'jb', 'dl', 'cl']) assert.match(html, new RegExp('id="' + id + '"'), id);
});

test('robots.txt: /api/news and /api/listings crawlable, the rest of /api/ blocked', () => {
  const r = read('public/robots.txt');
  assert.match(r, /^Disallow: \/api\/$/m); assert.match(r, /^Allow: \/api\/news$/m); assert.match(r, /^Allow: \/api\/listings$/m);
  assert.match(r, /^Disallow: \/admin\.html$/m);
});

test('dead files removed; generated geo-data.json and the census tool stay (they are part of the geography build)', () => {
  assert.ok(!fs.existsSync(path.join(root, 'metadata.json')));
  assert.ok(fs.existsSync(path.join(root, 'public', 'geo-data.json')));
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'extract-census.js')));
});
