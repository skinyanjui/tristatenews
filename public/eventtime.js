/* When an event shows and when it is "Happening now" (ship76). One rule, shared by the page (window.TSNEventTime),
   the server (api/news.js trims what /api/news and the tab pages send) and the tests.

   - An event with a start time is shown until 58 minutes after it starts (now - start <= 58 min) and hidden from the
     59th minute on. From its start until then it is "Happening now".
   - An event with an end time (end, ISO with its offset) is shown until it ends instead, "Happening now" from start to end.
   - A date-only event (no time; a feed time before 6 AM Chicago is a placeholder midnight, as the page has always
     read it) is never counted as started: it is shown through the end of its day in Chicago and never says
     "Happening now".
   - An event with no date at all is left alone.
   Times: an ISO start keeps its own offset; a post's date + "HH:MM" is a local time in America/Chicago (DST-aware). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNEventTime = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TZ = 'America/Chicago', GRACE_MS = 58 * 60 * 1000;
  var FMT = null;
  function parts(ms) {
    if (!FMT) FMT = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var o = {}; FMT.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { date: o.year + '-' + o.month + '-' + o.day, hm: (o.hour === '24' ? '00' : o.hour) + ':' + o.minute, wall: Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second) };
  }
  // A Chicago wall time ("2026-11-07", "19:30") as an instant.
  function chicagoMs(date, hm) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '')), t = /^(\d{2}):(\d{2})$/.exec(String(hm || '00:00'));
    if (!m || !t) return NaN;
    var wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]), guess = wall + 6 * 36e5;
    for (var i = 0; i < 2; i++) guess += wall - parts(guess).wall;
    return guess;
  }
  function today(now) { return parts(now).date; }
  // An ISO start from a feed as the page reads it: its Chicago date, and its time unless it is a placeholder (< 6 AM).
  function fromIso(iso) {
    var ms = Date.parse(iso); if (!Number.isFinite(ms)) return null;
    var p = parts(ms); return { date: p.date, time: p.hm < '06:00' ? '' : p.hm, ms: p.hm < '06:00' ? NaN : ms };
  }
  // ev: { start (ISO), date ("YYYY-MM-DD"), time ("HH:MM"), end (ISO) }. Returns { hide, live }.
  function status(ev, now) {
    ev = ev || {};
    var date = ev.date, ms = NaN;
    if (ev.time && date) ms = chicagoMs(date, ev.time);
    else if (ev.start) { var f = fromIso(ev.start); if (f) { date = date || f.date; ms = f.ms; } }
    var end = ev.end ? Date.parse(ev.end) : NaN;
    if (Number.isFinite(end)) return { hide: now > end, live: Number.isFinite(ms) && now >= ms && now <= end };
    if (Number.isFinite(ms)) return { hide: now - ms > GRACE_MS, live: now >= ms && now - ms <= GRACE_MS };
    if (date) return { hide: date < today(now), live: false };
    return { hide: false, live: false };
  }
  function visible(ev, now) { return !status(ev, now).hide; }
  return { status: status, visible: visible, chicagoMs: chicagoMs, fromIso: fromIso, today: today, GRACE_MS: GRACE_MS, TZ: TZ, LABEL: 'Happening now' };
});
