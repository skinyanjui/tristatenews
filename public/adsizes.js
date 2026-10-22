// Ad sizes (IAB standard units) for every placement, shared by the site (index.html), the upload page (creative.html),
// the Advertise page and the API (api/_creative.js validates per-size images with it).
//   SIZES        the units we use, each with the picture area it gets when the ad is built from one image and words
//   NOT_USED     common units we don't use, and why
//   rulesFor(p)  placement -> [{min, max, size}] by viewport width; sizeFor(p, vw); sizesFor(p); usedSizes()
//   cover()      object-fit: cover math (what part of an image shows in a box); check() warnings for an image at a size
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
    if (ad.img) { var im = el('img', 'ad-img'); im.src = ad.img; im.alt = ''; box.appendChild(im); }
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
  return { SIZES: SIZES, SAMPLE: SAMPLE, gallery: gallery, ORDER: ORDER, NOT_USED: NOT_USED, WHERE: WHERE, NEWS_BAR_MIN: NEWS_BAR_MIN, RAIL_MIN: RAIL_MIN, RAIL_WIDE: RAIL_WIDE,
    rulesFor: rulesFor, sizeFor: sizeFor, sizesFor: sizesFor, usedSizes: usedSizes, cover: cover, check: check, fullOk: fullOk, ratio: ratio,
    rules: rules, css: css, inject: inject, groupOf: groupOf, mark: mark, decorate: decorate, render: render, preview: preview, fit: fit, sampleImage: sampleImage, initials: initials };
});
