// Tri-State (Evansville, IN-KY MSA) news aggregator.
// Fetches every configured feed server-side, normalizes, dedupes, and returns one list.
// The CDN caches the response for one hour (s-maxage=3600), so each hour's first visit
// refreshes every source and everyone else gets the cached copy.

// Coverage area: Evansville MSA plus Owensboro, Madisonville, Carbondale, Marion, Vincennes
// and the towns in between (southwest Indiana, western Kentucky, southern Illinois).
//
// geo: true  -> the outlet covers a wider region than ours, so only stories that mention a
//               place from REGION_TERMS are kept.
// Sources marked "unverified" were not reachable when this was built; a source that fails or
// returns zero items is reported in `sources` with ok:false and the page hides it.
const SOURCES = [
  // Evansville / Tri-State
  { id: 'wfie', name: '14 News', area: 'Evansville', url: 'https://www.14news.com/arc/outboundfeeds/rss/?outputType=xml' },
  { id: 'weht', name: 'Eyewitness News', area: 'Evansville', url: 'https://www.tristatehomepage.com/feed/' },
  { id: 'living', name: 'Evansville Living', area: 'Evansville', url: 'https://evansvilleliving.com/feed/' },
  { id: 'courier', name: 'Courier & Press', area: 'Evansville', url: 'https://www.courierpress.com/arcio/rss/', altUrls: ['https://rssfeeds.courierpress.com/courierpress/home', 'https://www.courierpress.com/arc/outboundfeeds/rss/?outputType=xml'] }, // unverified
  { id: 'gleaner', name: 'Henderson Gleaner', area: 'Henderson', url: 'https://www.thegleaner.com/arcio/rss/', altUrls: ['https://rssfeeds.thegleaner.com/thegleaner/home', 'https://www.thegleaner.com/arc/outboundfeeds/rss/?outputType=xml'] }, // unverified
  // Owensboro
  { id: 'owtimes', name: 'Owensboro Times', area: 'Owensboro', url: 'https://www.owensborotimes.com/feed/' },
  { id: 'messinq', name: 'Messenger-Inquirer', area: 'Owensboro', url: 'https://www.messenger-inquirer.com/search/?f=rss&t=article&l=25' },
  // Madisonville
  { id: 'msgr', name: 'The Messenger', area: 'Madisonville', url: 'https://www.the-messenger.com/search/?f=rss&t=article&l=25', altUrls: ['https://www.the-messenger.com/search/?f=rss&t=article&c=news&l=25&s=start_time&sd=desc'] }, // unverified
  // Jasper / Dubois County (between Evansville and Vincennes)
  { id: 'dcherald', name: 'Dubois County Herald', area: 'Jasper', url: 'https://www.duboiscountyherald.com/search/?f=rss&t=article&l=25' },
  // Smaller-town papers (BLOX feed pattern; unverified, hidden automatically if they fail)
  { id: 'wth', name: 'Washington Times-Herald', area: 'Washington, Ind.', url: 'https://washtimesherald.com/search/?f=rss&t=article&l=25', altUrls: ['https://washtimesherald.com/search/?f=rss&t=article&c=news&l=25&s=start_time&sd=desc'] }, // unverified
  // Vincennes / Wabash Valley
  { id: 'wthi', name: 'WTHI News', area: 'Vincennes', geo: true, url: 'https://www.wthitv.com/arc/outboundfeeds/rss/?outputType=xml' },
  { id: 'sunc', name: 'Vincennes Sun-Commercial', area: 'Vincennes', url: 'https://www.suncommercial.com/search/?f=rss&t=article&l=25', altUrls: ['https://www.suncommercial.com/search/?f=rss&t=article&c=news&l=25&s=start_time&sd=desc'] }, // unverified
  // Carbondale / Marion / southern Illinois
  { id: 'kfvs', name: 'KFVS12', area: 'Southern Illinois', geo: true, url: 'https://www.kfvs12.com/arc/outboundfeeds/rss/?outputType=xml' },
  { id: 'wpsd', name: 'WPSD Local 6', area: 'Southern Illinois', geo: true, url: 'https://www.wpsdlocal6.com/search/?f=rss&t=article&l=25&s=start_time&sd=desc' },
  { id: 'southern', name: 'The Southern Illinoisan', area: 'Carbondale', url: 'https://thesouthern.com/search/?f=rss&t=article&l=25', altUrls: ['https://thesouthern.com/search/?f=rss&t=article&c=news&l=25&s=start_time&sd=desc'] }, // unverified
  { id: 'degypt', name: 'Daily Egyptian', area: 'Carbondale', url: 'https://dailyegyptian.com/feed/', altUrls: ['https://dailyegyptian.com/category/news/feed/'] }, // unverified
  // Radio
  // Small towns and more radio. Feeds checked on 2026-10-06 and re-checked 2026-10-07 unless marked.
  { id: 'pdclarion', name: 'Princeton Daily Clarion', area: 'Princeton, Ind.', url: 'https://www.pdclarion.com/search/?f=rss&t=article&l=25' },
  { id: 'mtcarmel', name: 'Daily Republican-Register', area: 'Mt. Carmel', url: 'https://hometownregister.com/search/?f=rss&t=article&l=25' },
  { id: 'pikenews', name: 'Pike County News', area: 'Petersburg', url: 'https://www.pikecountynews.com/feed/' },
  { id: 'murphy', name: 'Murphysboro American', area: 'Murphysboro', url: 'https://www.murphysboroamerican.com/feed/' },
  { id: 'wsto', name: 'WSTO Radio', area: 'Owensboro', geo: true, url: 'https://wsto.com/feed/' },
  { id: 'wkdq', name: 'WKDQ Radio', area: 'Henderson', geo: true, url: 'https://wkdq.com/feed/' },
  { id: 'weoa', name: 'WEOA Radio', area: 'Evansville', geo: true, url: 'https://weoa.com/feed/' },
  { id: 'wjps', name: 'WJPS Radio', area: 'Evansville', geo: true, url: 'https://wjps.com/feed/' },
  { id: 'owradio', name: 'Owensboro Radio', area: 'Owensboro', url: 'https://owensbororadio.com/feed/' },
  // Statehouse reporting: kept only when a story names a place in the region
  { id: 'inchron', name: 'Indiana Capital Chronicle', area: 'Indiana', geo: true, url: 'https://indianacapitalchronicle.com/feed/' },
  { id: 'kylantern', name: 'Kentucky Lantern', area: 'Kentucky', geo: true, url: 'https://kentuckylantern.com/feed/' },
  { id: 'capnewsil', name: 'Capitol News Illinois', area: 'Illinois', geo: true, url: 'https://capitolnewsillinois.com/feed/' },
  // Radio (wider-market stations: kept only when a story names a place in the region)
  { id: 'wiky', name: 'WIKY', area: 'Evansville', geo: true, url: 'https://wiky.com/feed/' },
  { id: 'wbkr', name: 'WBKR', area: 'Owensboro', geo: true, url: 'https://wbkr.com/feed/' },
  // Federal courts and prosecutors (press releases are infrequent, so they stay on the page longer)
  { id: 'usaowdky', name: 'U.S. Attorney, W.D. Kentucky', area: 'Kentucky', kind: 'courts', geo: true, maxAgeDays: 60, url: 'https://www.justice.gov/news/rss?type=press_release&groupname=331&field_component=1851&search_api_language=en&require_all=0' },
  { id: 'usaosdil', name: 'U.S. Attorney, S.D. Illinois', area: 'Illinois', kind: 'courts', geo: true, maxAgeDays: 60, url: 'https://www.justice.gov/news/rss?type=press_release&groupname=296&field_component=1826&search_api_language=en&require_all=0' },
  // FBI field offices covering the region (all three verified)
  { id: 'fbilou', name: 'FBI Louisville', area: 'Kentucky', kind: 'courts', geo: true, maxAgeDays: 60, url: 'https://www.fbi.gov/feeds/louisville-news/rss.xml' },
  { id: 'fbiind', name: 'FBI Indianapolis', area: 'Indiana', kind: 'courts', geo: true, maxAgeDays: 60, url: 'https://www.fbi.gov/feeds/indianapolis-news/rss.xml' },
  { id: 'fbispr', name: 'FBI Springfield', area: 'Illinois', kind: 'courts', geo: true, maxAgeDays: 60, url: 'https://www.fbi.gov/feeds/springfield-news/rss.xml' },
  // Events (kind: 'events'): RSS or iCal calendars. Unverified, tourism sites often block datacenter
  // requests; each tries its RSS feed, then its iCal export. Add more with EXTRA_FEEDS.
  { id: 'ev-evv', name: 'Explore Evansville', area: 'Evansville', kind: 'events', url: 'https://www.exploreevansville.com/events/feed/', altUrls: ['https://www.exploreevansville.com/events/?ical=1'] },
  { id: 'ev-owb', name: 'Visit Owensboro', area: 'Owensboro', kind: 'events', url: 'https://www.visitowensboro.com/events/feed/', altUrls: ['https://www.visitowensboro.com/events/?ical=1'] },
  { id: 'ev-mad', name: 'Visit Madisonville', area: 'Madisonville', kind: 'events', url: 'https://www.visitmadisonvilleky.com/events/feed/', altUrls: ['https://www.visitmadisonvilleky.com/events/?ical=1'] },
  // Public radio and newsrooms from neighboring markets
  { id: 'wkms', name: 'WKMS Public Radio', area: 'Western Kentucky', geo: true, url: 'https://www.wkms.org/rss.xml' },
  { id: 'ipm', name: 'Illinois Public Media', area: 'Illinois', geo: true, url: 'https://ipmnewsroom.org/feed/' },
];

// Add more feeds without editing code: set EXTRA_FEEDS in the Vercel project to a JSON array like
// [{"id":"usi","name":"USI News","area":"Evansville","kind":"institution","url":"https://example.edu/feed"}]
// Add "geo": true for outlets that cover a wider region than ours.
try {
  const extra = JSON.parse(process.env.EXTRA_FEEDS || '[]');
  for (const e of Array.isArray(extra) ? extra : []) {
    if (e && e.id && e.name && /^https?:\/\//.test(e.url || '') && !SOURCES.some(s => s.id === e.id)) {
      SOURCES.push({ id: String(e.id), name: String(e.name), area: String(e.area || ''), kind: ['institution', 'courts', 'police', 'events'].includes(e.kind) ? e.kind : undefined, geo: !!e.geo, maxAgeDays: Number(e.maxAgeDays) > 0 ? Number(e.maxAgeDays) : undefined, url: e.url, altUrls: Array.isArray(e.altUrls) ? e.altUrls.filter(u => /^https?:\/\//.test(u)) : [] });
    }
  }
} catch (_) { /* ignore malformed EXTRA_FEEDS */ }

// Places between and around the anchor cities. Ambiguous names are state-qualified.
const REGION_TERMS = [
  // Indiana
  'evansville', 'newburgh, ind', 'vanderburgh', 'warrick', 'boonville', 'posey', 'mount vernon, ind', 'mt. vernon, ind', 'poseyville',
  'gibson county', 'princeton, ind', 'fort branch', 'haubstadt', 'oakland city', 'vincennes', 'knox county, ind', 'bicknell', 'washington, ind',
  'daviess county, ind', 'jasper, ind', 'dubois county', 'huntingburg', 'ferdinand', 'santa claus', 'tell city', 'perry county, ind', 'spencer county, ind', 'rockport, ind', 'chandler, ind', 'lynnville', 'terre haute', 'sullivan county, ind', 'pike county, ind', 'petersburg, ind', 'lawrenceburg', 'university of southern indiana', 'usi ',
  // Kentucky
  'owensboro', 'daviess county', 'henderson, ky', 'henderson county, ky', 'webster county', 'sebree', 'providence, ky', 'morganfield', 'union county, ky', 'uniontown', 'sturgis', 'madisonville, ky', 'hopkins county', 'earlington', 'nortonville', 'dawson springs', 'central city', 'muhlenberg', 'greenville, ky', 'hartford, ky', 'ohio county, ky', 'mclean county', 'calhoun, ky', 'livermore', 'beaver dam', 'hancock county, ky', 'hawesville', 'lewisport', 'princeton, ky', 'caldwell county', 'marion, ky', 'crittenden county', 'western kentucky', 'wku', 'kentucky wesleyan',
  // Illinois
  'carbondale', 'marion, ill', 'williamson county', 'herrin', 'murphysboro', 'jackson county, ill', 'harrisburg, ill', 'saline county, ill', 'carterville', 'johnston city', 'west frankfort', 'franklin county, ill', 'benton, ill', 'mount vernon, ill', 'mt. vernon, ill', 'jefferson county, ill', 'mcleansboro', 'hamilton county, ill', 'carmi', 'white county, ill', 'mount carmel', 'mt. carmel', 'wabash county, ill', 'lawrenceville, ill', 'lawrence county, ill', 'olney, ill', 'fairfield, ill', 'wayne county, ill', 'eldorado, ill', 'galatia', 'shawneetown', 'gallatin county, ill', 'metropolis, ill', 'massac', 'vienna, ill', 'johnson county, ill', 'anna, ill', 'jonesboro, ill', 'union county, ill', 'southern illinois', 'siu ', 'siu-', 'shawnee national forest', 'cairo, ill', 'pulaski county, ill', 'du quoin', 'perry county, ill', 'pinckneyville', 'chester, ill', 'randolph county, ill', 'sparta, ill', 'wabash valley', 'illinois', 'indiana', 'kentucky',
];

function inRegion(item) {
  const hay = (item.title + ' ' + item.summary).toLowerCase();
  // bare state names are weak signals on their own; require a real place for regional stations
  const strong = REGION_TERMS.filter(t => !['illinois', 'indiana', 'kentucky'].includes(t));
  return strong.some(t => hay.includes(t));
}

// BLOX CMS outlets mix AP wire copy into the same feed under /ap/. Wire stories are national.
function isWire(item) {
  try { return /^\/ap\//i.test(new URL(item.link).pathname); } catch (_) { return false; }
}

const MAX_ITEMS = 240;
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
    const title = stripHtml(tag(b, 'title'));
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
    if (summary.toLowerCase() === title.toLowerCase()) summary = '';

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

    items.push({ title, link, summary, image, published, source: source.name, sourceId: source.id, maxAgeDays: source.maxAgeDays, isEvent: source.kind === 'events' });
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
    items.push({ title, link, summary, image: '', published, source: source.name, sourceId: source.id, isEvent: true });
  }
  return items;
}

async function tryUrl(source, url) {
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': 'TriStateNewsAggregator/1.0 (+RSS reader)', accept: 'application/rss+xml, application/xml, text/xml, */*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { items: [], error: 'HTTP ' + r.status };
    const xml = await r.text();
    const items = (/BEGIN:VCALENDAR/.test(xml) ? parseIcal(xml, source) : parseFeed(xml, source))
      .filter(it => !isWire(it))
      .filter(it => !source.geo || inRegion(it));
    return { items, error: items.length ? null : 'no items' };
  } catch (e) {
    return { items: [], error: String(e && e.message || e).slice(0, 80) };
  }
}

// Tries the main URL, then any altUrls, and keeps the first one that returns stories.
async function loadSource(source) {
  let last = { items: [], error: 'no url' };
  for (const url of [source.url].concat(source.altUrls || [])) {
    last = await tryUrl(source, url);
    if (last.items.length) break;
  }
  return { source, items: last.items, error: last.error };
}

function normKey(item) {
  return item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function combine(results, now) {
  const seen = new Set();
  const all = [];
  const events = [];
  for (const r of results) {
    for (const it of r.items) {
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
      const cutoff = now - (it.maxAgeDays || MAX_AGE_DAYS) * 864e5;
      if (ts !== null && (ts < cutoff || ts > now + 36e5)) continue;
      if (seen.has(key) || seen.has(it.link)) continue;
      seen.add(key); seen.add(it.link);
      all.push(it);
    }
  }
  all.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  events.sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
  return all.slice(0, MAX_ITEMS).concat(events.slice(0, 120)).map((it, i) => ({ id: it.sourceId + '-' + i, ...it }));
}

function logoFor(url) {
  try { return 'https://www.google.com/s2/favicons?sz=128&domain=' + new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

async function handler(req, res) {
  const results = await Promise.all(SOURCES.map(loadSource));
  const items = combine(results, Date.now());
  const sources = results.map(r => ({
    logo: logoFor(r.source.url), id: r.source.id, name: r.source.name, area: r.source.area || '', kind: r.source.kind || 'news', ok: !r.error, count: items.filter(i => i.sourceId === r.source.id).length, error: r.error,
  }));
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=900, max-age=300');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).send(JSON.stringify({ updatedAt: new Date().toISOString(), sources, items }));
}

module.exports = handler;
module.exports.parseFeed = parseFeed;
module.exports.combine = combine;
module.exports.inRegion = inRegion;
module.exports.isWire = isWire;
module.exports.parseIcal = parseIcal;
