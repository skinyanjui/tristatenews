// Ads PR 4: the in-listing ad card (public/adslots.js and the page code that places it). One per board view, only on
// Jobs, Deals, Classifieds and Events, never targeted, labeled, https only, no intrusive formats.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../public/adslots.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('public/index.html'), mod = read('public/adslots.js'), raw = read('public/sponsors.json');
const sponsors = JSON.parse(raw);
const NOW = Date.parse('2026-10-18T15:00:00Z');
const ad = (n, extra) => Object.assign({ name: 'Advertiser ' + n, text: 'Text ' + n, url: 'https://ad' + n + '.test/' }, extra || {});

test('the four boards and the News feed can carry the card; every no-ad section gets null', () => {
  assert.deepStrictEqual(A.BOARDS, { item: 'classifieds', deal: 'deals', event: 'events', job: 'jobs' });
  assert.deepStrictEqual(A.AD_TABS, ['events', 'jobs', 'deals', 'classifieds', 'news']);
  assert.deepStrictEqual(A.fill('news', { news: ad(2) }, NOW), { type: 'direct', ad: ad(2) }, 'News: its in-feed card');
  for (const k of ['obit', 'obits', 'all', 'safety', 'institution', 'breaking', 'saved', 'submit', '', undefined, '__proto__', 'constructor', 'toString'])
    assert.strictEqual(A.fill(k, { obits: ad(1), news: ad(2), safety: ad(3), breaking: ad(4) }, NOW), null, String(k));
});

test('unsold, invalid or reserved-network slots hold the house unit; a valid direct sponsor fills it', () => {
  for (const cards of [undefined, null, {}, { jobs: null }, { jobs: [] }, { jobs: ad(1, { url: 'http://insecure.test/' }) }, { jobs: ad(1, { url: 'javascript:alert(1)' }) },
    { jobs: { url: 'https://x.test/' } }, { jobs: ad(1, { text: 5 }) }, { jobs: { network: 'some-network' } }, { jobs: [ad(1, { url: '' })] }])
    assert.deepStrictEqual(A.fill('job', cards, NOW), { type: 'house' }, JSON.stringify(cards));
  assert.deepStrictEqual(A.fill('job', { jobs: ad(1) }, NOW), { type: 'direct', ad: ad(1) });
  assert.deepStrictEqual(A.fill('deal', { deals: [ad(1, { url: 'http://x' }), ad(2)] }, NOW), { type: 'direct', ad: ad(2) }, 'invalid entries are skipped');
  for (const [kind, key] of Object.entries(A.BOARDS)) assert.strictEqual(A.fill(kind, { [key]: ad(9) }, NOW).ad.name, 'Advertiser 9', kind);
});

test('rotation is by the clock only: equal turns, the same ad for every reader at the same moment', () => {
  const list = [ad(1), ad(2), ad(3)], T = A.TURN_MIN * 60000, t0 = Date.parse('2026-10-18T15:00:00Z');
  const at = n => A.fill('event', { events: list }, t0 + n * T).ad.name;
  assert.strictEqual(A.TURN_MIN, 15);
  assert.deepStrictEqual(new Set([0, 1, 2].map(at)).size, 3, 'each sponsor gets a turn');
  assert.strictEqual(at(0), at(3));
  assert.strictEqual(A.fill('event', { events: list }, A.turn(t0) * T).ad.name, A.fill('event', { events: list }, A.turn(t0) * T + T - 1).ad.name, 'one turn, one ad');
  // fair: over any Chicago day each of n sponsors gets the same number of turns, give or take one
  for (const n of [1, 2, 3, 4, 5, 7]) {
    const names = Array.from({ length: n }, (_, i) => ad(i + 1)), seen = {};
    for (let m = 0; m < 24 * 60 / A.TURN_MIN; m++) { const x = A.pick(names, Date.parse('2026-10-18T05:00:00Z') + m * T).name; seen[x] = (seen[x] || 0) + 1; }
    const v = Object.values(seen);
    assert.strictEqual(v.length, n); assert.ok(Math.max(...v) - Math.min(...v) <= 1, n + ': ' + v);
  }
  assert.strictEqual(A.dayNumber(Date.parse('2026-10-19T04:59:00Z')), A.dayNumber(Date.parse('2026-10-18T05:00:00Z')));
  assert.strictEqual(A.dayNumber(Date.parse('2026-10-19T05:00:00Z')), A.dayNumber(Date.parse('2026-10-18T05:00:00Z')) + 1);
  assert.strictEqual(A.fill.length, 4, 'fill(kind, cards, now, samples): site settings and the date; nothing about the reader goes in');
});

test('never targeted: no cookies, storage, reader signals or randomness in the card code', () => {
  const start = html.indexOf('      adCard: function (kind) {'), end = html.indexOf('      notice: function (text) {');
  assert.ok(start > 0 && end > start);
  for (const src of [mod, html.slice(start, end)])
    for (const re of [/document\.cookie/, /localStorage/, /sessionStorage/, /navigator\./, /fetch\(/, /Math\.random/, /XMLHttpRequest/, /geolocation/i, /state\.(town|q|saved|mine)/])
      assert.ok(!re.test(src), String(re));
});

test('one card per board view: after the 6th post, at the end of a shorter board, none on an empty one', () => {
  assert.deepStrictEqual([0, 1, 5, 6, 7, 60, -1, NaN, '3'].map(A.position), [-1, 1, 5, 6, 6, 6, -1, -1, 3]);
  // the page places it with that rule, once, in the board list and in the Events day list, never during a search
  assert.ok(html.includes("var adAt = state.q.trim() ? -1 : (window.TSNAds ? TSNAds.position(items.length) : -1);"));
  assert.ok(html.includes("items.forEach(function (it, i) { list.appendChild(card(it, kind, b)); if (i + 1 === adAt) { var ac = UI.adCard(kind); if (ac) list.appendChild(ac); } });"));
  assert.ok(html.includes("adAt = state.q.trim() ? -1 : (window.TSNAds ? TSNAds.position(shown.length) : -1);"));
  assert.ok(html.includes("if (++seen === adAt) { var ac = UI.adCard('event'); if (ac) g.appendChild(ac); }"));
  assert.deepStrictEqual([...html.matchAll(/UI\.adCard\(([^)]*)\)/g)].map(m => m[1]).sort(), ["'event'", "'news'", 'kind'], 'placed in exactly three spots (boards, Events, the News feed card)');
  // drawBody also draws Obituaries; the module answers null there, so no card (checked above). Breaking and news
  // cards are drawn by other functions that never call adCard.
  const brk = html.slice(html.indexOf('function renderBreaking'), html.indexOf('function renderBreaking') + 4000);
  assert.ok(!/adCard|UI\.sponsor|rail/.test(brk.slice(0, brk.indexOf('\n  function ', 10))), 'no ad in Breaking');
});

test('no intrusive formats: in the flow (not sticky or fixed), no video, iframes or autoplay; a still image only through adLink', () => {
  const css = html.split('\n').filter(l => /^\.ad-card/.test(l)).join('\n');
  assert.ok(css.length > 0);
  assert.ok(!/position\s*:\s*(sticky|fixed|absolute)|animation|transition/.test(css), css);
  const start = html.indexOf('      adCard: function (kind) {'), end = html.indexOf('      notice: function (text) {');
  assert.ok(!/'img'|'video'|'iframe'|autoplay|setTimeout|setInterval|window\.open|alert\(/.test(html.slice(start, end)));
  const ls = html.indexOf('      adLink: function (cls, ad) {'), le = html.indexOf('      // A tall ad for the side margins');
  assert.ok(/im\.loading = 'lazy'/.test(html.slice(ls, le)) && !/'video'|'iframe'|autoplay/.test(html.slice(ls, le)), 'the one image path is a lazy still image');
  assert.ok(!/autoplay/i.test(html), 'no autoplay anywhere on the page');
});

test('sponsors.json: one card key per board, no key for a no-ad section; the page reads it', () => {
  assert.deepStrictEqual(Object.keys(sponsors.cards).sort(), ['classifieds', 'deals', 'events', 'jobs']);
  for (const [k, v] of Object.entries(sponsors.cards)) for (const x of (Array.isArray(v) ? v : v ? [v] : [])) assert.ok(A.validAd(x) || (x && typeof x.network === 'string'), k);
  const { samples, ...rest } = sponsors;
  assert.ok(!/sample|example\.com/i.test(JSON.stringify(rest).replace(/'samples'[^.]*\./, '')), 'outside the samples switch, nothing is a sample');
  assert.ok(!/example\.com/i.test(raw));
  assert.ok(html.includes('SPONSORS.__cards = d && d.cards ? d.cards : {};'));
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<script src="/adslots.js"></script>'));
  assert.ok(html.includes("var AD_TABS = ['events', 'jobs', 'deals', 'classifieds', 'news'];"), 'side-ad tabs match the module');
  assert.ok(JSON.parse(read('package.json')).scripts.lint.includes('public/adslots.js'));
});

// The page's own adCard against a tiny DOM.
function pageCard(cards) {
  const node = (tag, cls, text) => {
    const n = { tag, className: cls || '', children: [], attrs: {}, listeners: {} };
    Object.defineProperty(n, 'textContent', { get() { return (n._t || '') + n.children.map(c => c.textContent).join(' '); }, set(v) { n._t = String(v); n.children = []; } });
    n.appendChild = c => { n.children.push(c); return c; };
    n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
    n.addEventListener = (e, f) => { n.listeners[e] = f; };
    if (text != null) n.textContent = text;
    return n;
  };
  const start = html.indexOf('      adCard: function (kind) {'), end = html.indexOf('      notice: function (text) {');
  const ls = html.indexOf('      adLink: function (cls, ad) {'), le = html.indexOf('      // A tall ad for the side margins');
  let opened = 0;
  const UI = new Function('el', 'openAd', 'SPONSORS', 'window', 'TSNAds', 'var UI = {' + html.slice(ls, le) + html.slice(start, end).replace(/,\s*$/, '') + '}; return UI;')(
    (t, c, x) => node(t, c, x), () => { opened++; }, { __cards: cards }, { TSNAds: A }, A);
  return { UI, opened: () => opened };
}
const tagOf = n => n.children.find(c => c.className === 'spon-tag').textContent;

test('the card: house unit "Advertise with us" (no business, price or number) opens the inquiry form; a sponsor is "Sponsored", rel="sponsored"', () => {
  const p = pageCard(sponsors.cards);
  for (const kind of Object.keys(A.BOARDS)) {
    const h = p.UI.adCard(kind);
    // named by its visible text, no aria-label (axe label-content-name-mismatch, audit 2026-10-22)
    assert.deepStrictEqual([h.tag, tagOf(h), h.attrs['aria-label']], ['button', 'Advertise with us', undefined], kind);
    assert.ok(h.textContent.includes('Advertise with Tri-State News'), kind);
    assert.ok(!/sponsored|\$|\d/i.test(h.textContent), h.textContent);
    h.listeners.click();
  }
  assert.strictEqual(p.opened(), 4);
  assert.strictEqual(p.UI.adCard('obit'), null);
  const d = pageCard({ jobs: ad(1, { cta: 'Shop now' }) }).UI.adCard('job');
  assert.deepStrictEqual([d.tag, d.href, d.rel, d.target, tagOf(d), d.attrs['aria-label']], ['a', 'https://ad1.test/', 'sponsored noopener noreferrer', '_blank', 'Sponsored', undefined]);
  assert.ok(d.textContent.includes('Sponsored') && d.textContent.includes('Advertiser 1'), 'the visible text names it');
  assert.ok(d.textContent.includes('Shop now'));
});
