// ship76: events leave 58 minutes after they start (or at their end) and say "Happening now" once started.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const E = require('../public/eventtime.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const MIN = 60000;

test('boundaries with a fake clock: start-1min, start, start+58min, start+59min (a post: Chicago date + time)', () => {
  const s = E.chicagoMs('2026-11-07', '19:30');
  assert.strictEqual(new Date(s).toISOString(), '2026-11-08T01:30:00.000Z', 'CST is UTC-6');
  const at = m => E.status({ date: '2026-11-07', time: '19:30' }, s + m * MIN);
  assert.deepStrictEqual(at(-1), { hide: false, live: false });
  assert.deepStrictEqual(at(0), { hide: false, live: true });
  assert.deepStrictEqual(at(58), { hide: false, live: true });
  assert.deepStrictEqual(at(59), { hide: true, live: false });
  assert.strictEqual(E.status({ date: '2026-11-07', time: '19:30' }, s + 58 * MIN + 1).hide, true, 'more than 58 minutes is gone');
});

test('feed starts keep their own offset; DST handled', () => {
  const iso = '2026-07-04T20:00:00-04:00'; // 7 PM CDT
  const s = Date.parse(iso);
  assert.deepStrictEqual([-1, 0, 58, 59].map(m => E.status({ start: iso }, s + m * MIN)), [{ hide: false, live: false }, { hide: false, live: true }, { hide: false, live: true }, { hide: true, live: false }]);
  assert.strictEqual(new Date(E.chicagoMs('2026-07-04', '19:00')).toISOString(), '2026-07-05T00:00:00.000Z', 'CDT is UTC-5');
});

test('date-only events: never "started" at midnight, shown through their Chicago day; no-date events untouched; end times win', () => {
  const day = { date: '2026-11-07' };
  assert.deepStrictEqual(E.status(day, E.chicagoMs('2026-11-07', '23:59')), { hide: false, live: false });
  assert.deepStrictEqual(E.status(day, E.chicagoMs('2026-11-08', '00:00')), { hide: true, live: false });
  const placeholder = '2026-11-07T06:00:00Z'; // midnight CST from a date-only feed: not a time
  assert.deepStrictEqual(E.status({ start: placeholder }, E.chicagoMs('2026-11-07', '12:00')), { hide: false, live: false });
  assert.deepStrictEqual(E.status({}, Date.now()), { hide: false, live: false });
  const multi = { start: '2026-11-07T10:00:00-06:00', end: '2026-11-09T17:00:00-06:00' };
  assert.deepStrictEqual(E.status(multi, Date.parse('2026-11-08T12:00:00-06:00')), { hide: false, live: true }, 'with an end: until the end');
  assert.deepStrictEqual(E.status(multi, Date.parse('2026-11-09T17:01:00-06:00')), { hide: true, live: false });
});

test('the page filters every event list and shows "Happening now" in place of the date and time; it re-checks on an interval', () => {
  const app = read('public/assets/app.js');
  assert.match(app, /function postedEvents\(\) \{ return boards\.event\.items\.filter\(evShown\); \}/);
  assert.match(app, /return x\.date >= today && evShown\(x\);/, 'feed events');
  assert.strictEqual((app.match(/boards\.event\.items\.concat|b\.items\.concat\(feedEvents/g) || []).length, 0, 'no unfiltered event list left');
  assert.match(app, /postedEvents\(\)\.concat\(feedEvents\(\)\)\.forEach\(function \(e\) \{ docs\.push\(getDoc\('events', e\)\);/, 'search');
  assert.ok(app.includes('if (evStatus(it).live) tm.appendChild(liveTag());'), 'event card bottom row (ship79: the one template for every event)');
  assert.match(app, /if \(state\.cat === 'events' \|\| state\.q\.trim\(\)\) render\(\);\n  \}, 30 \* 1000\);/);
  assert.match(read('public/assets/app.css'), /\.ev-live \{[^}]*font-weight:700; color:var\(--red\);/);
  assert.ok(read('public/assets/lib.js').includes('/* ---- public/eventtime.js ---- */'), 'bundled for the page');
  assert.ok(read('package.json').includes('public/eventtime.js'), 'linted');
});

test('the server trims events past their time from every /api/news answer (and the tab pages built from it)', () => {
  const news = require('../api/news.js');
  assert.match(read('api/news.js'), /const evGone = it => \(it\.isEvent \|\| kinds\[it\.sourceId\] === 'events'\) && ET\.status\(\{ start: it\.published, end: it\.end \}, now\)\.hide;/);
  assert.strictEqual(fs.readdirSync(path.join(__dirname, '..', 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.ok(typeof news === 'function');
});
