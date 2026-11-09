/* Obituaries: comments off, photos off, no in-feed ad neighbors; also used to route news-feed
   death notices into the Obituaries tab (api/news.js looksLikeObit + page remount). Strong signals
   only: name+age, "obituary"/obituar text, /obituar|/obits/|legacy|tributes|funeral-home URLs, known
   obit sources, or ≥2 weak hints plus a person-name pattern. Weak hints alone (age N, funeral,
   visitation, formerly of) must not trip. Google News feed URLs that only mention -obituary
   (exclusion) are not obituary feeds. Missing module → fail closed. */
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
  var OBIT_PATH_RE = /\/(?:obituar[a-z]*|obits?)(?:\/|$|[?#&\s-])/i;
  var OBIT_HOST_RE = /(?:^|\.)(?:legacy\.com|tributes\.com)$|(?:funeralhome|mortuary|memorialchapel|memorial-chapel)/i;

  function decodeUrl(s) {
    try { return decodeURIComponent(String(s || '').replace(/\+/g, ' ')); } catch (e) { return String(s || ''); }
  }

  function linkSlug(link) {
    var slug = '';
    try {
      slug = decodeURIComponent(new URL(link).pathname || '');
    } catch (e) {
      slug = String(link || '');
    }
    return slug.replace(/\.[a-z0-9]+$/i, '').replace(/[-_+/]+/g, ' ');
  }

  function haystack(it) {
    it = it || {};
    var title = String(it.title || '');
    var summary = String(it.summary || it.dek || '');
    var slug = linkSlug(it.link || it.url || '');
    return [title, summary, slug].join('\n');
  }

  // Positive obituar* in a Google News q= value: ignore -obituary, -(...obituar...), and NOT obituar*.
  function positiveObituarInQuery(q) {
    var s = String(q || '');
    s = s.replace(/-\([^)]*\)/g, ' ');
    s = s.replace(/(^|[\s(])-obituar[a-z]*/gi, '$1');
    s = s.replace(/\bNOT\s+obituar[a-z]*/gi, ' ');
    return /\bobituar[a-z]*/i.test(s);
  }

  function googleNewsPositiveObitQuery(url) {
    try {
      var u = new URL(String(url || ''));
      if (!/news\.google\./i.test(u.hostname || '')) return false;
      // searchParams.get already URL-decodes q=
      return positiveObituarInQuery(u.searchParams.get('q') || '');
    } catch (e) {
      return false;
    }
  }

  function obitUrl(it) {
    var link = String((it && (it.link || it.url)) || '');
    try {
      var u = new URL(link);
      var host = String(u.hostname || '').toLowerCase();
      if (OBIT_PATH_RE.test(u.pathname || '')) return true;
      if (OBIT_HOST_RE.test(host)) return true;
      if (/news\.google\./i.test(host) && googleNewsPositiveObitQuery(link)) return true;
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
      if (/news\.google\./i.test(u.hostname) && googleNewsPositiveObitQuery(link)) return true;
    } catch (e) {}
    return false;
  }

  function hintMatches(s) {
    WEAK_HINT_RE.lastIndex = 0;
    var out = [], m;
    while ((m = WEAK_HINT_RE.exec(String(s || '')))) {
      out.push(m[0].toLowerCase().replace(/\s+/g, ' '));
    }
    return out;
  }

  // Title + summary count as usual; slug hints that already appeared in the title are ignored
  // so a title-derived slug cannot double-count "formerly of" into an obituary.
  function weakHintCountFields(title, summary, slug) {
    var titleHints = hintMatches(title);
    var n = titleHints.length;
    var seen = {};
    titleHints.forEach(function (h) { seen[h] = 1; });
    hintMatches(summary).forEach(function () { n++; });
    hintMatches(slug).forEach(function (h) { if (!seen[h]) { seen[h] = 1; n++; } });
    return n;
  }

  function weakHintCount(s) {
    // Back-compat for callers that pass a pre-joined haystack (counts every match).
    WEAK_HINT_RE.lastIndex = 0;
    var n = 0, m;
    while ((m = WEAK_HINT_RE.exec(String(s || '')))) n++;
    return n;
  }

  function hasPersonName(s) {
    return PERSON_NAME_RE.test(String(s || ''));
  }

  function obitText(s) {
    s = String(s || '');
    var title = (s.split('\n')[0] || s).trim();
    if (AGE_HEAD_RE.test(title) || NAME_AGE_RE.test(title)) return true;
    if (STRONG_TEXT_RE.test(s)) return true;
    if (weakHintCount(s) >= 2 && hasPersonName(s)) return true;
    return false;
  }

  function obitStory(it) {
    it = it || {};
    if (googleObitSource(it) || obitUrl(it)) return true;
    var title = String(it.title || '');
    var summary = String(it.summary || it.dek || '');
    var slug = linkSlug(it.link || it.url || '');
    if (AGE_HEAD_RE.test(title.trim()) || NAME_AGE_RE.test(title.trim())) return true;
    if (STRONG_TEXT_RE.test(title) || STRONG_TEXT_RE.test(summary) || STRONG_TEXT_RE.test(slug)) return true;
    if (weakHintCountFields(title, summary, slug) >= 2 && hasPersonName(title + '\n' + summary)) return true;
    return false;
  }

  function obitTitle(title) { return obitStory({ title: title }); }

  // Feed URL / registry helper. Google News q= must have a POSITIVE obituar* term
  // (-obituary exclusions and -(...) / NOT forms do not count). Otherwise only /obituaries
  // paths or funeral-home / legacy / tributes hosts on the feed URL itself.
  function obitFeedUrl(url) {
    var s = String(url || '');
    var decoded = decodeUrl(s);
    if (OBIT_PATH_RE.test(decoded)) return true;
    if (/(?:funeralhome|mortuary|memorialchapel|memorial-chapel|legacy\.com|tributes\.com)/i.test(decoded)) return true;
    if (/news\.google\.com\/rss\/search/i.test(s) && googleNewsPositiveObitQuery(s)) return true;
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
    decodeUrl: decodeUrl,
    positiveObituarInQuery: positiveObituarInQuery,
    googleNewsPositiveObitQuery: googleNewsPositiveObitQuery,
    obitUrl: obitUrl,
    googleObitSource: googleObitSource,
    weakHintCount: weakHintCount,
    weakHintCountFields: weakHintCountFields,
    hasPersonName: hasPersonName,
    obitText: obitText,
    obitStory: obitStory,
    obitTitle: obitTitle,
    obitFeedUrl: obitFeedUrl
  };
});
