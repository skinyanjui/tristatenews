/* "Send flowers" on obituaries: the one exception to "no ads on Obituaries" (Advertising Policy section 8). It is a
   quiet text link under the notice, never an ad unit, image or script. One rule, shared by the page
   (window.TSNFlowers), the server (api/_flowers.js) and the tests.

   - If the obituary's funeral home is in data/funeral-homes.json with a checked https florist page, the link goes
     there. It is not paid, so it has no "paid link" label.
   - Otherwise, if an affiliate ID is set (FLORIST_ONE_AFFILIATE_ID on the server, or data/flowers.json), the link is
     the affiliate link, labeled "paid link" and marked rel="sponsored noopener".
   - Otherwise, if data/flowers.json has a fallbackUrl (a florist's public funeral-flowers page, no affiliate code),
     the link goes there. Nothing is earned, so there is no "paid link" label; rel="noopener nofollow".
   - Otherwise (fallbackUrl emptied) there is no link at all.
   "Plant a tree" (treeFor) works the same way from cfg.tree: the home's treeUrl, else a paid affiliate link (only with
   an ID and a link template), else the unpaid fallbackUrl (One Tree Planted's memorial-tree page), else nothing.
   "Donate" (donateFor) never invents a charity: the home's donateUrl; else, when the obituary text itself asks for
   donations ("in lieu of flowers", "memorial contributions may be made to ..."), an https link written in that text,
   or the obituary's own page (where the family's wording and the charity are); otherwise there is no Donate link.
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
  // cfg is GET /api/flowers: { homes: { key: url }, affiliate: url | null, fallbackUrl: url | null }.
  // Returns { href, paid, rel } or null.
  function linkFor(it, cfg) {
    if (!cfg || typeof cfg !== 'object') return null;
    var k = key(homeOf(it));
    var home = k && cfg.homes && Object.prototype.hasOwnProperty.call(cfg.homes, k) ? httpsUrl(cfg.homes[k]) : '';
    if (home) return { href: home, paid: false, rel: REL_HOME };
    var aff = httpsUrl(cfg.affiliate);
    if (aff) return { href: aff, paid: true, rel: REL_PAID };
    var fb = httpsUrl(cfg.fallbackUrl);
    return fb ? { href: fb, paid: false, rel: REL_FALLBACK } : null;
  }
  // "Plant a tree": cfg.tree is { homes, affiliate, fallbackUrl }, the same shape and order as flowers.
  function treeFor(it, cfg) { return cfg && typeof cfg === 'object' && cfg.tree && typeof cfg.tree === 'object' ? linkFor(it, cfg.tree) : null; }
  // The obituary asks for donations: "in lieu of flowers", "memorial contributions/donations may be made to",
  // "donations in his memory to" and the like. Only the obituary's own words count.
  var ASK_RE = /\bin lieu of flowers\b|\b(memorial|memorials|contributions|donations|gifts)\b[^.]{0,60}\b(may|can|be|are)\b[^.]{0,30}\b(made|given|sent|directed)\b[^.]{0,10}\bto\b|\b(donations|contributions|memorials)\b[^.]{0,40}\b(in (his|her|their) (memory|honor|name))\b[^.]{0,20}\bto\b/i;
  function asksDonations(text) { return ASK_RE.test(String(text || '').slice(0, 4000)); }
  // An https link written in the donation sentence (the family's charity), if any.
  function linkInAsk(text) {
    var t = String(text || '').slice(0, 4000), m = ASK_RE.exec(t); if (!m) return '';
    var rest = t.slice(m.index, m.index + 400), u = /https:\/\/[^\s<>"')]+/i.exec(rest);
    return u ? httpsUrl(u[0].replace(/[.,;:]+$/, '')) : '';
  }
  // "Donate": { href, paid:false, rel } or null (hidden).
  function donateFor(it, cfg) {
    if (!it) return null;
    var k = key(homeOf(it)), dh = cfg && cfg.donate && cfg.donate.homes;
    var home = k && dh && Object.prototype.hasOwnProperty.call(dh, k) ? httpsUrl(dh[k]) : '';
    if (home) return { href: home, paid: false, rel: REL_HOME };
    var text = [it.summary, it.desc].filter(Boolean).join(' ');
    if (!asksDonations(text)) return null;
    var inText = linkInAsk(text); if (inText) return { href: inText, paid: false, rel: REL_FALLBACK };
    var page = httpsUrl(it.link || '');
    return page ? { href: page, paid: false, rel: REL_FALLBACK, page: true } : null;
  }
  var REL_HOME = 'noopener', REL_PAID = 'sponsored noopener', REL_FALLBACK = 'noopener nofollow';
  return { key: key, httpsUrl: httpsUrl, homeOf: homeOf, linkFor: linkFor, treeFor: treeFor, donateFor: donateFor, asksDonations: asksDonations, linkInAsk: linkInAsk, REL_HOME: REL_HOME, REL_PAID: REL_PAID, REL_FALLBACK: REL_FALLBACK, LABEL_PAID: 'paid link' };
});
