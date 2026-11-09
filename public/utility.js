/* Standing / utility pages that newspapers publish as “stories” (Contact Us, Privacy Policy, …).
   Dropped at ingestion (api/news.js) and again on render. Shared as window.TSNUtility. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNUtility = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Exact-ish standing furniture already in api/news.js STANDING_RE, plus utility/contact/legal pages.
  var UTILITY_RE = /^(?:billboard|calendar|scoreboard|looking back|real estate transfers|community events|funeral services?|town crier|a1 teaser|inside|contact(?:\s+\w+)?|contact us|about us|advertise with(?:\s+\w+)?|newsletter sign[- ]?up|privacy policy|terms of(?:\s+\w+)?|watch live|download our app)(?:\s*[:|–—-].*)?$/i;

  function utilityTitle(title) {
    var t = String(title || '').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    // Strip a trailing " | Outlet" / " - Outlet" publisher suffix (Google News and some CMS titles).
    t = t.replace(/\s*[|·•]\s*[^|·•]{2,40}$/, '').replace(/\s+[-–—]\s+[A-Z][^–—-]{2,40}$/, '').trim();
    return UTILITY_RE.test(t);
  }

  function utilityStory(it) {
    return utilityTitle(it && it.title);
  }

  return { UTILITY_RE: UTILITY_RE, utilityTitle: utilityTitle, utilityStory: utilityStory };
});
