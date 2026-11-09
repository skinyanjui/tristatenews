/* Death / tragedy headlines: in-feed ads never sit directly before or after these (with crime and obituaries).
   Shared by the page (window.TSNTragedy) and clustering (public/cluster.js). Conservative word list. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNTragedy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEATH_RE = new RegExp('\\b(?:' + [
    'died',
    'dies',
    'dead',
    'death',
    'deaths',
    'killed',
    'kills',
    'killing',
    'fatal',
    'fatally',
    'fatality',
    'fatalities',
    'crash victims?',
    'victim(?:s)? (?:of|in) (?:a |the )?(?:crash|wreck|collision|fire|shooting)',
    'mourns?',
    'mourning'
  ].join('|') + ')\\b', 'i');

  // Sports/health phrases that look tragic but are not.
  var ALLOW_RE = new RegExp([
    '\\b(?:pacers?|aces|heat|otters|cubs|cards|reds) (?:kill(?:s|ed)? off|died? (?:in|on) (?:the )?(?:fourth|late|overtime))\\b',
    '\\b(?:battery|batteries) (?:died|dead)\\b',
    '\\bdead[- ](?:ball|heat|lift|center|centre|end|line)\\b',
    '\\bkilling it\\b',
    '\\bkilled (?:the (?:lights?|engine|power|deal|bill))\\b'
  ].join('|'), 'gi');

  function haystack(it) {
    it = it || {};
    return [String(it.title || ''), String(it.summary || it.dek || '')].join('\n');
  }
  function soften(s) {
    ALLOW_RE.lastIndex = 0;
    return String(s || '').replace(ALLOW_RE, ' ');
  }
  function deathText(s) { return DEATH_RE.test(soften(s)); }
  function deathStory(it) { return deathText(haystack(it)); }
  function deathTitle(title) { return deathStory({ title: title }); }

  return { DEATH_RE: DEATH_RE, ALLOW_RE: ALLOW_RE, haystack: haystack, soften: soften, deathText: deathText, deathStory: deathStory, deathTitle: deathTitle };
});
