// Tri-State (Evansville, IN-KY MSA) news aggregator.
// A scheduled job (/api/refresh, handler in api/_refresh.js, served by this function) fetches every configured feed, normalizes, dedupes, and stores
// the result in Redis; this endpoint just serves that stored snapshot, so pages load instantly and a
// source that fails one run keeps its last good stories. If Redis isn't configured, or the snapshot
// is more than 3 hours old, the first visitor triggers a refresh instead.

// Coverage area: Evansville MSA plus Owensboro, Madisonville, Carbondale, Marion, Vincennes
// and the towns in between (southwest Indiana, western Kentucky, southern Illinois).
//
// geo: true  -> the outlet covers a wider region than ours, so only stories that mention a
//               place from REGION_TERMS are kept.
// Sources marked "unverified" were not reachable when this was built; a source that fails or
// returns zero items is reported in `sources` with ok:false and the page hides it.
// The sources (ids, URLs, kinds, flags) live in the registry: data/sources/*.json, loaded by api/_sources.js, which
// also drops disabled entries and applies EXTRA_FEEDS (plan PR 3.1).
const { SOURCES, DISABLED_SOURCES } = require('./_sources.js');

const { inTriState } = require('./_places.js'); // strict place filter for statewide FBI / U.S. Attorney feeds
const LOC = () => require('./_location.js'); // loaded only when the shadow classifier runs
const FLAGS = require('./_flags.js');
// Every publisher request goes through safeFetch (http/https only, no private or metadata addresses after DNS, at most
// 3 redirects, each re-checked) and every body through readCapped (PR 1.3). Caps are about 3x the largest body seen
// on 2026-10-18 (Indiana Chronicle feed 1.34 MB, Barnett sitemap 0.66 MB). Items parsed per feed were already capped
// below the plan's 200: PER_SOURCE_LIMIT (30) for RSS/Atom, 200 events for iCal.
const { safeFetch, readCapped } = require('./_safe.js');
const CAP = { feed: 4 * 1024 * 1024, sitemap: 5 * 1024 * 1024, page: 2 * 1024 * 1024, json: 4 * 1024 * 1024 };

// Places between and around the anchor cities. Ambiguous names are state-qualified.
const REGION_TERMS = [
  // Indiana
  'evansville', 'newburgh, ind', 'vanderburgh', 'warrick', 'boonville', 'posey', 'mount vernon, ind', 'mt. vernon, ind', 'poseyville',
  'gibson county', 'princeton, ind', 'fort branch', 'haubstadt', 'oakland city', 'vincennes', 'knox county, ind', 'bicknell', 'washington, ind',
  'daviess county, ind', 'jasper, ind', 'dubois county', 'huntingburg', 'ferdinand', 'santa claus', 'tell city', 'perry county, ind', 'spencer county, ind', 'rockport, ind', 'chandler, ind', 'lynnville', 'terre haute', 'sullivan county, ind', 'pike county, ind', 'petersburg, ind', 'lawrenceburg', 'university of southern indiana', 'usi ',
  // Kentucky
  'owensboro', 'daviess county', 'henderson, ky', 'henderson county, ky', 'webster county', 'sebree', 'providence, ky', 'morganfield', 'union county, ky', 'uniontown', 'sturgis', 'madisonville, ky', 'hopkins county', 'earlington', 'nortonville', 'dawson springs', 'central city', 'muhlenberg', 'greenville, ky', 'hartford, ky', 'ohio county, ky', 'mclean county', 'calhoun, ky', 'livermore', 'beaver dam', 'hancock county, ky', 'hawesville', 'lewisport', 'princeton, ky', 'caldwell county', 'marion, ky', 'crittenden county', 'western kentucky', 'wku', 'kentucky wesleyan',
  // Illinois
  'carbondale', 'marion, ill', 'williamson county', 'herrin', 'murphysboro', 'jackson county, ill', 'harrisburg, ill', 'saline county, ill', 'carterville', 'johnston city', 'west frankfort', 'franklin county, ill', 'benton, ill', 'mount vernon, ill', 'mt. vernon, ill', 'jefferson county, ill', 'mcleansboro', 'hamilton county, ill', 'carmi', 'white county, ill', 'mount carmel', 'mt. carmel', 'wabash county, ill', 'lawrenceville, ill', 'lawrence county, ill', 'olney, ill', 'fairfield, ill', 'wayne county, ill', 'eldorado, ill', 'galatia', 'shawneetown', 'gallatin county, ill', 'metropolis, ill', 'massac', 'vienna, ill', 'johnson county, ill', 'anna, ill', 'jonesboro, ill', 'union county, ill', 'southern illinois', 'siu ', 'siu-', 'shawnee national forest', 'cairo, ill', 'pulaski county, ill', 'du quoin', 'perry county, ill', 'pinckneyville', 'chester, ill', 'randolph county, ill', 'sparta, ill', 'wabash valley',
  // Tri-State shorthand and Evansville high schools (Courier & Press headlines often name only these)
  'tri-state', 'southwestern indiana', 'southwest indiana', 'sw indiana', 'reitz', 'mater dei', 'bosse', 'evansville police', 'epd ',
  'illinois', 'indiana', 'kentucky',
];

// "Henderson, Kentucky" style datelines (DOJ, FBI) are folded to the short forms REGION_TERMS uses.
const STATE_ABBR = { kentucky: 'ky', indiana: 'ind', illinois: 'ill' };
function inRegion(item, extra) {
  const hay = (item.title + ' ' + item.summary).toLowerCase().replace(/,\s*(kentucky|indiana|illinois)\b/g, (m, st) => ', ' + STATE_ABBR[st]);
  // bare state names are weak signals on their own; require a real place for regional stations
  const strong = REGION_TERMS.filter(t => !['illinois', 'indiana', 'kentucky'].includes(t));
  return strong.some(t => hay.includes(t)) || (extra || []).some(t => hay.includes(t));
}

// A story from a local outlet that names another state ("An 81-year-old Mississippi man...") and no place
// in our region is network or wire copy (Gray and Nexstar stations share stories across markets).
const OTHER_STATES = 'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|iowa|kansas|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|west virginia|wisconsin|wyoming';
const OUT_OF_AREA_RE = new RegExp(
  '\\b(?:' + OTHER_STATES + ')\\s+(?:man|woman|men|women|teen|teens|boy|girl|child|children|toddler|infant|couple|family|mother|father|resident|residents|deputy|deputies|officer|officers|police|sheriff|trooper|troopers|officials|authorities|lawmakers?|governor|judge|jury|school|students?)\\b' +
  '|\\b(?:in|near|outside|from) (?:rural |northern |southern |eastern |western |central )?(?:' + OTHER_STATES + ')\\b(?! river| valley| county| state university)', 'i');
function outOfArea(item) {
  const hay = item.title + ' ' + item.summary;
  return OUT_OF_AREA_RE.test(hay) && !inRegion(item);
}

// Obituaries belong in the Obituaries tab, not the news feed (papers mix them into their main feeds).
const OBIT_NAME_RE = /^(?:["\u201c(]?[A-Z][A-Za-z.'\u2019\u201d"()-]*\s+){1,5}[A-Z][A-Za-z.'\u2019-]+(?:,? (?:Jr|Sr|II|III|IV)\.?)?,\s*\d{1,3},\s+(?:of\s+)?[A-Z][A-Za-z.'\u2019 -]{1,40}$/;
function looksLikeObit(item) {
  if (/\bobituar(?:y|ies)\b/i.test(item.title)) return true;
  // A headline that is only a name, an age and a hometown ("John Henry Adams, 61, of Mill Shoals") is a death notice;
  // a news story about a person says what happened ("..., 45, of Henderson, arrested").
  if (OBIT_NAME_RE.test(String(item.title || '').trim())) return true;
  try { return /\/obituar/i.test(new URL(item.link).pathname); } catch (_) { return false; }
}

// BLOX CMS (and CNHI) outlets mix wire and syndicated copy into their main feeds: AP under /ap/, and
// national, world, statewide and lifestyle wire under section paths, and sister papers' stories (the
// Sun-Commercial republishes the Greencastle Banner Graphic under /banner_graphic/). Those are not local.
const WIRE_PATH_RE = /^\/(?:ap|news\/(?:national|national_news|nation|nation_world|nation-world|world|world_news|state|state_news)|sports\/(?:national|nation|ap|college|pro)|lifestyles?\/(?:health|food|travel|national)|entertainment\/(?:national|ap)|indiana\/(?:news|opinion|sports)|banner_graphic)(?:\/|$)/i;
function isWire(item) {
  try { return WIRE_PATH_RE.test(new URL(item.link).pathname); } catch (_) { return false; }
}

// Standing page furniture some papers publish as articles every day (not stories).
const STANDING_RE = /^(?:billboard|calendar|scoreboard|looking back|real estate transfers|community events|funeral services?|town crier|a1 teaser|inside)$/i;

// The wire, region, obituary, out-of-area and standing-page filters. tryUrl() runs them on every fetch, and
// combine() runs them again on stored stories, so stories saved before a filter existed (or changed) drop out
// at the next snapshot instead of lingering for their whole window.
function passesFilters(it, source, viaGoogle) {
  const news = !source.kind || source.kind === 'news' || source.kind === 'police' || source.kind === 'courts' || source.kind === 'institution';
  if (viaGoogle === undefined) viaGoogle = isGoogleNews(it.link || '');
  if (isWire(it)) return false;
  // Google News site feeds include the paper's wire, syndicated and shopping stories, so they are geo-filtered too.
  if (source.strictGeo) { if (!inTriState(it, source.strictGeo)) return false; }
  else if ((source.geo || (viaGoogle && news)) && !inRegion(it, source.geoTerms)) return false;
  return !news || (!looksLikeObit(it) && !outOfArea(it) && !STANDING_RE.test(it.title.trim()));
}

// ---------- Police & courts policy ----------
// The tab carries official sources only (kind 'police' / 'courts'); crime stories from news outlets stay in News.
// Items that involve juveniles are dropped from police and court sources. Offense
// names such as "child exploitation" describe an adult defendant's crime and are not matched.
const JUVENILE_RE = /\b(?:juveniles?|teens?|teenagers?|(?:[1-9]|1[0-7])-year-olds?|boys?|girls?|students?|high school(?:ers?)?|middle school|minors? (?:arrested|charged|detained|cited|taken)|under 18)\b/i;
// Arrested or charged, not (yet) convicted: these get the note on their card and a 14-day window, from police and
// sheriff's offices and from prosecutors, U.S. Attorneys, the FBI and courts alike. Outcome items (sentenced,
// convicted, pleaded guilty, acquitted) and other releases keep their source's window.
const ARREST_RE = /\b(?:arrest(?:s|ed)?|charged|charges?|indicted|indictment|accused|suspects?|in custody|booked|jailed|warrant)\b/i;
// ("Convicted killer back in jail on new charges" is still an arrest: only a verdict or sentence counts.)
const OUTCOME_RE = /\b(?:sentenced|sentencing|(?:is|was|were|been|be) convicted|convicted (?:of|in|on)|found guilty|pleads? guilty|pleaded guilty|guilty (?:plea|verdict)|acquitted)\b/i;
const ARREST_MAX_DAYS = 14;

// Returns a police or court item as it should appear (a copy with the arrest flag and no image), or null to
// leave it out; other items pass through unchanged. Runs in combine(), so stored stories follow it too.
function safetyView(it, source) {
  const kind = source.kind || 'news';
  if (kind !== 'police' && kind !== 'courts') return it;
  if (JUVENILE_RE.test(it.title + ' ' + (it.summary || ''))) return null;
  const arrest = ARREST_RE.test(it.title) && !OUTCOME_RE.test(it.title);
  const out = { ...it, image: '', arrest };
  if (arrest) out.maxAgeDays = Math.min(it.maxAgeDays || MAX_AGE_DAYS, ARREST_MAX_DAYS);
  return out;
}

// Obituary match key: first and last name, ignoring nicknames ("PJ"), maiden names in parentheses, middle names
// and initials, suffixes and ages, so "Paul James \"PJ\" Carnahan" and "Paul Carnahan, 79" match.
function obitKey(title) {
  const words = title.toLowerCase().replace(/^obituary:?\s*/, '').replace(/["\u201c\u201d].*?["\u201c\u201d]|\(.*?\)|,.*$/g, ' ')
    .replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(w => w && !/^(?:jr|sr|ii|iii|iv|mrs?|dr)$/.test(w));
  return words.length > 1 ? words[0] + ' ' + words[words.length - 1] : words.join(' ');
}

const MAX_ITEMS = 240;
// The Obituaries tab: 21 days from about 25 papers and funeral homes, one card per person.
const MAX_OBITS = 300;
// Police & courts: about ten official sources with 14- to 90-day windows.
const MAX_SAFETY = 80;
const MAX_AGE_DAYS = 10;
const PER_SOURCE_LIMIT = 30;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function unwrap(s) {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : decodeEntities(s);
}

function stripHtml(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i');
  const m = block.match(re);
  return m ? unwrap(m[1]) : '';
}

function attr(block, name, attrName, mustMatch) {
  const re = new RegExp('<' + name + '\\s[^>]*>', 'gi');
  let m;
  while ((m = re.exec(block))) {
    if (mustMatch && !mustMatch.test(m[0])) continue;
    const a = m[0].match(new RegExp(attrName + '\\s*=\\s*["\']([^"\']+)["\']', 'i'));
    if (a) return decodeEntities(a[1]);
  }
  return '';
}

function safeUrl(u, httpsOnly) {
  if (!u) return '';
  try {
    const url = new URL(u.trim());
    if (url.protocol === 'https:' || (!httpsOnly && url.protocol === 'http:')) return url.href;
  } catch (_) { /* fall through */ }
  return '';
}

function parseFeed(xml, source) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const items = [];
  for (const b of blocks.slice(0, PER_SOURCE_LIMIT)) {
    let title = stripHtml(tag(b, 'title'));
    const viaGoogle = /^https:\/\/news\.google\.com\//.test(source.fetchedUrl || '');
    // Google News appends " - Publisher" to every title and its description is only a link back.
    if (viaGoogle) { const cut = title.lastIndexOf(' - '); if (cut > 15 && title.length - cut < 64) title = title.slice(0, cut).trim(); }
    let link = tag(b, 'link').trim();
    if (!link) link = attr(b, 'link', 'href', /rel\s*=\s*["']alternate["']/i) || attr(b, 'link', 'href');
    if (!link) { const g = tag(b, 'guid').trim(); if (/^https?:\/\//i.test(g)) link = g; }
    link = safeUrl(link, false);
    if (!title || !link) continue;

    const dateStr = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const t = Date.parse(dateStr);
    const published = Number.isFinite(t) ? new Date(t).toISOString() : null;

    const rawDesc = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content');
    let summary = stripHtml(rawDesc);
    if (summary.length > 220) summary = summary.slice(0, 217).replace(/\s+\S*$/, '') + '\u2026';
    if (viaGoogle || summary.toLowerCase() === title.toLowerCase() || /^continue reading\b/i.test(summary)) summary = '';

    let image =
      attr(b, 'media:content', 'url') ||
      attr(b, 'media:thumbnail', 'url') ||
      attr(b, 'enclosure', 'url', /type\s*=\s*["']image/i);
    if (!image) {
      const full = tag(b, 'content:encoded') || tag(b, 'description') || '';
      const im = decodeEntities(full).match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
      if (im) image = im[1];
    }
    image = safeUrl(image, true);

    items.push({ title, link, summary, image, published, source: source.name, sourceId: source.id, maxAgeDays: source.maxAgeDays, isEvent: source.kind === 'events', isObit: source.kind === 'obits' });
  }
  return items;
}

// iCal (.ics) calendars: `published` carries the event's start time.
function chicagoToUtc(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(guess));
  const g = t => Number(parts.find(p => p.type === t).value);
  const asChi = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return new Date(guess - (asChi - guess));
}
function icalDate(line) {
  const m = /:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?\s*$/.exec(line);
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0)];
  return (m[7] ? new Date(Date.UTC(y, mo - 1, d, h, mi)) : chicagoToUtc(y, mo, d, h, mi)).toISOString();
}
function parseIcal(text, source) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const unesc = v => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
  const items = [];
  for (const b of (unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || []).slice(0, 200)) {
    const get = n => { const m = new RegExp('^' + n + '(?:;[^:\\r\\n]*)?:(.*)$', 'mi').exec(b); return m ? m[1] : ''; };
    const start = /^DTSTART[^\r\n]*$/mi.exec(b);
    const published = start ? icalDate(start[0]) : null;
    const title = unesc(get('SUMMARY'));
    const link = safeUrl(get('URL').trim(), false) || safeUrl(source.url.replace(/\/events.*$/, '/events/'), false);
    if (!title || !published || !link) continue;
    let summary = stripHtml(unesc(get('DESCRIPTION')));
    if (summary.length > 220) summary = summary.slice(0, 217).replace(/\s+\S*$/, '') + '…';
    const att = /^ATTACH[^:\r\n]*:(https?:\/\/\S+)/mi.exec(b);
    const image = att && /image\/|\.(jpe?g|png|webp|gif)(\?|$)/i.test(att[0]) ? safeUrl(att[1], true) : '';
    const loc = (unesc(get('LOCATION')).split(',').map(x => x.trim()).find(x => x.length > 3) || '').slice(0, 60);
    items.push({ title, link, summary, image, published, source: source.name, sourceId: source.id, isEvent: true, venue: loc, area: source.area });
  }
  return items;
}


// Ford Center / Victory Theatre list pages: <figure class="allEventsItem"> with image, name, blurb, "Mon. D, YYYY | H:MM PM" and a
// ticket link. Times are Central. `published` carries the start time (like iCal). Paged 20 at a time via ?start=.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseVenue(html, source, base) {
  const items = [];
  for (const b of html.match(/<figure class="allEventsItem">[\s\S]*?<\/figure>/g) || []) {
    const name = stripHtml((/<h2 class="allEventsItemName">([\s\S]*?)<\/h2>/.exec(b) || [])[1] || '');
    const when = /<time[^>]*>[\s\S]*?<\/i>\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})(?:\s*\|\s*(\d{1,2}):(\d{2})\s*([AP]M))?/i.exec(b);
    if (!name || !when) continue;
    let h = when[4] ? +when[4] % 12 + (/p/i.test(when[6]) ? 12 : 0) : 0;
    const mo = MONTHS[when[1].toLowerCase()];
    if (!mo) continue;
    const published = chicagoToUtc(+when[3], mo, +when[2], h, when[5] ? +when[5] : 0).toISOString();
    const hrefs = [...b.matchAll(/<a [^>]*href="([^"]+)"/g)].map(m => m[1]);
    const link = safeUrl(hrefs.find(u => /^https?:\/\//.test(u)) || '', true) || safeUrl(base, true);
    const imgSrc = (/<img src="([^"#]+)/.exec(b) || [])[1] || '';
    const image = /1920x1080/.test(imgSrc) ? '' : safeUrl(imgSrc.startsWith('/') ? new URL(imgSrc, base).href : imgSrc, true);
    let summary = stripHtml(((/<details[\s\S]*?<p>([\s\S]*?)<\/p>/.exec(b) || [])[1] || '').replace(/<br\s*\/?>/gi, ' '));
    summary = summary.replace(/\b(Doors Open|Show Starts):\s*[\d:]+\s*[AP]M\s*/gi, '').trim();
    if (summary.length > 220) summary = summary.slice(0, 217).replace(/\s+\S*$/, '') + '…';
    if (!link) continue;
    items.push({ title: name, link, summary, image, published, source: source.name, sourceId: source.id, isEvent: true, venue: source.name, area: source.area });
  }
  // an image shared by several events is the venue's placeholder, not a photo of the event
  const uses = {};
  items.forEach(i => { if (i.image) uses[i.image] = (uses[i.image] || 0) + 1; });
  items.forEach(i => { if (i.image && uses[i.image] > 2) i.image = ''; });
  return items;
}


// Ticketmaster Discovery API. The key lives only in the environment and is added at request time, so it
// is never stored with the source record or sent to the browser.
const TM_SEGMENT = { Sports: 'Sports', Music: 'Music', 'Arts & Theatre': 'Arts' };
async function fetchTicketmaster(source, url) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return { items: [], error: 'no items', missingKey: true, url };
  const items = [];
  const start = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  for (let page = 0; page < 2; page++) {
    const q = '?apikey=' + encodeURIComponent(key) + '&latlong=37.9716,-87.5711&radius=75&unit=miles&size=100&sort=date,asc&page=' + page + '&startDateTime=' + start;
    const r = await safeFetch(url + q, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) { if (!page) return { items: [], error: 'HTTP ' + r.status, httpStatus: r.status, url }; break; }
    const d = JSON.parse(await readCapped(r, CAP.json));
    for (const e of (d._embedded && d._embedded.events) || []) {
      const st = e.dates && e.dates.start;
      if (!st || !e.name || (e.dates.status && /cancel|postpon/i.test(e.dates.status.code || ''))) continue;
      let published = st.dateTime || null;
      if (!published && st.localDate) published = chicagoToUtc(+st.localDate.slice(0, 4), +st.localDate.slice(5, 7), +st.localDate.slice(8, 10), 0, 0).toISOString();
      const link = safeUrl(e.url, true);
      if (!published || !link) continue;
      const v = (e._embedded && e._embedded.venues && e._embedded.venues[0]) || {};
      const imgs = (e.images || []).filter(i => i.ratio === '16_9' && i.width >= 300).sort((a, b) => a.width - b.width);
      const seg = e.classifications && e.classifications[0] && e.classifications[0].segment && e.classifications[0].segment.name;
      const genre = e.classifications && e.classifications[0] && e.classifications[0].genre && e.classifications[0].genre.name;
      const pr = e.priceRanges && e.priceRanges[0];
      const fromPrice = pr && Number.isFinite(pr.min) && pr.min > 0 ? '$' + Math.round(pr.min) : '';
      const city = [v.city && v.city.name, v.state && v.state.stateCode].filter(Boolean).join(', ');
      let summary = stripHtml(e.info || e.pleaseNote || '');
      if (summary.length > 220) summary = summary.slice(0, 217).replace(/\s+\S*$/, '') + '…';
      items.push({ title: stripHtml(e.name), link, summary, image: safeUrl(imgs[0] && imgs[0].url, true), published, source: source.name, sourceId: source.id, isEvent: true, fromPrice, area: (v.city && v.city.name) || source.area, venue: [v.name, city].filter(Boolean).join(' · ').slice(0, 70), cat: genre === 'Family' ? 'Family' : (TM_SEGMENT[seg] || 'Community') });
    }
    if (!d.page || page + 1 >= d.page.totalPages) break;
  }
  return { items, error: items.length ? null : 'no items', httpStatus: 200, url };
}

// Identifies the reader honestly, with a URL publishers can check. Google News and some BLOX/Arc sites
// treat the old bare "TriStateNewsAggregator/1.0" string as an unknown bot.
const USER_AGENT = 'Mozilla/5.0 (compatible; TriStateNews/1.1; +https://tristatenewss.vercel.app)';
const isGoogleNews = url => /^https:\/\/news\.google\.com\//.test(url);
// Google News requests from many sources go out one at a time, 600 ms apart, so one refresh never bursts.
let googleQueue = Promise.resolve();
const googleTurn = () => { const turn = googleQueue.then(() => new Promise(r => setTimeout(r, 600))); googleQueue = turn; return turn; };

const hostOf = u => { try { return new URL(u).hostname; } catch (_) { return ''; } };
// ---------- Funeral home sitemaps (parser: 'sitemap') ----------
// FuneralOne, CFS and Tukios sites list every obituary in a sitemap with a <lastmod>. The newest entries inside the
// source's window are read; a page already read on an earlier run is reused from the stored record, and at most
// SITEMAP_DETAILS new pages are fetched per run, one at a time, so a refresh costs each site a handful of requests.
// Only the name, a short summary, the photo and the date are kept; the card links to the funeral home.
const SITEMAP_DETAILS = 6;
const SITEMAP_SCAN = 40;
const SUMMARY_MAX = 220;
const OBIT_BOILERPLATE_RE = /\b(?:leave (?:your )?condolences|send flowers|share (?:memories|a memory)|sign the guestbook|view obituary|service information)\b/i;

function metaContent(html, key) {
  const re = new RegExp('<meta\\s[^>]*(?:property|name)\\s*=\\s*["\']' + key.replace(/[.:]/g, '\\$&') + '["\'][^>]*>', 'i');
  const m = html.match(re);
  if (!m) return '';
  const c = m[0].match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
  return c ? decodeEntities(c[1] !== undefined ? c[1] : c[2]).trim() : '';
}

// "Mary Layne Byrer - View Obituary & Service Information", "Obituary for Paul Carnahan | Colvin Funeral Home",
// "Shirley Pagan Obituary Oct 13, 2026 - Glenn Funeral Home and Crematory" -> the person's name.
function obitName(raw) {
  let t = stripHtml(raw || '');
  t = t.replace(/\s+[|\u2013\u2014-]\s+.*$/, '');
  t = t.replace(/^obituary (?:for|of)\s+/i, '').replace(/\s+obituary\b.*$/i, '');
  return t.trim();
}

function nameFromSlug(u) {
  try {
    const seg = new URL(u).pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(seg).replace(/[-_]\d+$/, '').split(/[-_]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  } catch (_) { return ''; }
}

function obitSummary(desc, name) {
  let t = stripHtml(desc || '');
  // CFS descriptions start with the page title: "Obituary for X | X, 79, passed away..."
  if (/^obituary (?:for|of)\b/i.test(t) && t.includes(' | ')) t = t.slice(t.indexOf(' | ') + 3);
  t = t.split(/(?<=[.!?])\s+/).filter(x => !OBIT_BOILERPLATE_RE.test(x)).join(' ').trim();
  if (!t || t.toLowerCase() === (name || '').toLowerCase()) return '';
  if (t.length > SUMMARY_MAX) t = t.slice(0, SUMMARY_MAX - 3).replace(/\s+\S*$/, '') + '\u2026';
  return t;
}

function parseObitPage(html, source, entry) {
  const name = obitName(metaContent(html, 'og:title') || tag(html, 'title')) || nameFromSlug(entry.loc);
  if (!name) return null;
  const pubM = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
  const deathM = html.match(/"deathDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  let ts = pubM ? Date.parse(pubM[1]) : NaN;
  if (!Number.isFinite(ts)) ts = entry.lastmod;
  // a page republished long after the death (a memorial added later) ages by the date of death
  // (CFS pages carry no deathDate, so "passed away ... on June 28, 2026" in the description is used instead)
  const desc = metaContent(html, 'description');
  const said = desc.match(/\b(?:passed away|died|entered (?:into )?rest)\b[^.]{0,80}?\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4})/i);
  const death = deathM ? Date.parse(deathM[1] + 'T12:00:00Z') : said ? Date.parse(said[1].replace('.', '') + ' 12:00 UTC') : NaN;
  if (Number.isFinite(death) && ts - death > 30 * 864e5) ts = death;
  const canon = safeUrl(metaContent(html, 'og:url'), true);
  const link = canon && hostOf(canon) === hostOf(entry.loc) ? canon : entry.loc;
  return {
    title: name, link, pageUrl: entry.loc, summary: obitSummary(desc, name),
    image: safeUrl(metaContent(html, 'og:image'), true), published: new Date(ts).toISOString(),
    source: source.name, sourceId: source.id, maxAgeDays: source.maxAgeDays, isEvent: false, isObit: true,
  };
}

async function fetchSitemap(source, url, prev) {
  const now = Date.now();
  const headers = { 'user-agent': USER_AGENT, accept: 'application/xml, text/xml, */*' };
  const r = await safeFetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return { items: [], error: 'HTTP ' + r.status, httpStatus: r.status, url };
  const xml = await readCapped(r, CAP.sitemap);
  const cutoff = now - (source.maxAgeDays || 21) * 864e5;
  const entries = (xml.match(/<url>[\s\S]*?<\/url>/gi) || [])
    .map(b => ({ loc: safeUrl(tag(b, 'loc').trim(), true), lastmod: Date.parse(tag(b, 'lastmod').trim()) }))
    .filter(e => e.loc && Number.isFinite(e.lastmod) && e.lastmod >= cutoff && hostOf(e.loc) === hostOf(url) && new URL(e.loc).pathname.length > 2)
    .sort((a, b) => b.lastmod - a.lastmod)
    .slice(0, SITEMAP_SCAN);
  const known = new Map(((prev && prev.items) || []).map(i => [i.pageUrl || i.link, i]));
  const items = [];
  let fetched = 0, blockedErr = null;
  for (const e of entries) {
    const old = known.get(e.loc);
    if (old) { items.push(old); continue; }
    if (fetched >= SITEMAP_DETAILS || blockedErr) continue;
    if (fetched) await new Promise(res => setTimeout(res, 900));
    fetched++;
    try {
      const pr = await safeFetch(e.loc, { headers: { ...headers, accept: 'text/html' }, signal: AbortSignal.timeout(10000) });
      if (pr.status === 429 || pr.status === 403) { blockedErr = 'HTTP ' + pr.status; continue; }
      if (!pr.ok) continue;
      const it = parseObitPage(await readCapped(pr, CAP.page), source, e);
      if (it) items.push(it);
    } catch (_) { /* one slow page should not sink the source */ }
  }
  // A block on the detail pages backs the whole host off (loadSource) once nothing usable came back.
  if (!items.length && blockedErr) return { items: [], error: blockedErr, httpStatus: +blockedErr.slice(5), url };
  return { items, error: items.length ? null : 'no items', httpStatus: r.status, url };
}

// Fetches one URL. When we hold validators (ETag / Last-Modified) from the last good fetch, they are
// sent so an unchanged feed answers 304 and costs almost nothing.
async function tryUrl(source, url, prev) {
  try {
    const headers = { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/xml, text/xml, */*' };
    if (prev && prev.url === url) {
      if (prev.etag) headers['if-none-match'] = prev.etag;
      if (prev.lastModified) headers['if-modified-since'] = prev.lastModified;
    }
    if (source.parser === 'ticketmaster') return await fetchTicketmaster(source, url);
    if (source.parser === 'sitemap') return await fetchSitemap(source, url, prev);
    if (source.parser === 'venue') {
      const items = [];
      for (const start of [0, 20, 40]) {
        const r = await safeFetch(url + (start ? '?start=' + start : ''), { headers: { ...headers, accept: 'text/html' }, signal: AbortSignal.timeout(10000) });
        if (!r.ok) { if (!start) return { items: [], error: 'HTTP ' + r.status, httpStatus: r.status, url }; break; }
        const page = parseVenue(await readCapped(r, CAP.page), source, url);
        if (!page.length) break;
        items.push(...page);
        if (page.length < 20) break;
      }
      return { items, error: items.length ? null : 'no items', httpStatus: 200, url };
    }
    if (isGoogleNews(url)) await googleTurn();
    const r = await safeFetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (r.status === 304) return { items: [], notModified: true, error: null, httpStatus: 304, url };
    if (!r.ok) return { items: [], error: 'HTTP ' + r.status, httpStatus: r.status, url };
    const xml = await readCapped(r, CAP.feed);
    const viaGoogle = isGoogleNews(url);
    const ical = /BEGIN:VCALENDAR/.test(xml);
    const parsed = ical ? parseIcal(xml, source) : parseFeed(xml, { ...source, fetchedUrl: url });
    const items = parsed.filter(it => passesFilters(it, source, viaGoogle));
    const wire = parsed.filter(it => isWire(it)).length; // counted so a feed flooded by wire copy shows up in source health
    return { items, error: items.length ? null : 'no items', httpStatus: r.status, received: parsed.length, wire,
      feedLike: ical || /<(rss|feed|rdf:RDF|channel)\b/i.test(xml), url, etag: r.headers.get('etag') || '', lastModified: r.headers.get('last-modified') || '' };
  } catch (e) {
    return { items: [], error: String(e && e.message || e).slice(0, 80), errorCode: (e && (e.code || e.name)) || '', url };
  }
}

// Tries the URL that worked last time first, then the main URL and any altUrls, and keeps the first
// one that returns stories (or confirms nothing changed).
// A host that answered 429/403 is left alone until its cooldown ends (prev.blocked: { host: untilMs }); the
// Google News fallback is used meanwhile. After the cooldown the publisher's own feed is tried first again.
async function loadSource(source, prev, now) {
  now = now || Date.now();
  let urls = [source.url].concat(source.altUrls || []);
  if (prev && prev.url && urls.includes(prev.url) && !isGoogleNews(prev.url)) urls.splice(urls.indexOf(prev.url), 1), urls.unshift(prev.url);
  const blocked = Object.assign({}, (prev && prev.blocked) || {});
  Object.keys(blocked).forEach(h => { if (blocked[h] <= now) delete blocked[h]; });
  const open = urls.filter(u => !blocked[hostOf(u)]);
  let last = { items: [], error: open.length ? 'no url' : 'cooling down after rate limit' }, wireSeen = null;
  for (const url of open) {
    last = await tryUrl(source, url, prev);
    if (/^HTTP (429|403)$/.test(last.error || '')) {
      // back off: 30 min, doubling with each consecutive block, up to 6 hours
      const fails = ((prev && prev.blockCount) || 0) + 1;
      blocked[hostOf(url)] = now + Math.min(6 * 36e5, 30 * 6e4 * Math.pow(2, fails - 1));
      last.blockCount = fails;
      continue;
    }
    if (last.items.length || last.notModified) break;
    if (last.wire && (!wireSeen || last.wire > wireSeen.wire)) wireSeen = { wire: last.wire, received: last.received };
  }
  // Every endpoint came back empty: keep the wire count from the one that was all wire copy, so the run report says
  // all_wire instead of looking like a quiet feed (the Google News fallback has no wire count of its own).
  if (wireSeen && !last.items.length && !last.notModified && !(last.wire >= wireSeen.wire)) last = Object.assign({}, last, wireSeen);
  return { source, ...last, blocked, blockCount: last.blockCount || (Object.keys(blocked).length ? (prev && prev.blockCount) || 0 : 0) };
}

function normKey(item) {
  return item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function combine(results, now) {
  const seen = new Set();
  const all = [];
  const events = [];
  const obits = [];
  const safety = [];
  const obitAt = new Map();
  // Funeral homes go first, so when a paper and a funeral home list the same person the funeral home's card wins.
  results = results.slice().sort((a, b) => (b.source && b.source.funeralHome ? 1 : 0) - (a.source && a.source.funeralHome ? 1 : 0));
  for (const r of results) {
    for (const raw of r.items) {
      const it = !r.source ? raw : passesFilters(raw, r.source) ? safetyView(raw, r.source) : null;
      if (!it) continue;
      const ts = it.published ? Date.parse(it.published) : null;
      const key = normKey(it);
      if (it.isEvent) {
        // upcoming events only: from the start of today (Chicago) to 120 days out
        if (ts === null || ts < now - 864e5 || ts > now + 120 * 864e5) continue;
        const ekey = key + '|' + new Date(ts).toISOString().slice(0, 10);
        if (seen.has(ekey)) continue;
        seen.add(ekey);
        events.push(it);
        continue;
      }
      if (it.isObit) {
        if (ts !== null && (ts < now - (it.maxAgeDays || 21) * 864e5 || ts > now + 36e5)) continue;
        const okey = 'ob|' + obitKey(it.title);
        if (seen.has('ob|' + key) || seen.has(okey)) {
          // keep the first card's link, but borrow the paper's summary when the funeral home gave none
          const at = obitAt.get(okey);
          if (at !== undefined && !obits[at].summary && it.summary) obits[at] = { ...obits[at], summary: it.summary };
          continue;
        }
        seen.add('ob|' + key); seen.add(okey); obitAt.set(okey, obits.length);
        obits.push(it);
        continue;
      }
      const cutoff = now - (it.maxAgeDays || MAX_AGE_DAYS) * 864e5;
      if (ts !== null && (ts < cutoff || ts > now + 36e5)) continue;
      if (seen.has(key) || seen.has(it.link)) continue;
      seen.add(key); seen.add(it.link);
      (r.source && (r.source.kind === 'police' || r.source.kind === 'courts') ? safety : all).push(it);
    }
  }
  const byDate = (a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0);
  // Police and court releases have their own cap: they post a few times a month, so in one shared cap a
  // busy news day pushed a sheriff's post from three weeks ago out of the snapshot while it was still in its window.
  safety.sort(byDate);
  const feed = all.sort(byDate).slice(0, MAX_ITEMS).concat(safety.slice(0, MAX_SAFETY)).sort(byDate);
  events.sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
  // Repeat events (weekly yoga, a run of shows) share one picture: any dated copy that has an image lends it to the rest.
  const pics = {};
  events.forEach(e => { const k = e.sourceId + '|' + normKey(e); if (e.image && !pics[k]) pics[k] = e.image; });
  events.forEach(e => { if (!e.image) e.image = pics[e.sourceId + '|' + normKey(e)] || ''; });
  obits.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  return feed.concat(events.slice(0, 160), obits.slice(0, MAX_OBITS)).map((it, i) => ({ id: it.sourceId + '-' + i, ...it }));
}

function logoFor(url) {
  try { return 'https://www.google.com/s2/favicons?sz=128&domain=' + new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

// ---------- storage (Upstash Redis) ----------
// Each source keeps its own record (last good stories + validators + health), so one failed or rate-limited
// run never makes a source's stories disappear. The merged page data is stored as one snapshot that
// /api/news serves, so visitors never wait on the feeds.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const stored = () => !!(URL_ && TOKEN);
const OVERRIDES_KEY = 'tsn:loc:overrides';
const SNAP_KEY = 'tsn:news:snapshot', LOCK_KEY = 'tsn:news:lock', srcKey = id => 'tsn:src:' + id;
const SNAP_MAX_AGE = 3 * 36e5;          // older than this and /api/news refreshes on the spot
const KEEP_ITEMS = 80;                  // stories kept per source
// Fast tier (every 10 min): sources that post often and tolerate polling. BLOX papers (Messenger-Inquirer,
// The Messenger, Sun-Commercial, WPSD) rate-limit by IP, so they moved to the half-hourly full run.
const FAST_IDS = new Set(['ob-owtimes', 'wfie', 'weht', 'owtimes', 'courier', 'gleaner', 'kfvs', 'wthi', 'wkdq', 'wbkr', 'fbilou', 'fbiind', 'fbispr', 'usaowdky', 'usaosdil']);

async function redis(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(commands), signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('store ' + r.status);
  return r.json();
}
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
// MGET through the same /pipeline call. Anything but an array of the right length is treated like an unreachable
// store (the caller's catch), so a bad answer can never be mistaken for "no previous state" and overwrite it.
async function mget(keys) {
  if (!keys.length) return [];
  const out = await redis([['MGET'].concat(keys)]);
  const v = out && out[0] && out[0].result;
  if (!Array.isArray(v) || v.length !== keys.length) throw new Error('store MGET ' + ((out && out[0] && out[0].error) || 'bad reply'));
  return v;
}

async function readSnapshot() {
  if (!stored()) return null;
  try { const out = await redis([['GET', SNAP_KEY]]); return parse(out[0] && out[0].result); } catch (e) { return null; }
}

// Folds a fetch result into the source's previous record. Failures keep the earlier stories.
function mergeState(source, prev, res, now) {
  prev = prev || { items: [] };
  const state = { items: prev.items || [], url: prev.url || '', etag: prev.etag || '', lastModified: prev.lastModified || '', lastOk: prev.lastOk || null, fails: prev.fails || 0, error: null, lastTry: new Date(now).toISOString(), blocked: res.blocked || prev.blocked || {}, blockCount: res.blockCount !== undefined ? res.blockCount : (prev.blockCount || 0) };
  if (res.notModified || res.items.length || res.error === 'no items') { // 'no items': the feed works but has nothing local right now
    if (res.items.length) {
      const fresh = new Set(res.items.map(i => i.link));
      state.items = res.items.concat(state.items.filter(i => !fresh.has(i.link)));
      state.etag = res.etag || ''; state.lastModified = res.lastModified || ''; state.url = res.url;
    }
    state.lastOk = new Date(now).toISOString(); state.fails = 0;
  } else { state.fails += 1; state.error = res.error || 'failed'; }
  // drop stories past their window (events stay until the day after they happen)
  state.items = state.items.filter(it => {
    const ts = it.published ? Date.parse(it.published) : null;
    if (it.isEvent) return ts !== null && ts >= now - 864e5;
    if (ts === null) return res.items.includes(it);
    return ts >= now - (it.maxAgeDays || MAX_AGE_DAYS) * 864e5;
  }).slice(0, KEEP_ITEMS);
  return state;
}

// ---------- adapter results and run records (plan 6.1, PR 1.3) ----------
// Every source fetched in a run gets one typed result; the run's results are stored privately under tsn:runs:<runId>
// for 7 days (one extra SET in the run's single write request). Error text lives only there and in tsn:src:<id>,
// never in the public /api/news answer.
const RUN_TTL = 7 * 86400;
const runKey = id => 'tsn:runs:' + id;
// <ISO minute>-<tier>-<4 hex>, e.g. 2026-10-18T13:38Z-fast-3f9a
const newRunId = (now, tier) => new Date(now).toISOString().slice(0, 16) + 'Z-' + tier + '-' + require('crypto').randomBytes(2).toString('hex');
const STATUSES = ['success', 'not_modified', 'empty_valid_feed', 'rate_limited', 'temporary_failure', 'invalid_response', 'blocked', 'configuration_error'];

// The loadSource result -> one status. 403s count as rate_limited until the host has been blocked 3 runs in a row.
function statusOf(r) {
  if (r.notModified) return 'not_modified';
  if (r.items && r.items.length) return 'success';
  const e = r.error || '', h = r.httpStatus || 0, c = r.errorCode || '', blocks = r.blockCount || 0;
  if (e === 'no items') return r.missingKey ? 'configuration_error' : r.feedLike === false && !r.received ? 'invalid_response' : 'empty_valid_feed';
  if (e === 'cooling down after rate limit' || h === 403) return blocks >= 3 ? 'blocked' : 'rate_limited';
  if (h === 429) return 'rate_limited';
  if (h >= 500) return 'temporary_failure';
  if (h >= 400) return 'configuration_error';
  if (h >= 300) return 'invalid_response';
  if (c === 'ERR_URL_BLOCKED' || c === 'ERR_URL_INVALID' || e === 'no url') return 'configuration_error';
  if (c === 'ERR_BODY_TOO_LARGE' || c === 'ERR_TOO_MANY_REDIRECTS' || c === 'SyntaxError') return 'invalid_response';
  return 'temporary_failure'; // timeouts, DNS and network errors
}

function adapterResult(r, ctx) {
  const src = r.source || {}, urls = [src.url].concat(src.altUrls || []);
  const at = r.url ? urls.indexOf(r.url) : -1;
  const accepted = (r.items || []).length;
  const received = Math.max(accepted, Number.isFinite(r.received) ? r.received : accepted);
  const out = {
    runId: ctx.runId, sourceId: src.id, endpointId: at === 0 ? 'main' : at > 0 ? 'alt' + at : 'none',
    attemptedAt: r.attemptedAt || ctx.attemptedAt || null, status: statusOf(r), httpStatus: r.httpStatus || null,
    durationMs: Number.isFinite(r.durationMs) ? r.durationMs : null, notModified: !!r.notModified,
    itemsReceived: received, itemsAccepted: accepted, itemsRejected: received - accepted,
    rejectionReasons: received > accepted ? { not_eligible: received - accepted } : {}, warnings: [],
  };
  // Wire copy (AP and the like) is rejected on purpose; when it is most of what a feed returns, the feed URL is the
  // problem (an unfiltered site-wide BLOX search feed, 2026-10-22), so it is reported as its own reason and warning.
  const wire = Math.min(Number(r.wire) || 0, received - accepted);
  if (wire > 0) {
    out.rejectionReasons = { wire };
    if (received - accepted - wire > 0) out.rejectionReasons.not_eligible = received - accepted - wire;
    if (wire * 2 >= received) out.warnings.push(accepted ? 'mostly_wire' : 'all_wire');
  }
  if (at > 0) out.warnings.push('fallback_endpoint');
  if (r.error && r.error !== 'no items') out.detail = String(r.error).slice(0, 120); // private: tsn:runs only
  return out;
}

// The public sources[] carries no error text (plan 6.1: error detail is admin-only; it stays in tsn:src:<id> and
// tsn:runs:<runId>). Snapshots stored before PR 1.3 still have an error field, so it is also dropped when served.
function publicSnapshot(snap) {
  if (snap && 'overrides' in snap) { snap = Object.assign({}, snap); delete snap.overrides; } // admin data, see refreshAll
  if (!snap || !Array.isArray(snap.sources) || !snap.sources.some(s => s && 'error' in s)) return snap;
  return Object.assign({}, snap, { sources: snap.sources.map(s => { const o = Object.assign({}, s); delete o.error; return o; }) });
}

function buildSnapshot(states, now) {
  const results = SOURCES.map(src => ({ source: src, items: (states[src.id] && states[src.id].items) || [] }));
  const items = combine(results, now);
  const sources = SOURCES.map(src => {
    const st = states[src.id] || { items: [] };
    return { logo: logoFor(src.url), id: src.id, name: src.name, area: src.area || '', kind: src.kind || 'news', ok: st.items.length > 0 || (!st.error && !!st.lastOk), count: items.filter(i => i.sourceId === src.id).length, lastOk: st.lastOk || null, stale: !!st.error && st.items.length > 0 };
  });
  return { updatedAt: new Date(now).toISOString(), sources, items };
}

// Fetches sources (all of them, or just the fast tier), updates their records, and rebuilds the snapshot.
// Without Redis nothing is saved: the result is just computed fresh, as before.
async function refreshAll(opts) {
  opts = opts || {};
  const now = Date.now();
  let targets = opts.tier === 'fast' ? SOURCES.filter(s => FAST_IDS.has(s.id)) : SOURCES;
  let persist = stored();
  let prevStates = {}, overridesRaw = [];
  const store = { requests: 0, commands: 0 }; // billed Upstash commands this run, reported by /api/refresh
  if (persist) {
    // If the store is unreachable (bad or rotated token, outage) keep going without it rather than failing the page.
    try {
      // One MGET (one billed command) instead of one GET per source. Same values: a missing key is null either way.
      // The same request also reads the admin's manual county overrides (HGETALL, one more command, no extra trip).
      store.requests++; store.commands += 2;
      const keys = SOURCES.map(s => srcKey(s.id));
      const out = await redis([['MGET'].concat(keys), ['HGETALL', OVERRIDES_KEY]]);
      const vals = out && out[0] && out[0].result;
      if (!Array.isArray(vals) || vals.length !== keys.length) throw new Error('store MGET ' + ((out && out[0] && out[0].error) || 'bad reply'));
      overridesRaw = (out[1] && out[1].result) || [];
      SOURCES.forEach((s, i) => { prevStates[s.id] = parse(vals[i]); });
    } catch (e) { persist = false; }
  }
  // Respect each source's minimum polling interval (everyMin): skip it if it was tried recently.
  targets = targets.filter(s => { const p = prevStates[s.id]; return !s.everyMin || !p || !p.lastTry || now - Date.parse(p.lastTry) >= s.everyMin * 6e4 - 30e3; });
  // Sources on the same host run one after another with a pause: those hosts rate-limit by IP, and the
  // news and obituary feeds of one paper share a host.
  const byHost = {};
  targets.forEach(s => { let h = ''; try { h = new URL(s.url).hostname; } catch (_) { /* ignore */ } (byHost[h] = byHost[h] || []).push(s); });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tier = opts.tier === 'fast' ? 'fast' : 'all';
  const runId = newRunId(now, tier);
  const fetched = (await Promise.all(Object.values(byHost).map(async group => {
    const out = [];
    for (let i = 0; i < group.length; i++) {
      if (i) await sleep(900);
      const t = Date.now();
      const r = await loadSource(group[i], prevStates[group[i].id], now);
      r.attemptedAt = new Date(t).toISOString(); r.durationMs = Date.now() - t;
      out.push(r);
    }
    return out;
  }))).flat();
  const states = Object.assign({}, prevStates);
  const report = [];
  for (const r of fetched) {
    states[r.source.id] = mergeState(r.source, prevStates[r.source.id], r, now);
    report.push({ id: r.source.id, result: r.notModified ? '304' : r.items.length ? 'ok ' + r.items.length : 'fail: ' + r.error });
  }
  // sources not fetched this round (fast tier) still need a record
  SOURCES.forEach(s => { if (!states[s.id]) states[s.id] = { items: [], error: null, lastOk: null }; });
  const snap = buildSnapshot(states, now);
  // Manual county overrides from the admin (api/_coverage.js), carried in the snapshot for api/_scope.js. Only the
  // story keys that are in this snapshot; readers never get the map (publicSnapshot/_scope strip it).
  if (overridesRaw.length) {
    try {
      const flat = overridesRaw, keys = new Set(snap.items.map(i => require('./_scope.js').overrideKey(i)));
      const m = {}; for (let i = 0; i + 1 < flat.length; i += 2) if (keys.has(flat[i])) { try { const v = JSON.parse(flat[i + 1]); if (Array.isArray(v.countyIds)) m[flat[i]] = v.countyIds; } catch (_) { /* skip */ } }
      if (Object.keys(m).length) snap.overrides = m;
    } catch (_) { /* overrides are optional */ }
  }
  const results = fetched.map(r => adapterResult(r, { runId }));
  const statusCounts = {};
  results.forEach(x => { statusCounts[x.status] = (statusCounts[x.status] || 0) + 1; });
  const finished = Date.now();
  let shadowLoc = null;
  if (FLAGS.countyClassification()) { try { shadowLoc = LOC().shadow(snap, SOURCES, { runId, tier }); } catch (e) { console.error('location shadow failed', e && e.message); } }
  const run = { runId, tier, startedAt: new Date(now).toISOString(), finishedAt: new Date(finished).toISOString(), durationMs: finished - now, attempted: results.length, statusCounts, results };
  if (persist) {
    const cmds = fetched.map(r => ['SET', srcKey(r.source.id), JSON.stringify(states[r.source.id]), 'EX', String(14 * 86400)]);
    cmds.push(['SET', SNAP_KEY, JSON.stringify(snap), 'EX', String(2 * 86400)]);
    cmds.push(['SET', runKey(runId), JSON.stringify(run), 'EX', String(RUN_TTL)]);
    // Shadow county classification (plan stage B, COUNTY_CLASSIFICATION_ENABLED): stored privately, never in the snapshot.
    if (shadowLoc) cmds.push(['SET', LOC().SHADOW_KEY, JSON.stringify(shadowLoc), 'EX', String(LOC().SHADOW_TTL)]);
    store.requests++; store.commands += cmds.length;
    try { await redis(cmds); } catch (e) { report.push({ id: 'store', result: 'fail: ' + e.message }); }
  }
  return { snapshot: snap, report, store, runId, run, locations: shadowLoc ? shadowLoc.summary : null };
}

async function handler(req, res) {
  try { await run(req, res); } catch (e) {
    console.error('news failed', e && e.stack || e);
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'news temporarily unavailable' }); // the detail is in the function log only
  }
}

async function run(req, res) {
  const filters = FLAGS.on('COUNTY_FILTERS_ENABLED');
  let scope = null;
  if (filters) {
    const S = require('./_scope.js');
    const raw = req.query && req.query.scope;
    scope = S.parse(Array.isArray(raw) ? raw[0] : raw);
    if (scope.error) { res.setHeader('Cache-Control', 'public, s-maxage=3600, max-age=300'); return res.status(400).json({ error: scope.error }); }
    if (raw != null && String(raw) !== scope.key && scope.key !== 'tristate') {
      res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600');
      res.setHeader('Location', '/api/news?scope=' + encodeURIComponent(scope.key).replace(/%3A/g, ':').replace(/%2C/g, ','));
      return res.status(308).end();
    }
  }
  let snap = await readSnapshot();
  if (!snap || Date.now() - Date.parse(snap.updatedAt) > SNAP_MAX_AGE) {
    // No fresh snapshot (cron not set up yet, or it stopped): refresh now. A short lock keeps a burst of
    // visitors from each re-fetching every feed.
    let locked = false;
    if (stored()) { try { const l = await redis([['SET', LOCK_KEY, '1', 'NX', 'EX', '90']]); locked = !(l[0] && l[0].result === 'OK'); } catch (e) { /* carry on */ } }
    if (!locked || !snap) { try { snap = (await refreshAll({})).snapshot; } catch (e) { if (!snap) throw e; } }
  }
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900, max-age=120');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).send(JSON.stringify(publicSnapshot(scoped(snap, scope, filters))));
}

// Scope filters (plan PR 6.1, api/_scope.js), behind COUNTY_FILTERS_ENABLED. Off: ?scope is ignored and the response is
// the snapshot as before. On: ?scope selects a view, the response says which (scope{}) and carries a place label per
// story, and features{} tells the page to show its scope control. The CDN caches per full URL, so each canonical
// ?scope= value is its own cache entry; a non-canonical spelling (state:KY, counties:b,a) redirects to the canonical one.
// Either way the no-scope view keeps expansion-batch sources out unless a story names a core county (plan D8).
function scoped(snap, scope, filters) {
  const S = require('./_scope.js');
  if (!filters) return S.view(snap, S.parse(''), SOURCES);
  const v = S.view(snap, scope, SOURCES, { labels: true });
  return Object.assign({}, v, { features: { scopes: true, routes: FLAGS.on('REGIONAL_ROUTES_ENABLED') } });
}

// /api/refresh is served by this function too (vercel.json rewrites it to /api/news?__route=refresh); its handler,
// with its own CRON_SECRET check, lives in api/_refresh.js. /api/counties and /api/regions (rewritten to
// ?__route=counties / ?__route=regions) are the read-only geography API in api/_geoapi.js, which never touches Redis.
// /api/locations (?__route=locations) is the admin-only county-classification report in api/_locations.js.
// /api/coverage (?__route=coverage) is the admin Sources & Coverage report and override endpoint in api/_coverage.js.
// Every other request is the news handler above.
module.exports = require('./_dispatch.js').host({
  refresh: () => require('./_refresh.js'),
  counties: () => require('./_geoapi.js').counties,
  regions: () => require('./_geoapi.js').regions,
  locations: () => require('./_locations.js'),
  geopage: () => require('./_geopage.js'),
  coverage: () => require('./_coverage.js')
}, handler);
module.exports.parseFeed = parseFeed;
module.exports.readSnapshot = readSnapshot;
module.exports.redis = redis;
module.exports.combine = combine;
module.exports.inRegion = inRegion;
module.exports.inTriState = inTriState;
module.exports.isWire = isWire;
module.exports.parseIcal = parseIcal;
module.exports.refreshAll = refreshAll;
module.exports.SOURCES = SOURCES;
module.exports.DISABLED_SOURCES = DISABLED_SOURCES;
module.exports.mergeState = mergeState;
module.exports.stored = stored;
module.exports.loadSource = loadSource;
module.exports.safetyView = safetyView;
module.exports.ARREST_MAX_DAYS = ARREST_MAX_DAYS;
module.exports.passesFilters = passesFilters;
module.exports.adapterResult = adapterResult;
module.exports.statusOf = statusOf;
module.exports.STATUSES = STATUSES;
module.exports.RUN_TTL = RUN_TTL;
module.exports.publicSnapshot = publicSnapshot;
