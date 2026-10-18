/* One Breaking slot, priority-ranked. Shared by the page (window.TSNBreaking) and the server (require).
   Rules:
   - At most ONE item is shown. Highest tier wins; inside a tier the newest wins.
   - Official alerts stay until their own end time (NWS "ends", else "expires"; a feed's end_date). An item
     with no end time drops off 3 hours after it was issued/published.
   - A regular "BREAKING:" story from an outlet is tier 7 and also lasts 3 hours, then returns to the feed.
   - Keyword tiers (boil water, closures, outages...) apply ONLY to items from official sources. */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.TSNBreaking = m;
})(typeof self !== 'undefined' ? self : this, function () {
  var HOUR = 36e5, NO_END_MS = 3 * HOUR, SKEW_MS = 5 * 6e4, TZ = 'America/Chicago';

  var TIERS = [
    { tier: 1, id: 'life-safety', name: 'Life-safety orders and tornado warnings' },
    { tier: 2, id: 'missing-person', name: 'AMBER and Silver alerts' },
    { tier: 3, id: 'nws-warning', name: 'Other NWS warnings' },
    { tier: 4, id: 'boil-water', name: 'Boil-water advisories' },
    { tier: 5, id: 'road-closure', name: 'Major road and bridge closures' },
    { tier: 6, id: 'outage-school', name: 'Large power outages and district-wide school closures' },
    { tier: 7, id: 'breaking-news', name: 'Breaking news (outlet-labeled)' }
  ];

  // NWS event name -> [tier, short label]. Events not listed never take the Breaking slot (they stay in the weather strip).
  var NWS = {
    'Tornado Warning': [1, 'Tornado Warning'],
    'Extreme Wind Warning': [1, 'Extreme Wind Warning'],
    'Shelter In Place Warning': [1, 'Shelter in place'],
    'Evacuation Immediate': [1, 'Evacuation order'],
    'Civil Danger Warning': [1, 'Civil danger warning'],
    'Civil Emergency Message': [1, 'Civil emergency'],
    'Hazardous Materials Warning': [1, 'Hazardous materials warning'],
    'Nuclear Power Plant Warning': [1, 'Nuclear power plant warning'],
    'Radiological Hazard Warning': [1, 'Radiological hazard warning'],
    'Law Enforcement Warning': [1, 'Law enforcement warning'],
    'Local Area Emergency': [1, 'Local area emergency'],
    'Child Abduction Emergency': [2, 'AMBER Alert'],
    'Severe Thunderstorm Warning': [3, 'Severe Thunderstorm Warning'],
    'Flash Flood Warning': [3, 'Flash Flood Warning'],
    'Flood Warning': [3, 'Flood Warning'],
    'Ice Storm Warning': [3, 'Ice Storm Warning'],
    'Winter Storm Warning': [3, 'Winter Storm Warning'],
    'Blizzard Warning': [3, 'Blizzard Warning'],
    'Snow Squall Warning': [3, 'Snow Squall Warning']
  };

  // Text rules for official items only. A cancellation / all-clear never takes the slot.
  var CLEARED = /\b(cancel+ed|cancel+ation|has been lifted|is lifted|lifted|rescinded|all[- ]clear|reopened|re-opened|found safe|located safe|has been located|restored)\b/i;
  var RULES = [
    { tier: 1, label: 'Shelter in place', re: /\bshelter[- ]in[- ]place\b/i },
    { tier: 1, label: 'Evacuation order', re: /\b(mandatory evacuation|evacuation order|evacuate (now|immediately))\b/i },
    { tier: 2, label: 'AMBER Alert', re: /\bamber alert\b/i },
    { tier: 2, label: 'Silver Alert', re: /\bsilver alert\b/i },
    { tier: 2, label: 'Golden Alert', re: /\bgolden alert\b/i },                       // Kentucky's alert for missing at-risk adults
    { tier: 2, label: 'Endangered missing person', re: /\bendangered missing person advisory\b/i }, // Illinois
    { tier: 4, label: 'Boil-water advisory', re: /\b(precautionary )?boil[- ](water )?(advisory|order|notice)\b|\bboil water\b/i },
    { tier: 5, label: 'Road closure', re: /\b(I-?\s?69|interstate 69|US[- ]?41|U\.S\. 41|twin bridges)\b[^.]{0,80}\b(closed|closure|closures|shut down)\b|\b(closed|closure|closures|shut down)\b[^.]{0,80}\b(I-?\s?69|interstate 69|US[- ]?41|U\.S\. 41|twin bridges)\b/i },
    { tier: 6, label: 'Power outage', re: /\b(widespread|large|major|thousands)\b[^.]{0,60}\b(power )?outages?\b|\b\d{1,3}(,\d{3})+ (customers|homes)\b[^.]{0,40}\bwithout power\b/i },
    { tier: 6, label: 'School closure', re: /\b(EVSC|all (EVSC |district )?schools|schools? (are |will be )?closed|district[- ]wide)\b[^.]{0,60}\b(closed|closing|cancel+ed|e-?learning|no school)\b/i }
  ];
  var BREAKING_RE = /^\s*(breaking( news)?|just in|developing story|news alert)\b|\bbreaking( news)?\s*[:|\u2013\u2014-]|[\[(]breaking[\])]/i;
  var PREFIX_RE = /^\s*(breaking( news)?|just in|developing story|news alert)\s*[:|\u2013\u2014-]?\s*/i;

  function ms(v) { var t = typeof v === 'number' ? v : Date.parse(v); return isNaN(t) ? null : t; }

  // NWS alert (GeoJSON feature.properties) -> candidate, or null if it isn't a Breaking event.
  function fromNws(p) {
    if (!p || !p.event || p.status !== 'Actual' || p.messageType === 'Cancel') return null;
    var m = NWS[p.event]; if (!m) return null;
    var tier = m[0], label = m[1], txt = (p.headline || '') + ' ' + (p.description || '') + ' ' + (p.areaDesc || '');
    if (p.event === 'Flood Warning' && /ohio river/i.test(txt)) label = 'Ohio River Flood Warning';
    var pr = p.parameters || {};
    // Flash flood emergency / catastrophic damage threat is a life-safety situation.
    if (p.event === 'Flash Flood Warning' && (/catastrophic/i.test(String(pr.flashFloodDamageThreat || '')) || /flash flood emergency/i.test(txt))) { tier = 1; label = 'Flash Flood Emergency'; }
    if (p.event === 'Tornado Warning' && (/catastrophic/i.test(String(pr.tornadoDamageThreat || '')) || /tornado emergency/i.test(txt))) label = 'Tornado Emergency';
    return {
      key: 'nws:' + (p.id || p.event + '|' + (p.sent || '')),
      kind: 'alert', official: true, tier: tier, label: label,
      title: p.headline || p.event, summary: (p.areaDesc || '').slice(0, 220),
      source: p.senderName || 'National Weather Service', sourceId: 'nws',
      link: p.web || nwsLink(p), start: ms(p.onset) || ms(p.effective) || ms(p.sent), end: ms(p.ends) || ms(p.expires), sent: ms(p.sent)
    };
  }
  // A public NWS page for the alert's first county/zone (the API's own @id is JSON, not a reader page).
  function nwsLink(p) {
    var ugc = (p.geocode && p.geocode.UGC) || [];
    var z = ugc.filter(function (c) { return /^[A-Z]{2}Z\d{3}$/.test(c); })[0], c = ugc.filter(function (x) { return /^[A-Z]{2}C\d{3}$/.test(x); })[0];
    if (z || c) return 'https://forecast.weather.gov/showsigwx.php?warnzone=' + (z || '') + '&warncounty=' + (c || '');
    return 'https://www.weather.gov/pah/';
  }

  // Official item (title + summary) -> {tier, label} by keyword, or null. Callers must only pass official sources.
  function classifyOfficial(it) {
    var txt = (it.title || '') + ' ' + (it.summary || '');
    if (CLEARED.test(it.title || '')) return null;
    for (var i = 0; i < RULES.length; i++) if (RULES[i].re.test(txt)) return { tier: RULES[i].tier, label: RULES[i].label };
    return null;
  }
  function isBreakingTitle(title) { return BREAKING_RE.test(title || ''); }
  function stripPrefix(title) { return String(title || '').replace(PREFIX_RE, '') || title; }

  function endOf(c) { return c.end != null ? c.end : (c.start != null ? c.start + NO_END_MS : null); }
  function isActive(c, now) {
    if (!c || c.start == null && c.end == null) return false;
    if (c.start != null && c.start > now + SKEW_MS) return false;   // not in effect yet (NWS onset in the future)
    var e = endOf(c); return e != null && now < e;
  }
  // The single item for the Breaking slot: { top, more } (more = other active candidates hidden behind it).
  function pick(cands, now) {
    now = now == null ? Date.now() : now;
    var seen = {}, act = (cands || []).filter(function (c) { if (!c || seen[c.key]) return false; seen[c.key] = 1; return isActive(c, now); });
    act.sort(function (a, b) { return a.tier - b.tier || (b.start || 0) - (a.start || 0); });
    return { top: act[0] || null, more: Math.max(0, act.length - 1) };
  }

  function chi(t, o) { o.timeZone = TZ; return new Date(t).toLocaleString('en-US', o); }
  // "until 9:45 PM CT", or "until Sun 8:00 AM CT" when it ends on another day (America/Chicago).
  function untilText(end, now) {
    if (end == null) return '';
    now = now == null ? Date.now() : now;
    var sameDay = chi(end, { year: 'numeric', month: 'numeric', day: 'numeric' }) === chi(now, { year: 'numeric', month: 'numeric', day: 'numeric' });
    return 'until ' + (sameDay ? '' : chi(end, { weekday: 'short' }) + ' ') + chi(end, { hour: 'numeric', minute: '2-digit' }) + ' CT';
  }

  return { HOUR: HOUR, NO_END_MS: NO_END_MS, TIERS: TIERS, NWS: NWS, RULES: RULES, fromNws: fromNws, classifyOfficial: classifyOfficial,
    isBreakingTitle: isBreakingTitle, stripPrefix: stripPrefix, isActive: isActive, endOf: endOf, pick: pick, untilText: untilText };
});
