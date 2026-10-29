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

// A story from a local outlet that names another state or country and no place in our region is network or wire
// copy: Gray and Nexstar stations share stories across markets ("An 81-year-old Mississippi man...", "Three people
// found shot to death inside an Oregon home", "the killing of his dentist in Mexico"). The 2026-10-22 audit found
// three gaps in the first version, which only knew "<State> man/woman/officials..." and "in/near/from <State>":
//   - a state used as an adjective before a place or an event ("an Oregon home", "Oregon elementary school shooting");
//   - an AP-style "City, State" place ("in Gladstone, Oregon", "Nashville, Tenn.");
//   - other countries ("in Mexico", "Mexican authorities").
// A story is only dropped when none of this region's places (REGION_TERMS, inRegion) and none of its teams and
// schools (LOCAL_TEAMS) appear, so "Evansville man arrested in Florida" or "Reitz falls to Ohio power" stay.
// Indiana, Kentucky and Illinois are never "other" states; place names that are also towns here (Holland, Ireland,
// Brazil, Peru, Lebanon, Scotland in Indiana; Cuba and Vienna in Illinois) are not in the country list.
const OTHER_STATES = 'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|iowa|kansas|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|west virginia|wisconsin|wyoming';
const STATE_ABBRS = 'Ala|Ariz|Ark|Calif|Colo|Conn|Del|Fla|Ga|Kan|La|Md|Mass|Mich|Minn|Miss|Mo|Mont|Neb|Nev|N\\.H|N\\.J|N\\.M|N\\.Y|N\\.C|N\\.D|Okla|Ore|Pa|R\\.I|S\\.C|S\\.D|Tenn|Vt|Va|W\\.Va|Wis|Wyo';
const COUNTRIES = 'mexico|canada|china|russia|ukraine|israel|gaza|west bank|iran|iraq|syria|afghanistan|pakistan|japan|north korea|south korea|taiwan|philippines|vietnam|thailand|venezuela|colombia|haiti|guatemala|honduras|el salvador|nicaragua|argentina|chile|england|britain|united kingdom|france|germany|italy|spain|sweden|norway|australia|new zealand|nigeria|kenya|south africa|egypt|saudi arabia|turkey';
const DEMONYMS = 'mexican|canadian|chinese|russian|ukrainian|israeli|palestinian|iranian|iraqi|syrian|afghan|pakistani|japanese|north korean|south korean|taiwanese|filipino|venezuelan|colombian|haitian|guatemalan|honduran|salvadoran|british|french|german|italian|spanish|australian|nigerian|egyptian|saudi';
const PEOPLE = 'man|woman|men|women|teen|teens|teenager|boy|girl|child|children|toddler|infant|baby|couple|family|mother|father|mom|dad|resident|residents|deputy|deputies|officer|officers|police|sheriff|trooper|troopers|officials|authorities|lawmakers?|governor|judge|jury|students?|teacher|nurse|doctor|dentist|suspect|inmate|driver|pilot|soldier|veteran|priest|pastor|lawmaker|senator|prosecutors?|department|highway patrol|state police|attorney general';
const PLACES_EVENTS = 'home|homes|house|apartment|residence|neighborhood|town|city|community|hospital|prison|jail|church|school|schools|elementary|middle school|high school|campus|mall|store|restaurant|bar|hotel|highway|interstate|airport|beach|pond|lake|shooting|stabbing|killing|murder|crash|wreck|fire|wildfire|explosion|flood|flooding|tornado|hurricane|standoff|manhunt|massacre';
// a state's next word that makes it a name of something else: the Ohio River, Ohio County (Ky.), Ohio Valley, Ohio State...
const NOT_PLACE = '(?! (?:river|valley|county|township|twp\\b|state|conference|avenue|ave\\b|street|st\\b|road|turnpike|tech|wesleyan|university|college|titans|vols|volunteers|valley authority))';
const OUT_OF_AREA_RE = new RegExp(
  '\\b(?:' + OTHER_STATES + ')\\s+(?:' + PEOPLE + ')\\b' +
  // ship60: "Trump heads to Iowa Thursday", "since Tennessee's first box was installed" (Knoxville baby box story)
  '|\\b(?:heads?|headed|heading|travels?|traveled|traveling|flies|flew|visits?|visited|visiting) (?:to )?(?:' + OTHER_STATES + ')\\b' + NOT_PLACE +
  '|\\b(?:' + OTHER_STATES + ')[\'\u2019]s\\b' +
  '|\\b(?:in|near|outside|from|across) (?:rural |northern |southern |eastern |western |central |north |south |east |west |upstate |downstate )?(?:' + OTHER_STATES + ')\\b' + NOT_PLACE +
  '|\\b(?:' + OTHER_STATES + ')' + NOT_PLACE + '(?: [a-z]+){0,2} (?:' + PLACES_EVENTS + ')\\b' +
  '|\\b(?:in|near|outside|from|across|to) (?:northern |southern |eastern |western |central |north |south |east |west )?(?:' + COUNTRIES + ')\\b' +
  '|\\b(?:' + DEMONYMS + ') (?:' + PEOPLE + '|government|military|army|navy|forces|troops|president|prime minister|cartel|border)\\b', 'i');
// "Gladstone, Oregon", "Nashville, Tenn." (the city part capitalised, so this one is case-sensitive)
const TITLE_STATES = OTHER_STATES.split('|').map(x => x.replace(/\b[a-z]/g, c => c.toUpperCase())).join('|');
const CITY_STATE_RE = new RegExp('\\b[A-Z][a-z]+(?:[ .-][A-Z][a-z]+)*, (?:' + TITLE_STATES + ')\\b(?! (?:River|Valley|County|Township|State))|\\b[A-Z][a-z]+(?:[ .-][A-Z][a-z]+)*, (?:' + STATE_ABBRS + ')\\.');
// Well-known landmarks and national parks elsewhere (ship60: 14 News carried Gray's "Grand Canyon adds new dog to help
// reduce wildlife interactions with visitors"). Any "<Name> National Park" counts except the parks in Indiana and
// Kentucky (Mammoth Cave, Indiana Dunes); national forests and recreation areas are not matched at all, so Shawnee,
// Hoosier and Daniel Boone National Forest, Land Between the Lakes and the Ohio River stay local. "Zion" alone is a
// church name here, so only "Zion National Park" (through the National Park rule) counts.
const LANDMARK_RE = /\b(?:Grand Canyon|Yellowstone|Yosemite|Grand Teton|Mount Rushmore|Mt\. Rushmore|Everglades|Death Valley|Joshua Tree|Denali|Mount Rainier|Great Smoky Mountains|Niagara Falls|Golden Gate Bridge|Statue of Liberty|Times Square|Las Vegas Strip|Hoover Dam|Lake Tahoe|Pikes Peak|Old Faithful|Walt Disney World|Disney World|Disneyland)\b/;
const NATIONAL_PARK_RE = /\b((?:[A-Z][A-Za-z.'\u2019-]*\s){1,4})National Parks?\b/g;
const LOCAL_PARKS = /(?:^|\s)(?:Mammoth Cave|Indiana Dunes)\s$/;
function landmark(hay) {
  if (LANDMARK_RE.test(hay)) return true;
  for (const m of hay.matchAll(NATIONAL_PARK_RE)) if (!LOCAL_PARKS.test(m[1])) return true;
  return false;
}
// Local teams, schools and leagues that headlines name without a town ("Aces fall at Ohio Valley foe", "Otters drop
// series in Washington, Pa.", "Screaming Eagles host Missouri S&T"): a story naming one is local whatever else it names.
const LOCAL_TEAMS_RE = /\b(?:purple aces|screaming eagles|otters|thunderbolts|castle knights|harrison warriors|north huskies|memorial tigers|central bears|boonville pioneers|apollo eagles|owensboro catholic|daviess county panthers|gliac)\b/i; // (towns and schools such as Evansville, USI, Reitz, Mater Dei are REGION_TERMS already)
// Towns here whose names other states share, so REGION_TERMS only lists them with ", Ind." / ", Ky." / ", Ill.".
// Named bare (capitalised, with no other state after a comma) they still count as local for this check: "Henderson
// family returns from Mexico mission trip" stays, "Henderson, Nev. casino opens" does not.
const LOCAL_TOWNS_RE = /\b(?:Henderson|Newburgh|Mount Vernon|Mt\. Vernon|Princeton|Jasper|Madisonville|Morganfield|Carmi|Albion|Mount Carmel|Grayville|Paducah|Tell City|Rockport|Huntingburg|Lynnville|Darmstadt|Elberfeld)\b(?!, (?!Ind\b|Indiana\b|Ky\b|Kentucky\b|Ill\b|Illinois\b)[A-Z])/;
// extra: the source's own geoTerms, so a Purchase-area or Pennyrile source's story about its own towns is not
// mistaken for network copy (REGION_TERMS lists only the core Tri-State places).
function outOfArea(item, extra) {
  const hay = item.title + ' ' + item.summary;
  if (!OUT_OF_AREA_RE.test(hay) && !CITY_STATE_RE.test(hay) && !landmark(hay)) return false;
  return !inRegion(item, extra) && !LOCAL_TEAMS_RE.test(hay) && !LOCAL_TOWNS_RE.test(hay);
}

// Obituaries belong in the Obituaries tab, not the news feed (papers mix them into their main feeds).
const OBIT_NAME_RE = /^(?:["\u201c(]?[A-Z][A-Za-z.'\u2019\u201d"()-]*\s+){1,5}[A-Z][A-Za-z.'\u2019-]+(?:,? (?:Jr|Sr|II|III|IV)\.?)?,\s*\d{1,3},\s+(?:of\s+)?[A-Z][A-Za-z.'\u2019 -]{1,40}$/;
// Radio stations' notices put the age another way: "Patricia Ann Dial, age 79 of McLeansboro", "Betty Lamb (82) of
// Olney", "Nancy I. Stevens (77) of Olney, formerly of Effingham", "Mary Lou (Rogers) Elliston, 88, McLeansboro,".
const OBIT_AGE_RE = /^(?:["\u201c(]?[A-Z][A-Za-z.'\u2019\u201d"()-]*\s+){1,6}[A-Z][A-Za-z.'\u2019-]+(?:,? (?:Jr|Sr|II|III|IV)\.?)?(?:,\s*age\s+\d{1,3},?|\s+\(\d{1,3}\)|,\s*\d{1,3},?)\s+(?:of\s+)?[A-Z][A-Za-z.'\u2019 -]{1,40}(?:,\s*formerly of [A-Z][A-Za-z.,'\u2019 -]{1,60})?,?$/;
function looksLikeObit(item) {
  if (/\bobituar(?:y|ies)\b/i.test(item.title)) return true;
  if (OBIT_AGE_RE.test(String(item.title || '').trim())) return true;
  // A headline that is only a name, an age and a hometown ("John Henry Adams, 61, of Mill Shoals") is a death notice;
  // a news story about a person says what happened ("..., 45, of Henderson, arrested").
  if (OBIT_NAME_RE.test(String(item.title || '').trim())) return true;
  if (nameOnlyObit(item)) return true;
  try { return /\/obituar/i.test(new URL(item.link).pathname); } catch (_) { return false; }
}

// A headline that is only a person's name ("Paxton Beckham Luttrell", Spencer County Online, 2026-10-22) over a summary
// that says the person died is a death notice as well. To keep news out, all of these must hold: the title is 2 to 6
// capitalised name words (initials, a "nickname", a (maiden name) and Jr/Sr/II/III/IV allowed) with no ordinary
// headline word in it; the summary mentions passed away, funeral, visitation or obituary; and the summary opens with
// the title itself followed by what a death notice puts after a name (a comma, an age, "of", "passed", "died"...).
// So "Remembering Coach Bob Jones", "Henderson County Fair" or "Evansville Otters will hold a visitation..." stay news.
const NAME_WORD = '(?:[A-Z][A-Za-z\'\u2019-]*\\.?|["\u201c][A-Z][A-Za-z.\'\u2019 -]*["\u201d]|\\([A-Z][A-Za-z.\'\u2019 -]*\\))';
const NAME_ONLY_RE = new RegExp('^' + NAME_WORD + '(?:,?\\s+(?:' + NAME_WORD + '|Jr\\.?|Sr\\.?|II|III|IV))' + '{1,5}$');
const DEATH_WORDS_RE = /\b(?:passed away|funeral|visitation|obituar(?:y|ies))\b/i;
const AFTER_NAME_RE = /^\s*(?:,|\(|\d|(?:age|aged|of|passed|died|was born|infant)\b)/;
const HEADLINE_WORDS = new Set(('remembering remembered remember honoring honored honors honor mourns mourning mourn tribute memorial dies died dead ' +
  'killed death funeral funerals services service visitation obituary obituaries celebrates celebration life legacy community county city ' +
  'school schools police sheriff fire family coach mayor council board church day fair festival week update news the a an of for and in on at to ' +
  'with new local high university center park street road team club year hall').split(' '));
function nameOnlyObit(item) {
  const title = String(item.title || '').trim(), summary = String(item.summary || '').trim();
  if (!title || title.length > 70 || !NAME_ONLY_RE.test(title) || !DEATH_WORDS_RE.test(summary)) return false;
  const words = title.replace(/["\u201c\u201d(),]/g, ' ').split(/\s+/).filter(Boolean).map(w => w.toLowerCase().replace(/\.$/, ''));
  if (words.length < 2 || words.some(w => w.length > 1 && HEADLINE_WORDS.has(w))) return false; // (an initial "A." is not the word "a")
  const norm = x => x.toLowerCase().replace(/[\u201c\u201d]/g, '"').replace(/\u2019/g, "'").replace(/\s+/g, ' ');
  const t = norm(title), sm = norm(summary);
  return sm.startsWith(t) && AFTER_NAME_RE.test(sm.slice(t.length));
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
  // Google News site feeds include the paper's wire, syndicated and shopping stories, so they are geo-filtered too,
  // except a search limited to one publisher's local section path (localSection, batch 3: "site:messenger-inquirer.com/
  // mclean_county/news"), where a county weekly's headlines rarely repeat the town ("Frizzell eyeing 4 more years as
  // sheriff") and the path already keeps out the paper's other sections (the statewide stories a weekly reprints in
  // its news section still come through, as in print); wire, obituary and out-of-area checks still apply.
  if (source.strictGeo) { if (!inTriState(it, source.strictGeo)) return false; }
  else if ((source.geo || (viaGoogle && news && !source.localSection)) && !inRegion(it, source.geoTerms)) return false;
  return !news || (!looksLikeObit(it) && !outOfArea(it, source.geoTerms) && !STANDING_RE.test(it.title.trim()));
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
// Every police and court item leaves News after 14 days at most (audit 2026-10-22: U.S. Attorney and FBI releases sat
// in the feed for 59 days on their sources' 60- and 90-day windows). A shorter source window still applies.
const SAFETY_MAX_DAYS = 14;

// Returns a police or court item as it should appear (a copy with the arrest flag and no image), or null to
// leave it out; other items pass through unchanged. Runs in combine(), so stored stories follow it too.
function safetyView(it, source) {
  const kind = source.kind || 'news';
  if (kind !== 'police' && kind !== 'courts') return it;
  if (JUVENILE_RE.test(it.title + ' ' + (it.summary || ''))) return null;
  const arrest = ARREST_RE.test(it.title) && !OUTCOME_RE.test(it.title);
  const out = { ...it, image: '', arrest };
  out.maxAgeDays = Math.min(it.maxAgeDays || MAX_AGE_DAYS, SAFETY_MAX_DAYS);
  if (arrest) out.maxAgeDays = Math.min(out.maxAgeDays, ARREST_MAX_DAYS);
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
  return decodeEntities(m ? m[1] : s); // CDATA text is decoded once too, so a feed's &amp;quot; reads the same either way
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
// A wall-clock time in an IANA zone -> the UTC instant, right next to DST changes too: a repeated fall-back time is
// its first (daylight) occurrence, a time skipped by spring-forward moves an hour on. An unknown zone falls back to Chicago.
const TZ = 'America/Chicago';
function zonedToUtc(tz, y, mo, d, h, mi) {
  let fmt;
  try { fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz || TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }); }
  catch (_) { fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }); }
  const want = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = t => { const p = fmt.formatToParts(new Date(t)), g = k => Number(p.find(x => x.type === k).value); return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - t; };
  const a = want - offsetAt(want), b = want - offsetAt(a), c = want - offsetAt(b);
  const exact = [a, b, c].filter(t => t + offsetAt(t) === want);
  // an existing time: its first occurrence (fall-back hour: the daylight one); a skipped time: an hour on
  return new Date(exact.length ? Math.min.apply(null, exact) : Math.max(a, b, c));
}
function chicagoToUtc(y, mo, d, h, mi) { return zonedToUtc(TZ, y, mo, d, h, mi); }
// The Chicago calendar date (YYYY-MM-DD) of an instant, and the instant that day starts.
const chicagoDate = t => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ });
const chicagoDayStart = t => { const [y, mo, d] = chicagoDate(t).split('-').map(Number); return chicagoToUtc(y, mo, d, 0, 0).getTime(); };
// DTSTART;TZID=America/New_York:20261030T190000, DTSTART:20261030T190000Z, DTSTART;VALUE=DATE:20261030. A time with
// neither Z nor TZID (floating) is read as Chicago time, as before.
function icalDate(line) {
  const m = /:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?\s*$/.exec(line);
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0)];
  if (m[7]) return new Date(Date.UTC(y, mo - 1, d, h, mi)).toISOString();
  const tz = /;TZID=("?)([^;:"]+)\1/i.exec(line.slice(0, line.lastIndexOf(':')));
  return zonedToUtc(tz ? tz[2].trim() : TZ, y, mo, d, h, mi).toISOString();
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
    if (!r.ok) return { items: [], error: 'HTTP ' + r.status, httpStatus: r.status, url, retryAfterMs: retryAfterMs(r.headers.get('retry-after'), Date.now()) };
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

// Retry-After on a 429 (or 503): seconds ("120") or an HTTP date. Returns milliseconds from now, or null when the
// header is missing or unreadable.
function retryAfterMs(v, now) {
  if (v == null || v === '') return null;
  const t = String(v).trim();
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  const at = Date.parse(t);
  return Number.isFinite(at) ? Math.max(0, at - (now || Date.now())) : null;
}
// How long a host that refused us is left alone. A Retry-After is honored as asked, but never less than 10 minutes
// (a run every 10 minutes would otherwise just hit it again) and never more than 24 hours. Without one: 30 minutes,
// doubling with each consecutive block, up to 6 hours (as before).
const BLOCK_MIN_MS = 10 * 6e4, BLOCK_MAX_MS = 24 * 36e5;
function cooldownMs(res, fails) {
  if (Number.isFinite(res.retryAfterMs) && res.retryAfterMs !== null) return Math.min(BLOCK_MAX_MS, Math.max(BLOCK_MIN_MS, res.retryAfterMs));
  return Math.min(6 * 36e5, 30 * 6e4 * Math.pow(2, fails - 1));
}

// Tries the URL that worked last time first, then the main URL and any altUrls, and keeps the first
// one that returns stories (or confirms nothing changed).
// A host that answered 429/403 is left alone until its cooldown ends (prev.blocked: { host: untilMs }); the
// Google News fallback is used meanwhile. After the cooldown the publisher's own feed is tried first again.
// opts.directOff: the source's rate group was refused earlier in this run (refreshAll), so only its Google News
// fallback is tried and the publisher is not asked again until the next run.
async function loadSource(source, prev, now, opts) {
  now = now || Date.now();
  let urls = [source.url].concat(source.altUrls || []);
  if (prev && prev.url && urls.includes(prev.url) && !isGoogleNews(prev.url)) urls.splice(urls.indexOf(prev.url), 1), urls.unshift(prev.url);
  const blocked = Object.assign({}, (prev && prev.blocked) || {});
  Object.keys(blocked).forEach(h => { if (blocked[h] <= now) delete blocked[h]; });
  const open = urls.filter(u => !blocked[hostOf(u)] && !(opts && opts.directOff && !isGoogleNews(u)));
  let last = { items: [], error: open.length ? 'no url' : 'cooling down after rate limit' }, wireSeen = null, refused = false;
  for (const url of open) {
    last = await tryUrl(source, url, prev);
    if (/^HTTP (429|403)$/.test(last.error || '')) {
      // back off (cooldownMs): the publisher's Retry-After when it sends one, else 30 min doubling up to 6 hours
      const fails = ((prev && prev.blockCount) || 0) + 1;
      blocked[hostOf(url)] = now + cooldownMs(last, fails);
      last.blockCount = fails;
      refused = true;
      continue;
    }
    if (last.items.length || last.notModified) break;
    if (last.wire && (!wireSeen || last.wire > wireSeen.wire)) wireSeen = { wire: last.wire, received: last.received };
  }
  // Every endpoint came back empty: keep the wire count from the one that was all wire copy, so the run report says
  // all_wire instead of looking like a quiet feed (the Google News fallback has no wire count of its own).
  if (wireSeen && !last.items.length && !last.notModified && !(last.wire >= wireSeen.wire)) last = Object.assign({}, last, wireSeen);
  // Every source's pictures are sized (ship68; events only before), so an oversized publisher photo never reaches a card.
  // News sources get a time budget (IMG_BUDGET_MS) so a source's turn in its host group never grows by more than
  // that; pictures not checked in time stay as they are and are checked on a later run.
  if (last.items.length) { try { await sizeImages(last.items, prev, source.kind === 'events' ? 0 : IMG_BUDGET_MS); } catch (_) { /* pictures are optional */ } }
  return { source, ...last, refused, blocked, blockCount: last.blockCount || (Object.keys(blocked).length ? (prev && prev.blockCount) || 0 : 0) };
}

function normKey(item) {
  return item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Near-identical headlines from different sources are one story: an FBI field office and the U.S. Attorney post the
// same press release ("Ex COO of ..." / "Ex-COO of ... $400K" / "... $400,000"), and sister papers repost each other's
// copy with "(copy)" on the end. Titles are compared as word sets after folding hyphens, "$400K" / "$400,000" and
// small words; two count as the same story when 80% of all their words are shared (Jaccard), or when 90% of the
// shorter one's words are in the longer and the shorter has at least 6 words. Different outlets writing up the same
// event in their own words ("Pickle Plex opens at Ben Hawes Park" / "Pickleball facility opens at Ben Hawes State
// Park") stay separate. The first copy wins, so registry order decides, as it already does for exact duplicates.
const DUP_STOP = new Set('a an and are as at be by for from has have in into is it its of on or over that the this to was were will with after'.split(' '));
function titleWords(title) {
  const t = String(title || '').toLowerCase().replace(/\(copy\)/g, ' ')
    .replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/\b(\d+(?:\.\d+)?)k\b/g, (m, n) => String(Math.round(parseFloat(n) * 1000)))
    .replace(/[\u2018\u2019']s\b/g, '').replace(/[^a-z0-9]+/g, ' ');
  return new Set(t.split(' ').filter(w => w && !DUP_STOP.has(w)));
}
function sameStory(a, b) {
  const small = a.size <= b.size ? a : b, big = small === a ? b : a;
  if (small.size < 4) return false;
  let shared = 0; small.forEach(w => { if (big.has(w)) shared++; });
  return shared / (a.size + b.size - shared) >= 0.8 || (small.size >= 6 && shared / small.size >= 0.9);
}
// Remembers the words of every kept story, indexed by word, so each new story is compared only with stories that
// share a word with it.
function nearIndex() {
  const kept = [], byWord = new Map();
  return {
    dupOf(words, sourceId) {
      const seen = new Set();
      for (const w of words) for (const i of byWord.get(w) || []) {
        if (seen.has(i)) continue; seen.add(i);
        if (kept[i].sourceId !== sourceId && sameStory(words, kept[i].words)) return kept[i];
      }
      return null;
    },
    add(words, sourceId) { const i = kept.push({ words, sourceId }) - 1; words.forEach(w => { if (!byWord.has(w)) byWord.set(w, []); byWord.get(w).push(i); }); },
  };
}

function combine(results, now, pool) {
  const seen = new Set();
  const all = [];
  const events = [];
  const obits = [];
  const safety = [];
  const obitAt = new Map();
  const near = nearIndex();
  // Funeral homes go first, so when a paper and a funeral home list the same person the funeral home's card wins.
  results = results.slice().sort((a, b) => (b.source && b.source.funeralHome ? 1 : 0) - (a.source && a.source.funeralHome ? 1 : 0));
  for (const r of results) {
    for (const raw of r.items) {
      const it = !r.source ? raw : passesFilters(raw, r.source) ? safetyView(raw, r.source) : null;
      if (!it) continue;
      const ts = it.published ? Date.parse(it.published) : null;
      const key = normKey(it);
      if (it.isEvent) {
        // upcoming events only: from the start of today (Chicago) to 120 days out; the same event twice on one Chicago
        // day is one event (a UTC date would split an evening event at 7 PM CT from its 6:30 PM listing)
        if (ts === null || ts < chicagoDayStart(now) || ts > now + 120 * 864e5) continue;
        const ekey = key + '|' + chicagoDate(ts);
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
      const words = titleWords(it.title);
      if (near.dupOf(words, it.sourceId)) continue;
      near.add(words, it.sourceId);
      seen.add(key); seen.add(it.link);
      (r.source && (r.source.kind === 'police' || r.source.kind === 'courts') ? safety : all).push(it);
    }
  }
  const byDate = (a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0);
  // Police and court releases have their own cap: they post a few times a month, so in one shared cap a
  // busy news day pushed a sheriff's post from three weeks ago out of the snapshot while it was still in its window.
  safety.sort(byDate);
  if (pool) pool.push(...all, ...safety); // every news story before the public cap (api/_depthrec.js)
  const feed = all.sort(byDate).slice(0, MAX_ITEMS).concat(safety.slice(0, MAX_SAFETY)).sort(byDate);
  events.sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
  // Repeat events (weekly yoga, a run of shows) share one picture: any dated copy that has an image lends it to the rest.
  const pics = {};
  // (Only a picture a card may show is lent: one known to be over IMG_MAX_BYTES is not.)
  events.forEach(e => { const k = e.sourceId + '|' + normKey(e); if (cardImage(e) && !pics[k]) pics[k] = e; });
  events.forEach(e => { const p = pics[e.sourceId + '|' + normKey(e)]; if (!e.image && p) { e.image = p.image; if (p.imageBytes !== undefined) e.imageBytes = p.imageBytes; } });
  obits.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  return feed.concat(events.slice(0, 160), obits.slice(0, MAX_OBITS)).map((it, i) => {
    const out = { id: it.sourceId + '-' + i, ...it };
    if (out.image) out.image = cardImage(out);
    delete out.imageBytes;
    return out;
  });
}

// ---------- Picture weight (audit 2026-10-22: home 4.8 MB, Events 19 MB) ----------
// Cards show pictures at most about 640 px wide, so where the publisher's image service can make a smaller copy the
// link asks for one: Gray TV's Arc resizer (gtv-cdn.com, width=640, any height dropped so nothing is cropped),
// WordPress VIP / Photon uploads with a ?w= over 640, Townsquare Media (w=640, q=75) and BLOX (resize=W,H over
// 640 wide, scaled down). Checked with curl on 2026-10-22: a 1280 px Gray picture went from 134 KB to 48 KB, a
// WordPress VIP PNG from 776 KB to 110 KB and a Townsquare JPEG from 461 KB to 52 KB. Anything else is left alone.
const IMG_WIDTH = 640;
function smallerImage(u) {
  if (!u) return u;
  let url; try { url = new URL(u); } catch (_) { return u; }
  const q = url.searchParams, host = url.hostname;
  if (/\.gtv-cdn\.com$/.test(host) && url.pathname.startsWith('/resizer/')) {
    const w = +q.get('width');
    if (w && w <= IMG_WIDTH) return u;
    q.set('width', String(IMG_WIDTH)); q.delete('height');
  } else if (host === 'townsquare.media') {
    if (q.has('w')) return u;
    q.set('w', String(IMG_WIDTH)); q.set('q', '75');
  } else if (/\/wp-content\/uploads\//.test(url.pathname) && q.has('w')) {
    if (!(+q.get('w') > IMG_WIDTH)) return u;
    q.set('w', String(IMG_WIDTH));
  } else if (/\.townnews\.com$/.test(host) && q.has('resize')) {
    const m = String(q.get('resize')).match(/^(\d+),(\d+)$/);
    if (!m || +m[1] <= IMG_WIDTH) return u;
    q.set('resize', IMG_WIDTH + ',' + Math.round(+m[2] * IMG_WIDTH / +m[1]));
  } else return u;
  return url.href;
}

// Event pictures come straight from venue and tourism sites, some of them print-size files (a 15.6 MB Victory
// Theatre JPEG). Each new picture URL gets one HEAD request; the size is kept on the stored item, so a picture is
// checked once, not every run. Over IMG_MAX_BYTES the card shows its date tile instead. At most IMG_CHECKS new
// pictures per source per run, IMG_PARALLEL at a time with a 3 s timeout, so a refresh never waits long on them.
const IMG_MAX_BYTES = 500 * 1024, IMG_CHECKS = 10, IMG_PARALLEL = 3, IMG_BUDGET_MS = 2500;
async function sizeImages(items, prev, budgetMs) {
  const until = budgetMs ? Date.now() + budgetMs : Infinity;
  const known = new Map();
  ((prev && prev.items) || []).forEach(i => { if (i.image && Number.isFinite(i.imageBytes)) known.set(i.image, i.imageBytes); });
  const todo = [];
  for (const it of items) {
    if (!it.image) continue;
    if (known.has(it.image)) { it.imageBytes = known.get(it.image); continue; }
    if (!todo.includes(it.image) && todo.length < IMG_CHECKS) todo.push(it.image);
  }
  const got = new Map();
  for (let i = 0; i < todo.length && Date.now() < until; i += IMG_PARALLEL) {
    await Promise.all(todo.slice(i, i + IMG_PARALLEL).map(async u => {
      let n = -1; // unknown: no Content-Length, or the HEAD failed; the picture is kept
      try {
        const r = await safeFetch(smallerImage(u), { method: 'HEAD', headers: { 'user-agent': USER_AGENT, accept: 'image/*' }, signal: AbortSignal.timeout(3000) });
        const len = Number(r.headers.get('content-length'));
        if (r.ok && len > 0) n = len;
      } catch (_) { /* keep the picture */ }
      got.set(u, n);
    }));
  }
  items.forEach(it => { if (it.image && got.has(it.image)) it.imageBytes = got.get(it.image); });
  return items;
}
// The picture a card should load: the smaller variant, or none when the file is known to be too big.
function cardImage(it) {
  if (!it.image) return it.image;
  if (it.imageBytes > IMG_MAX_BYTES) return '';
  return smallerImage(it.image);
}

// Source icons. Most come from Google's favicon service for the publisher's domain. The audit (2026-10-22) found ten
// that 404 there and two that showed the Google News icon (sources fetched through news.google.com), so those are
// self-hosted under public/logos: the publisher's own icon where it has a square one, else a plain lettermark
// (marked "lettermark" below) until Sam has artwork from the publisher. A Google News URL's site: domain, and the
// registrable domain of a feed subdomain (obits.glennfuneralhome.com, app.ticketmaster.com), are used otherwise.
const LOGOS = {
  courier: '/logos/courier.png', gleaner: '/logos/gleaner.png', 'ob-glenn': '/logos/glenn.png', 'ev-tm': '/logos/ticketmaster.png',
  ocmonitor: '/logos/ocmonitor.png',
  dcherald: '/logos/dcherald.svg', 'ob-dcherald': '/logos/dcherald.svg', pdclarion: '/logos/pdclarion.svg', 'ob-pdclarion': '/logos/pdclarion.svg', // lettermark
  'ob-ziemer': '/logos/ziemer.svg', 'ob-koehler': '/logos/koehler.svg', poseynews: '/logos/poseynews.svg', // lettermark
};
function logoFor(src) {
  if (src && typeof src === 'object') { if (LOGOS[src.id]) return LOGOS[src.id]; src = src.url; }
  try {
    const u = new URL(src);
    let host = u.hostname.replace(/^www\./, '');
    if (isGoogleNews(u.href)) { const m = (u.searchParams.get('q') || '').match(/site:([a-z0-9.-]+)/i); if (m) host = m[1].replace(/^www\./, ''); }
    else if (/^(?:obits|app|feeds?|rss|news|m)\./.test(host) && host.split('.').length > 2) host = host.replace(/^[^.]+\./, '');
    return 'https://www.google.com/s2/favicons?sz=128&domain=' + host;
  } catch (e) { return ''; }
}

// ---------- storage (Upstash Redis) ----------
// Each source keeps its own record (last good stories + validators + health), so one failed or rate-limited
// run never makes a source's stories disappear. The merged page data is stored as one snapshot that
// /api/news serves, so visitors never wait on the feeds.
const STORE = require('./_store.js'); // the one Redis helper (pipeline, stored)
const stored = STORE.stored;
const OVERRIDES_KEY = 'tsn:loc:overrides';
const DEPTH = () => require('./_depthrec.js');
const SNAP_KEY = 'tsn:news:snapshot', LOCK_KEY = 'tsn:news:lock', srcKey = id => 'tsn:src:' + id;
const NEWS_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=60'; // /api/news 200s and the tab pages with stories
const SNAP_MAX_AGE = 3 * 36e5;          // older than this and /api/news refreshes on the spot
const KEEP_ITEMS = 80;                  // stories kept per source
// Fast tier (every 10 min): sources that post often and tolerate polling. BLOX papers (Messenger-Inquirer,
// The Messenger, Sun-Commercial, WPSD) rate-limit by IP, so they moved to the half-hourly full run.
// Rate groups (registry field rateGroup): papers of one publisher served from shared infrastructure, which rate-limits
// by IP across all of them. Paxton Media's western Kentucky and southern Illinois BLOX papers (batch 1) never loaded
// from Vercel (audit 2026-10-22: lastOk null, HTTP 429 from the audit machine too). They are fetched 4 seconds apart,
// at most 3 per run, and each has a Google News site: fallback.
// Batch 3's Google News fallbacks (rateGroup gnews: publisher sections whose RSS answers 429, and town searches for
// counties with no working feed) are one queue too, 1.5 s apart and at most 5 per run, oldest first, so a full run never
// adds more than a handful of Google requests (on top of the 600 ms Google queue) and stays inside the 30 s limit.
const RATE_GROUPS = { paxton: { gapMs: 4000, perRun: 3 }, gnews: { gapMs: 1500, perRun: 5 } };
const FAST_IDS = new Set(['ob-owtimes', 'wfie', 'weht', 'owtimes', 'courier', 'gleaner', 'kfvs', 'wthi', 'wkdq', 'wbkr', 'fbilou', 'fbiind', 'fbispr', 'usaowdky', 'usaosdil']);

const redis = STORE.pipeline;
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };

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

function buildSnapshot(states, now, pool) {
  const results = SOURCES.map(src => ({ source: src, items: (states[src.id] && states[src.id].items) || [] }));
  const items = combine(results, now, pool);
  const sources = SOURCES.map(src => {
    const st = states[src.id] || { items: [] };
    return { logo: logoFor(src), id: src.id, name: src.name, area: src.area || '', kind: src.kind || 'news', ok: st.items.length > 0 || (!st.error && !!st.lastOk), count: items.filter(i => i.sourceId === src.id).length, lastOk: st.lastOk || null, stale: !!st.error && st.items.length > 0 };
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
  let overridesAll = null, prevStates = {}, overridesRaw = [], depthPrev = null, depthRead = false;
  const store = { requests: 0, commands: 0 }; // billed Upstash commands this run, reported by /api/refresh
  if (persist) {
    // If the store is unreachable (bad or rotated token, outage) keep going without it rather than failing the page.
    try {
      // One MGET (one billed command) instead of one GET per source. Same values: a missing key is null either way.
      // The same request also reads the admin's manual county overrides (HGETALL) and the rolling county depth record
      // (GET tsn:geo:depth, api/_depthrec.js): two more commands, no extra trip.
      store.requests++; store.commands += 3;
      const keys = SOURCES.map(s => srcKey(s.id));
      const out = await redis([['MGET'].concat(keys), ['HGETALL', OVERRIDES_KEY], ['GET', DEPTH().KEY]]);
      const vals = out && out[0] && out[0].result;
      if (!Array.isArray(vals) || vals.length !== keys.length) throw new Error('store MGET ' + ((out && out[0] && out[0].error) || 'bad reply'));
      overridesRaw = (out[1] && out[1].result) || [];
      if (out[2] && !out[2].error) { depthPrev = out[2].result || null; depthRead = true; }
      SOURCES.forEach((s, i) => { prevStates[s.id] = parse(vals[i]); });
    } catch (e) { persist = false; }
  }
  // Respect each source's minimum polling interval (everyMin): skip it if it was tried recently.
  targets = targets.filter(s => { const p = prevStates[s.id]; return !s.everyMin || !p || !p.lastTry || now - Date.parse(p.lastTry) >= s.everyMin * 6e4 - 30e3; });
  // Sources on the same host run one after another with a pause: those hosts rate-limit by IP, and the
  // news and obituary feeds of one paper share a host. Sources with the same rateGroup (several papers of one
  // publisher on shared servers) are one queue as well, with that group's gap and at most perRun of them per run
  // (the ones tried longest ago first; the rest wait for the next run and keep their stories).
  const groups = {};
  const byLastTry = (a, b) => (Date.parse((prevStates[a.id] || {}).lastTry) || 0) - (Date.parse((prevStates[b.id] || {}).lastTry) || 0);
  targets.forEach(s => { const k = s.rateGroup && RATE_GROUPS[s.rateGroup] ? 'group:' + s.rateGroup : 'host:' + hostOf(s.url); (groups[k] = groups[k] || []).push(s); });
  for (const k of Object.keys(groups)) {
    const g = k.startsWith('group:') && RATE_GROUPS[k.slice(6)];
    if (g) groups[k] = groups[k].sort(byLastTry).slice(0, g.perRun);
  }
  targets = [].concat(...Object.values(groups));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tier = opts.tier === 'fast' ? 'fast' : 'all';
  const runId = newRunId(now, tier);
  const fetched = (await Promise.all(Object.entries(groups).map(async ([k, group]) => {
    const g = k.startsWith('group:') ? RATE_GROUPS[k.slice(6)] : null;
    const out = [];
    let refused = false;
    for (let i = 0; i < group.length; i++) {
      if (i) await sleep(g ? g.gapMs : 900);
      const t = Date.now();
      // once one paper of a rate group says 429/403, its sisters go straight to their Google News fallback this run
      const r = await loadSource(group[i], prevStates[group[i].id], now, { directOff: !!(g && refused) });
      if (g && r.refused) refused = true;
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
  const pool = [];
  const snap = buildSnapshot(states, now, pool);
  // Manual county overrides from the admin (api/_coverage.js), carried in the snapshot for api/_scope.js. Only the
  // story keys that are in this snapshot; readers never get the map (publicSnapshot/_scope strip it).
  if (overridesRaw.length) {
    try {
      const flat = overridesRaw, keys = new Set(snap.items.map(i => require('./_scope.js').overrideKey(i)));
      const all = {}; for (let i = 0; i + 1 < flat.length; i += 2) { try { const v = JSON.parse(flat[i + 1]); if (Array.isArray(v.countyIds)) all[flat[i]] = v.countyIds; } catch (_) { /* skip */ } }
      const m = {}; for (const k of Object.keys(all)) if (keys.has(k)) m[k] = all[k];
      if (Object.keys(m).length) snap.overrides = m;
      overridesAll = all;
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
    cmds.push(...require('./_storyid.js').idsCmds(snap.items, 2 * 86400)); // the ids /api/react accepts a heart for
    cmds.push(['SET', runKey(runId), JSON.stringify(run), 'EX', String(RUN_TTL)]);
    // Shadow county classification (plan stage B, COUNTY_CLASSIFICATION_ENABLED): stored privately, never in the snapshot.
    if (shadowLoc) cmds.push(['SET', LOC().SHADOW_KEY, JSON.stringify(shadowLoc), 'EX', String(LOC().SHADOW_TTL)]);
    // Rolling county depth record: this run's stories (before the public cap) merged into the last 14 days. Only
    // when the read succeeded, so a failed read never overwrites two weeks of history with one run.
    if (depthRead) { try { cmds.push(['SET', DEPTH().KEY, JSON.stringify(DEPTH().update(depthPrev, pool, SOURCES.concat(DISABLED_SOURCES), now, overridesAll)), 'EX', String(DEPTH().TTL)]); } catch (e) { console.error('depth record failed', e && e.message); } }
    store.requests++; store.commands += cmds.length;
    try { await redis(cmds); } catch (e) { report.push({ id: 'store', result: 'fail: ' + e.message }); }
  }
  return { snapshot: snap, report, store, runId, run, locations: shadowLoc ? shadowLoc.summary : null };
}

// Work that should finish after the answer is sent. On Vercel the request context exposes waitUntil (the same hook
// @vercel/functions' waitUntil() uses, read here without adding the dependency); elsewhere (local server, tests)
// the promise simply runs on in the open process.
function background(promise) {
  try {
    const ctx = globalThis[Symbol.for('@vercel/request-context')];
    const c = ctx && typeof ctx.get === 'function' ? ctx.get() : null;
    if (c && typeof c.waitUntil === 'function') return c.waitUntil(promise);
  } catch (_) { /* fall through */ }
  return promise;
}

// Paging (PR ship67). The answer carries every event and obituary (their tabs and the calendar need them all) but
// only the NEWS_PAGE newest stories of the other kinds (news, police, courts, institutions); more: { before } says
// there are older ones, which ?before=<that ISO time> returns, NEWS_PAGE at a time, stories only. The page fetches
// them when the reader reaches the end of News. isEvent/isObit are left out: the page tells kinds by source.
const NEWS_PAGE = 200;
function page(snap, before) {
  if (!snap || !Array.isArray(snap.items)) return snap;
  const kinds = {}; (snap.sources || []).forEach(s => { if (s && s.id) kinds[s.id] = s.kind; });
  const boardKind = it => it.isEvent || it.isObit || kinds[it.sourceId] === 'events' || kinds[it.sourceId] === 'obits';
  const strip = it => { const o = Object.assign({}, it); delete o.isEvent; delete o.isObit; return o; };
  const t = it => Date.parse(it.published) || 0;
  let cut = Infinity;
  if (before != null) {
    cut = Date.parse(String(Array.isArray(before) ? before[0] : before));
    if (!Number.isFinite(cut)) return { error: 'before must be an ISO time' };
  }
  const stories = snap.items.filter(it => !boardKind(it) && t(it) < cut).sort((a, b) => t(b) - t(a));
  const shown = stories.slice(0, NEWS_PAGE);
  const more = stories.length > NEWS_PAGE ? { before: new Date(t(shown[shown.length - 1])).toISOString() } : null;
  const keep = new Set(shown);
  const items = before != null ? shown : snap.items.filter(it => boardKind(it) || keep.has(it));
  const out = Object.assign({}, snap, { items: items.map(strip) });
  if (before != null) delete out.sources;
  if (more) out.more = more;
  return out;
}

async function handler(req, res) {
  try { await run(req, res); } catch (e) {
    require('./_log.js').fail('news', e);
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
    // No fresh snapshot (cron not set up yet, or it stopped). A short lock lets one request refresh; the rest don't
    // re-fetch every feed. Stale snapshot: serve it now and refresh after the answer (background()). No snapshot at
    // all: the lock holder refreshes inline; everyone else gets a 503 with Retry-After instead of piling on.
    let locked = false;
    if (stored()) { try { const l = await redis([['SET', LOCK_KEY, '1', 'NX', 'EX', '90']]); locked = !(l[0] && l[0].result === 'OK'); } catch (e) { /* carry on */ } }
    if (!snap && locked) {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Retry-After', '15');
      return res.status(503).json({ error: 'news is refreshing, try again shortly' });
    }
    if (!snap) snap = (await refreshAll({})).snapshot;
    else if (!locked) background(refreshAll({}).catch(e => console.error('background refresh failed', e && e.message)));
  }
  const view = page(publicSnapshot(scoped(snap, scope, filters)), req.query && req.query.before);
  if (view.error) { res.setHeader('Cache-Control', 'public, s-maxage=3600, max-age=300'); return res.status(400).json({ error: view.error }); }
  // Browsers always revalidate (max-age=0), so a reload shows the latest snapshot; the CDN keeps a copy for a minute
  // and may serve it one more minute while it fetches a new one, so most requests stay CDN hits.
  res.setHeader('Cache-Control', NEWS_CACHE);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).send(JSON.stringify(view));
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

// The /api/news answer for the Tri-State view, for the tab page's first stories in the HTML (api/_tabpage.js, PR
// ship69). Only a fresh snapshot (within SNAP_MAX_AGE): with none, or a stale one, the page loads as before and its
// own /api/news call does the refresh. Never refreshes and never throws.
async function homeView() {
  try {
    const snap = await readSnapshot();
    if (!snap || !(Date.now() - Date.parse(snap.updatedAt) <= SNAP_MAX_AGE)) return null;
    const filters = FLAGS.on('COUNTY_FILTERS_ENABLED');
    const scope = filters ? require('./_scope.js').parse(undefined) : null;
    const v = page(publicSnapshot(scoped(snap, scope, filters)));
    return v && !v.error && Array.isArray(v.items) ? v : null;
  } catch (e) { return null; }
}

// /api/refresh is served by this function too (vercel.json rewrites it to /api/news?__route=refresh); its handler,
// with its own CRON_SECRET check, lives in api/_refresh.js. /api/counties and /api/regions (rewritten to
// ?__route=counties / ?__route=regions) are the read-only geography API in api/_geoapi.js, which never touches Redis.
// /api/locations (?__route=locations) is the admin-only county-classification report in api/_locations.js.
// /api/coverage (?__route=coverage) is the admin Sources & Coverage report and override endpoint in api/_coverage.js.
// The tab pages (/events, /jobs, ... rewritten to ?__route=tabpage) are data/pages/index.html with the tab's head, in
// api/_tabpage.js.
// Every other request is the news handler above.
module.exports = require('./_dispatch.js').host({
  refresh: () => require('./_refresh.js'),
  counties: () => require('./_geoapi.js').counties,
  regions: () => require('./_geoapi.js').regions,
  locations: () => require('./_locations.js'),
  geopage: () => require('./_geopage.js'),
  tabpage: () => require('./_tabpage.js'),
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
module.exports.icalDate = icalDate;
module.exports.zonedToUtc = zonedToUtc;
module.exports.chicagoDate = chicagoDate;
module.exports.chicagoDayStart = chicagoDayStart;
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
module.exports.page = page;
module.exports.NEWS_PAGE = NEWS_PAGE;
module.exports.homeView = homeView;
module.exports.NEWS_CACHE = NEWS_CACHE;
module.exports.background = background;
module.exports.looksLikeObit = looksLikeObit;
module.exports.outOfArea = outOfArea;
module.exports.titleWords = titleWords;
module.exports.sameStory = sameStory;
module.exports.retryAfterMs = retryAfterMs;
module.exports.cooldownMs = cooldownMs;
module.exports.RATE_GROUPS = RATE_GROUPS;
module.exports.SAFETY_MAX_DAYS = SAFETY_MAX_DAYS;
module.exports.smallerImage = smallerImage;
module.exports.sizeImages = sizeImages;
module.exports.IMG_MAX_BYTES = IMG_MAX_BYTES;
module.exports.IMG_BUDGET_MS = IMG_BUDGET_MS;
module.exports.logoFor = logoFor;
