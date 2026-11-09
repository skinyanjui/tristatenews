/* Obituaries: comments off, photos off, no in-feed ad neighbors. Shared by the page (window.TSNObit),
   first-paint cards, GET /api/comments (via api/_crime.js), and News ad adjacency. Headline, dek/summary and
   URL are checked; Google News obituary sources and /obituar paths count too. Missing module → fail closed. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNObit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Soft signals in a headline or dek (Marilyn Kay Morris, age 73, … formerly of …).
  var HINT_RE = /\b(?:age\s+\d{1,3}|passed away|formerly of|obituar(?:y|ies)|visitation|funeral|in loving memory|celebration of life)\b/i;
  // Name + age forms that slip past kindOf (news sourceId, not ob-*): "Name, age 73, of Town".
  var AGE_HEAD_RE = /^(?:["\u201c(]?[A-Z][A-Za-z.'\u2019\u201d"()-]*\s+){1,6}[A-Z][A-Za-z.'\u2019-]+(?:,? (?:Jr|Sr|II|III|IV)\.?)?(?:,\s*age\s+\d{1,3},?|\s+\(\d{1,3}\)|,\s*\d{1,3},?)\s+(?:of\s+)?[A-Z]/;
  var NAME_AGE_RE = /^(?:["\u201c(]?[A-Z][A-Za-z.'\u2019\u201d"()-]*\s+){1,5}[A-Z][A-Za-z.'\u2019-]+(?:,? (?:Jr|Sr|II|III|IV)\.?)?,\s*\d{1,3},\s+(?:of\s+)?[A-Z]/;

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
      if (/\/obituar/i.test(u.pathname)) return true;
      if (/news\.google\./i.test(u.hostname) && /obituar/i.test(u.href)) return true;
    } catch (e) {
      if (/\/obituar/i.test(link)) return true;
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

  function obitText(s) {
    s = String(s || '');
    if (HINT_RE.test(s)) return true;
    var title = s.split('\n')[0] || s;
    if (AGE_HEAD_RE.test(title.trim()) || NAME_AGE_RE.test(title.trim())) return true;
    return false;
  }

  function obitStory(it) {
    it = it || {};
    if (googleObitSource(it) || obitUrl(it)) return true;
    return obitText(haystack(it));
  }

  function obitTitle(title) { return obitStory({ title: title }); }

  return {
    HINT_RE: HINT_RE,
    AGE_HEAD_RE: AGE_HEAD_RE,
    NAME_AGE_RE: NAME_AGE_RE,
    haystack: haystack,
    obitUrl: obitUrl,
    googleObitSource: googleObitSource,
    obitText: obitText,
    obitStory: obitStory,
    obitTitle: obitTitle
  };
});
