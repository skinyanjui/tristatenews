/* "Send flowers" on obituaries: the one exception to "no ads on Obituaries" (Advertising Policy section 8). It is a
   quiet text link under the notice, never an ad unit, image or script. One rule, shared by the page
   (window.TSNFlowers), the server (api/_flowers.js) and the tests.

   - If the obituary's funeral home is in data/funeral-homes.json with a checked https florist page, the link goes
     there. It is not paid, so it has no "paid link" label.
   - Otherwise, if an affiliate ID is set (FLORIST_ONE_AFFILIATE_ID on the server, or data/flowers.json), the link is
     the affiliate link, labeled "paid link" and marked rel="sponsored noopener".
   - Otherwise there is no link at all.
   - The link carries nothing about the reader or the obituary: the florist page as listed, or the affiliate URL with
     only our ID in it. Same link for every reader. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNFlowers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DROP = { the: 1, funeral: 1, home: 1, homes: 1, and: 1, crematory: 1, cremation: 1, chapel: 1, chapels: 1, mortuary: 1, inc: 1, llc: 1, services: 1 };
  // "Nass & Son Funeral Home" and "NASS AND SON" give the same key: "nass son".
  function key(name) {
    var words = String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[\u2019']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
    return words.filter(function (w) { return w && !DROP[w]; }).join(' ');
  }
  function httpsUrl(u) {
    if (typeof u !== 'string' || u.length > 500) return '';
    try { var x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password ? x.href : ''; } catch (_) { return ''; }
  }
  // The funeral home an obituary names: a posted notice's "business", or the Source of a feed card (only funeral
  // homes' names are in the map, so a paper's name never matches).
  function homeOf(it) { return it ? (it.business || it.source || '') : ''; }
  // cfg is GET /api/flowers: { homes: { key: url }, affiliate: url | null }. Returns { href, paid } or null.
  function linkFor(it, cfg) {
    if (!cfg || typeof cfg !== 'object') return null;
    var k = key(homeOf(it));
    var home = k && cfg.homes && Object.prototype.hasOwnProperty.call(cfg.homes, k) ? httpsUrl(cfg.homes[k]) : '';
    if (home) return { href: home, paid: false };
    var aff = httpsUrl(cfg.affiliate);
    return aff ? { href: aff, paid: true } : null;
  }
  return { key: key, httpsUrl: httpsUrl, homeOf: homeOf, linkFor: linkFor, REL_PAID: 'sponsored noopener', LABEL_PAID: 'paid link' };
});
