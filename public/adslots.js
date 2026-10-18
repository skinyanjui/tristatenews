/* The in-listing ad card: which boards may carry it, where it goes, and what fills it. One rule, shared by the page
   (window.TSNAds) and the tests.

   - Only the Jobs, Deals, Classifieds and Events boards carry it. News/All, News, Police & courts, Institutions,
     Obituaries, Breaking cards, Liked and search results never do (fill() returns null for anything else).
   - One card per board view: after the 6th post, or after the last one on a shorter board; none on an empty board.
   - Only approved creatives fill it. The page reads /api/creative?live=1 (api/_creative.js), which lists only what an
     admin approved in admin.html, with a reason, for that placement; ads typed into sponsors.json are never shown.
   - Never targeted. Every reader of a board sees the same ad, and when a board has several they rotate by the date
     in Chicago, the same for everyone. No cookies, no storage, no reader data. When the slot is unsold it holds the
     site's own "Advertise with us" unit.
   - Sample ads: while spots are unsold, sponsors.json "samples" (one switch: "on") can show made-up placeholder
     businesses instead of the plain house unit. Each is labeled "Sample ad", links only to /advertise, and never
     takes the place of a real, approved ad. Same rotation for every reader.
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
  var CTAS = ['Visit website', 'Call now', 'Get directions', 'Shop now', 'Learn more'];
  // An approved ad as /api/creative?live=1 gives it: a name (the headline) and an https or tel: destination; text,
  // a CTA from the fixed list, and an image served by /api/creative are optional.
  function validAd(ad) {
    if (!ad || typeof ad !== 'object' || Array.isArray(ad)) return false;
    if (typeof ad.name !== 'string' || !ad.name.trim() || typeof ad.url !== 'string') return false;
    if (!/^https:\/\/[^\s"'<>]+$/i.test(ad.url) && !/^tel:\+1\d{10}$/.test(ad.url)) return false;
    if (ad.text != null && typeof ad.text !== 'string') return false;
    if (ad.cta != null && CTAS.indexOf(ad.cta) < 0) return false;
    if (ad.img != null && !/^\/api\/creative\?img=cr[a-z0-9]{10}$/.test(ad.img)) return false;
    return true;
  }
  // The Chicago calendar date as a day number, the same for every reader that day (rotation only, never targeting).
  function dayNumber(now) {
    var d = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    return Math.floor(Date.parse(d + 'T00:00:00Z') / DAY);
  }
  // One ad from a slot (an ad or a list), rotating by the Chicago date; null when none is valid.
  function pick(v, now) {
    var list = (Array.isArray(v) ? v : v ? [v] : []).filter(validAd);
    return list.length ? list[((dayNumber(now) % list.length) + list.length) % list.length] : null;
  }
  // A placeholder sample ad: a short made-up name and line from sponsors.json. Its link is always /advertise (set by
  // the page, never taken from the file), so it can't send anyone to an outside site.
  function validSample(ad) {
    if (!ad || typeof ad !== 'object' || Array.isArray(ad)) return false;
    if (typeof ad.name !== 'string' || !ad.name.trim() || ad.name.length > 40) return false;
    if (ad.text != null && (typeof ad.text !== 'string' || ad.text.length > 100)) return false;
    return Object.keys(ad).every(function (k) { return k === 'name' || k === 'text'; });
  }
  // The sample list when the switch is on, else []. samples: sponsors.json "samples" ({ on, ads }).
  function sampleList(samples) {
    if (!samples || samples.on !== true || !Array.isArray(samples.ads)) return [];
    return samples.ads.filter(validSample);
  }
  // One sample for a spot (offset keeps the card, sponsor line and side ad on a board from showing the same one).
  function sample(samples, offset, now) {
    var list = sampleList(samples);
    if (!list.length) return null;
    var i = dayNumber(now) + (Number(offset) || 0);
    return list[((i % list.length) + list.length) % list.length];
  }
  var OFFSET = { classifieds: 0, deals: 2, events: 4, jobs: 6 };
  // What fills the card on a board: { type: 'direct', ad } | { type: 'sample', ad } | { type: 'house' }, or null where
  // no ad may appear. A real ad always comes first; samples only stand in for an unsold spot.
  function fill(kind, cards, now, samples) {
    if (!Object.prototype.hasOwnProperty.call(BOARDS, kind)) return null;
    var v = cards && Object.prototype.hasOwnProperty.call(cards, BOARDS[kind]) ? cards[BOARDS[kind]] : null;
    var ad = pick(v, now);
    if (ad) return { type: 'direct', ad: ad };
    var sm = sample(samples, OFFSET[BOARDS[kind]], now);
    if (sm) return { type: 'sample', ad: sm };
    return { type: 'house' }; // unsold, or a reserved network entry (no network is connected)
  }
  // How many posts come before the card, or -1 for no card.
  function position(count) {
    count = Number(count) || 0;
    return count <= 0 ? -1 : Math.min(count, AFTER);
  }
  return { BOARDS: BOARDS, AD_TABS: AD_TABS, AFTER: AFTER, CTAS: CTAS, validAd: validAd, pick: pick, validSample: validSample, sampleList: sampleList, sample: sample, OFFSET: OFFSET, dayNumber: dayNumber, fill: fill, position: position };
});
