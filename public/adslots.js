/* The in-listing ad card: which boards may carry it, where it goes, and what fills it. One rule, shared by the page
   (window.TSNAds) and the tests.

   - Only the Jobs, Deals, Classifieds and Events boards carry it. News/All, News, Police & courts, Institutions,
     Obituaries, Breaking cards, Liked and search results never do (fill() returns null for anything else).
   - One card per board view: after the 6th post, or after the last one on a shorter board; none on an empty board.
   - Never targeted. Every reader of a board sees the same ad: a direct sponsor from sponsors.json ("cards", one key
     per board), and when a board has several they rotate by the date in Chicago, the same for everyone. No cookies,
     no storage, no reader data. When the slot is unsold it holds the site's own "Advertise with us" unit.
   - An entry { "network": "..." } is reserved for a future ad network; none is connected, so it falls back to the
     house unit. Connecting one needs the Advertising and Privacy policies (and a consent notice) updated first. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNAds = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var BOARDS = { item: 'classifieds', deal: 'deals', event: 'events', job: 'jobs' }; // board kind -> sponsors.json key
  var AD_TABS = ['events', 'jobs', 'deals', 'classifieds']; // the only tabs with any ad (side ads included)
  var AFTER = 6;
  var DAY = 864e5;
  // A direct ad as sponsors.json gives it: a name and an https link (text and cta optional, strings).
  function validAd(ad) {
    if (!ad || typeof ad !== 'object' || Array.isArray(ad)) return false;
    if (typeof ad.name !== 'string' || !ad.name.trim() || typeof ad.url !== 'string' || !/^https:\/\/[^\s"'<>]+$/i.test(ad.url)) return false;
    if (ad.text != null && typeof ad.text !== 'string') return false;
    if (ad.cta != null && typeof ad.cta !== 'string') return false;
    return true;
  }
  // The Chicago calendar date as a day number, the same for every reader that day (rotation only, never targeting).
  function dayNumber(now) {
    var d = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    return Math.floor(Date.parse(d + 'T00:00:00Z') / DAY);
  }
  // What fills the card on a board: { type: 'direct', ad } | { type: 'house' }, or null where no ad may appear.
  function fill(kind, cards, now) {
    if (!Object.prototype.hasOwnProperty.call(BOARDS, kind)) return null;
    var v = cards && Object.prototype.hasOwnProperty.call(cards, BOARDS[kind]) ? cards[BOARDS[kind]] : null;
    var list = (Array.isArray(v) ? v : v ? [v] : []).filter(validAd);
    if (list.length) return { type: 'direct', ad: list[((dayNumber(now) % list.length) + list.length) % list.length] };
    return { type: 'house' }; // unsold, or a reserved network entry (no network is connected)
  }
  // How many posts come before the card, or -1 for no card.
  function position(count) {
    count = Number(count) || 0;
    return count <= 0 ? -1 : Math.min(count, AFTER);
  }
  return { BOARDS: BOARDS, AD_TABS: AD_TABS, AFTER: AFTER, validAd: validAd, dayNumber: dayNumber, fill: fill, position: position };
});
