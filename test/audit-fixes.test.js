// Fixes from the live-site audit of 2026-10-22 (ship56). No network and no real Redis: feeds, image HEADs and DNS are
// stubs, and the KV/UPSTASH/EXTRA_FEEDS variables are cleared before api/news.js loads.
//   (a) name-only obituaries kept out of News       (c) police and court items: 14 days at most
//   (d) near-identical titles from two sources       (g) rate-limited Paxton papers: Retry-After, rate group, fallback
//   plus the picture weight helpers (e, f) and the self-hosted logos (h).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'api');
const CLEAN = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'KV_URL', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'UPSTASH_REDIS_URL', 'CRON_SECRET', 'EXTRA_FEEDS', 'TICKETMASTER_API_KEY', 'EXPANDED_SOURCES_ENABLED', 'SOURCE_BATCHES'];

function load(env) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k];
  CLEAN.forEach(k => delete process.env[k]);
  Object.assign(process.env, env || {});
  const safe = require(path.join(API, '_safe.js'));
  safe.guard.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  return require(path.join(API, 'news.js'));
}
test.afterEach(() => CLEAN.forEach(k => delete process.env[k]));

// routes: exact URL (or URL prefix before "?") -> handler(init) returning a Response; '*' catches the rest; else 404.
function install(routes) {
  const realFetch = global.fetch, realTimeout = global.setTimeout;
  const asked = [];
  global.fetch = async (url, init) => {
    url = String(url); asked.push({ url, method: (init && init.method) || 'GET' });
    for (const [k, f] of Object.entries(routes)) if (k !== '*' && (url === k || url.startsWith(k + '?') || (k.endsWith('*') && url.startsWith(k.slice(0, -1))))) return f(init, url);
    if (routes['*']) return routes['*'](init, url);
    return new Response('nope', { status: 404 });
  };
  global.setTimeout = (fn, ms, ...a) => realTimeout(fn, 0, ...a); // the 4 s rate-group gap and the Google queue run instantly
  return { asked, restore() { global.fetch = realFetch; global.setTimeout = realTimeout; } };
}
const ago = h => new Date(Date.now() - h * 36e5).toISOString();
const rss = items => '<?xml version="1.0"?><rss><channel>' + items.map(([t, link, desc]) => '<item><title>' + t + '</title><link>' + link + '</link><pubDate>' + new Date(Date.now() - 6e5).toUTCString() + '</pubDate><description>' + (desc || t) + '</description></item>').join('') + '</channel></rss>';
const item = (src, title, extra) => Object.assign({ title, link: 'https://' + src.id + '.example.com/' + encodeURIComponent(title), summary: '', image: '', published: ago(2), source: src.name, sourceId: src.id, maxAgeDays: src.maxAgeDays }, extra || {});

// ---------- (a) name-only obituaries ----------
const LUTTRELL = { // as /api/news served it on 2026-10-22 (spencerco-81)
  title: 'Paxton Beckham Luttrell', link: 'https://spencercountyonline.com/paxton-beckham-luttrell/',
  summary: 'Paxton Beckham Luttrell, infant, passed away on October 17, 2026, at Deaconess Memorial Medical Center in Jasper.He was born October 17, 2026, in Jasper, to William C. and Kennedy Brooke (Embry) Luttrell. He was\u2026',
  image: '', published: '2026-10-22T14:55:58.000Z', source: 'Spencer County Online', sourceId: 'spencerco',
};

test('(a) Paxton Beckham Luttrell: a name-only title over a "passed away" summary is an obituary, and News drops it', () => {
  const N = load();
  assert.equal(N.looksLikeObit(LUTTRELL), true);
  const spencerco = { id: 'spencerco', name: 'Spencer County Online', area: 'Rockport', url: 'https://spencercountyonline.com/feed/' };
  assert.equal(N.passesFilters(LUTTRELL, spencerco, false), false, 'kept out at fetch time');
  const out = N.combine([{ source: spencerco, items: [Object.assign({}, LUTTRELL, { published: ago(3) }), item(spencerco, 'Rockport council approves sewer project', { summary: 'The council voted 4-1.' })] }], Date.now());
  assert.deepEqual(out.map(i => i.title), ['Rockport council approves sewer project'], 'and when stored stories are rebuilt');
});

test('(a) other death notices with only a name: nickname, maiden name, initials, suffix, funeral or visitation or obituary wording', () => {
  const N = load();
  const yes = [
    ['Mary Jo "Sissy" Smith (Jones)', 'Mary Jo "Sissy" Smith (Jones), 88, of Jasper, passed away Sunday. Visitation will be held Thursday.'],
    ['John A. Doe Jr.', 'John A. Doe Jr. of Rockport died Monday at home. Funeral services will be at 10 a.m. Friday.'],
    ['Betty Lou Kramer', 'Betty Lou Kramer, age 91, of Tell City. Visitation is Tuesday at the funeral home.'],
    ['Robert \u201cBob\u201d Hale', 'Robert \u201cBob\u201d Hale (1950-2026). Obituary and service details from the family.'],
  ];
  for (const [title, summary] of yes) assert.equal(N.looksLikeObit({ title, summary, link: 'https://spencercountyonline.com/x/' }), true, title);
});

test('(a) news stays news: headline words, a place name, a summary that does not open with the name, or no death wording', () => {
  const N = load();
  const no = [
    ['Remembering Coach Bob Jones', 'Remembering Coach Bob Jones, who passed away last week, his players gathered Friday.'],
    ['Evansville Otters', 'Evansville Otters will hold a visitation for longtime usher Tom Smith on Friday.'],
    ['Henderson County Fair', 'Henderson County Fair, funeral home sponsors and more this weekend.'],
    ['Mayor Steve Hirsch', 'Mayor Steve Hirsch, 60, spoke at the funeral of a firefighter.'],
    ['Paxton Beckham Luttrell', 'A new playground opens in Rockport this weekend.'],
    ['Jasper Strassenfest Returns', 'Jasper Strassenfest returns with a visitation of the old brewery.'],
    ['Paxton Beckham Luttrell', 'Family and friends say Paxton Beckham Luttrell passed away.'],
    ['Evansville Police Investigate Shooting', 'Evansville Police Investigate Shooting, funeral planned.'],
  ];
  for (const [title, summary] of no) assert.equal(N.looksLikeObit({ title, summary, link: 'https://news.example.com/story' }), false, title + ' | ' + summary);
});

// ---------- (c) 14 days at most for police and court items ----------
test('(c) a 60-day courts source (U.S. Attorney): its items leave News after 14 days; a shorter window still applies', () => {
  const N = load();
  assert.equal(N.SAFETY_MAX_DAYS, 14);
  const usao = { id: 'usaotest', name: 'U.S. Attorney (test)', area: 'Southern Indiana', kind: 'courts', maxAgeDays: 60, url: 'https://justice.example.gov/rss' };
  const sheriff = { id: 'sheriff7', name: 'Sheriff (test)', area: 'Evansville', kind: 'police', maxAgeDays: 7, url: 'https://sheriff.example.gov/rss' };
  const sentenced = d => item(usao, 'Evansville man sentenced to ' + d + ' years for wire fraud', { published: ago(d * 24) });
  const out = N.combine([
    { source: usao, items: [sentenced(3), sentenced(13), sentenced(15), sentenced(59)] },
    { source: sheriff, items: [item(sheriff, 'Sheriff hosts community safety night', { published: ago(10 * 24) })] },
  ], Date.now());
  assert.deepEqual(out.map(i => i.title), ['Evansville man sentenced to 3 years for wire fraud', 'Evansville man sentenced to 13 years for wire fraud']);
  assert.ok(out.every(i => i.image === '' && i.arrest === false));
  const v = N.safetyView(sentenced(1), usao);
  assert.equal(v.maxAgeDays, 14);
  assert.equal(N.safetyView(item(sheriff, 'Road closed for training'), sheriff).maxAgeDays, 7, "the sheriff's own 7 days is shorter");
  const news = { id: 'paper', name: 'Paper', area: 'Evansville', maxAgeDays: 10, url: 'https://paper.example.com/rss' };
  assert.equal(N.safetyView(item(news, 'Court story'), news).maxAgeDays, 10, 'news outlets are not touched');
});

// ---------- (d) near-identical titles ----------
test('(d) the FBI and U.S. Attorney copies of one press release, and a "(copy)" repost, show once; the first source wins', () => {
  const N = load();
  const usao = { id: 'usaosdin', name: 'U.S. Attorney, S.D. Indiana', area: 'Indiana', kind: 'courts', maxAgeDays: 60, url: 'https://www.justice.gov/usao-sdin/rss' };
  const fbi = { id: 'fbiind', name: 'FBI Indianapolis', area: 'Indiana', kind: 'courts', maxAgeDays: 60, url: 'https://www.fbi.gov/feeds/indianapolis' };
  const dch = { id: 'dcherald', name: 'Dubois County Herald', area: 'Jasper', url: 'https://www.duboiscountyherald.com/rss' };
  const pdc = { id: 'pdclarion', name: 'Princeton Daily Clarion', area: 'Princeton', url: 'https://www.pdclarion.com/rss' };
  const out = N.combine([
    { source: usao, items: [item(usao, 'Ex COO of Evansville Staffing Agency Lands in Federal Prison for $400K Embezzlement Scheme')] },
    { source: fbi, items: [item(fbi, 'Ex-COO of Evansville Staffing Agency Lands in Federal Prison for $400,000 Embezzlement Scheme')] },
    { source: dch, items: [item(dch, 'Helping an older parent cope with loneliness (copy)')] },
    { source: pdc, items: [item(pdc, 'Helping an older parent cope with loneliness')] },
  ], Date.now());
  assert.deepEqual(out.map(i => i.sourceId).sort(), ['dcherald', 'usaosdin']);
});

test('(d) the same event written up by two outlets in their own words stays two stories; one source never dedupes itself', () => {
  const N = load();
  const W = N.titleWords;
  const pairs = [ // pairs seen in the live feed on 2026-10-22 that are different reporting, not copies
    ['Owensboro\u2019s Pickle Plex opens at Ben Hawes Park', 'Pickle Plex opens at Ben Hawes, giving Owensboro\u2019s growing pickleball community a new home'],
    ['Man Convicted In Murder-For-Hire Plot Sentenced', 'Man convicted in Evansville murder-for-hire sentenced to over 100 years in prison'],
    ['Multiple drug dealers arrested in Posey County operation', 'Five suspected drug dealers arrested in Posey County bust'],
    ['Evansville council approves budget', 'Henderson council approves budget'],
  ];
  for (const [a, b] of pairs) assert.equal(N.sameStory(W(a), W(b)), false, a + ' / ' + b);
  assert.equal(N.sameStory(W('Ex COO lands in prison for $1.5k scheme'), W('Ex-COO lands in prison for $1,500 scheme')), true, '$1.5K and $1,500 fold to one word');
  assert.equal(N.sameStory(W('Road closed'), W('Road closed')), false, 'titles under 4 words are left to the exact-title check');
  const p = { id: 'p1', name: 'P1', area: 'Evansville', url: 'https://p1.example.com/rss' };
  const out = N.combine([{ source: p, items: [item(p, 'Evansville City Council approves 2027 budget on 5-4 vote'), item(p, 'Evansville City Council approves 2027 budget on 5-4 vote (updated)')] }], Date.now());
  assert.equal(out.length, 2, 'an update from the same outlet is not a cross-source duplicate');
});

// ---------- (g) Retry-After, rate group, Google News fallback ----------
test('(g) Retry-After: seconds or an HTTP date; the cooldown honors it within 10 minutes and 24 hours, else 30 min doubling', () => {
  const N = load();
  const now = Date.parse('2026-10-22T23:00:00Z');
  assert.equal(N.retryAfterMs('120', now), 120000);
  assert.equal(N.retryAfterMs('Thu, 22 Oct 2026 23:30:00 GMT', now), 30 * 6e4);
  assert.equal(N.retryAfterMs('Thu, 22 Oct 2026 22:00:00 GMT', now), 0, 'a date in the past');
  assert.equal(N.retryAfterMs(null, now), null); assert.equal(N.retryAfterMs('soon', now), null);
  assert.equal(N.cooldownMs({ retryAfterMs: 2 * 36e5 }, 1), 2 * 36e5, 'as asked');
  assert.equal(N.cooldownMs({ retryAfterMs: 30e3 }, 1), 10 * 6e4, 'never less than 10 minutes');
  assert.equal(N.cooldownMs({ retryAfterMs: 0 }, 1), 10 * 6e4);
  assert.equal(N.cooldownMs({ retryAfterMs: 3 * 864e5 }, 1), 24 * 36e5, 'never more than a day');
  assert.deepEqual([1, 2, 3, 6].map(f => N.cooldownMs({ retryAfterMs: null }, f)), [30 * 6e4, 60 * 6e4, 120 * 6e4, 6 * 36e5]);
});

const PAX = { id: 'paxtest', name: 'Paxton Test', area: 'Paducah', rateGroup: 'paxton', geoTerms: ['paducah'],
  url: 'https://www.paxtest.example.com/search/?f=rss&t=article&l=50',
  altUrls: ['https://news.google.com/rss/search?q=site%3Apaxtest.example.com%20when%3A3d&hl=en-US&gl=US&ceid=US:en'] };

test('(g) a 429 with Retry-After blocks the host for that long; the Google News fallback fills in, geo-filtered by geoTerms', async () => {
  const N = load();
  const io = install({
    'https://www.paxtest.example.com/search/': () => new Response('slow down', { status: 429, headers: { 'retry-after': '7200' } }),
    'https://news.google.com/rss/search': () => new Response(rss([['Paducah commission approves riverfront plan - Paxton Test', 'https://www.paxtest.example.com/news/1'], ['National story about Congress - Paxton Test', 'https://www.paxtest.example.com/news/2']])),
  });
  try {
    const now = Date.now();
    const r = await N.loadSource(PAX, null, now);
    assert.equal(r.refused, true);
    assert.equal(r.blocked['www.paxtest.example.com'], now + 7200e3, 'Retry-After: 2 hours');
    assert.deepEqual(r.items.map(i => i.title), ['Paducah commission approves riverfront plan'], 'fallback stories that name the paper\'s town');
    assert.equal(N.statusOf(r), 'success');
    // next run, still cooling down: the publisher is not asked at all
    io.asked.length = 0;
    const r2 = await N.loadSource(PAX, { items: r.items, blocked: r.blocked, blockCount: r.blockCount }, now + 36e5);
    assert.ok(!io.asked.some(a => a.url.includes('paxtest.example.com/search')), 'no request to the blocked host');
    assert.equal(r2.items.length, 1);
  } finally { io.restore(); }
});

test('(g) directOff: once a sister paper was refused this run, only the Google News fallback is tried', async () => {
  const N = load();
  const io = install({ 'https://news.google.com/rss/search': () => new Response(rss([['Paducah schools add bus route - Paxton Test', 'https://www.paxtest.example.com/news/3']])) });
  try {
    const r = await N.loadSource(PAX, null, Date.now(), { directOff: true });
    assert.deepEqual(io.asked.map(a => new URL(a.url).hostname), ['news.google.com']);
    assert.equal(r.items.length, 1); assert.equal(r.refused, false);
  } finally { io.restore(); }
});

test('(g) batch 1: the eight Paxton papers are one rate group with a Google News site: fallback and their own geoTerms', () => {
  const b1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/sources/batches/batch-1.json'), 'utf8'));
  const ids = ['pasun', 'mledger', 'kne', 'heraldledger', 'tribcourier', 'mayfield', 'timesleader', 'metplanet'];
  for (const id of ids) {
    const s = b1.sources.find(x => x.id === id);
    assert.equal(s.rateGroup, 'paxton', id);
    assert.equal(s.altUrls.length, 1, id);
    const host = new URL(s.url).hostname.replace(/^www\./, '');
    assert.equal(s.altUrls[0], 'https://news.google.com/rss/search?q=site%3A' + host + '%20when%3A3d&hl=en-US&gl=US&ceid=US:en', id);
    assert.ok(Array.isArray(s.geoTerms) && s.geoTerms.length >= 3 && s.geoTerms.every(t => t === t.toLowerCase()), id);
  }
  assert.deepEqual(b1.sources.filter(s => s.rateGroup).map(s => s.id), ids, 'no other source joined the group');
  const N = load();
  assert.deepEqual(N.RATE_GROUPS.paxton, { gapMs: 4000, perRun: 3 });
});

test('(g) refreshAll: at most 3 Paxton papers per run, and after the first 429 the others go straight to Google News', async () => {
  const N = load({ EXPANDED_SOURCES_ENABLED: 'true', SOURCE_BATCHES: 'b1' });
  const pax = N.SOURCES.filter(s => s.rateGroup === 'paxton');
  assert.equal(pax.length, 8);
  const hosts = new Set(pax.map(s => new URL(s.url).hostname));
  const io = install({
    '*': (init, url) => {
      const u = new URL(url);
      if (hosts.has(u.hostname)) return new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '3600' } });
      if (u.hostname === 'news.google.com') { const site = (u.searchParams.get('q') || '').match(/site:(\S+)/); return new Response(rss([['Paducah Murray Hopkinsville Eddyville Benton, Ky. Mayfield Princeton Metropolis update - ' + (site ? site[1] : ''), 'https://' + (site ? site[1] : 'x.example') + '/news/1']])); }
      return new Response('nope', { status: 404 });
    },
  });
  try {
    const { run } = await N.refreshAll({});
    const ran = run.results.filter(r => pax.some(s => s.id === r.sourceId));
    assert.equal(ran.length, 3, 'perRun: 3');
    const direct = io.asked.filter(a => hosts.has(new URL(a.url).hostname));
    assert.equal(direct.length, 1, 'one 429 from the shared servers, then no more direct requests this run: ' + direct.map(a => a.url).join(' '));
    assert.ok(ran.every(r => r.status === 'success' && r.endpointId === 'alt1'), JSON.stringify(ran.map(r => [r.sourceId, r.status, r.endpointId])));
  } finally { io.restore(); }
});

// ---------- (e, f) picture weight ----------
test('(f) smaller picture variants where the image service makes them; everything else untouched', () => {
  const N = load();
  const S = N.smallerImage;
  assert.equal(S('https://gray-wfie-prod.gtv-cdn.com/resizer/v2//JJ3W.png?auth=abc&smart=false'), 'https://gray-wfie-prod.gtv-cdn.com/resizer/v2//JJ3W.png?auth=abc&smart=false&width=640');
  assert.equal(S('https://gray-kfvs12-prod.gtv-cdn.com/resizer/v2/X.jpg?auth=a&width=1280&height=720'), 'https://gray-kfvs12-prod.gtv-cdn.com/resizer/v2/X.jpg?auth=a&width=640');
  assert.equal(S('https://www.tristatehomepage.com/wp-content/uploads/sites/92/2026/10/A.png?w=900'), 'https://www.tristatehomepage.com/wp-content/uploads/sites/92/2026/10/A.png?w=640');
  assert.equal(S('https://townsquare.media/site/72/files/2026/10/a.jpg?format=natural'), 'https://townsquare.media/site/72/files/2026/10/a.jpg?format=natural&w=640&q=75');
  assert.equal(S('https://bloximages.chicago2.vip.townnews.com/x.com/a.image.jpg?resize=1200%2C800'), 'https://bloximages.chicago2.vip.townnews.com/x.com/a.image.jpg?resize=640%2C427');
  for (const same of ['https://bloximages.chicago2.vip.townnews.com/x.com/a.image.jpg?resize=300%2C222', 'https://cdn.owensborotimes.com/wp-content/uploads/2026/10/Jordys-560x293.jpg',
    'https://www.tristatehomepage.com/wp-content/uploads/a.png?w=320', 'https://media-cdn.socastsrm.com/wordpress/x.jpg', '', 'not a url']) assert.equal(S(same), same, same);
});

test('(e) event pictures: one HEAD per new picture, over 1 MB shows the date tile, the size is remembered, a big picture is not lent', async () => {
  const N = load();
  const ev = { id: 'evtest', name: 'Venue', area: 'Evansville', kind: 'events', url: 'https://venue.example.com/events.ics' };
  const big = 'https://venue.example.com/images/Pops%201_TV.jpg', ok = 'https://venue.example.com/images/small.jpg', nolen = 'https://venue.example.com/images/nolen.jpg';
  const sizes = { [big]: '16036656', [ok]: '204800' };
  const start = d => new Date(Date.now() + d * 864e5).toISOString();
  const evItem = (t, d, image) => ({ title: t, link: 'https://venue.example.com/e/' + encodeURIComponent(t) + d, summary: '', image, published: start(d), source: ev.name, sourceId: ev.id, isEvent: true, isObit: false });
  const io = install({ '*': (init, url) => (init && init.method === 'HEAD' ? new Response(null, { status: 200, headers: sizes[url] ? { 'content-length': sizes[url] } : {} }) : new Response('nope', { status: 404 })) });
  try {
    const items = [evItem('Pops concert', 2, big), evItem('Pops concert', 9, ''), evItem('Jazz night', 3, ok), evItem('Quiz', 4, nolen)];
    await N.sizeImages(items, null);
    assert.equal(io.asked.filter(a => a.method === 'HEAD').length, 3);
    assert.deepEqual(items.map(i => i.imageBytes), [16036656, undefined, 204800, -1]);
    const out = N.combine([{ source: ev, items }], Date.now());
    assert.deepEqual(out.map(i => [i.title, i.image]), [['Pops concert', ''], ['Jazz night', ok], ['Quiz', nolen], ['Pops concert', '']], 'the 15.6 MB picture is neither shown nor lent to the repeat');
    assert.ok(out.every(i => !('imageBytes' in i)), 'the size stays out of the page data');
    io.asked.length = 0;
    const again = [evItem('Pops concert', 2, big), evItem('Jazz night', 3, ok)];
    await N.sizeImages(again, { items });
    assert.equal(io.asked.length, 0, 'known sizes are reused from the stored record');
    assert.equal(again[0].imageBytes, 16036656);
  } finally { io.restore(); }
});

// ---------- (h) logos ----------
test('(h) self-hosted logos for the ten that 404 at Google and the two that showed the Google News icon; the files exist', () => {
  const N = load();
  const want = { courier: '/logos/courier.png', gleaner: '/logos/gleaner.png', 'ob-glenn': '/logos/glenn.png', 'ev-tm': '/logos/ticketmaster.png', ocmonitor: '/logos/ocmonitor.png',
    dcherald: '/logos/dcherald.svg', 'ob-dcherald': '/logos/dcherald.svg', pdclarion: '/logos/pdclarion.svg', 'ob-pdclarion': '/logos/pdclarion.svg', 'ob-ziemer': '/logos/ziemer.svg', 'ob-koehler': '/logos/koehler.svg', poseynews: '/logos/poseynews.svg' };
  for (const [id, file] of Object.entries(want)) {
    assert.equal(N.logoFor({ id, url: 'https://news.google.com/rss/search?q=site%3Aexample.com' }), file, id);
    assert.ok(fs.statSync(path.join(ROOT, 'public', file)).size > 100, file);
  }
  assert.equal(N.logoFor({ id: 'x', url: 'https://news.google.com/rss/search?q=site%3Amessenger-inquirer.com%20when%3A3d' }), 'https://www.google.com/s2/favicons?sz=128&domain=messenger-inquirer.com', 'a Google News URL: the site: domain');
  assert.equal(N.logoFor({ id: 'x', url: 'https://obits.glennfuneralhome.com/obituary-sitemap.xml' }), 'https://www.google.com/s2/favicons?sz=128&domain=glennfuneralhome.com');
  assert.equal(N.logoFor('https://www.wthitv.com/arc/outboundfeeds/rss/'), 'https://www.google.com/s2/favicons?sz=128&domain=wthitv.com', 'a plain URL as before');
  for (const f of fs.readdirSync(path.join(ROOT, 'public/logos')).filter(f => f.endsWith('.svg'))) assert.ok(!/<script|on\w+=/i.test(fs.readFileSync(path.join(ROOT, 'public/logos', f), 'utf8')), f);
});
