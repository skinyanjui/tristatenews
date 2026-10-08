// Tri-State (Evansville, IN-KY MSA) news aggregator.
// A scheduled job (api/refresh.js) fetches every configured feed, normalizes, dedupes, and stores
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
  // Obituaries (kind: 'obits'): the papers' own obituary sections (BLOX category feeds) and Owensboro Times.
  // Each item links back to the full notice on the publisher's site.
  { id: 'ob-messinq', name: 'Messenger-Inquirer', area: 'Owensboro', kind: 'obits', maxAgeDays: 21, url: 'https://www.messenger-inquirer.com/search/?f=rss&t=article&c=obituaries&l=25' },
  { id: 'ob-owtimes', name: 'Owensboro Times', area: 'Owensboro', kind: 'obits', maxAgeDays: 21, url: 'https://www.owensborotimes.com/obituaries/feed/' },
  { id: 'ob-dcherald', name: 'Dubois County Herald', area: 'Jasper', kind: 'obits', maxAgeDays: 21, url: 'https://www.duboiscountyherald.com/search/?f=rss&t=article&c=obituaries&l=25' },
  { id: 'ob-pdclarion', name: 'Princeton Daily Clarion', area: 'Princeton, Ind.', kind: 'obits', maxAgeDays: 21, url: 'https://www.pdclarion.com/search/?f=rss&t=article&c=obituaries&l=25' },
  { id: 'ob-sunc', name: 'Vincennes Sun-Commercial', area: 'Vincennes', kind: 'obits', maxAgeDays: 21, url: 'https://www.suncommercial.com/search/?f=rss&t=article&c=obituaries&l=25' },
  { id: 'ob-msgr', name: 'The Messenger', area: 'Madisonville', kind: 'obits', maxAgeDays: 21, url: 'https://www.the-messenger.com/search/?f=rss&t=article&c=obituaries&l=25' },
  { id: 'ob-wth', name: 'Washington Times-Herald', area: 'Washington, Ind.', kind: 'obits', maxAgeDays: 21, url: 'https://washtimesherald.com/search/?f=rss&t=article&c=obituaries&l=25' },
  // Venue listings (parser 'venue': the Ford Center and Victory Theatre event pages, which share one layout).
  { id: 'ev-ford', name: 'Ford Center', area: 'Evansville', kind: 'events', parser: 'venue', url: 'https://fordcenter.com/events-tickets/view-all-events' },
  { id: 'ev-victory', name: 'Victory Theatre', area: 'Evansville', kind: 'events', parser: 'venue', url: 'https://www.victorytheatre.com/events-tickets/view-all-events' },
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
      SOURCES.push({ id: String(e.id), name: String(e.name), area: String(e.area || ''), kind: ['institution', 'courts', 'police', 'events', 'obits'].includes(e.kind) ? e.kind : undefined, geo: !!e.geo, maxAgeDays: Number(e.maxAgeDays) > 0 ? Number(e.maxAgeDays) : undefined, url: e.url, altUrls: Array.isArray(e.altUrls) ? e.altUrls.filter(u => /^https?:\/\//.test(u)) : [] });
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
    if (summary.toLowerCase() === title.toLowerCase() || /^continue reading\b/i.test(summary)) summary = '';

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
    items.push({ title, link, summary, image: '', published, source: source.name, sourceId: source.id, isEvent: true });
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
    items.push({ title: name, link, summary, image, published, source: source.name, sourceId: source.id, isEvent: true, venue: source.name });
  }
  // an image shared by several events is the venue's placeholder, not a photo of the event
  const uses = {};
  items.forEach(i => { if (i.image) uses[i.image] = (uses[i.image] || 0) + 1; });
  items.forEach(i => { if (i.image && uses[i.image] > 2) i.image = ''; });
  return items;
}

// Fetches one URL. When we hold validators (ETag / Last-Modified) from the last good fetch, they are
// sent so an unchanged feed answers 304 and costs almost nothing.
async function tryUrl(source, url, prev) {
  try {
    const headers = { 'user-agent': 'TriStateNewsAggregator/1.0 (+RSS reader)', accept: 'application/rss+xml, application/xml, text/xml, */*' };
    if (prev && prev.url === url) {
      if (prev.etag) headers['if-none-match'] = prev.etag;
      if (prev.lastModified) headers['if-modified-since'] = prev.lastModified;
    }
    if (source.parser === 'venue') {
      const items = [];
      for (const start of [0, 20, 40]) {
        const r = await fetch(url + (start ? '?start=' + start : ''), { headers: { ...headers, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
        if (!r.ok) { if (!start) return { items: [], error: 'HTTP ' + r.status, url }; break; }
        const page = parseVenue(await r.text(), source, url);
        if (!page.length) break;
        items.push(...page);
        if (page.length < 20) break;
      }
      return { items, error: items.length ? null : 'no items', url };
    }
    const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (r.status === 304) return { items: [], notModified: true, error: null, url };
    if (!r.ok) return { items: [], error: 'HTTP ' + r.status, url };
    const xml = await r.text();
    const items = (/BEGIN:VCALENDAR/.test(xml) ? parseIcal(xml, source) : parseFeed(xml, source))
      .filter(it => !isWire(it))
      .filter(it => !source.geo || inRegion(it));
    return { items, error: items.length ? null : 'no items', url, etag: r.headers.get('etag') || '', lastModified: r.headers.get('last-modified') || '' };
  } catch (e) {
    return { items: [], error: String(e && e.message || e).slice(0, 80), url };
  }
}

// Tries the URL that worked last time first, then the main URL and any altUrls, and keeps the first
// one that returns stories (or confirms nothing changed).
async function loadSource(source, prev) {
  const urls = [source.url].concat(source.altUrls || []);
  if (prev && prev.url && urls.includes(prev.url)) urls.splice(urls.indexOf(prev.url), 1), urls.unshift(prev.url);
  let last = { items: [], error: 'no url' };
  for (const url of urls) {
    last = await tryUrl(source, url, prev);
    if (last.items.length || last.notModified) break;
  }
  return { source, ...last };
}

function normKey(item) {
  return item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function combine(results, now) {
  const seen = new Set();
  const all = [];
  const events = [];
  const obits = [];
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
      if (it.isObit) {
        if (ts !== null && (ts < now - (it.maxAgeDays || 21) * 864e5 || ts > now + 36e5)) continue;
        if (seen.has('ob|' + key)) continue;
        seen.add('ob|' + key);
        obits.push(it);
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
  obits.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  return all.slice(0, MAX_ITEMS).concat(events.slice(0, 120), obits.slice(0, 150)).map((it, i) => ({ id: it.sourceId + '-' + i, ...it }));
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
const SNAP_KEY = 'tsn:news:snapshot', LOCK_KEY = 'tsn:news:lock', srcKey = id => 'tsn:src:' + id;
const SNAP_MAX_AGE = 3 * 36e5;          // older than this and /api/news refreshes on the spot
const KEEP_ITEMS = 80;                  // stories kept per source
const FAST_IDS = new Set(['ob-messinq', 'ob-owtimes', 'wfie', 'weht', 'owtimes', 'messinq', 'courier', 'gleaner', 'msgr', 'kfvs', 'wthi', 'wpsd', 'sunc', 'wkdq', 'wbkr', 'fbilou', 'fbiind', 'fbispr', 'usaowdky', 'usaosdil']);

async function redis(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(commands), signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('store ' + r.status);
  return r.json();
}
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };

async function readSnapshot() {
  if (!stored()) return null;
  try { const out = await redis([['GET', SNAP_KEY]]); return parse(out[0] && out[0].result); } catch (e) { return null; }
}

// Folds a fetch result into the source's previous record. Failures keep the earlier stories.
function mergeState(source, prev, res, now) {
  prev = prev || { items: [] };
  const state = { items: prev.items || [], url: prev.url || '', etag: prev.etag || '', lastModified: prev.lastModified || '', lastOk: prev.lastOk || null, fails: prev.fails || 0, error: null, lastTry: new Date(now).toISOString() };
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

function buildSnapshot(states, now) {
  const results = SOURCES.map(src => ({ source: src, items: (states[src.id] && states[src.id].items) || [] }));
  const items = combine(results, now);
  const sources = SOURCES.map(src => {
    const st = states[src.id] || { items: [] };
    return { logo: logoFor(src.url), id: src.id, name: src.name, area: src.area || '', kind: src.kind || 'news', ok: st.items.length > 0 || (!st.error && !!st.lastOk), count: items.filter(i => i.sourceId === src.id).length, error: st.error || null, lastOk: st.lastOk || null, stale: !!st.error && st.items.length > 0 };
  });
  return { updatedAt: new Date(now).toISOString(), sources, items };
}

// Fetches sources (all of them, or just the fast tier), updates their records, and rebuilds the snapshot.
// Without Redis nothing is saved: the result is just computed fresh, as before.
async function refreshAll(opts) {
  opts = opts || {};
  const now = Date.now();
  const targets = opts.tier === 'fast' ? SOURCES.filter(s => FAST_IDS.has(s.id)) : SOURCES;
  const persist = stored();
  let prevStates = {};
  if (persist) {
    const out = await redis(SOURCES.map(s => ['GET', srcKey(s.id)]));
    SOURCES.forEach((s, i) => { prevStates[s.id] = parse(out[i] && out[i].result); });
  }
  const fetched = await Promise.all(targets.map(s => loadSource(s, prevStates[s.id])));
  const states = Object.assign({}, prevStates);
  const report = [];
  for (const r of fetched) {
    states[r.source.id] = mergeState(r.source, prevStates[r.source.id], r, now);
    report.push({ id: r.source.id, result: r.notModified ? '304' : r.items.length ? 'ok ' + r.items.length : 'fail: ' + r.error });
  }
  // sources not fetched this round (fast tier) still need a record
  SOURCES.forEach(s => { if (!states[s.id]) states[s.id] = { items: [], error: null, lastOk: null }; });
  const snap = buildSnapshot(states, now);
  if (persist) {
    const cmds = fetched.map(r => ['SET', srcKey(r.source.id), JSON.stringify(states[r.source.id]), 'EX', String(14 * 86400)]);
    cmds.push(['SET', SNAP_KEY, JSON.stringify(snap), 'EX', String(2 * 86400)]);
    await redis(cmds);
  }
  return { snapshot: snap, report };
}

async function handler(req, res) {
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
  res.status(200).send(JSON.stringify(snap));
}

module.exports = handler;
module.exports.parseFeed = parseFeed;
module.exports.combine = combine;
module.exports.inRegion = inRegion;
module.exports.isWire = isWire;
module.exports.parseIcal = parseIcal;
module.exports.refreshAll = refreshAll;
module.exports.SOURCES = SOURCES;
module.exports.mergeState = mergeState;
module.exports.stored = stored;
module.exports.loadSource = loadSource;
