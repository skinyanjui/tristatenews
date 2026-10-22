// Ad sizes (public/adsizes.js): every placement maps to standard IAB units by screen width, each unit fits where it
// runs, images are cropped with object-fit: cover math, warnings for crop and resolution, and the previews render.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../public/adsizes.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('public/index.html');
const { PLACEMENTS } = require('../api/_creative.js');

test('size map: News 320x100 on phones and 728x90 from 768px; boards 300x250; side ads 160x600, 300x600 from 2560px', () => {
  const at = (p, vw) => S.sizeFor(p, vw);
  for (const vw of [320, 390, 767]) assert.equal(at('card:news', vw), '320x100', vw);
  for (const vw of [768, 1024, 1440, 1920, 2560]) assert.equal(at('card:news', vw), '728x90', vw);
  for (const b of ['jobs', 'deals', 'events', 'classifieds']) for (const vw of [320, 390, 1440, 2560]) assert.equal(at('card:' + b, vw), '300x250');
  assert.equal(at('rail:left', 1359), null, 'no side ads under 1360px');
  for (const vw of [1360, 1440, 1680, 1920, 2559]) assert.equal(at('rail:right', vw), '160x600', vw);
  assert.equal(at('rail:left', 2560), '300x600');
  for (const b of ['jobs', 'deals']) assert.deepEqual(S.rulesFor('line:' + b), [], 'the sponsor line is text, not a sized unit');
  assert.deepEqual(S.usedSizes(), ['728x90', '300x250', '320x100', '160x600', '300x600']);
  // every sized placement the API knows has a rule, and every rule is an IAB size we define
  for (const p of PLACEMENTS) if (!/^line:/.test(p)) assert.ok(S.sizesFor(p).length, p);
  for (const k of S.usedSizes()) { const z = S.SIZES[k]; assert.equal(k, z.w + 'x' + z.h); assert.ok(S.WHERE[k]); }
  assert.deepEqual(Object.keys(S.NOT_USED).sort(), ['120x600', '320x50', '970x250']);
  for (const k of Object.keys(S.NOT_USED)) assert.ok(!S.SIZES[k], k);
});

test('fit: each unit fits where it runs, with the page width tokens', () => {
  // News column: 960px max, 16px page padding each side; the 728 unit needs 768px of screen
  assert.ok(S.NEWS_BAR_MIN - 32 >= 728);
  assert.ok(390 - 32 >= 320, 'the phone banner fits a 390px phone');
  assert.ok(html.includes('--news-max:960px'));
  // board cells: 2 columns from 720px in a 960px page, 3 columns from 1920px in a 1440px page; a 300 unit fits each cell
  assert.ok((720 - 32 - 12) / 2 >= 300 && (1440 - 2 * 12) / 3 >= 300);
  // side ads: the rail width token matches the unit at each width, and page + both rails fit the screen
  const tok = { 1360: [960, 160, 24], 1440: [1056, 160, 24], 1680: [1280, 160, 24], 1920: [1440, 160, 32], 2560: [1760, 300, 48] };
  for (const [vw, [page, rail, gap]] of Object.entries(tok)) {
    assert.equal(S.SIZES[S.sizeFor('rail:left', Number(vw))].w, rail, vw);
    assert.ok(page + 2 * (rail + gap) <= Number(vw), vw);
  }
  assert.ok(html.includes(':root { --page-max:960px; --rail-w:160px; --rail-gap:24px;'));
  assert.ok(html.includes('@media (min-width:1440px) { :root { --page-max:1056px; } }'));
  assert.ok(!html.includes('--rail-w:120px'), '120x600 is gone: no mid-word wrapping in a 120px column');
});

test('cover(): object-fit cover crop math; check(): crop and resolution warnings with 2x recommendations', () => {
  const c = S.cover(1200, 600, 300, 150);
  assert.deepEqual([c.sx, c.sy, c.sw, c.sh, c.cut], [0, 0, 1200, 600, 0]);
  const sq = S.cover(1200, 600, 100, 100);
  assert.deepEqual([sq.sx, sq.sw, sq.sh], [300, 600, 600]); assert.equal(sq.cut, 0.5);
  const tall = S.cover(600, 1200, 300, 120);
  assert.equal(tall.sx, 0); assert.ok(tall.sy > 0);
  // a big 2:1 picture: fine in the 300x250 card (300x120 area), cropped a lot in the square phone-banner area
  assert.equal(S.check(1200, 600, '300x250').level, 'ok');
  const ph = S.check(1200, 600, '320x100');
  assert.equal(ph.level, 'warn'); assert.match(ph.warnings[0], /About 50% of the picture is cut off/); assert.deepEqual(ph.rec, { w: 200, h: 200 });
  // resolution: under 1x is blurry (bad), under 2x is soft (warn)
  const low = S.check(300, 150, '300x600');
  assert.equal(low.level, 'bad'); assert.ok(low.warnings.some(w => /blurry. Use at least 300×250 pixels; 600×500 is best/.test(w)));
  const soft = S.check(400, 200, '300x250');
  assert.equal(soft.level, 'warn'); assert.ok(soft.warnings.some(w => /600×240 pixels is best/.test(w)));
  // whole-unit banners: exact shape (3%), at least 1x
  assert.ok(S.fullOk(728, 90, '728x90') && S.fullOk(1456, 180, '728x90') && S.fullOk(300, 250, '300x250'));
  assert.ok(!S.fullOk(700, 87, '728x90') && !S.fullOk(728, 120, '728x90') && !S.fullOk(1456, 180, '970x250'));
  assert.equal(S.check(728, 90, '728x90', true).level, 'warn', '1x is soft on sharp screens');
  assert.equal(S.check(1456, 180, '728x90', true).level, 'ok');
  assert.match(S.check(800, 100, '300x250', true).warnings[0], /same shape \(6:5\): 300×250 or 600×500/);
  assert.equal(S.check(0, 10, '728x90'), null); assert.equal(S.check(100, 100, '970x250'), null);
});

test('css: one layout per size, by fixed size (previews) and by placement with media queries matching the size map', () => {
  const css = S.css();
  for (const k of S.usedSizes()) {
    const z = S.SIZES[k];
    assert.ok(css.includes('.tsz.tsz-k-' + k + ' { box-sizing:border-box; position:relative; overflow:hidden; display:grid; width:' + z.w + 'px; max-width:100%; height:' + z.h + 'px;'), k);
    assert.ok(css.includes('.tsz.tsz-k-' + k + ' > .ad-img { grid-area:img; display:block; width:' + z.img[0] + 'px; max-width:100%; height:' + z.img[1] + 'px; max-height:none; object-fit:cover;'), k + ' picture area');
  }
  assert.ok(css.includes('@media (max-width:767px) {\n  .tsz.tsz-p-news { box-sizing:border-box; position:relative; overflow:hidden; display:grid; width:320px;'));
  assert.ok(css.includes('@media (min-width:768px) {\n  .tsz.tsz-p-news { box-sizing:border-box; position:relative; overflow:hidden; display:grid; width:728px;'));
  assert.ok(css.includes('@media (min-width:1360px) and (max-width:2559px) {\n  .tsz.tsz-p-rail { box-sizing:border-box; position:relative; overflow:hidden; display:grid; width:160px;'));
  assert.ok(css.includes('@media (min-width:2560px) {\n  .tsz.tsz-p-rail { box-sizing:border-box; position:relative; overflow:hidden; display:grid; width:300px;'));
  assert.ok(css.includes('.tsz.tsz-p-board { box-sizing:border-box; position:relative; overflow:hidden; display:grid; width:300px;'));
  assert.ok(/hyphens:auto/.test(css) && /overflow-wrap:break-word/.test(css) && !/overflow-wrap:anywhere/.test(css), 'words hyphenate instead of breaking anywhere');
  assert.ok(/-webkit-line-clamp/.test(css), 'text is clamped so it stays inside the unit');
  assert.ok(css.includes('.tsz.tsz-k-728x90 > .ad-full.tsz-only-728x90 { display:block; position:absolute; inset:0; width:100%; height:100%; max-height:none; object-fit:cover;'));
  assert.ok(!/:has\([^)]*,/.test(css), 'no commas inside :has() (they would split the selector)');
});

// a tiny DOM for render()/preview()/gallery()/decorate()
function doc() {
  const mk = tag => {
    const n = { tagName: tag.toUpperCase(), className: '', children: [], attrs: {}, style: {}, textContent: '' };
    n.appendChild = c => { n.children.push(c); c.parentNode = n; return c; };
    n.setAttribute = (k, v) => { n.attrs[k] = String(v); }; n.getAttribute = k => n.attrs[k];
    n.classList = { add: c => { if (!n.className.split(' ').includes(c)) n.className = (n.className + ' ' + c).trim(); } };
    Object.defineProperty(n, 'firstChild', { get: () => n.children[0] });
    return n;
  };
  return { createElement: mk, createTextNode: t => ({ textContent: t }) };
}
const kids = n => n.children.map(c => (c.tagName || '#') + (c.className ? '.' + c.className.split(' ').join('.') : '') + (c.textContent ? ':' + c.textContent : ''));

test('render(): image + words laid out per size; a sample is labeled, a banner replaces the layout at its size', () => {
  const d = doc();
  const real = S.render(d, '728x90', { name: 'Fall sale', text: 'Boots 20% off', cta: 'Shop now', img: '/api/creative?img=cr0000000001' });
  assert.equal(real.className, 'tsz tsz-k-728x90 ad-card');
  assert.deepEqual(kids(real), ['SPAN.spon-tag:Sponsored', 'IMG.ad-img', 'B:Fall sale', 'SPAN.ad-tx:Boots 20% off', 'SPAN.rail-cta:Shop now']);
  const sky = S.render(d, '160x600', { name: 'Ninebark Bakehouse', sample: true, avatar: true });
  assert.equal(sky.className, 'tsz tsz-k-160x600 rail-ad rail-sky ad-sample');
  assert.deepEqual(kids(sky), ['SPAN.spon-tag:Sample ad', 'SPAN.bav:NB', 'B:Ninebark Bakehouse', 'SPAN.ad-tx.ad-note:A sample, not a real business. Your ad could be here.', 'SPAN.rail-cta:Learn more']);
  const ban = S.render(d, '300x250', { name: 'X', img: 'blob:a', full: { '300x250': 'blob:b', '728x90': 'blob:c' } });
  assert.equal(kids(ban).filter(k => /ad-full/.test(k)).length, 1, 'only the banner for this size');
  assert.equal(ban.children.at(-1).className, 'ad-full tsz-only-300x250');
  assert.equal(S.render(d, '970x250', {}), null);
  const fig = S.preview(d, '300x600', { name: 'Y' });
  assert.equal(fig.attrs['data-size'], '300x600');
  assert.equal(fig.children[1].children[0].textContent, 'Half page · 300×600');
  assert.equal(fig.children[1].children[1].textContent, 'Side ads, on screens 2560px and wider');
});

test('gallery(): every size with a made-up business (Sample ad, not a link) plus the sponsor line note; decorate() sizes page ads', () => {
  const d = doc(), box = d.createElement('div');
  S.gallery(d, box);
  const figs = box.children.filter(c => c.tagName === 'FIGURE');
  assert.deepEqual(figs.map(f => f.attrs['data-size']), ['728x90', '300x250', '320x100', '160x600', '300x600']);
  for (const f of figs) { const unit = f.children[0].children[0]; assert.equal(unit.tagName, 'DIV'); assert.equal(unit.children[0].textContent, 'Sample ad'); assert.equal(unit.attrs.role, 'img'); }
  assert.match(box.children.at(-1).textContent, /^Sponsor line: one line of text/);
  assert.match(S.sampleImage('Ninebark Bakehouse'), /^data:image\/svg\+xml;charset=utf-8,/);
  assert.ok(decodeURIComponent(S.sampleImage('Ninebark Bakehouse')).includes('>NB</text>'));
  // page ads: the class picks the layout by screen width; banners only for the sizes this placement uses
  const a = d.createElement('a');
  S.decorate(d, a, 'card:news', { name: 'Fall sale', img: '/api/creative?img=cr0000000001', sizes: ['728x90', '300x250'] });
  assert.equal(a.className, 'tsz tsz-p-news');
  assert.deepEqual(a.children.map(c => [c.className, c.src, c.loading, c.width, c.height]), [['ad-full tsz-only-728x90', '/api/creative?img=cr0000000001&size=728x90', 'lazy', 728, 90]]);
  const r = d.createElement('a'); S.mark(r, 'rail:right'); assert.equal(r.className, 'tsz tsz-p-rail');
  const l = d.createElement('a'); S.mark(l, 'line:jobs'); assert.equal(l.className, '', 'the sponsor line is not sized');
});

test('wiring: the site, the Advertise panel and the /advertise page use the same sizes and previews', () => {
  assert.ok(html.includes('<script src="/adsizes.js"></script>') && html.includes('if (window.TSNSizes) TSNSizes.inject(document);'));
  assert.ok(html.includes("var place = kind === 'news' ? 'card:news' : 'card:' + kind;"));
  assert.equal((html.match(/return UI\.sized\(/g) || []).length, 5, 'card: sample, sponsor and house; side ad: sponsor and house');
  assert.ok(html.includes("list = [UI.sized(sa, 'rail:left')]"), 'the side sample too');
  assert.ok(html.includes("var gal = TSNSizes.gallery(document, el('div', 'sn-sizes'))"), 'previews in the #advertise panel, where readers go while ADS_PAGE is off');
  const page = read('data/pages/advertise.html');
  assert.ok(page.includes('<h2 id="sizes">Ad sizes and where they run</h2>') && page.includes('<div id="size-previews"></div>'));
  assert.ok(page.includes('<script src="/adsizes.js"></script>') && page.includes('TSNSizes.gallery(document, box)'));
  assert.ok(page.indexOf('<script src="/adsizes.js"></script>') > page.indexOf('</main>'), 'after the page script');
});
