/* Obituaries: comments off, photos off, no in-feed ad neighbors; also used to route news-feed
   death notices into the Obituaries tab (api/news.js looksLikeObit + page remount). Strong signals
   only: name+age, "obituary"/obituar text, /obituar|/obits/|legacy|tributes|funeral-home URLs, known
   obit sources, or ≥2 weak hints plus a person-name pattern. Weak hints alone (age N, funeral,
   visitation, formerly of) must not trip. Missing module → fail closed. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNObit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Weak soft signals — need a partner hint + person name, never alone.
  var WEAK_HINT_RE = /\b(?:age\s+\d{1,3}|passed away|formerly of|visitation|funeral|in loving memory|celebration of life)\b/gi;
  // Strong text: the word obituary / obituaries.
  var STRONG_TEXT_RE = /\bobituar(?:y|ies)\b/i;
  // Name + age forms that slip past kindOf (news sourceId, not ob-*): "Name, age 73, of Town".
  var AGE_HEAD_RE = /^(?:["\u201c(]?[A-Z][A-Za-z.'\u2019\u201d"()-]*\s+){1,6}[A-Z][A-Za-z.'\u2019-]+(?:,? (?:Jr|Sr|II|III|IV)\.?)?(?:,\s*age\s+\d{1,3},?|\s+\(\d{1,3}\)|,\s*\d{1,3},?)\s+(?:of\s+)?[A-Z]/;
  var NAME_AGE_RE = /^(?:["\u201c(]?[A-Z][A-Za-z.'\u2019\u201d"()-]*\s+){1,5}[A-Z][A-Za-z.'\u2019-]+(?:,? (?:Jr|Sr|II|III|IV)\.?)?,\s*\d{1,3},\s+(?:of\s+)?[A-Z]/;
  // Person-like name in a headline/dek (First Last, or "of Name" memorial form).
  var PERSON_NAME_RE = /\b(?:[A-Z][a-zA-Z.'\u2019-]+(?:\s+(?:[A-Z]\.|[A-Z][a-zA-Z.'\u2019-]+)){1,4}|(?:of|for)\s+[A-Z][a-zA-Z.'\u2019-]+)\b/;
  // Kept for callers/tests that still reference HINT_RE (union of weak + strong text).
  var HINT_RE = /\b(?:age\s+\d{1,3}|passed away|formerly of|obituar(?:y|ies)|visitation|funeral|in loving memory|celebration of life)\b/i;
  // Path and host patterns that are strong URL signals (not title-only).
  var OBIT_PATH_RE = /\/(?:obituar[a-z]*|obits?)(?:\/|$|[?#-])/i;
  var OBIT_HOST_RE = /(?:^|\.)(?:legacy\.com|tributes\.com)$|(?:funeralhome|mortuary|memorialchapel|memorial-chapel)/i;

  function haystack(it) {
    it = it || {};
    var title = String(it.title || '');
    var summary = String(it.summary || it.dek || '');
    var link = String(it.link || it.url || '');
    var slug = '';
    try {
      slug = decodeURIComponent(new URL(link).pathname || '');
    } catch (e) {
      slug = link;
    }
    slug = slug.replace(/\.[a-z0-9]+$/i, '').replace(/[-_+/]+/g, ' ');
    return [title, summary, slug].join('\n');
  }

  function obitUrl(it) {
    var link = String((it && (it.link || it.url)) || '');
    try {
      var u = new URL(link);
      var host = String(u.hostname || '').toLowerCase();
      if (OBIT_PATH_RE.test(u.pathname || '')) return true;
      if (OBIT_HOST_RE.test(host)) return true;
      if (/news\.google\./i.test(host) && /obituar/i.test(u.href)) return true;
    } catch (e) {
      if (OBIT_PATH_RE.test(link) || /legacy\.com|tributes\.com|funeralhome|mortuary|memorial.?chapel/i.test(link)) return true;
    }
    return false;
  }

  function googleObitSource(it) {
    it = it || {};
    var sid = String(it.sourceId || '');
    var src = String(it.source || '');
    if (/^ob-/i.test(sid) || /\bobits?\b/i.test(sid)) return true;
    if (/\bobituar/i.test(src) || /\bobits?\b/i.test(src)) return true;
    var link = String(it.link || it.url || '');
    try {
      var u = new URL(link);
      if (/news\.google\./i.test(u.hostname) && (/\bobituar/i.test(u.href) || /[?&]q=[^&]*obituar/i.test(u.search))) return true;
    } catch (e) {}
    return false;
  }

  function weakHintCount(s) {
    WEAK_HINT_RE.lastIndex = 0;
    var n = 0, m;
    while ((m = WEAK_HINT_RE.exec(s))) n++;
    return n;
  }

  function hasPersonName(s) {
    return PERSON_NAME_RE.test(String(s || ''));
  }

  function obitText(s) {
    s = String(s || '');
    var title = (s.split('\n')[0] || s).trim();
    // Strong: classic name + age headline forms.
    if (AGE_HEAD_RE.test(title) || NAME_AGE_RE.test(title)) return true;
    // Strong: the word obituary / obituaries in title, dek, or slug text.
    if (STRONG_TEXT_RE.test(s)) return true;
    // Weak path: at least two weak hints AND a person-name pattern.
    if (weakHintCount(s) >= 2 && hasPersonName(s)) return true;
    return false;
  }

  function obitStory(it) {
    it = it || {};
    if (googleObitSource(it) || obitUrl(it)) return true;
    return obitText(haystack(it));
  }

  function obitTitle(title) { return obitStory({ title: title }); }

  // Feed URL / registry helper: Google News obituary queries, /obituaries paths, funeral-home hosts.
  function obitFeedUrl(url) {
    var s = String(url || '');
    if (/\/(?:obituar[a-z]*|obits?)(?:\/|$|[?#])/i.test(s)) return true;
    if (/news\.google\.com\/rss\/search\?[^#]*obituar/i.test(s)) return true;
    if (/(?:funeralhome|mortuary|memorialchapel|memorial-chapel|legacy\.com|tributes\.com)/i.test(s)) return true;
    return false;
  }

  return {
    HINT_RE: HINT_RE,
    WEAK_HINT_RE: WEAK_HINT_RE,
    STRONG_TEXT_RE: STRONG_TEXT_RE,
    PERSON_NAME_RE: PERSON_NAME_RE,
    AGE_HEAD_RE: AGE_HEAD_RE,
    NAME_AGE_RE: NAME_AGE_RE,
    OBIT_PATH_RE: OBIT_PATH_RE,
    OBIT_HOST_RE: OBIT_HOST_RE,
    haystack: haystack,
    obitUrl: obitUrl,
    googleObitSource: googleObitSource,
    weakHintCount: weakHintCount,
    hasPersonName: hasPersonName,
    obitText: obitText,
    obitStory: obitStory,
    obitTitle: obitTitle,
    obitFeedUrl: obitFeedUrl
  };
});
