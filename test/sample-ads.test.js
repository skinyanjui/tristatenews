// Placeholder sample ads: while a spot on Jobs, Deals, Events or Classifieds is unsold, it can show a made-up
// business instead of the plain "Advertise with us" unit. Every one is labeled "Sample ad", links only to /advertise,
// comes from one switch in sponsors.json ("samples": { "on": ... }), and never takes the place of a real ad.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../public/adslots.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('public/index.html'), sponsors = JSON.parse(read('public/sponsors.json'));
const NOW = Date.parse('2026-10-18T15:00:00Z');
const real = { name: 'Real Advertiser', text: 'Approved', url: 'https://real.test/', cta: 'Visit website' };
const ON = { on: true, ads: [{ name: 'Alpha Shop', text: 'One' }, { name: 'Beta Shop', text: 'Two' }, { name: 'Gamma Shop' }] };

test('sponsors.json: one switch, made-up businesses with a name and a line only, no links, prices or numbers', () => {
  assert.strictEqual(typeof sponsors.samples.on, 'boolean');
  assert.ok(sponsors.samples.ads.length >= 4);
  for (const ad of sponsors.samples.ads) {
    assert.ok(A.validSample(ad), JSON.stringify(ad));
    assert.deepStrictEqual(Object.keys(ad).filter(k => k !== 'name' && k !== 'text'), [], 'no url, image or cta: the page sets the link');
    assert.ok(!/https?:|www\.|\.com\b|\$|\d|%/.test(ad.name + ' ' + (ad.text || '')), ad.name);
  }
  assert.strictEqual(new Set(sponsors.samples.ads.map(a => a.name)).size, sponsors.samples.ads.length);
  assert.ok(Object.values(sponsors.slots).concat(Object.values(sponsors.cards), sponsors.rails.left, sponsors.rails.right).every(v => v === null), 'real ad spots stay empty here');
});

test('the module: a real ad always wins, samples only when the switch is on, never outside the four boards and News', () => {
  assert.deepStrictEqual(A.fill('job', { jobs: real }, NOW, ON), { type: 'direct', ad: real }, 'approved ads first');
  assert.strictEqual(A.fill('job', {}, NOW, ON).type, 'sample');
  for (const off of [undefined, null, {}, { on: false, ads: ON.ads }, { on: 'yes', ads: ON.ads }, { on: true }, { on: true, ads: [] }, { on: true, ads: [{ name: 'X', url: 'https://evil.test/' }] }, { on: true, ads: [{ name: 'x'.repeat(41) }] }])
    assert.deepStrictEqual(A.fill('job', {}, NOW, off), { type: 'house' }, JSON.stringify(off));
  for (const k of ['obit', 'all', 'safety', 'institution', 'breaking', 'saved']) assert.strictEqual(A.fill(k, {}, NOW, ON), null, k);
  assert.strictEqual(A.fill('news', {}, NOW, ON).type, 'sample', 'the News in-feed card can show a sample');
  const a = A.sample(ON, 0, NOW), b = A.sample(ON, 1, NOW);
  assert.notStrictEqual(a.name, b.name, 'offsets keep two spots from showing the same sample');
  assert.strictEqual(A.sample(ON, 0, NOW).name, A.sample(ON, 0, NOW + 3600e3).name, 'same sample all day for everyone');
  assert.notStrictEqual(A.sample(ON, 0, NOW).name, A.sample(ON, 0, NOW + 864e5).name, 'rotates by day');
});

// The page's own ad code against a tiny DOM (sample, sponsor line, side ads, card).
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
  const cut = (a, b) => { const s = html.indexOf(a), e = html.indexOf(b); assert.ok(s > 0 && e > s, a); return html.slice(s, e).replace(/,\s*$/, ''); };
  const src = 'var UI = {' + cut('      adLink: function (cls, ad) {', '      // The one heart used everywhere.') + ',' + cut('      sponsor: function (slot, houseAd) {', '      notice: function (text) {') + '}; return UI;';
  const UI = new Function('el', 'bizAvatar', 'openAd', 'SPONSORS', 'document', 'window', 'TSNAds', src)(
    (t, c, x) => node(t, c, x), name => node('span', 'bav', name), () => {}, cfg, { getElementById: id => boxes[id] }, { TSNAds: A }, A);
  return { UI, boxes };
}
const tagOf = n => n.children.find(c => c.className === 'spon-tag').textContent;

test('sample ads on the page: labeled "Sample ad", say they are not a real business, link only to /advertise', () => {
  const { UI, boxes } = pageUI({ __samples: sponsors.samples.on ? sponsors.samples : ON, __rails: {}, __cards: {} });
  const names = (sponsors.samples.on ? sponsors.samples : ON).ads.map(a => a.name);
  const spots = ['jobs', 'deals', 'events', 'classifieds'].map(b => UI.sponsor(b, true)).concat(Object.keys(A.BOARDS).map(k => UI.adCard(k)));
  UI.rails('jobs');
  spots.push(boxes['rail-r'].children[0]);
  for (const n of spots) {
    assert.deepStrictEqual([n.tag, n.href, tagOf(n), n.rel, n.target], ['a', '/advertise', 'Sample ad', undefined, undefined], n.className);
    assert.match(n.className, /ad-sample/);
    assert.match(n.attrs['aria-label'], /^Sample ad: .+, not a real business\. Advertise with Tri-State News\.$/);
    assert.ok(names.some(x => n.textContent.includes(x)) && n.textContent.includes('Advertise here'));
    assert.ok(!/Sponsored/.test(n.textContent), 'never labeled as a real sponsor');
  }
  assert.ok(spots.slice(4, 8).every(c => c.textContent.includes('A sample, not a real business.')));
  const left = boxes['rail-l'].children[0];
  assert.deepStrictEqual([left.tag, left.href, tagOf(left)], ['a', '/advertise', 'Sample ad'], 'an unsold left margin shows a vertical sample too');
  assert.match(left.className, /rail-sky/); assert.match(boxes['rail-r'].children[0].className, /rail-sky/);
  assert.notStrictEqual(left.children.find(c => c.tag === 'b').textContent, boxes['rail-r'].children[0].children.find(c => c.tag === 'b').textContent, 'different samples left and right');
  for (const tab of ['obits', 'safety', 'institution', 'saved', 'submit', '']) {
    UI.rails(tab);
    assert.deepStrictEqual([boxes['rail-l'].children.length, boxes['rail-r'].children.length], [0, 0], 'no side ads on ' + (tab || 'search/none'));
  }
});

test('real approved ads take every spot first; with the switch off the plain house units come back', () => {
  const { UI, boxes } = pageUI({ jobs: real, __samples: ON, __rails: { right: [real] }, __cards: { jobs: real } });
  assert.deepStrictEqual([UI.sponsor('jobs', true).href, tagOf(UI.sponsor('jobs', true))], ['https://real.test/', 'Sponsored']);
  assert.deepStrictEqual([UI.adCard('job').href, tagOf(UI.adCard('job'))], ['https://real.test/', 'Sponsored']);
  UI.rails('jobs');
  assert.strictEqual(boxes['rail-r'].children[0].href, 'https://real.test/');
  assert.strictEqual(tagOf(UI.sponsor('deals', true)), 'Sample ad', 'other boards still show samples');
  const off = pageUI({ __samples: { on: false, ads: ON.ads }, __rails: {}, __cards: {} });
  assert.deepStrictEqual([off.UI.sponsor('jobs', true).tag, tagOf(off.UI.sponsor('jobs', true)), tagOf(off.UI.adCard('job'))], ['button', 'Advertise with us', 'Advertise with us']);
  off.UI.rails('jobs');
  assert.strictEqual(tagOf(off.boxes['rail-r'].children[0]), 'Advertise with us');
  assert.strictEqual(off.boxes['rail-l'].children.length, 0, 'samples off: an unsold left margin stays empty');
  assert.strictEqual(off.UI.sponsor('jobs', false), null, 'no sample where the caller asks for no house unit');
});

test('still no ads on News, Police & courts or Obituaries; the page reads only the sample switch from sponsors.json', () => {
  assert.strictEqual(pageUI({ __samples: ON, __cards: {} }).UI.adCard('obit'), null);
  const calls = [...html.matchAll(/UI\.sponsor\(([^)]*)\)/g)].map(m => m[1]).sort();
  assert.deepStrictEqual(calls, ["'events', true", 'TABOF[kind], true']);
  assert.ok(html.includes("var spn = kind !== 'obit' && UI.sponsor(TABOF[kind], true);"));
  assert.ok(html.includes('body:not([data-ads]) .rail { display:none !important; }'), 'side ads, samples included, show only on the four ad tabs');
  assert.ok(html.includes("SPONSORS.__samples = sj && sj.samples ? sj.samples : null;"));
  const code = html.slice(html.indexOf('      sampleAd: function (cls, ad) {'), html.indexOf('      sample: function (offset)'));
  assert.ok(code.includes("a.href = '/advertise';") && !/ad\.url|\.rel|target/.test(code), 'the link is fixed, never from the file');
});

test('legal describes the placeholder sample ads honestly', () => {
  const legal = read('public/legal.html').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
  for (const s of ['some unsold spots show placeholder sample ads labeled “Sample ad”', 'The businesses in them are made up, not real advertisers', 'each one links only to our advertising page', 'A real, approved ad always takes the spot first', 'placeholder sample ads are labeled “Sample ad.”'])
    assert.ok(legal.includes(s), s);
  for (const ad of sponsors.samples.ads) assert.ok(!legal.includes(ad.name), 'no sample business is named in the policy');
});
