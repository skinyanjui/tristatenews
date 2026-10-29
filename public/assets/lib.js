/* ---- public/breaking.js ---- */
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
;
/* ---- public/routes.js ---- */
/* One shareable URL per tab. Shared by the page (window.TSNRoutes, loaded in <head> so the title, description
   and canonical are right before anything renders) and by node (tests, sitemap check).
   vercel.json rewrites these paths to /index.html; the page reads location.pathname to open the tab and uses
   history.pushState when the tab changes, so back/forward and direct loads work. "/" is the News tab (the landing
   tab). Old paths that no longer have a tab of their own (ALIASES: /news, /all, /liked) open News at "/"; vercel.json
   also redirects them to "/" so shared links keep working. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNRoutes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var ORIGIN = 'https://tristatenewss.vercel.app';
  var SITE = 'Tri-State News';
  // cat: the page's tab id (CATS in index.html). index: listed in sitemap.xml and indexable.
  var ROUTES = [
    { cat: 'news', path: '/', index: true, title: SITE,
      desc: 'The latest local news, police and courts from Evansville, Henderson, Owensboro and the Tri-State, gathered from the region\u2019s newsrooms and official sources.' },
    // No institution feeds are wired today (the tab hides when empty), so it stays out of the sitemap and noindex.
    { cat: 'institution', path: '/institutions', index: false, title: 'Institutions · ' + SITE,
      desc: 'News from Tri-State schools, universities, hospitals and public agencies.' },
    { cat: 'events', path: '/events', index: true, title: 'Events · ' + SITE,
      desc: 'Things to do in Evansville and the Tri-State: concerts, festivals, family events, sports and community events by date.' },
    { cat: 'obits', path: '/obituaries', index: true, title: 'Obituaries · ' + SITE,
      desc: 'Recent obituaries from Tri-State funeral homes and newspapers in Indiana, Kentucky and Illinois.' },
    { cat: 'jobs', path: '/jobs', index: true, title: 'Jobs · ' + SITE,
      desc: 'Local job listings from Tri-State employers in Evansville, Henderson, Owensboro and nearby towns.' },
    { cat: 'deals', path: '/deals', index: true, title: 'Deals · ' + SITE,
      desc: 'Coupons and specials from local Tri-State businesses.' },
    { cat: 'classifieds', path: '/classifieds', index: true, title: 'Classifieds · ' + SITE,
      desc: 'Free local classifieds: furniture, electronics, vehicles and more for sale across the Tri-State.' }
  ];
  // Retired tab paths: the All tab (it duplicated News), the Liked page (removed), the old /news path and the
  // Police & courts tab (merged into News, where its items keep their rules).
  var ALIASES = { '/news': '/', '/all': '/', '/liked': '/', '/police-courts': '/', '/police': '/', '/courts': '/' };
  // Retired tab ids in an old hash or ?tab= link (#all, ?tab=all, #liked, ...), all of which now mean News.
  var OLD_TABS = { all: 1, news: 1, liked: 1, saved: 1, likes: 1, safety: 1, police: 1, courts: 1, 'police-courts': 1 };
  function norm(path) { var p = String(path || '/').split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase(); return p || '/'; }
  function byPath(path) { var p = norm(path); if (ALIASES[p]) p = ALIASES[p]; for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].path === p) return ROUTES[i]; return null; }
  function byCat(cat) { for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].cat === cat) return ROUTES[i]; return null; }
  function meta(doc, sel, attr, make) {
    var m = doc.head.querySelector(sel);
    if (!m && make) { m = doc.createElement(make.tag); for (var k in make.attrs) m.setAttribute(k, make.attrs[k]); doc.head.appendChild(m); }
    return m;
  }
  // Point the document's head at one route: <title>, description, canonical, og:* and robots.
  function apply(doc, r) {
    if (!doc || !r) return;
    var url = ORIGIN + (r.path === '/' ? '/' : r.path);
    doc.title = r.title;
    var d = meta(doc, 'meta[name="description"]', 'content', { tag: 'meta', attrs: { name: 'description' } }); d.setAttribute('content', r.desc);
    var c = meta(doc, 'link[rel="canonical"]', 'href', { tag: 'link', attrs: { rel: 'canonical' } }); c.setAttribute('href', url);
    var ou = meta(doc, 'meta[property="og:url"]'); if (ou) ou.setAttribute('content', url);
    var ot = meta(doc, 'meta[property="og:title"]'); if (ot) ot.setAttribute('content', r.title);
    var od = meta(doc, 'meta[property="og:description"]'); if (od) od.setAttribute('content', r.desc);
    var rb = meta(doc, 'meta[name="robots"]', 'content', r.index ? null : { tag: 'meta', attrs: { name: 'robots' } });
    if (rb) { if (r.index) rb.parentNode.removeChild(rb); else rb.setAttribute('content', 'noindex'); }
  }
  // County and state pages (/news/indiana, /news/indiana/dubois), served only while REGIONAL_ROUTES_ENABLED is on
  // (api/_geopage.js sets their head server-side). geo() maps such a path to a scope key, geoPath() the other way;
  // both are string rules only, and the server checks the county is one of ours. They open the News tab.
  var STATE_SLUGS = { 'in': 'indiana', ky: 'kentucky', il: 'illinois' }; // no Missouri (removed in ship62)
  function geo(path) {
    var m = /^\/news\/([a-z]+)(?:\/([a-z-]+))?$/.exec(norm(path)); if (!m) return null;
    for (var k in STATE_SLUGS) if (STATE_SLUGS[k] === m[1]) return { cat: 'news', path: norm(path), scope: m[2] ? 'county:' + k + '-' + m[2] : 'state:' + k };
    return null;
  }
  function geoPath(scope) {
    var m = /^(state|county):([a-z]{2})(?:-([a-z-]+))?$/.exec(String(scope || '')); if (!m || !STATE_SLUGS[m[2]]) return null;
    return '/news/' + STATE_SLUGS[m[2]] + (m[1] === 'county' ? '/' + m[3] : '');
  }
  return { ORIGIN: ORIGIN, STATE_SLUGS: STATE_SLUGS, geo: geo, geoPath: geoPath, ROUTES: ROUTES, ALIASES: ALIASES, OLD_TABS: OLD_TABS, norm: norm, byPath: byPath, byCat: byCat, apply: apply };
});
;
/* ---- public/featured.js ---- */
/* When a paid Featured period starts and ends. One rule, shared by the page (window.TSNFeatured, shown on the button
   before checkout) and the server (api/_checkout.js names the same window in Stripe; api/stripe-webhook.js applies it).

   - The period starts now, or when the post's current Featured period ends if it has one (purchases stack).
   - It lasts the catalog's days, except for posts tied to a date: an event (its date) or a deal with an end date.
     Those leave the board after that day, so the period stops at the end of that day (midnight America/Chicago), and
     the button says "until <day>" instead of "for N days". The price is the catalog price either way.
   - If the period would add less than MIN_HOURS, the post can't be featured (no button; checkout refuses).
   - Posts without a date (classifieds, jobs, deals without an end date) never lose paid time: the webhook keeps the
     post on its board until the period ends (api/stripe-webhook.js extends the post's expiry and index entry). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNFeatured = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 864e5, MIN_HOURS = 24, TZ = 'America/Chicago';
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  // Minutes east of UTC in Chicago at a moment (-300 in summer, -360 in winter). If the browser can't say, -300,
  // which ends a date-bound period an hour early in winter rather than late.
  function offsetMin(ms) {
    try {
      var p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' }).formatToParts(new Date(ms));
      for (var i = 0; i < p.length; i++) if (p[i].type === 'timeZoneName') {
        var m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(p[i].value);
        if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
      }
    } catch (_) { /* fall through */ }
    return -300;
  }
  // The moment a Chicago calendar day ends (the next local midnight), as epoch ms. NaN for a bad date.
  function dayEnd(date) {
    if (!DATE_RE.test(String(date || ''))) return NaN;
    var next = Date.parse(date + 'T00:00:00Z') + DAY;
    if (!isFinite(next)) return NaN;
    var t = next - offsetMin(next + 6 * 36e5) * 6e4;
    return next - offsetMin(t) * 6e4;
  }
  // The date a post is tied to, or '' (events: their date; deals: their end date, if any).
  function boundDate(post) {
    if (!post) return '';
    if (post.kind === 'event') return post.date || '';
    if (post.kind === 'deal') return post.ends || '';
    return '';
  }
  // post: { kind, date, ends, featuredUntil }. days: the catalog's days. now: epoch ms. minHours: the least time that
  // must remain (default MIN_HOURS; the webhook passes 0, since the buyer saw the period at checkout).
  // -> { ok: true, from, until, capped, bound } or { ok: false, reason: 'too_close' | 'bad_input' }
  function window_(post, days, now, minHours) {
    if (!post || !(days > 0) || !isFinite(now)) return { ok: false, reason: 'bad_input' };
    var from = Math.max(now, Number(post.featuredUntil) || 0), full = from + days * DAY;
    var bound = boundDate(post), cap = bound ? dayEnd(bound) : Infinity;
    if (bound && !isFinite(cap)) return { ok: false, reason: 'bad_input' };
    var until = Math.min(full, cap);
    var min = minHours == null ? MIN_HOURS : minHours;
    // nothing left to sell: the date has passed, or (stacking) the current period already runs to the cap
    if (until <= from || until - from < min * 36e5) return { ok: false, reason: 'too_close' };
    return { ok: true, from: from, until: until, capped: until < full, bound: bound };
  }
  // "Tue, Oct 20" for the day a capped period covers (the day before its end moment).
  function dayLabel(until) {
    return new Date(until - 1).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
  }
  return { DAY: DAY, MIN_HOURS: MIN_HOURS, dayEnd: dayEnd, boundDate: boundDate, window: window_, dayLabel: dayLabel, offsetMin: offsetMin };
});
;
/* ---- public/adslots.js ---- */
/* The in-listing ad card: which boards may carry it, where it goes, and what fills it. One rule, shared by the page
   (window.TSNAds) and the tests.

   - The Jobs, Deals, Classifieds and Events boards carry it, and the News feed carries in-feed cards (newsSlots: about
     every 6th story, never next to a Police & courts item). Institutions, Obituaries, Breaking cards and search
     results never do (fill() returns null for anything else).
   - One card per board view: after the 6th post, or after the last one on a shorter board; none on an empty board.
   - Only approved creatives fill it. The page reads /api/creative?live=1 (api/_creative.js), which lists only what an
     admin approved in admin.html, with a reason, for that placement; ads typed into sponsors.json are never shown.
   - Never targeted. Every reader of a board gets the same list. When several sponsors share a spot they take equal
     turns of TURN_MIN minutes by the clock (fair rotation: over a day each gets the same number of turns, give or
     take one), the same sponsor for every reader at the same moment. No cookies, no storage, no reader data. When the slot is unsold it holds the
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
  var AD_TABS = ['events', 'jobs', 'deals', 'classifieds', 'news']; // the only tabs with any ad (side ads included); never Obituaries
  var FEED = { news: 'news' }; // the News feed's in-feed card (see newsSlots); a feed, not a board
  var AFTER = 6;
  var DAY = 864e5;
  var TURN_MIN = 15;
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
  // The rotation turn: which TURN_MIN-minute block of the clock it is. The same number for everyone at that moment.
  function turn(now) { return Math.floor(Number(now) / (TURN_MIN * 60000)); }
  // One ad from a slot (an ad or a list), taking equal turns in the list's order; null when none is valid.
  function pick(v, now) {
    var list = (Array.isArray(v) ? v : v ? [v] : []).filter(validAd);
    return list.length ? list[((turn(now) % list.length) + list.length) % list.length] : null;
  }
  // A whole list in turn order: the side ads show up to two at once, and the top spot moves by the same turns.
  function order(v, now) {
    var list = (Array.isArray(v) ? v : v ? [v] : []).filter(validAd), n = list.length;
    if (!n) return [];
    var s = ((turn(now) % n) + n) % n;
    return list.slice(s).concat(list.slice(0, s));
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
  var OFFSET = { classifieds: 0, deals: 2, events: 4, jobs: 6, news: 5 };
  // What fills the card on a board: { type: 'direct', ad } | { type: 'sample', ad } | { type: 'house' }, or null where
  // no ad may appear. A real ad always comes first; samples only stand in for an unsold spot.
  function fill(kind, cards, now, samples) {
    var own = Object.prototype.hasOwnProperty;
    var key = own.call(BOARDS, kind) ? BOARDS[kind] : own.call(FEED, kind) ? FEED[kind] : null;
    if (!key) return null;
    var v = cards && own.call(cards, key) ? cards[key] : null;
    var ad = pick(v, now);
    if (ad) return { type: 'direct', ad: ad };
    var sm = sample(samples, OFFSET[key], now);
    if (sm) return { type: 'sample', ad: sm };
    return { type: 'house' }; // unsold, or a reserved network entry (no network is connected)
  }
  // The side ads (vertical, skyscraper-shaped rails on wide screens). tab: the page's tab id; side: 'left' | 'right';
  // list: the approved ads for that rail. { type: 'direct', ads } | { type: 'sample', ad } | { type: 'house' } |
  // { type: 'none' }, or null on any tab without ads (News, which carries Police & courts, Obituaries, search...).
  // A real ad always comes first. Unsold: a vertical sample ad on either rail while samples are on (different ones
  // left and right); with samples off, the house unit on the right and nothing on the left.
  var RAIL_OFFSET = { left: 3, right: 1 };
  function railFill(tab, side, list, now, samples) {
    if (AD_TABS.indexOf(tab) < 0 || !Object.prototype.hasOwnProperty.call(RAIL_OFFSET, side)) return null;
    var ads = order(list, now).filter(validAd).slice(0, 2);
    if (ads.length) return { type: 'direct', ads: ads };
    var sm = sample(samples, RAIL_OFFSET[side], now);
    if (sm) return { type: 'sample', ad: sm };
    return side === 'right' ? { type: 'house' } : { type: 'none' };
  }
  // Where the News feed's in-feed cards go: the indexes of the stories each card goes before. flags[i] is true when
  // story i is a Police & courts item. News is one story per row at every width, so a card goes about every `every`
  // stories (6) and never next to a Police & courts item: neither the story just before it nor the one just after it
  // may be one; otherwise it moves down one story at a time to the next safe spot. Cards are at least `every` stories
  // apart, never first (so never next to the Breaking card above the list), never last.
  var NEWS_EVERY = 6;
  function newsSlots(flags, every) {
    flags = Array.isArray(flags) ? flags : []; every = Math.max(2, Number(every) || NEWS_EVERY);
    var out = [], n = flags.length, p = every;
    while (p < n) {
      if (!flags[p - 1] && !flags[p]) { out.push(p); p += every; } else p += 1;
    }
    return out;
  }
  // How many posts come before the card, or -1 for no card.
  function position(count) {
    count = Number(count) || 0;
    return count <= 0 ? -1 : Math.min(count, AFTER);
  }
  return { BOARDS: BOARDS, AD_TABS: AD_TABS, AFTER: AFTER, CTAS: CTAS, validAd: validAd, pick: pick, order: order, validSample: validSample, sampleList: sampleList, sample: sample, OFFSET: OFFSET, dayNumber: dayNumber, turn: turn, TURN_MIN: TURN_MIN, fill: fill, position: position, railFill: railFill, RAIL_OFFSET: RAIL_OFFSET, FEED: FEED, newsSlots: newsSlots, NEWS_EVERY: NEWS_EVERY };
});
;
/* ---- public/adsizes.js ---- */
// Ad sizes (IAB standard units) for every placement, shared by the site (index.html), the upload page (creative.html),
// the Advertise page and the API (api/_creative.js validates per-size images with it).
//   SIZES        the units we use, each with the picture area it gets when the ad is built from one image and words
//   NOT_USED     common units we don't use, and why
//   rulesFor(p)  placement -> [{min, max, size}] by viewport width; sizeFor(p, vw); sizesFor(p); usedSizes()
//   cover()      object-fit: cover math (what part of an image shows in a box); check() warnings for an image at a size
//   pick()       which of two pictures (landscape main, optional square) a size should use: the one cropped less
//   fullOk()     whether an image can be a whole-unit banner for a size (same shape, at least 1x)
//   css()        the layout of every size, by placement (media queries) and by fixed size (previews); inject() adds it
//   mark()/decorate()  size an ad element on the page; render() builds a preview of an ad at a size
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNSizes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // img: the picture area inside the unit (CSS px) when the ad is one image plus headline, text and button.
  var SIZES = {
    '728x90': { w: 728, h: 90, name: 'Leaderboard', layout: 'bar', img: [160, 90] },
    '300x250': { w: 300, h: 250, name: 'Medium rectangle', layout: 'rect', img: [300, 120] },
    '320x100': { w: 320, h: 100, name: 'Large mobile banner', layout: 'bar', img: [100, 100] },
    '160x600': { w: 160, h: 600, name: 'Wide skyscraper', layout: 'sky', img: [160, 160] },
    '300x600': { w: 300, h: 600, name: 'Half page', layout: 'sky', img: [300, 250] }
  };
  var ORDER = ['728x90', '300x250', '320x100', '160x600', '300x600'];
  var NOT_USED = {
    '970x250': 'wider than the 960px News column and the board grids',
    '120x600': 'too narrow for a readable headline; side ads are 160px wide from 1360px up instead',
    '320x50': 'too short for a headline and a button big enough to tap'
  };
  var NEWS_BAR_MIN = 768, RAIL_MIN = 1360, RAIL_WIDE = 2560;
  // Where each size runs, by viewport width (CSS px). The sponsor line on a board is a line of text, not a sized unit.
  var WHERE = {
    '728x90': 'Sponsored card in the News feed, on screens ' + NEWS_BAR_MIN + 'px and wider',
    '300x250': 'Sponsored card on Jobs, Deals, Events and Classifieds, on every screen',
    '320x100': 'Sponsored card in the News feed, on phones',
    '160x600': 'Side ads, on screens ' + RAIL_MIN + '–' + (RAIL_WIDE - 1) + 'px wide',
    '300x600': 'Side ads, on screens ' + RAIL_WIDE + 'px and wider'
  };
  function rulesFor(p) {
    p = String(p || '');
    if (p === 'card:news') return [{ min: 0, max: NEWS_BAR_MIN - 1, size: '320x100' }, { min: NEWS_BAR_MIN, max: Infinity, size: '728x90' }];
    if (/^card:/.test(p)) return [{ min: 0, max: Infinity, size: '300x250' }];
    if (/^rail:/.test(p)) return [{ min: RAIL_MIN, max: RAIL_WIDE - 1, size: '160x600' }, { min: RAIL_WIDE, max: Infinity, size: '300x600' }];
    return [];
  }
  function sizeFor(p, vw) {
    vw = Number(vw) || 0;
    var r = rulesFor(p).filter(function (x) { return vw >= x.min && vw <= x.max; })[0];
    return r ? r.size : null;
  }
  function sizesFor(p) { var o = []; rulesFor(p).forEach(function (r) { if (o.indexOf(r.size) < 0) o.push(r.size); }); return o; }
  function usedSizes(placements) {
    var seen = {};
    (placements || ['card:news', 'card:jobs', 'rail:left']).forEach(function (p) { sizesFor(p).forEach(function (s) { seen[s] = 1; }); });
    return ORDER.filter(function (s) { return seen[s]; });
  }
  // object-fit: cover. The source rectangle of an iw×ih image that fills a bw×bh box, and the share of the image cut off.
  function cover(iw, ih, bw, bh) {
    var s = Math.max(bw / iw, bh / ih), sw = bw / s, sh = bh / s;
    return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw: sw, sh: sh, scale: s, cut: 1 - (sw * sh) / (iw * ih) };
  }
  function ratio(w, h) { var a = w, b = h; while (b) { var t = b; b = a % b; a = t; } return (w / a) + ':' + (h / a); }
  // How an iw×ih image looks at a size: in the picture area (full false) or as the whole unit (full true).
  // -> { box, cut, density, level: 'ok'|'warn'|'bad', warnings[], rec: {w, h} } (rec: 2x the box, for sharp screens)
  function check(iw, ih, key, full) {
    var z = SIZES[key]; if (!z || !(iw > 0) || !(ih > 0)) return null;
    var bw = full ? z.w : z.img[0], bh = full ? z.h : z.img[1], c = cover(iw, ih, bw, bh), density = 1 / c.scale;
    var out = { box: [bw, bh], cut: c.cut, density: density, level: 'ok', warnings: [], rec: { w: bw * 2, h: bh * 2 } };
    function warn(level, t) { out.warnings.push(t); if (level === 'bad' || out.level === 'ok') out.level = level; }
    if (full && !fullOk(iw, ih, key)) warn('bad', 'A banner for ' + key + ' must be the same shape (' + ratio(z.w, z.h) + '): ' + z.w + '×' + z.h + ' or ' + z.w * 2 + '×' + z.h * 2 + ' pixels.');
    else if (c.cut > 0.25) warn('warn', 'About ' + Math.round(c.cut * 100) + '% of the picture is cut off at this size. The best shape here is ' + bw + '×' + bh + ' (' + ratio(bw, bh) + ').');
    if (density < 1) warn('bad', 'Too small here: it will look blurry. Use at least ' + bw + '×' + bh + ' pixels; ' + bw * 2 + '×' + bh * 2 + ' is best.');
    else if (density < 2) warn('warn', 'Fine, but soft on sharp (high-density) screens. ' + bw * 2 + '×' + bh * 2 + ' pixels is best.');
    return out;
  }
  // Which picture a size uses when the ad has a main (usually landscape) picture and an optional square one: the one
  // its picture area crops less. Ties keep the main picture. main, square: { w, h } (square may be null).
  function pick(key, main, square) {
    var z = SIZES[key]; if (!z || !square || !(square.w > 0) || !(square.h > 0)) return 'main';
    if (!main || !(main.w > 0) || !(main.h > 0)) return 'square';
    var a = cover(main.w, main.h, z.img[0], z.img[1]).cut, b = cover(square.w, square.h, z.img[0], z.img[1]).cut;
    return b < a - 0.005 ? 'square' : 'main';
  }
  // A whole-unit banner for a size: within 3% of its shape, and at least as many pixels as the unit.
  function fullOk(iw, ih, key) {
    var z = SIZES[key]; if (!z) return false;
    return iw >= z.w && ih >= z.h && Math.abs((iw / ih) / (z.w / z.h) - 1) <= 0.03;
  }

  // ---------- layout ----------
  // One block of rules for a size, under a selector. Picture areas use object-fit: cover; text is clamped per size so
  // nothing spills out of the unit; long words hyphenate rather than break mid-word.
  function rules(sel, key) {
    var z = SIZES[key], L = z.layout, out = [];
    function r(s, body) { out.push(s.split(',').map(function (x) { return sel + x; }).join(',') + ' { ' + body + ' }'); }
    r('', 'box-sizing:border-box; position:relative; overflow:hidden; display:grid; width:' + z.w + 'px; max-width:100%; height:' + z.h + 'px; min-height:0; max-height:none; margin-inline:auto; justify-self:center; padding:0; gap:2px 0; align-content:start; text-align:left; hyphens:auto; -webkit-hyphens:auto; overflow-wrap:break-word');
    r(' > *', 'margin:0; min-width:0');
    r(' > .spon-tag', 'grid-area:tag; font-size:11px; line-height:14px');
    r(' > b', 'grid-area:name; display:-webkit-box; align-self:start; max-height:max-content; -webkit-box-orient:vertical; overflow:hidden; font-size:14px; line-height:18px; font-weight:600; overflow-wrap:break-word');
    r(' > .ad-tx:not(.ad-note), > .rail-tx:not(.ad-note)', 'grid-area:tx; display:-webkit-box; align-self:start; max-height:max-content; -webkit-box-orient:vertical; overflow:hidden; font-size:12px; line-height:16px');
    r(' > .ad-note', 'grid-area:note; display:-webkit-box; align-self:start; max-height:max-content; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; font-size:11px; line-height:14px');
    r(' > .rail-cta', 'grid-area:cta; justify-self:start; align-self:end; min-height:28px; height:28px; padding:0 10px; font-size:12px; line-height:28px; white-space:nowrap');
    r(' > .ad-img', 'grid-area:img; display:block; width:' + z.img[0] + 'px; max-width:100%; height:' + z.img[1] + 'px; max-height:none; object-fit:cover; object-position:center; border-radius:0; margin:0');
    r(' > .bav', 'grid-area:img; margin:10px 0 0 10px');
    r(' > .ad-sq', 'display:none');
    r(' > .ad-sq.tsz-sq-' + key, 'grid-area:img; display:block; width:' + z.img[0] + 'px; max-width:100%; height:' + z.img[1] + 'px; max-height:none; object-fit:cover; object-position:center; border-radius:0; margin:0');
    r(':has(> .ad-sq.tsz-sq-' + key + ') > .ad-img', 'display:none');
    r(' > .ad-full', 'display:none');
    r(' > .ad-full.tsz-only-' + key, 'display:block; position:absolute; inset:0; width:100%; height:100%; max-height:none; object-fit:cover; border-radius:0; margin:0');
    r(':has(> .ad-full.tsz-only-' + key + ') > :not(.ad-full):not(.spon-tag)', 'display:none');
    r(':has(> .ad-full.tsz-only-' + key + ') > .spon-tag', 'position:absolute; z-index:1; top:0; left:0; padding:1px 6px; background:rgba(255,255,255,.9); color:#333; border-bottom-right-radius:6px');
    if (L === 'bar') {
      var tall = key === '320x100';
      r('', 'grid-template-columns:auto minmax(0,1fr)' + (tall ? '' : ' auto') + '; grid-template-areas:' + (tall ? '"img tag" "img name" "img tx" "img cta"' : '"img tag cta" "img name cta" "img tx cta" "img note cta"') + '; align-content:center; column-gap:12px; padding-right:' + (tall ? 8 : 12) + 'px');
      r(' > .ad-img', 'align-self:stretch');
      r(' > b, > .ad-tx:not(.ad-note), > .rail-tx:not(.ad-note)', '-webkit-line-clamp:1');
      r(' > .spon-tag, > b, > .ad-tx, > .rail-tx', 'white-space:normal');
      r(' > .rail-cta', tall ? 'height:24px; min-height:24px; line-height:24px; align-self:start; margin-top:2px' : 'align-self:center');
      if (tall) r(' > .ad-note', 'display:none');
      else r(' > .ad-note', '-webkit-line-clamp:1');
      r(':not(:has(> .ad-img)):not(:has(> .bav))', 'padding-left:12px; column-gap:0');
    } else {
      // rect and sky: picture across the top, then the words, the button at the bottom
      r('', 'grid-template-columns:minmax(0,1fr); grid-template-rows:auto auto auto auto auto minmax(0,1fr) auto; grid-template-areas:"img" "tag" "name" "tx" "note" "." "cta"; row-gap:4px');
      r(' > :not(.ad-img):not(.ad-full):not(.bav)', 'margin-inline:12px');
      r(' > .spon-tag', 'margin-top:10px');
      r(' > .rail-cta', 'margin-bottom:12px');
      var big = L === 'sky';
      r(' > b', '-webkit-line-clamp:' + (big ? 3 : 2) + (key === '300x600' ? '; font-size:18px; line-height:24px' : ''));
      r(' > .ad-tx:not(.ad-note), > .rail-tx:not(.ad-note)', '-webkit-line-clamp:' + (big ? 6 : 3));
      r(':has(> .ad-img) > b', '-webkit-line-clamp:' + (big ? 3 : 1));
      r(':has(> .ad-img) > .ad-tx:not(.ad-note), :has(> .ad-img) > .rail-tx:not(.ad-note)', '-webkit-line-clamp:' + (big ? 5 : 2));
      if (!big) r(':has(> .ad-img) > .ad-note', 'display:none');
      if (big) r(' > .ad-note', '-webkit-line-clamp:4');
    }
    return out;
  }
  // Placement groups on the page: the News feed card, a board card, a side ad.
  var GROUPS = { news: 'card:news', board: 'card:jobs', rail: 'rail:left' };
  function css() {
    var out = ['/* public/adsizes.js: IAB ad sizes */', '.tsz-prev { display:grid; gap:8px; justify-items:start; margin:0; }', '.tsz-prev figcaption { font-size:13px; line-height:18px; }',
      '.tsz-prev figcaption b { display:block; }', '.tsz-frame { overflow:hidden; max-width:100%; }', '.tsz-frame > .tsz { transform-origin:0 0; margin:0; }',
      '.tsz-warn { margin:0; padding-left:18px; font-size:13px; line-height:18px; color:#b45309; }', '.tsz-warn.bad { color:#d93036; }', '.tsz-ok { font-size:13px; color:#15803d; }', '.tsz-gallery { display:grid; gap:20px; }', '.tsz-line { margin:0; font-size:13px; line-height:18px; }'];
    Object.keys(SIZES).forEach(function (k) { out = out.concat(rules('.tsz.tsz-k-' + k, k)); });
    Object.keys(GROUPS).forEach(function (g) {
      rulesFor(GROUPS[g]).forEach(function (rr) {
        var q = [];
        if (rr.min > 0) q.push('(min-width:' + rr.min + 'px)');
        if (rr.max !== Infinity) q.push('(max-width:' + rr.max + 'px)');
        var body = rules('.tsz.tsz-p-' + g, rr.size);
        if (g === 'rail') body.push('.tsz.tsz-p-rail { max-height:calc(100vh - 140px); }');
        out.push(q.length ? '@media ' + q.join(' and ') + ' {\n  ' + body.join('\n  ') + '\n}' : body.join('\n'));
      });
    });
    return out.join('\n');
  }
  function inject(doc) {
    if (!doc || doc.getElementById('tsz-css')) return;
    var s = doc.createElement('style'); s.id = 'tsz-css'; s.textContent = css(); (doc.head || doc.documentElement).appendChild(s);
  }
  function groupOf(p) { return p === 'card:news' ? 'news' : /^rail:/.test(p) ? 'rail' : /^card:/.test(p) ? 'board' : ''; }
  // Size an ad element on the page for its placement (CSS picks the unit by screen width).
  function mark(node, p) { var g = groupOf(p); if (node && g) { node.classList.add('tsz'); node.classList.add('tsz-p-' + g); } return node; }
  // ...and, for an approved ad with whole-unit banners (ad.sizes), add one picture per size this placement uses;
  // only the one for the current size shows (the others are display:none, so lazy loading never fetches them).
  function decorate(doc, node, p, ad) {
    mark(node, p);
    var have = (ad && Array.isArray(ad.sizes)) ? ad.sizes : [];
    // the square picture, for each size here that crops it less than the main one (shown instead of it by the CSS)
    if (ad && ad.sq && ad.img) sizesFor(p).forEach(function (k) {
      if (have.indexOf(k) >= 0 || pick(k, { w: ad.w, h: ad.h }, { w: ad.sqW, h: ad.sqH }) !== 'square') return;
      var sq = doc.createElement('img'); sq.className = 'ad-sq tsz-sq-' + k; sq.src = ad.sq; sq.alt = ad.name || '';
      sq.loading = 'lazy'; sq.decoding = 'async'; sq.width = ad.sqW; sq.height = ad.sqH; node.appendChild(sq);
    });
    sizesFor(p).forEach(function (k) {
      if (have.indexOf(k) < 0 || !ad.img) return;
      var im = doc.createElement('img'); im.className = 'ad-full tsz-only-' + k; im.src = ad.img + '&size=' + k; im.alt = ad.name || '';
      im.loading = 'lazy'; im.decoding = 'async'; im.width = SIZES[k].w; im.height = SIZES[k].h; node.appendChild(im);
    });
    return node;
  }
  function initials(n) { return String(n || '').split(/\s+/).filter(function (w) { return /^[A-Za-z]/.test(w); }).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(''); }
  // A preview of an ad at a size. ad: {name, text, cta, img (url), full: {size: url}, sample}. Not a link.
  function render(doc, key, ad) {
    var z = SIZES[key]; if (!z) return null; ad = ad || {};
    function el(t, c, x) { var n = doc.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
    var box = el('div', 'tsz tsz-k-' + key + ' ' + (z.layout === 'sky' ? 'rail-ad rail-sky' : 'ad-card') + (ad.sample ? ' ad-sample' : ''));
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', (ad.sample ? 'Sample ad' : 'Sponsored') + ' preview, ' + z.name + ' ' + key + ': ' + (ad.name || ''));
    box.appendChild(el('span', 'spon-tag', ad.sample ? 'Sample ad' : 'Sponsored'));
    // ad.square (url) with ad.dims / ad.sqDims ({w, h}): the size uses whichever picture crops less (pick)
    var useSq = ad.square && pick(key, ad.dims, ad.sqDims) === 'square';
    if (ad.img || useSq) { var im = el('img', 'ad-img'); im.src = useSq ? ad.square : ad.img; im.alt = ''; im.setAttribute('data-pic', useSq ? 'square' : 'main'); box.appendChild(im); }
    else if (ad.avatar) { var av = el('span', 'bav', initials(ad.name)); av.setAttribute('aria-hidden', 'true'); box.appendChild(av); }
    box.appendChild(el('b', null, ad.name || 'Your headline'));
    if (ad.text) box.appendChild(el('span', 'ad-tx', ad.text));
    if (ad.sample) box.appendChild(el('span', 'ad-tx ad-note', 'A sample, not a real business. Your ad could be here.'));
    box.appendChild(el('span', 'rail-cta', ad.cta || 'Learn more'));
    if (ad.full && ad.full[key]) { var f = el('img', 'ad-full tsz-only-' + key); f.src = ad.full[key]; f.alt = ''; box.appendChild(f); }
    return box;
  }
  // A labeled preview: the unit, scaled down to fit narrow screens, with its name, size and where it runs.
  function preview(doc, key, ad, where) {
    var z = SIZES[key]; if (!z) return null;
    var fig = doc.createElement('figure'); fig.className = 'tsz-prev'; fig.setAttribute('data-size', key);
    var frame = doc.createElement('div'); frame.className = 'tsz-frame'; frame.appendChild(render(doc, key, ad)); fig.appendChild(frame);
    var cap = doc.createElement('figcaption'), b = doc.createElement('b'); b.textContent = z.name + ' · ' + z.w + '×' + z.h;
    cap.appendChild(b); cap.appendChild(doc.createTextNode(where || WHERE[key] || '')); fig.appendChild(cap);
    return fig;
  }
  // Scale previews down to the width they have (call after they're in the page, and on resize).
  function fit(root) {
    if (!root || !root.querySelectorAll) return;
    [].forEach.call(root.querySelectorAll('.tsz-prev'), function (fig) {
      var z = SIZES[fig.getAttribute('data-size')], frame = fig.firstChild, box = frame && frame.firstChild; if (!z || !box) return;
      var avail = fig.clientWidth || z.w, s = Math.min(1, avail / z.w);
      box.style.maxWidth = 'none'; box.style.transform = s < 1 ? 'scale(' + s + ')' : '';
      frame.style.width = Math.round(z.w * s) + 'px'; frame.style.height = Math.round(z.h * s) + 'px';
    });
  }
  // A made-up picture for sample previews: an SVG (no network), 1200×628, the business's initials on a soft pattern.
  function sampleImage(name, hue) {
    hue = Number(hue) || 190;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="628" viewBox="0 0 1200 628">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(' + hue + ',55%,78%)"/><stop offset="1" stop-color="hsl(' + ((hue + 40) % 360) + ',50%,52%)"/></linearGradient></defs>' +
      '<rect width="1200" height="628" fill="url(#g)"/><circle cx="980" cy="120" r="220" fill="rgba(255,255,255,.18)"/><circle cx="160" cy="560" r="260" fill="rgba(255,255,255,.12)"/>' +
      '<text x="600" y="370" text-anchor="middle" font-family="Georgia, serif" font-size="220" fill="rgba(255,255,255,.92)">' + initials(name) + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  // Every size we use, previewed with a made-up sample business (labeled "Sample ad"), for the Advertise page and the
  // site's Advertise panel. Returns the container; call fit(container) once it's in the page.
  var SAMPLE = { name: 'Ninebark Bakehouse', text: 'Bread, pies and coffee, baked each morning.', cta: 'Visit website', sample: true };
  function gallery(doc, box) {
    box.classList.add('tsz-gallery');
    var ad = { name: SAMPLE.name, text: SAMPLE.text, cta: SAMPLE.cta, sample: true, img: sampleImage(SAMPLE.name, 28) };
    ORDER.forEach(function (k) { box.appendChild(preview(doc, k, ad)); });
    var line = doc.createElement('p'); line.className = 'tsz-line';
    line.textContent = 'Sponsor line: one line of text at the top of a Jobs, Deals, Events or Classifieds board (name, a short line and a link), not a sized image unit.';
    box.appendChild(line);
    return box;
  }
  // The newsletter sponsor block (api/newsletter.js sponsorBlock), previewed with the made-up business and labeled
  // "Sample ad". Newsletter sponsorship isn't for sale yet; this only shows what the slot looks like.
  function newsletterPreview(doc) {
    function el(t, c, x) { var n = doc.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
    var box = el('div', 'tsz-nl ad-sample'); box.setAttribute('aria-label', 'Sample ad preview, newsletter sponsor block: ' + SAMPLE.name);
    box.appendChild(el('span', 'spon-tag', 'Sample ad'));
    box.appendChild(el('b', 'ad-nm', SAMPLE.name));
    box.appendChild(el('span', 'ad-tx', SAMPLE.text));
    box.appendChild(el('span', 'ad-tx ad-note', 'A sample, not a real business. One sponsor block per weekly email, after the headlines.'));
    return box;
  }
  // A "See ad sizes" button for a gallery box: collapsed by default (box hidden), aria-expanded and aria-controls kept
  // in step, the previews built the first time it opens. Returns the button; put it just before the box.
  function toggle(doc, box, id) {
    if (!box.id) box.id = id || 'tsz-sizes';
    box.hidden = true;
    var btn = doc.createElement('button'), built = false;
    btn.type = 'button'; btn.className = 'tsz-toggle'; btn.textContent = 'See ad sizes';
    btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', box.id);
    btn.addEventListener('click', function () {
      var open = !!box.hidden;
      if (open && !built) { gallery(doc, box); built = true; }
      box.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? 'Hide ad sizes' : 'See ad sizes';
      if (open) fit(box);
    });
    return btn;
  }
  return { SIZES: SIZES, SAMPLE: SAMPLE, gallery: gallery, newsletterPreview: newsletterPreview, toggle: toggle, ORDER: ORDER, NOT_USED: NOT_USED, WHERE: WHERE, NEWS_BAR_MIN: NEWS_BAR_MIN, RAIL_MIN: RAIL_MIN, RAIL_WIDE: RAIL_WIDE,
    rulesFor: rulesFor, sizeFor: sizeFor, sizesFor: sizesFor, usedSizes: usedSizes, cover: cover, check: check, pick: pick, fullOk: fullOk, ratio: ratio,
    rules: rules, css: css, inject: inject, groupOf: groupOf, mark: mark, decorate: decorate, render: render, preview: preview, fit: fit, sampleImage: sampleImage, initials: initials };
});
;
/* ---- public/flowers.js ---- */
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
;
/* each tab has its own URL: set this one's title, description and canonical first */ if (window.TSNRoutes) TSNRoutes.apply(document, TSNRoutes.byPath(location.pathname));
