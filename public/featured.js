/* When a paid Featured period starts and ends. One rule, shared by the page (window.TSNFeatured, shown on the button
   before checkout) and the server (api/_checkout.js names the same window in Stripe; api/stripe-webhook.js applies it).

   - The period starts now, or when the post's current Featured period ends if it has one (purchases stack).
   - It lasts the catalog's days, except for posts tied to a date: an event (its date) or a deal with an end date.
     Those leave the board after that day, so the period stops at the end of that day (midnight America/Chicago), and
     the button says "until <day>" instead of "for N days". The price is the catalog price either way.
   - If the period would add less than MIN_HOURS, the post can't be featured (no button; checkout refuses).
   - Posts without a date (classifieds, jobs, deals without an end date) never lose paid time: the webhook keeps the
     post on its board until the period ends (api/stripe-webhook.js extends the post's expiry and index entry). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNFeatured = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 864e5, MIN_HOURS = 24, TZ = 'America/Chicago';
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  // Minutes east of UTC in Chicago at a moment (-300 in summer, -360 in winter). If the browser can't say, -300,
  // which ends a date-bound period an hour early in winter rather than late.
  function offsetMin(ms) {
    try {
      var p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' }).formatToParts(new Date(ms));
      for (var i = 0; i < p.length; i++) if (p[i].type === 'timeZoneName') {
        var m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(p[i].value);
        if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
      }
    } catch (_) { /* fall through */ }
    return -300;
  }
  // The moment a Chicago calendar day ends (the next local midnight), as epoch ms. NaN for a bad date.
  function dayEnd(date) {
    if (!DATE_RE.test(String(date || ''))) return NaN;
    var next = Date.parse(date + 'T00:00:00Z') + DAY;
    if (!isFinite(next)) return NaN;
    var t = next - offsetMin(next + 6 * 36e5) * 6e4;
    return next - offsetMin(t) * 6e4;
  }
  // The date a post is tied to, or '' (events: their date; deals: their end date, if any).
  function boundDate(post) {
    if (!post) return '';
    if (post.kind === 'event') return post.date || '';
    if (post.kind === 'deal') return post.ends || '';
    return '';
  }
  // post: { kind, date, ends, featuredUntil }. days: the catalog's days. now: epoch ms. minHours: the least time that
  // must remain (default MIN_HOURS; the webhook passes 0, since the buyer saw the period at checkout).
  // -> { ok: true, from, until, capped, bound } or { ok: false, reason: 'too_close' | 'bad_input' }
  function window_(post, days, now, minHours) {
    if (!post || !(days > 0) || !isFinite(now)) return { ok: false, reason: 'bad_input' };
    var from = Math.max(now, Number(post.featuredUntil) || 0), full = from + days * DAY;
    var bound = boundDate(post), cap = bound ? dayEnd(bound) : Infinity;
    if (bound && !isFinite(cap)) return { ok: false, reason: 'bad_input' };
    var until = Math.min(full, cap);
    var min = minHours == null ? MIN_HOURS : minHours;
    // nothing left to sell: the date has passed, or (stacking) the current period already runs to the cap
    if (until <= from || until - from < min * 36e5) return { ok: false, reason: 'too_close' };
    return { ok: true, from: from, until: until, capped: until < full, bound: bound };
  }
  // "Tue, Oct 20" for the day a capped period covers (the day before its end moment).
  function dayLabel(until) {
    return new Date(until - 1).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
  }
  return { DAY: DAY, MIN_HOURS: MIN_HOURS, dayEnd: dayEnd, boundDate: boundDate, window: window_, dayLabel: dayLabel, offsetMin: offsetMin };
});
