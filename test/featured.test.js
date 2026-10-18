// Ads PR 2: the Featured window rule (public/featured.js), shared by the page and the server.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const F = require('../public/featured.js');
const root = path.join(__dirname, '..');
const DAY = 864e5, H = 36e5;

test('dayEnd: the next Chicago midnight, across both DST changes', () => {
  assert.strictEqual(new Date(F.dayEnd('2026-10-18')).toISOString(), '2026-10-19T05:00:00.000Z'); // CDT
  assert.strictEqual(new Date(F.dayEnd('2026-11-01')).toISOString(), '2026-11-02T06:00:00.000Z'); // DST ends that day
  assert.strictEqual(new Date(F.dayEnd('2026-12-24')).toISOString(), '2026-12-25T06:00:00.000Z'); // CST
  assert.strictEqual(new Date(F.dayEnd('2027-03-14')).toISOString(), '2027-03-15T05:00:00.000Z'); // DST starts that day
  for (const bad of ['', '2026-13-01x', 'tomorrow', null, undefined]) assert.ok(Number.isNaN(F.dayEnd(bad)), String(bad));
});

test('window: undated posts get the full catalog days; purchases stack on an existing period', () => {
  const now = Date.parse('2026-10-18T15:00:00Z');
  for (const kind of ['item', 'job']) assert.deepStrictEqual(F.window({ kind }, 30, now), { ok: true, from: now, until: now + 30 * DAY, capped: false, bound: '' });
  assert.deepStrictEqual(F.window({ kind: 'deal', ends: '' }, 14, now), { ok: true, from: now, until: now + 14 * DAY, capped: false, bound: '' });
  const fu = now + 5 * DAY;
  assert.deepStrictEqual(F.window({ kind: 'job', featuredUntil: fu }, 30, now), { ok: true, from: fu, until: fu + 30 * DAY, capped: false, bound: '' });
  assert.strictEqual(F.window({ kind: 'job', featuredUntil: now - DAY }, 30, now).from, now, 'an ended period does not count');
});

test('window: events and deals with an end date stop at the end of that day, and the label names it', () => {
  const now = Date.parse('2026-10-18T15:00:00Z'); // Sun 10:00 AM CT
  const ev = F.window({ kind: 'event', date: '2026-10-20' }, 7, now);
  assert.deepStrictEqual(ev, { ok: true, from: now, until: Date.parse('2026-10-21T05:00:00Z'), capped: true, bound: '2026-10-20' });
  assert.strictEqual(F.dayLabel(ev.until), 'Tue, Oct 20');
  const far = F.window({ kind: 'event', date: '2026-12-01' }, 7, now);
  assert.deepStrictEqual([far.capped, far.until], [false, now + 7 * DAY], 'an event far enough out gets the full days');
  const deal = F.window({ kind: 'deal', ends: '2026-10-25' }, 14, now);
  assert.deepStrictEqual([deal.capped, F.dayLabel(deal.until)], [true, 'Sun, Oct 25']);
  assert.strictEqual(F.window({ kind: 'job', date: '2026-10-19', ends: '2026-10-19' }, 30, now).capped, false, 'only events and deals are tied to a date');
});

test('window: not offered when less than a day would be added; the webhook (minHours 0) only needs time left', () => {
  const end = F.dayEnd('2026-10-20');
  assert.deepStrictEqual(F.window({ kind: 'event', date: '2026-10-20' }, 7, end - 10 * H), { ok: false, reason: 'too_close' });
  assert.strictEqual(F.window({ kind: 'event', date: '2026-10-20' }, 7, end - 25 * H).ok, true);
  assert.strictEqual(F.window({ kind: 'event', date: '2026-10-20' }, 7, end - 10 * H, 0).ok, true);
  assert.deepStrictEqual(F.window({ kind: 'event', date: '2026-10-20' }, 7, end + 1, 0), { ok: false, reason: 'too_close' }, 'date passed');
  assert.deepStrictEqual(F.window({ kind: 'event', date: '2026-10-20', featuredUntil: end }, 7, end - 3 * DAY, 0), { ok: false, reason: 'too_close' }, 'already featured to the cap: nothing to sell');
  for (const bad of [[null, 7, 1], [{ kind: 'job' }, 0, 1], [{ kind: 'job' }, 7, NaN], [{ kind: 'event', date: 'soon' }, 7, 1]]) assert.deepStrictEqual(F.window(...bad), { ok: false, reason: 'bad_input' });
});

test('one file for page and server: the page loads it, checkout and the webhook require it, lint checks it', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<script src="/featured.js"></script>'));
  assert.ok(html.includes("TSNFeatured.window({ kind: kind, date: it.date, ends: it.ends }, pr.days, Date.now())"));
  assert.ok(html.includes('fw && fw.ok'), 'no button when the window is not ok');
  for (const f of ['api/_checkout.js', 'api/stripe-webhook.js']) assert.ok(fs.readFileSync(path.join(root, f), 'utf8').includes("require('../public/featured.js')"), f);
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.lint.includes('public/featured.js'));
});
