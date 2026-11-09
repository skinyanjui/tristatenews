/* Crime / Police & courts: comments off, photos off. Shared by the page (window.TSNCrime), first-paint cards
   (api/_cards.js) and GET /api/comments (api/_crime.js). Headline, dek/summary and URL slug are checked; allowlisted
   non-crime phrases are stripped first. Ambiguous leftovers fail closed. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNCrime = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Strip these whole phrases so sports/health/place-name uses do not trip the crime matcher.
  var ALLOW_RE = new RegExp([
    '\\bshot[- ]clocks?\\b',
    '\\b(?:flu|covid(?:-?19)?|coronavirus|vaccine|vaccination|booster|allergy|tetanus|measles|mmr|pneumonia|shingles|hepatitis|hpv|rabies)[- ]shots?\\b',
    '\\b(?:jump|hook|bank|set|fadeaway|three[- ]point|3[- ]point|free[- ]throw|foul|screen)[- ]shots?\\b',
    '\\bscreenshots?\\b',
    '\\bshot[- ]put\\b',
    '\\bbig[- ]shots?\\b',
    '\\bopening[- ]shots?\\b',
    '\\bidentity[- ]thefts?\\b',
    '\\b(?:tips to |how to )?prevent(?:ing)? (?:\\w+[- ])?thefts?\\b',
    '\\bstolen[- ]bases?\\b',
    '\\bsteals? (?:the (?:show|ball|spotlight|headline|scene)|(?:a |the )?base|home|game \\d+)\\b',
    '\\bbox[- ]office steals?\\b',
    '\\b(?:in )?pursuit of\\b',
    '\\b(?:old|historic|former) (?:county |city |town )?jails?\\b',
    '\\bjail(?:house)?[- ](?:museum|cafe|caf[eé]|restaurant|coffee|brewery|inn|hotel|theater|theatre|tavern|pub|grill|kitchen|market|rock)\\b',
    '\\bjails? (?:museum|cafe|caf[eé]|restaurant|coffee)\\b',
    '\\b(?:dead|car|phone|lithium|ev|solar|storage)[- ]batter(?:y|ies)\\b',
    '\\bbatter(?:y|ies)[- ](?:powered|life|pack|storage|charger|electric)\\b',
    '\\bhelp wanted\\b',
    '\\bfully booked\\b',
    '\\bbooked (?:a |an |the )?(?:table|flight|gig|show|ticket|room|hotel|appointment|slot|stay|tour|event|vacation)\\b'
  ].join('|'), 'gi');

  var CRIME_RE = new RegExp('\\b(?:' + [
    'murder(?:s|ed|er|ers)?',
    'homicides?',
    'manslaughter',
    'sex offenders?',
    'rap(?:e|ed|es|ist|ists|ing)',
    'sexual(?:ly)? assault(?:ed|s)?',
    'molest(?:ed|ation|ing|s)?',
    'arrest(?:s|ed|ing)?',
    'charged',
    'charges',
    'indicted',
    'indictments?',
    'accused',
    'suspects?',
    'mugshots?',
    'convicted',
    'sentenced',
    'pleads? guilty',
    'pleaded guilty',
    'pled guilty',
    'in custody',
    'taken into custody',
    'booked',
    'jailed',
    'jails?',
    'inmates?',
    'warrants?',
    'wanted',
    'kidnapp(?:ed|ing|er|ers)?',
    'abduct(?:ed|ion|ions|ing)?',
    'stabb(?:ed|ing|ings)',
    'robber(?:y|ies)',
    'robbed',
    'robbing',
    'burglar(?:y|ies|ized?|izing|s)?',
    'break(?:-|\\s+)ins?',
    'broke into',
    'thefts?',
    'stolen',
    'shoplift(?:ed|ing|er|ers)?',
    'vandal(?:s|ism|ized?|izing)?',
    'arsons?',
    'assault(?:s|ed|ing)?',
    'batter(?:y|ed|ing)',
    'carjack(?:ed|ing|er|ers)?',
    'shooting(?! (?:guard|percentage|woes|slump|touch|clinic|range|star|practice|drill|contest))',
    'shot',
    'shot and killed',
    'fatally shot',
    'overdose(?:s|d)?',
    'overdosed',
    '(?:dui|owi|dwi)s?',
    'drunk(?:en)? driving',
    'driving under the influence',
    'standoffs?',
    'manhunts?',
    '(?:high[- ]speed |police |vehicle )?pursuits?',
    'missing persons?',
    'amber alerts?',
    'fatal (?:crash|wreck|collision|accident)s?(?: investigations?)?',
    '(?:crash|wreck|collision) investigations?',
    'incident reports?',
    'jail bookings?',
    '(?:police|sheriff(?:[\'’]?s)?|fire|ems|emt)(?:\\s*(?:&|and|/)\\s*(?:emt|ems|fire|ambulance))*(?:\\s+(?:department|dept\\.?|office|activity))?\\s+(?:logs?|blotters?|runs)',
    'deputies say',
    'police say',
    'alleged(?:ly)? kill(?:ed|ing)',
    'killed by (?:her |his |their )?(?:husband|wife|boyfriend|girlfriend|fianc[eé]e?|partner|ex)',
    'kills? (?:her |his |their )?(?:husband|wife|boyfriend|girlfriend|fianc[eé]e?|partner|ex)',
    '(?:her|his|their) body (?:was |were )?found',
    '(?:woman|man|girl|boy|teen(?:ager)?|child)\'s body (?:was )?found',
    'beaten to death',
    'strangl(?:e|ed|ing|ation)',
    'domestic(?:ally)?(?:-|\\s+)(?:violence|abuse|assault|battery)'
  ].join('|') + ')\\b', 'i');

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
  function soften(s) {
    ALLOW_RE.lastIndex = 0;
    return String(s || '').replace(ALLOW_RE, ' ');
  }
  function crimeText(s) { return CRIME_RE.test(soften(s)); }
  function crimeStory(it) { return crimeText(haystack(it)); }
  function crimeTitle(title) { return crimeStory({ title: title }); }

  return { ALLOW_RE: ALLOW_RE, CRIME_RE: CRIME_RE, haystack: haystack, soften: soften, crimeText: crimeText, crimeStory: crimeStory, crimeTitle: crimeTitle };
});
