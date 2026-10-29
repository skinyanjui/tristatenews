// Ads PR 3: no fictional advertisers or sample posts anywhere on the site, except the placeholder sample ads (ads PR
// 4.2, test/sample-ads.test.js), which are labeled "Sample ad" and live only in sponsors.json "samples". Open ad spots show the site's own
// "Advertise with us" unit; real ads are labeled "Sponsored" and linked rel="sponsored"; News/All, News,
// Police & courts and Obituaries carry no ads at all.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const A = require('../public/adslots.js');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = require('./_page.js')(), legal = read('public/legal.html'), raw = read('public/sponsors.json');
const sponsors = JSON.parse(raw);
// Everything but the labeled sample-ad switch and its code, which test/sample-ads.test.js checks on its own.
const rawNoSamples = JSON.stringify(Object.assign({}, sponsors, { samples: undefined, note: sponsors.note.replace(/ 'samples' is the one switch[\s\S]*$/, '') }));
const htmlNoSamples = html.replace(/\/\/ [^\n]*/g, '').replace(/Sample ad|sampleAd|UI\.sample|TSNAds\.sample|__samples|sj\.samples|ad-sample|A sample, not a real business|f\.type === 'sample'|      sample: function \(offset\)/g, '');

// Words and claims that only ever came from made-up demo content. If any comes back, this fails.
const FICTION = [/\bsample\b/i, /example\.(com|org|net)/i, /5\.49\s*%/, /\bAPR\b/, /lorem ipsum/i, /\bdemo (ad|post|listing)s?\b/i, /\bplaceholder (ad|business|sponsor)s?\b/i,
  /Staffing Co\.|Pizza Co\.|Riverfront Brewery|Credit Union|Roofing|Dental|Auto Care|Boutique|Coffee Shop|Heating & Air|Care Center|School District|Freight|Distribution|Hardware|Cinema|Salon|Diner/];

test('sponsors.json: no sample or made-up advertiser, only real-ad fields, no slot on a no-ad section', () => {
  for (const re of FICTION) assert.ok(!re.test(rawNoSamples), 'sponsors.json matches ' + re);
  assert.deepStrictEqual(Object.keys(sponsors.slots).sort(), ['classifieds', 'deals', 'events', 'jobs']);
  assert.deepStrictEqual(Object.keys(sponsors.rails).sort(), ['left', 'right']);
  const ads = Object.values(sponsors.slots).filter(Boolean).concat(sponsors.rails.left, sponsors.rails.right);
  for (const ad of ads) {
    assert.deepStrictEqual(Object.keys(ad).filter(k => !['name', 'text', 'url', 'cta'].includes(k)), [], 'only real-ad fields (no "sample" flag)');
    assert.match(ad.url, /^https:\/\//);
  }
});

test('index.html: no sample posts, sample businesses, sample labels or made-up offers', () => {
  for (const re of FICTION) assert.ok(!re.test(htmlNoSamples), 'index.html matches ' + re);
  assert.ok(!/SAMPLE_|\.samples\b|it\.sample|sp\.sample|ad\.sample/.test(htmlNoSamples));
  assert.ok(!html.includes('Featured \\u00B7 Sample') && !html.includes('Featured · Sample'));
  assert.ok(!/Hiring 40|for \$19|\$6 tickets|\$20 off/.test(html), 'no invented claims');
});

test('legal.html: no sample Featured posts; the only samples it describes are the labeled placeholder sample ads; it describes the house unit', () => {
  assert.deepStrictEqual([...legal.matchAll(/[^.>]*\bsamples?\b[^.<]*/gi)].length, 4, 'one bullet and one label sentence about placeholder sample ads');
  assert.ok(!/sample (featured|post|business|advertiser)/i.test(legal) && !/Featured · Sample/.test(legal));
  assert.ok(/“Advertise with us,?”/.test(legal));
  assert.ok(legal.includes('“Featured · Paid”'));
});

// Run the page's own sponsor-line and side-ad code against a tiny DOM.
function pageUI(cfg) {
  const node = (tag, cls, text) => {
    const n = { tag, className: cls || '', children: [], attrs: {}, listeners: {}, style: { setProperty() {} } };
    Object.defineProperty(n, 'textContent', { get() { return (n._t || '') + n.children.map(c => c.textContent).join(' '); }, set(v) { n._t = String(v); n.children = []; } });
    n.appendChild = c => { n.children.push(c); return c; };
    n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
    n.addEventListener = (e, f) => { n.listeners[e] = f; };
    if (text != null) n.textContent = text;
    return n;
  };
  const boxes = { 'rail-l': node('aside'), 'rail-r': node('aside') };
  const start = html.indexOf('      adLink: function (cls, ad) {'), mid = html.indexOf('      // The one heart used everywhere.');
  const s2 = html.indexOf('      sponsor: function (slot, houseAd) {'), e2 = html.indexOf('      notice: function (text) {');
  assert.ok(start > 0 && mid > start && s2 > mid && e2 > s2, 'found the sponsor code');
  const src = 'var UI = {' + html.slice(start, mid).replace(/,\s*$/, '') + ',' + html.slice(s2, e2).replace(/,\s*$/, '') + '}; return UI;';
  let opened = 0;
  const UI = new Function('el', 'bizAvatar', 'openAd', 'SPONSORS', 'document', 'window', 'TSNAds', src)(
    (t, c, x) => node(t, c, x), name => node('span', 'bav', name), () => { opened++; }, cfg, { getElementById: id => boxes[id] }, { TSNAds: A }, A);
  return { UI, boxes, opened: () => opened };
}
const tagOf = n => n.children.find(c => c.className === 'spon-tag').textContent;

test('open spots: one house unit labeled "Advertise with us", no business, price or number; it opens the inquiry form', () => {
  const sp = JSON.parse(raw).slots; sp.__rails = JSON.parse(raw).rails;
  const { UI, boxes, opened } = pageUI(sp);
  for (const slot of ['jobs', 'deals', 'events', 'classifieds']) {
    const h = UI.sponsor(slot, true);
    assert.deepStrictEqual([h.tag, tagOf(h), h.attrs['aria-label']], ['button', 'Advertise with us', undefined], slot); // named by its visible text
    assert.ok(!/sponsored|\$|\d/i.test(h.textContent), slot + ': ' + h.textContent);
    assert.ok(/Tri-State News/.test(h.textContent));
    h.listeners.click();
  }
  assert.strictEqual(opened(), 4);
  UI.rails('jobs');
  assert.strictEqual(boxes['rail-l'].children.length, 0, 'an unsold left margin stays empty (no samples configured)');
  assert.strictEqual(boxes['rail-r'].children.length, 1);
  const r = boxes['rail-r'].children[0];
  assert.deepStrictEqual([r.tag, tagOf(r)], ['button', 'Advertise with us']);
  assert.ok(!/sponsored|\$|\d/i.test(r.textContent), r.textContent);
  assert.strictEqual(UI.sponsor('jobs', false), null, 'no house unit where the caller asks for none');
});

test('real ads: labeled "Sponsored", rel="sponsored", https only; they replace the house unit', () => {
  const ad = { name: 'Acme', text: 'Hello', url: 'https://acme.test/' };
  const { UI, boxes } = pageUI({ jobs: ad, deals: { name: 'Bad', url: 'http://insecure.test/' }, __rails: { left: [ad], right: [ad, ad, ad] } });
  const a = UI.sponsor('jobs', true);
  assert.deepStrictEqual([a.tag, a.href, a.rel, tagOf(a)], ['a', 'https://acme.test/', 'sponsored noopener noreferrer', 'Sponsored']);
  assert.strictEqual(UI.sponsor('deals', true).tag, 'button', 'a non-https ad is not shown; the house unit is');
  UI.rails('jobs');
  assert.deepStrictEqual([boxes['rail-l'].children.length, boxes['rail-r'].children.length], [1, 2], 'at most two per margin');
  for (const n of boxes['rail-l'].children.concat(boxes['rail-r'].children)) assert.deepStrictEqual([n.tag, n.rel, tagOf(n)], ['a', 'sponsored noopener noreferrer', 'Sponsored']);
});

test('no ads on Obituaries or Breaking; News has no sponsor line (only its in-feed card and side ads)', () => {
  // sponsor lines: only the four boards (drawBody skips obituaries) and Events
  const calls = [...html.matchAll(/UI\.sponsor\(([^)]*)\)/g)].map(m => m[1]);
  assert.deepStrictEqual(calls.sort(), ["'events', true", 'TABOF[kind], true']);
  assert.ok(html.includes("var spn = kind !== 'obit' && UI.sponsor(TABOF[kind], true);"));
  assert.ok(!/UI\.sponsor\('(news|all|safety|obits|institution)'/.test(html));
  // side ads: hidden unless render() marks one of the ad tabs (the four boards and News; never during a search)
  assert.ok(html.includes('body:not([data-ads]) .rail { display:none !important; }'));
  assert.ok(html.includes("var AD_TABS = ['events', 'jobs', 'deals', 'classifieds', 'news'];"));
  assert.ok(html.includes("document.body.toggleAttribute('data-ads', AD_TABS.indexOf(state.cat) >= 0 && !state.q.trim());"));
  const asides = [...html.matchAll(/<aside id="rail-[lr]"[^>]*>/g)].map(m => m[0]);
  assert.strictEqual(asides.length, 2);
  for (const t of asides) assert.ok(t.includes('aria-label="Advertising"'), t);
  // no news or obituary item can carry a Featured badge: only board cards do
  assert.ok(!('news' in sponsors.slots) && !('obits' in sponsors.slots) && !('safety' in sponsors.slots));
});
