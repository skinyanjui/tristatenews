(function () {
  'use strict';

  // theme: follows the system until the reader picks one with the toggle
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var themePref = null;
  try { themePref = localStorage.getItem('tsn.theme'); } catch (e) {}
  var themeBtn = document.getElementById('themeBtn');
  function svg(d, extra) {
    var ns = 'http://www.w3.org/2000/svg', n = document.createElementNS(ns, 'svg');
    n.setAttribute('viewBox', '0 0 24 24'); n.setAttribute('aria-hidden', 'true');
    d.forEach(function (x) { var p = document.createElementNS(ns, x[0]); Object.keys(x[1]).forEach(function (k) { p.setAttribute(k, x[1][k]); }); n.appendChild(p); });
    return n;
  }
  // A short message at the bottom of the screen (screen readers hear it too).
  var toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) { toastEl = el('div', 'toast'); toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 2000);
  }
  // Heart and share side by side in the card's top-right corner (every card type uses this one row).
  function actRow(heartBtn, it) { var g = el('div', 'acts'); g.appendChild(heartBtn); g.appendChild(shareFor(it)); return g; }
  // The share button for a story or event, or nothing when it has no usable link.
  function shareFor(it) { var u = it.link ? safeHref(it.link) : '#'; return u === '#' ? document.createDocumentFragment() : UI.share(it.title, u); }
  function copyLink(url) {
    function old() {
      var t = el('textarea'); t.value = url; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      t.remove(); toast(ok ? 'Link copied' : 'Couldn\u2019t copy the link');
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(function () { toast('Link copied'); }, old);
    else old();
  }
  /* ---------- components: one place for the pieces every board and form reuses ---------- */
  var SPONSORS = null, PAY = { configured: false, prices: {} };
  if (window.TSNSizes) TSNSizes.inject(document); // ad units at IAB sizes (public/adsizes.js): News 728x90 / 320x100, boards 300x250, side ads 160x600 / 300x600
  // Ad counts (api/_adstats.js): a booked campaign's ad (it carries cid and pl) sends one "seen" when at least half of
  // it is on screen, once per page load, and one "click" per click. The beacon holds only the campaign and the spot:
  // no cookie, no ID, no page, nothing about the reader. Samples and our own house units are never counted.
  var adSeen = {}, adIO = null;
  function adBeacon(e, ad) {
    try { if (navigator.sendBeacon && !navigator.webdriver) navigator.sendBeacon('/api/adstats', JSON.stringify({ e: e, cid: ad.cid, pl: ad.pl })); } catch (_) { /* counting must never break the page */ }
  }
  function adCount(a, ad) {
    if (!ad.cid || !ad.pl || navigator.webdriver) return;
    a.addEventListener('click', function () { adBeacon('c', ad); });
    if (!('IntersectionObserver' in window)) return;
    if (!adIO) adIO = new IntersectionObserver(function (es) {
      es.forEach(function (x) {
        if (!x.isIntersecting || x.intersectionRatio < 0.5) return;
        adIO.unobserve(x.target);
        var o = x.target.__ad, k = o.cid + '|' + o.pl;
        if (!adSeen[k]) { adSeen[k] = 1; adBeacon('v', o); }
      });
    }, { threshold: 0.5 });
    a.__ad = { cid: ad.cid, pl: ad.pl }; adIO.observe(a);
  }
  var UI = (function () {
    var cv = document.createElement('canvas').getContext('2d'), pending = [];
    // A select is exactly as wide as its longest option (plus padding and the arrow), in every browser.
    function fit() {
      pending = pending.filter(function (sel) {
        if (!sel.isConnected) return true;
        var cs = getComputedStyle(sel); cv.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        var w = 0; Array.prototype.forEach.call(sel.options, function (o) { w = Math.max(w, cv.measureText(o.text).width); });
        var extra = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth) + 28;
        sel.style.width = Math.ceil(w + extra) + 'px';
        return false;
      });
      if (pending.length) requestAnimationFrame(fit);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { pending = pending.concat([].slice.call(document.querySelectorAll('select.ui-select'))); fit(); });
    return {
      // options: strings or {value, label}; blank adds an empty first option with that label.
      select: function (o) {
        var sel = el('select', 'ui-select');
        if (o.name) sel.name = o.name;
        if (o.id) sel.id = o.id;
        if (o.label) sel.setAttribute('aria-label', o.label);
        var opts = (o.blank ? [{ value: '', label: o.blank }] : []).concat((o.options || []).map(function (x) { return typeof x === 'string' ? { value: x, label: x } : x; }));
        opts.forEach(function (x) { var op = el('option', null, x.label); op.value = x.value; if (o.value === x.value) op.selected = true; sel.appendChild(op); });
        if (o.onChange) sel.addEventListener('change', function () { o.onChange(sel.value); });
        pending.push(sel); requestAnimationFrame(fit);
        return sel;
      },
      chip: function (label, on, onClick) {
        var x = el('button', 'cl-chip', label); x.type = 'button'; x.setAttribute('aria-pressed', String(!!on)); x.addEventListener('click', onClick); return x;
      },
      // A scrolling row of single-choice chips. items: [{value, label}], active: the current value.
      chipRow: function (items, active, onPick, aria) {
        var row = el('div', 'cl-chips'); if (aria) { row.setAttribute('role', 'group'); row.setAttribute('aria-label', aria); }
        items.forEach(function (it) { row.appendChild(UI.chip(it.label, it.value === active, function () { onPick(it.value); })); });
        return row;
      },
      // An approved ad's link: rel="sponsored", a new tab for web links (not for tel:), "Sponsored" first, and its
      // still image (served by /api/creative, lazy-loaded, the headline as alt text) when it has one.
      adLink: function (cls, ad) {
        var a = el('a', cls); a.href = ad.url; a.rel = 'sponsored noopener noreferrer';
        if (/^https:/i.test(ad.url)) a.target = '_blank';
        // No aria-label: the link is named by what it shows ("Sponsored", the name, the words), so the spoken name and
        // the visible text match (axe label-content-name-mismatch, audit 2026-10-22).
        a.appendChild(el('span', 'spon-tag', 'Sponsored'));
        if (ad.img) { var im = el('img', 'ad-img'); im.src = ad.img; im.alt = ad.name; im.loading = 'lazy'; im.decoding = 'async'; if (ad.w && ad.h) { im.width = ad.w; im.height = ad.h; } a.appendChild(im); }
        if (typeof adCount === 'function') adCount(a, ad); // count a booked campaign's ad (see adCount)
        return a;
      },
      // A placeholder sample ad (sponsors.json "samples", while the spot is unsold): a made-up business, labeled
      // "Sample ad" so it can't pass for a real advertiser, linking only to our /advertise page.
      sampleAd: function (cls, ad) {
        var a = el('a', cls + ' ad-sample'); a.href = '/advertise';
        a.appendChild(el('span', 'spon-tag', 'Sample ad'));
        return a;
      },
      sample: function (offset) { return window.TSNAds && SPONSORS ? TSNAds.sample(SPONSORS.__samples, offset, Date.now()) : null; },
      // A tall ad for the side margins on wide screens. A real ad (an approved creative) is labeled "Sponsored" and its link
      // is rel="sponsored". An unsold margin shows our own house unit instead: labeled "Advertise with us", it names no
      // business, price or number, and opens the advertising inquiry form.
      railAd: function (ad) {
        if (!ad) { var h = el('button', 'rail-ad rail-house'); h.type = 'button'; h.appendChild(el('span', 'spon-tag', 'Advertise with us')); h.appendChild(el('b', null, 'Your business here')); h.appendChild(el('span', 'rail-tx', 'Advertise with Tri-State News.')); h.appendChild(el('span', 'rail-cta', 'Learn more')); h.addEventListener('click', openAd); return UI.sized(h, 'rail:left'); }
        if (!window.TSNAds || !TSNAds.validAd(ad)) return null;
        var a = UI.adLink('rail-ad', ad);
        if (!ad.img) a.appendChild(bizAvatar(ad.name, '')); a.appendChild(el('b', null, ad.name));
        if (ad.text) a.appendChild(el('span', 'rail-tx', ad.text)); a.appendChild(el('span', 'rail-cta', ad.cta || 'Learn more'));
        return UI.sized(a, 'rail:left', ad);
      },
      // Side ads (public/adslots.js railFill): tall, vertical units in the margins on wide screens, only on the board tabs
      // (Events, Jobs, Deals, Classifieds). News (with Police & courts) and Obituaries get none: railFill answers null.
      rails: function (tab) {
        var cfg = (SPONSORS && SPONSORS.__rails) || {};
        [['rail-l', 'left'], ['rail-r', 'right']].forEach(function (r) {
          var box = document.getElementById(r[0]); box.textContent = '';
          var f = window.TSNAds ? TSNAds.railFill(tab, r[1], cfg[r[1]], Date.now(), SPONSORS && SPONSORS.__samples) : null;
          if (!f || f.type === 'none') return;
          var list = [];
          if (f.type === 'direct') list = f.ads.map(function (x) { return UI.railAd(x); }).filter(Boolean); // the top spot takes turns
          else if (f.type === 'sample') { var sm = f.ad, sa = UI.sampleAd('rail-ad rail-sky', sm); sa.appendChild(bizAvatar(sm.name, '')); sa.appendChild(el('b', null, sm.name)); if (sm.text) sa.appendChild(el('span', 'rail-tx', sm.text)); sa.appendChild(el('span', 'rail-tx ad-note', 'A sample, not a real business. Your ad could be here.')); sa.appendChild(el('span', 'rail-cta', 'Advertise here')); list = [UI.sized(sa, 'rail:left')]; }
          else list = [UI.railAd(null)];
          list.forEach(function (x) { box.appendChild(x); });
        });
      },
      // The one heart used everywhere. get(): {on, n, label}; toggle(): flips it. Same size and look on every card.
      heart: function (o) {
        var b = el('button', 'like'); b.type = 'button';
        var cnt = el('span');
        function paint() {
          var s = o.get();
          b.setAttribute('aria-pressed', String(s.on));
          b.setAttribute('aria-label', (s.on ? 'Unlike: ' : 'Like: ') + s.label + (s.n ? ' (' + s.n + ' like' + (s.n === 1 ? '' : 's') + ')' : ''));
          cnt.textContent = s.n > 0 ? String(s.n) : '';
        }
        b.appendChild(svg([['path', { d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' }]]));
        b.appendChild(cnt);
        paint();
        b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); o.toggle(); if (o.after) o.after(); else paint(); });
        b.paint = paint;
        return b;
      },
      // Share a story's original link: the phone's share sheet when there is one, otherwise copy it and say so.
      // Never opens the card underneath.
      share: function (title, url) {
        var b = el('button', 'share'); b.type = 'button';
        b.setAttribute('aria-label', 'Share: ' + title); b.title = 'Share';
        b.appendChild(svg([['circle', { cx: 18, cy: 5, r: 3 }], ['circle', { cx: 6, cy: 12, r: 3 }], ['circle', { cx: 18, cy: 19, r: 3 }], ['path', { d: 'M8.6 13.5l6.8 4M15.4 6.5l-6.8 4' }]]));
        b.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          var data = { title: title, url: url };
          if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
            navigator.share(data).catch(function (err) { if (!err || err.name !== 'AbortError') copyLink(url); });
          } else copyLink(url);
        });
        return b;
      },
      // A label pill. o: {label, icon (svg parts), tone: 'over'|'feat'|'red', dot}
      pill: function (o) {
        var p = el('span', 'pill' + (o.tone ? ' pill-' + o.tone : '') + (o.hue ? ' pill-hue' : ''));
        if (o.hue) p.style.setProperty('--c', 'var(--h-' + o.hue + ')');
        if (o.icon) p.appendChild(svg(o.icon));
        if (o.dot) p.appendChild(el('i'));
        p.appendChild(document.createTextNode(o.label));
        return p;
      },
      badge: function (label) { return UI.pill({ label: label, tone: 'feat' }); },
      // A sponsor line for a board: a real sponsor (labeled "Sponsored", rel="sponsored"), or, when the slot is open,
      // our own house unit ("Advertise with us", no business, price or number), which opens the inquiry form.
      sponsor: function (slot, houseAd) {
        var sp = window.TSNAds && SPONSORS ? TSNAds.pick(SPONSORS[slot], Date.now()) : null;
        if (sp) {
          var a = UI.adLink('spon', sp);
          a.appendChild(el('b', null, sp.name)); if (sp.text) a.appendChild(el('span', null, sp.text));
          return a;
        }
        if (!houseAd) return null;
        var sm = window.TSNAds ? UI.sample((TSNAds.OFFSET[slot] || 0) + 1) : null;
        if (sm) { var s2 = UI.sampleAd('spon', sm); s2.appendChild(el('b', null, sm.name)); if (sm.text) s2.appendChild(el('span', null, sm.text)); s2.appendChild(el('span', 'sr-only', 'A sample, not a real business.')); s2.appendChild(el('b', null, 'Advertise here')); return s2; }
        var h = el('button', 'spon spon-house'); h.type = 'button';
        h.appendChild(el('span', 'spon-tag', 'Advertise with us')); h.appendChild(el('span', null, 'Your business here, advertise with Tri-State News.')); h.appendChild(el('b', null, 'Learn more'));
        h.addEventListener('click', openAd);
        return h;
      },
      // The in-listing ad card for a board (public/adslots.js decides where it may go and what fills it). A direct
      // sponsor is labeled "Sponsored" and linked rel="sponsored" (https only); an unsold slot holds our own
      // "Advertise with us" unit, which opens the inquiry form. Same for every reader: nothing about the reader is used.
      // The News in-feed card: a real campaign (card:news) or, while unsold, a sample ad; nothing otherwise (no house unit
      // in the feed). Same markup and spacing as the boards' in-listing card.
      newsAd: function () {
        var f = window.TSNAds ? TSNAds.fill('news', SPONSORS && SPONSORS.__cards, Date.now(), SPONSORS && SPONSORS.__samples) : null;
        if (!f || f.type === 'house') return null;
        var c = UI.adCard('news'); if (c) c.classList.add('ad-feed');
        return c;
      },
      adCard: function (kind) {
        var place = kind === 'news' ? 'card:news' : 'card:' + kind;
        var f = window.TSNAds ? TSNAds.fill(kind, SPONSORS && SPONSORS.__cards, Date.now(), SPONSORS && SPONSORS.__samples) : null;
        if (!f) return null;
        if (f.type === 'sample') {
          var sa = UI.sampleAd('ad-card', f.ad); sa.appendChild(el('b', null, f.ad.name));
          if (f.ad.text) sa.appendChild(el('span', 'ad-tx', f.ad.text));
          sa.appendChild(el('span', 'ad-tx ad-note', 'A sample, not a real business. Your ad could be here.')); sa.appendChild(el('span', 'rail-cta', 'Advertise here'));
          return UI.sized(sa, place);
        }
        if (f.type === 'direct') {
          var ad = f.ad, a = UI.adLink('ad-card', ad);
          a.appendChild(el('b', null, ad.name));
          if (ad.text) a.appendChild(el('span', 'ad-tx', ad.text)); a.appendChild(el('span', 'rail-cta', ad.cta || 'Learn more'));
          return UI.sized(a, place, ad);
        }
        var h = el('button', 'ad-card ad-house'); h.type = 'button';
        h.appendChild(el('span', 'spon-tag', 'Advertise with us')); h.appendChild(el('b', null, 'Your business here'));
        h.appendChild(el('span', 'ad-tx', 'Advertise with Tri-State News.')); h.appendChild(el('span', 'rail-cta', 'Learn more'));
        h.addEventListener('click', openAd);
        return UI.sized(h, place);
      },
      // Size an ad for its placement (public/adsizes.js: the unit follows the screen width; an approved ad's own
      // banner for a size, when it has one, replaces the image-and-words layout at that size).
      sized: function (node, place, ad) { return window.TSNSizes && node ? TSNSizes.decorate(document, node, place, ad) : node; },
      notice: function (text) {
        var n = el('div', 'notice'); n.setAttribute('role', 'status'); n.appendChild(el('span', null, text));
        var x = UI.button('\u00d7', null, function () { n.remove(); }); x.setAttribute('aria-label', 'Dismiss'); n.appendChild(x);
        var m = document.querySelector('main'); m.insertBefore(n, m.firstChild); setTimeout(function () { n.remove(); }, 12000);
      },
      button: function (label, cls, onClick) { var b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; }
    };
  })();
  var SUN = [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2v2' }], ['path', { d: 'M12 20v2' }], ['path', { d: 'm4.93 4.93 1.41 1.41' }], ['path', { d: 'm17.66 17.66 1.41 1.41' }], ['path', { d: 'M2 12h2' }], ['path', { d: 'M20 12h2' }], ['path', { d: 'm6.34 17.66-1.41 1.41' }], ['path', { d: 'm19.07 4.93-1.41 1.41' }]];
  var MOON = [['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }]];
  /* clock: local time for the Tri-State (Central), updated on the minute */
  var clkEl = document.getElementById('clk');
  function tickClock() {
    var d = new Date(), z = 'America/Chicago';
    var t = d.toLocaleTimeString('en-US', { timeZone: z, hour: 'numeric', minute: '2-digit' });
    var zone = (d.toLocaleTimeString('en-US', { timeZone: z, timeZoneName: 'short' }).match(/[A-Z]{3,4}$/) || [''])[0];
    var day = d.toLocaleDateString('en-US', { timeZone: z, weekday: 'short', month: 'short', day: 'numeric' });
    clkEl.textContent = '';
    clkEl.appendChild(document.createTextNode(t));
    clkEl.appendChild(el('small', null, zone + ' · ' + day));
    clkEl.setAttribute('datetime', d.toISOString());
    setTimeout(tickClock, 60000 - (Date.now() % 60000) + 50);
  }
  tickClock();
  function isDark() { return themePref ? themePref === 'dark' : mq.matches; }
  function applyTheme() {
    var dark = isDark();
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    themeBtn.textContent = '';
    themeBtn.appendChild(svg(dark ? SUN : MOON));
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }
  themeBtn.addEventListener('click', function () {
    themePref = isDark() ? 'light' : 'dark';
    try { localStorage.setItem('tsn.theme', themePref); } catch (e) {}
    applyTheme();
  });
  applyTheme();
  if (mq.addEventListener) mq.addEventListener('change', applyTheme);

  var HOUR = 60 * 60 * 1000;
  var PAGE = 24;
  var state = { sf: 'all', srl: PAGE, items: [], sources: [], loaded: false, error: false, updatedAt: null, fetchedAt: 0, q: '', cat: 'news', limit: PAGE, saved: [], alerts: [], official: [], brk: { top: null, more: 0 }, counts: {}, shared: false };
  // Tab URLs (public/routes.js): a direct load of /events, /jobs ... opens that tab; /, /news and /police-courts open News.
  var RT = window.TSNRoutes || null, ROUTE_SYNCED = false;
  (function () { var r = RT && RT.byPath(location.pathname); if (r) state.cat = r.cat; })();
  /* ---------- geography scope ----------
     The reader feed is always the Tri-State view: there is no area picker (the Area button and its sheet were removed
     in ship59). A county or state page (/news/kentucky/henderson, REGIONAL_ROUTES_ENABLED) still sets the scope from its
     path, and /api/news?scope= stays for those pages and the admin tools. The picker used to save the reader's area in
     localStorage (tsn.scope, tsn.myCounties); clear both so a returning reader is never stuck on an old county view. */
  var SC = { key: 'tristate', on: false, routes: false, geo: null, info: null };
  try { localStorage.removeItem('tsn.scope'); localStorage.removeItem('tsn.myCounties'); } catch (e) {}
  (function () { var g = RT && RT.geo && RT.geo(location.pathname); if (g) { SC.geo = g.path; SC.key = g.scope; state.cat = 'news'; } })();
  // Old links to the removed All tab and Liked page (#all, #liked, ?tab=all, ?tab=liked) open News; drop the old part.
  (function () {
    if (!RT || !RT.OLD_TABS) return;
    var h = location.hash.replace(/^#\/?/, '').toLowerCase(), sp = /[?&]tab=([^&#]*)/i.exec(location.search), t = sp ? decodeURIComponent(sp[1]).toLowerCase() : '';
    var oldH = !!RT.OLD_TABS[h], oldT = !!RT.OLD_TABS[t];
    if (!oldH && !oldT) return;
    state.cat = 'news';
    var q = oldT ? location.search.replace(/([?&])tab=[^&#]*&?/i, '$1').replace(/[?&]$/, '') : location.search;
    try { history.replaceState(history.state, '', '/' + q + (oldH ? '' : location.hash)); } catch (e) {}
  })();
  try { var sv = JSON.parse(localStorage.getItem('tsn.saved') || '[]'); if (Array.isArray(sv)) state.saved = sv.filter(function (x) { return x && x.link && x.title; }); } catch (e) {}
  function storyId(link) { // short stable id from the story link (cyrb53)
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < link.length; i++) { var c = link.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 'h' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  var uid = null;
  try { uid = localStorage.getItem('tsn.uid'); if (!uid) { uid = 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('tsn.uid', uid); } } catch (e) {}
  if (!uid) uid = 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  function likeCount(it) {
    if (state.shared) return state.counts[storyId(it.link)] || 0;
    return isSaved(it.link) ? 1 : 0;
  }
  function persistSaved() { try { localStorage.setItem('tsn.saved', JSON.stringify(state.saved.slice(0, 200))); } catch (e) {} }
  function isSaved(link) { return state.saved.some(function (x) { return x.link === link; }); }
  function toggleSaved(it) {
    if (isSaved(it.link)) state.saved = state.saved.filter(function (x) { return x.link !== it.link; });
    else state.saved.unshift({ title: it.title, link: it.link, summary: it.summary || '', image: it.image || '', published: it.published, source: it.source, sourceId: it.sourceId });
    persistSaved();
    var on = isSaved(it.link), id = storyId(it.link);
    if (state.shared) {
      state.counts[id] = Math.max(0, (state.counts[id] || 0) + (on ? 1 : -1));
      fetch('/api/react', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id, uid: uid, liked: on }) })
        .then(function (r) { return r.json(); }).then(function (d) { if (d && typeof d.count === 'number') { state.counts[id] = d.count; render(); } })
        .catch(function () {});
    }
  }
  function loadCounts() {
    var ids = state.items.map(function (i) { return storyId(i.link); }).concat(state.saved.map(function (i) { return storyId(i.link); }));
    ids = ids.filter(function (x, k) { return ids.indexOf(x) === k; }).slice(0, 300);
    if (!ids.length) return;
    fetch('/api/react?ids=' + ids.join(','), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      state.shared = !!(d && d.configured); state.counts = (d && d.counts) || {};
      render();
    }).catch(function () {});
  }
  function kindOf(id) { var s = state.sources.filter(function (x) { return x.id === id; })[0]; return s && s.kind ? s.kind : 'news'; }
  var CATS = [
    { id: 'news', label: 'News' },
    { id: 'institution', label: 'Institutions' },
    { id: 'events', label: 'Events' },
    { id: 'obits', label: 'Obituaries' },
    { id: 'jobs', label: 'Jobs' },
    { id: 'deals', label: 'Deals' },
    { id: 'classifieds', label: 'Classifieds' }
  ];
  function inCat(it, cat) {
    var k = kindOf(it.sourceId);
    if (cat === 'deals') return false;
    if (cat === 'events' || cat === 'jobs') return false;
    // News (the landing tab, and since the Police & courts tab was merged into it the only home of official police and
    // court items) merges news outlets with Police & courts items, in the feed's time order. Those cards keep
    // their rules here too (makeCard decides by source kind): no photos, and "Charged or arrested, not convicted."
    if (cat === 'news') return k === 'news' || k === 'police' || k === 'courts';
    return k === cat;
  }
  function filtered() {
    var base = state.items.filter(function (i) { return inCat(i, state.cat); });
    var q = state.q.trim().toLowerCase();
    if (q) {
      var words = q.split(/\s+/);
      base = base.filter(function (i) {
        var hay = (i.title + ' ' + (i.summary || '') + ' ' + i.source).toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      });
    }
    return base;
  }
  function resetPaging() { state.limit = PAGE; }
  // A story counts as breaking only when the outlet itself labels it so, and only for 3 hours.
  var BREAKING_RE = /^\s*(breaking( news)?|just in|developing story|news alert)\b|\bbreaking( news)?\s*[:|\u2013\u2014-]|[\[(]breaking[\])]/i;
  function isBreaking(it) {
    if (it.breaking !== true && !BREAKING_RE.test(it.title)) return false;
    var t = Date.parse(it.published);
    return !isNaN(t) && Date.now() - t <= 3 * 3600 * 1000;
  }
  // One Breaking slot (public/breaking.js): official alerts from /api/alerts, NWS alerts for the chosen weather
  // location, official Police & courts items that match an alert tier, and outlet-labeled breaking stories (tier 7).
  // Highest tier wins, newest inside a tier; only that one item is shown.
  var BK = window.TSNBreaking || null;
  function breakingPick() {
    var now = Date.now(), c = [];
    if (BK) {
      state.official.forEach(function (a) { if (a && a.key) c.push(a); });
      state.alerts.forEach(function (p) { var a = BK.fromNws(p); if (a) c.push(a); });
    }
    state.items.forEach(function (it) {
      var k = kindOf(it.sourceId); if (k === 'events' || k === 'obits') return;
      var t = Date.parse(it.published); if (isNaN(t)) return;
      var hit = BK && (k === 'police' || k === 'courts') ? BK.classifyOfficial(it) : null; // keyword tiers: official sources only
      if (hit) c.push({ key: 'it:' + (it.id || it.link), kind: 'story', official: true, tier: hit.tier, label: hit.label, start: t, end: null, item: it });
      else if (isBreaking(it)) c.push({ key: 'it:' + (it.id || it.link), kind: 'story', tier: 7, label: '', start: t, end: null, item: it });
    });
    if (BK) return BK.pick(c, now);
    var s = c.filter(function (x) { return now - x.start <= 3 * 3600 * 1000; }).sort(function (a, b) { return b.start - a.start; });
    return { top: s[0] || null, more: Math.max(0, s.length - 1) };
  }
  function brkUntil(b) { return BK && b && b.end != null ? BK.untilText(b.end) : ''; }
  // An official alert drawn with the same card as a story (no picture; links to the official page).
  function alertItem(b) { return { id: b.key, title: b.title, summary: b.summary || '', link: b.link, source: b.source, sourceId: b.sourceId || 'alert', published: b.start ? new Date(b.start).toISOString() : '', image: '' }; }

  // "By posting, you agree to our Terms of Use and Privacy Policy." with real links.
  // Required "18 or older" checkbox for community posts, folded into the Terms/Privacy line. F.adult in the forms.
  function ageConsent() {
    var w = el('div', 'cl-adult'), i = el('input'); i.type = 'checkbox'; i.id = 'f-adult' + (++uidSeq); i.name = 'adult'; i.required = true;
    var l = el('label', 'cl-check'); l.setAttribute('for', i.id); l.appendChild(i);
    var tx = el('span'); tx.appendChild(document.createTextNode('I’m 18 or older, and I agree to the '));
    var t = el('a', null, 'Terms of Use'); t.href = '/legal#terms'; t.target = '_blank'; tx.appendChild(t);
    tx.appendChild(document.createTextNode(' and ')); var v = el('a', null, 'Privacy Policy'); v.href = '/legal#privacy'; v.target = '_blank'; tx.appendChild(v);
    tx.appendChild(document.createTextNode('.')); l.appendChild(tx);
    var fe = el('div', 'cl-fe'); fe.setAttribute('role', 'alert'); fe.id = i.id + '-err'; i.setAttribute('aria-describedby', fe.id);
    w.appendChild(l); w.appendChild(fe); w.input = i;
    w.err = function (m) { fe.textContent = m || ''; if (m) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid'); };
    return w;
  }
  function legalNote(lead) {
    var p = el('p', 'cl-note'); p.appendChild(document.createTextNode(lead + ', you agree to our '));
    var t = el('a', null, 'Terms of Use'); t.href = '/legal#terms'; t.target = '_blank'; p.appendChild(t);
    p.appendChild(document.createTextNode(' and ')); var v = el('a', null, 'Privacy Policy'); v.href = '/legal#privacy'; v.target = '_blank'; p.appendChild(v);
    p.appendChild(document.createTextNode('.')); return p;
  }
  function el(tagName, cls, text) {
    var n = document.createElement(tagName);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function safeHref(u) {
    try { var x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : '#'; } catch (e) { return '#'; }
  }

  function timeAgo(iso) {
    if (!iso || isNaN(Date.parse(iso))) return '';
    var d = new Date(iso), z = 'America/Chicago';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: z }) + ' · ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: z });
  }

  /* ---------- weather (Open-Meteo) ---------- */
  var LOCS = [
    { name: 'Evansville, IN', lat: 37.9716, lon: -87.5711 },
    { name: 'Henderson, KY', lat: 37.8361, lon: -87.59 },
    { name: 'Owensboro, KY', lat: 37.7742, lon: -87.1133 },
    { name: 'Madisonville, KY', lat: 37.3281, lon: -87.4986 },
    { name: 'Vincennes, IN', lat: 38.6773, lon: -87.5286 },
    { name: 'Jasper, IN', lat: 38.3914, lon: -86.9311 },
    { name: 'Mt. Vernon, IN', lat: 37.9323, lon: -87.895 },
    { name: 'Carbondale, IL', lat: 37.7273, lon: -89.2168 },
    { name: 'Marion, IL', lat: 37.7306, lon: -88.9331 },
    { name: 'Albion, IL', lat: 38.3786, lon: -88.0575 },
    { name: 'Anna, IL', lat: 37.4603, lon: -89.2468 },
    { name: 'Beaver Dam, KY', lat: 37.4011, lon: -86.8756 },
    { name: 'Benton, IL', lat: 37.9965, lon: -88.9201 },
    { name: 'Boonville, IN', lat: 38.0492, lon: -87.2742 },
    { name: 'Calhoun, KY', lat: 37.5387, lon: -87.2619 },
    { name: 'Cannelton, IN', lat: 37.9111, lon: -86.744 },
    { name: 'Carmi, IL', lat: 38.0906, lon: -88.1584 },
    { name: 'Cave-In-Rock, IL', lat: 37.4692, lon: -88.1636 },
    { name: 'Central City, KY', lat: 37.2923, lon: -87.1233 },
    { name: 'Chandler, IN', lat: 38.0289, lon: -87.3686 },
    { name: 'Clay, KY', lat: 37.4756, lon: -87.8228 },
    { name: 'Cobden, IL', lat: 37.5334, lon: -89.2531 },
    { name: 'Corydon, KY', lat: 37.7426, lon: -87.7156 },
    { name: 'Dixon, KY', lat: 37.5156, lon: -87.6919 },
    { name: 'Du Quoin, IL', lat: 38.0112, lon: -89.2362 },
    { name: 'Earlington, KY', lat: 37.2711, lon: -87.5122 },
    { name: 'Eldorado, IL', lat: 37.8109, lon: -88.447 },
    { name: 'Fairfield, IL', lat: 38.3787, lon: -88.3598 },
    { name: 'Ferdinand, IN', lat: 38.2253, lon: -86.8678 },
    { name: 'Fort Branch, IN', lat: 38.2523, lon: -87.5836 },
    { name: 'Golconda, IL', lat: 37.3689, lon: -88.4881 },
    { name: 'Grayville, IL', lat: 38.257, lon: -87.9967 },
    { name: 'Greenville, KY', lat: 37.2042, lon: -87.1639 },
    { name: 'Harrisburg, IL', lat: 37.7384, lon: -88.5406 },
    { name: 'Hartford, KY', lat: 37.4519, lon: -86.9097 },
    { name: 'Haubstadt, IN', lat: 38.2072, lon: -87.5719 },
    { name: 'Hawesville, KY', lat: 37.9017, lon: -86.7525 },
    { name: 'Herrin, IL', lat: 37.8031, lon: -89.0287 },
    { name: 'Huntingburg, IN', lat: 38.2978, lon: -86.9556 },
    { name: 'Johnston City, IL', lat: 37.8209, lon: -88.9234 },
    { name: 'Lawrenceville, IL', lat: 38.7303, lon: -87.6828 },
    { name: 'Linton, IN', lat: 39.0342, lon: -87.1658 },
    { name: 'Lynnville, IN', lat: 38.1992, lon: -87.3153 },
    { name: 'Marion, KY', lat: 37.3331, lon: -88.0817 },
    { name: 'McLeansboro, IL', lat: 38.0956, lon: -88.5384 },
    { name: 'Morganfield, KY', lat: 37.6842, lon: -87.9167 },
    { name: 'Mt. Carmel, IL', lat: 38.4109, lon: -87.7614 },
    { name: 'Mt. Vernon, IL', lat: 38.3173, lon: -88.9031 },
    { name: 'Murphysboro, IL', lat: 37.7645, lon: -89.3351 },
    { name: 'New Harmony, IN', lat: 38.1281, lon: -87.9372 },
    { name: 'Newburgh, IN', lat: 37.9445, lon: -87.4047 },
    { name: 'Olney, IL', lat: 38.7309, lon: -87.7456 },
    { name: 'Petersburg, IN', lat: 38.4917, lon: -87.2786 },
    { name: 'Poseyville, IN', lat: 38.1717, lon: -87.7886 },
    { name: 'Princeton, IN', lat: 38.3553, lon: -87.5681 },
    { name: 'Princeton, KY', lat: 37.1086, lon: -87.8761 },
    { name: 'Providence, KY', lat: 37.3978, lon: -87.7456 },
    { name: 'Robinson, IL', lat: 39.0058, lon: -87.7389 },
    { name: 'Rockport, IN', lat: 37.8828, lon: -87.0486 },
    { name: 'Santa Claus, IN', lat: 38.1203, lon: -86.9125 },
    { name: 'Sebree, KY', lat: 37.6089, lon: -87.5333 },
    { name: 'Shawneetown, IL', lat: 37.7117, lon: -88.1359 },
    { name: 'Sturgis, KY', lat: 37.547, lon: -87.9753 },
    { name: 'Sullivan, IN', lat: 39.0956, lon: -87.4086 },
    { name: 'Tell City, IN', lat: 37.9514, lon: -86.7678 },
    { name: 'Uniontown, KY', lat: 37.7714, lon: -87.9303 },
    { name: 'Vienna, IL', lat: 37.4153, lon: -88.8975 },
    { name: 'Washington, IN', lat: 38.6592, lon: -87.1728 },
    { name: 'West Frankfort, IL', lat: 37.8978, lon: -88.9312 }
  ];
  var wxLoc = LOCS[0];
  try { var saved = JSON.parse(localStorage.getItem('wxLoc') || 'null'); if (saved && typeof saved.lat === 'number' && typeof saved.lon === 'number' && saved.name) wxLoc = saved; } catch (e) {}
  function wxUrl(l) {
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + l.lat + '&longitude=' + l.lon +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=5';
  }
  function wxText(c) {
    if (c === 0) return 'Clear';
    if (c === 1) return 'Mostly clear';
    if (c === 2) return 'Partly cloudy';
    if (c === 3) return 'Overcast';
    if (c === 45 || c === 48) return 'Fog';
    if (c >= 51 && c <= 57) return 'Drizzle';
    if (c >= 61 && c <= 65) return 'Rain';
    if (c === 66 || c === 67) return 'Freezing rain';
    if (c >= 71 && c <= 77) return 'Snow';
    if (c >= 80 && c <= 82) return 'Showers';
    if (c === 85 || c === 86) return 'Snow showers';
    if (c >= 95) return 'Thunderstorms';
    return 'Weather';
  }
  var wxBtn = document.getElementById('wxBtn');
  var wxPop = document.getElementById('wxPop');

  function shortName(n) { return n.split(',')[0]; }
  function setLoc(l) {
    wxLoc = l;
    try { localStorage.setItem('wxLoc', JSON.stringify(l)); } catch (e) {}
    loadWeather();
  }
  function showPicker() {
    wxPop.textContent = '';
    var search = el('input', 'wx-search');
    search.type = 'search'; search.placeholder = 'Search for a city'; search.setAttribute('aria-label', 'Search for a city');
    var list = el('div', 'wx-pick');
    function fill(items) {
      list.textContent = '';
      items.forEach(function (l) {
        var b = el('button'); b.type = 'button';
        b.appendChild(el('span', null, l.name));
        if (l.name === wxLoc.name) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', function (e) { e.stopPropagation(); setLoc(l); });
        list.appendChild(b);
      });
    }
    fill(LOCS);
    var timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      var q = search.value.trim();
      if (q.length < 2) { fill(LOCS); return; }
      var ql = q.toLowerCase(), hit = LOCS.filter(function (l) { return l.name.toLowerCase().indexOf(ql) >= 0; });
      if (hit.length) { fill(hit); return; }
      timer = setTimeout(function () {
        fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=' + encodeURIComponent(q))
          .then(function (r) { return r.json(); }).then(function (g) {
            var res = (g.results || []).filter(function (x) { return x.country_code === 'US'; }).map(function (x) {
              return { name: x.name + (x.admin1 ? ', ' + x.admin1 : ''), lat: x.latitude, lon: x.longitude };
            });
            if (res.length) fill(res); else { list.textContent = ''; list.appendChild(el('div', 'wx-note', 'No U.S. places match “' + q + '”.')); }
          }).catch(function () { list.textContent = ''; list.appendChild(el('div', 'wx-note', 'Search is unavailable right now.')); });
      }, 250);
    });
    search.addEventListener('click', function (e) { e.stopPropagation(); });
    wxPop.appendChild(search);
    wxPop.appendChild(list);
    search.focus();
  }

  function loadWeather() {
    loadAlerts();
    fetch(wxUrl(wxLoc)).then(function (r) { if (!r.ok) throw new Error('wx'); return r.json(); }).then(function (w) {
      var cur = w.current, dly = w.daily;
      wxBtn.disabled = false;
      wxBtn.setAttribute('aria-label', Math.round(cur.temperature_2m) + '°F ' + shortName(wxLoc.name) + '. Weather in ' + wxLoc.name + '. Change location');
      wxBtn.textContent = '';
      wxBtn.appendChild(el('span', 'wx-temp', Math.round(cur.temperature_2m) + '°F'));
      wxBtn.appendChild(document.createTextNode(' ')); // so the visible text reads "72°F Evansville", as the label starts
      wxBtn.appendChild(el('span', 'wx-cond', shortName(wxLoc.name)));

      wxPop.textContent = '';
      var loc = el('div', 'wx-loc');
      loc.appendChild(el('b', null, wxLoc.name));
      var chg = el('button', 'chg', 'Change'); chg.type = 'button';
      chg.addEventListener('click', function (e) { e.stopPropagation(); showPicker(); });
      loc.appendChild(chg);
      wxPop.appendChild(loc);
      var head = el('div', 'wx-head');
      head.appendChild(el('b', null, Math.round(cur.temperature_2m) + '°F · ' + wxText(cur.weather_code)));
      wxPop.appendChild(head);
      for (var i = 0; i < dly.time.length; i++) {
        var row = el('div', 'wx-row');
        var day = new Date(dly.time[i] + 'T12:00:00');
        var left = el('div');
        left.appendChild(el('div', 'd', i === 0 ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'long' })));
        row.appendChild(left);
        var pr = dly.precipitation_probability_max[i];
        var pe = el('div', 'p');
        if (pr != null && pr >= 20) {
          pe.textContent = pr + '% rain';
        }
        row.appendChild(pe);
        row.appendChild(el('div', 't', Math.round(dly.temperature_2m_max[i]) + '° / ' + Math.round(dly.temperature_2m_min[i]) + '°'));
        wxPop.appendChild(row);
      }
    }).catch(function () {
      wxBtn.textContent = '';
      wxBtn.appendChild(el('span', 'wx-cond', 'Weather unavailable')); wxBtn.setAttribute('aria-label', 'Weather unavailable');
      wxBtn.firstChild.style.display = 'inline';
      wxBtn.disabled = true;
    });
  }
  function setWx(open) { wxPop.classList.toggle('open', open); wxBtn.setAttribute('aria-expanded', String(open)); }
  wxBtn.addEventListener('click', function (e) { e.stopPropagation(); setWx(!wxPop.classList.contains('open')); });

  document.addEventListener('click', function () { if (wxPop.classList.contains('open')) setWx(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setWx(false); });

  /* ---------- tabs and search ---------- */
  var tabsEl = document.getElementById('tabs');
  // The tab row is built once (and again only when a tab appears or hides: News and Institutions hide when empty), then
  // each render only updates aria-selected and the roving tabindex, so keyboard focus on a tab survives redraws. Each
  // tab names the part of the page it shows (aria-controls); those parts are tabpanels labelled by the selected tab.
  var TAB_PANEL = { news: 'list', institution: 'list', events: 'ev', obits: 'ob list', jobs: 'jb', deals: 'dl', classifieds: 'cl' };
  var tabsKey = null;
  function renderTabs() {
    var vis = CATS.filter(function (c) {
      // Tabs show no counts; a count is only used to hide an empty News, Police & courts or Institutions tab (it still shows when its URL is open).
      return !((c.id === 'news' || c.id === 'institution') && state.cat !== c.id && !state.items.some(function (i) { return inCat(i, c.id); }));
    });
    var key = vis.map(function (c) { return c.id; }).join(',');
    if (key !== tabsKey) {
      var had = document.activeElement && tabsEl.contains(document.activeElement) ? document.activeElement.dataset.cat : null;
      tabsEl.textContent = '';
      vis.forEach(function (c) {
        var b = el('button', 'tab'); b.type = 'button'; b.setAttribute('role', 'tab'); b.id = 'tab-' + c.id;
        b.setAttribute('aria-controls', TAB_PANEL[c.id]); b.dataset.cat = c.id; b.dataset.sec = c.id;
        b.appendChild(el('span', null, c.label));
        b.addEventListener('click', function () { state.cat = c.id; if (state.q) { clearTimeout(qTimer); qEl.value = ''; state.q = ''; } resetPaging(); render(); });
        tabsEl.appendChild(b);
      });
      tabsKey = key;
      var back = had && document.getElementById('tab-' + had); if (back) back.focus();
    }
    [].forEach.call(tabsEl.children, function (b) {
      var on = b.dataset.cat === state.cat;
      if (b.getAttribute('aria-selected') !== String(on)) b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    Object.keys(TAB_PANEL).forEach(function (cat) {
      TAB_PANEL[cat].split(' ').forEach(function (id) {
        var p = document.getElementById(id); if (!p) return;
        if (p.getAttribute('role') !== 'tabpanel') p.setAttribute('role', 'tabpanel');
        // labelled by the selected tab when it shows this part, else (until then) by the tab that owns it
        var by = TAB_PANEL[state.cat] && TAB_PANEL[state.cat].split(' ').indexOf(id) >= 0 ? state.cat : p.getAttribute('aria-labelledby') ? null : cat;
        if (by && document.getElementById('tab-' + by)) p.setAttribute('aria-labelledby', 'tab-' + by);
      });
    });
  }
  // Prefetch on intent: pointing at, touching or focusing a board tab starts loading that board (once; loadBoard reuses
  // a request in flight), so the switch shows posts at once.
  var TAB_BOARD = { classifieds: 'item', deals: 'deal', events: 'event', jobs: 'job', obits: 'obit' };
  function warmTab(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-cat]') : null, k = t && TAB_BOARD[t.dataset.cat];
    if (k && boards[k] && !boards[k].loaded) loadBoard(k);
  }
  ['pointerover', 'touchstart', 'focusin'].forEach(function (ev) { tabsEl.addEventListener(ev, warmTab, ev === 'touchstart' ? { passive: true, capture: true } : true); });
  tabsEl.addEventListener('keydown', function (e) {
    var keys = { ArrowRight: 1, ArrowLeft: -1, Home: 0, End: 0 };
    if (!(e.key in keys)) return;
    var tabs = [].slice.call(tabsEl.querySelectorAll('[role=tab]')), i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    var j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + keys[e.key] + tabs.length) % tabs.length;
    var id = tabs[j].dataset.cat; tabs[j].click();
    var again = tabsEl.querySelector('[data-cat="' + id + '"]'); if (again) again.focus();
  });
  var qEl = document.getElementById('q'), qTimer = null;
  document.getElementById('home').addEventListener('click', function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return;
    ev.preventDefault();
    clearTimeout(qTimer); qEl.value = ''; state.q = ''; state.cat = 'news'; SN_DONE = '';
    if (boards) Object.keys(boards).forEach(function (k) { boards[k].form = false; boards[k].filter = ''; boards[k].when = 'any'; boards[k].town = ''; boards[k].jt = ''; });
    resetPaging(); render(); window.scrollTo({ top: 0 });
  });
  // A search link (/?q=..., from the not-found page) opens with that search filled in.
  try { var q0 = new URLSearchParams(location.search).get('q'); if (q0 && (q0 = q0.trim().slice(0, 100))) { qEl.value = q0; state.q = q0; state.sf = 'all'; } } catch (e) {}
  qEl.addEventListener('input', function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = qEl.value; state.sf = 'all'; state.srl = PAGE; if (state.cat === 'submit') state.cat = state.prevCat || 'news'; resetPaging(); render(); }, 150);
  });

  /* ---------- banners ---------- */
  var bnBreak = document.getElementById('bnBreak'), breakDismissed = '';
  // Stories currently drawn as a Breaking card in the list, keyed by normalized link (and id). The banner skips
  // a story that's already a card there, so it never shows the same story twice; on tabs or searches with no
  // Breaking card (Police & courts, Events, a search...) the banner still carries it.
  var breakCards = {};
  function storyKey(u) {
    u = String(u || '').trim(); if (!u) return '';
    try { var x = new URL(u, location.href);
      return x.hostname.replace(/^www\./i, '').toLowerCase() + x.pathname.replace(/\/+$/, '').toLowerCase(); }
    catch (e) { return u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase(); }
  }
  function storyKeys(it) { var k = []; if (it.link) k.push('u:' + storyKey(it.link)); if (it.id) k.push('i:' + it.id); return k; }
  function shownAsCard(it) { return storyKeys(it).some(function (k) { return breakCards[k]; }); }
  function renderBreaking() {
    var b = state.brk && state.brk.top, hit = b ? (b.item || alertItem(b)) : null;
    bnBreak.textContent = '';
    if (!hit || hit.link === breakDismissed || shownAsCard(hit)) { bnBreak.hidden = true; return; }
    bnBreak.appendChild(el('span', 'tag', 'Breaking'));
    var tx = el('div', 'tx');
    var a = el('a', null, hit.title.replace(/^\s*(breaking( news)?|just in|developing story|news alert)\s*[:|\u2013\u2014-]?\s*/i, '') || hit.title);
    a.href = safeHref(hit.link); a.target = '_blank'; a.rel = 'noopener noreferrer'; tx.appendChild(a);
    var by = el('span', 'by');
    if (b.label) { by.appendChild(el('b', null, b.label)); by.appendChild(document.createTextNode(' · ')); }
    var u = brkUntil(b);
    by.appendChild(document.createTextNode((u ? u + ' · ' : '') + (b.kind === 'alert' ? 'From ' : 'Reported by ') + hit.source + (u ? '' : ' · ' + timeAgo(hit.published))));
    tx.appendChild(by);
    bnBreak.appendChild(tx);
    var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Dismiss breaking news banner');
    x.addEventListener('click', function () { breakDismissed = hit.link; bnBreak.hidden = true; });
    bnBreak.appendChild(x);
    bnBreak.hidden = false;
  }

  /* ---------- weather alerts (National Weather Service) ---------- */
  var alertsEl = document.getElementById('alerts'), alertGone = {};
  function alertKey(p) { return p.id || (p.event + '|' + (p.ends || p.expires || '')); }
  function alertIcon(ev) {
    var e = String(ev || '').toLowerCase(), C = 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242';
    if (/tornado/.test(e)) return [['path', { d: 'M21 4H3M18 8H6M19 12H9M16 16h-6M11 20H9' }]];
    if (/thunder|lightning/.test(e)) return [['path', { d: 'M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973' }], ['path', { d: 'm13 12-3 5h4l-3 5' }]];
    if (/flood|rain|hydro/.test(e)) return [['path', { d: C }], ['path', { d: 'M16 14v6M8 14v6M12 16v6' }]];
    if (/wind|gust/.test(e)) return [['path', { d: 'M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2' }]];
    if (/winter|snow|ice|blizzard|sleet/.test(e)) return [['path', { d: 'M2 12h20M12 2v20m8-4-4-4 4-4M4 8l4 4-4 4m8-12-4 4-4-4m0 0M8 20l4-4 4 4' }]];
    if (/heat/.test(e)) return SUN;
    if (/frost|freez|cold|chill/.test(e)) return [['path', { d: 'M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z' }]];
    if (/fog|smoke|haze/.test(e)) return [['path', { d: C }], ['path', { d: 'M16 17H7M17 21H9' }]];
    return [['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }], ['path', { d: 'M12 9v4M12 17h.01' }]];
  }
  function renderAlerts() {
    alertsEl.textContent = '';
    var vis = state.alerts.filter(function (p) { return !alertGone[alertKey(p)] && !(BK && BK.fromNws(p)); }); // Breaking-tier warnings live in the one Breaking slot
    vis.slice(0, 3).forEach(function (p) {
      var sev = p.severity === 'Extreme' || p.severity === 'Severe' ? 'sev-severe' : p.severity === 'Moderate' ? 'sev-mod' : 'sev-minor';
      var d = el('div', 'alert ' + sev);
      var hd = el('div', 'ah');
      var tg = el('button', 'at'); tg.type = 'button'; tg.setAttribute('aria-expanded', 'false');
      var ic = el('span', 'ai'); ic.appendChild(svg(alertIcon(p.event))); tg.appendChild(ic);
      tg.appendChild(el('b', null, p.event));
      var until = p.ends || p.expires, endMs = Date.parse(until), startMs = Date.parse(p.onset || p.effective || p.sent);
      if (until && !isNaN(endMs)) {
        var rt = el('span', 'rt');
        if (!isNaN(startMs) && endMs > startMs) {
          var left = Math.max(0, Math.min(1, (endMs - Date.now()) / (endMs - startMs)));
          var bar = el('span', 'bar'); bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', Math.round(left * 100) + '% of the alert period left');
          var fill = el('i'); fill.style.width = Math.round(left * 100) + '%'; bar.appendChild(fill); rt.appendChild(bar);
        }
        rt.appendChild(el('span', null, new Date(endMs).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })));
        tg.appendChild(rt);
      }
      hd.appendChild(tg);
      var wx = 'https://forecast.weather.gov/MapClick.php?lat=' + wxLoc.lat.toFixed(4) + '&lon=' + wxLoc.lon.toFixed(4);
      var more = el('a', 'al', 'Details'); more.href = wx; more.target = '_blank'; more.rel = 'noopener noreferrer'; more.setAttribute('aria-label', p.event + ' details on weather.gov');
      hd.appendChild(more);
      var x = el('button', 'ax', '\u00d7'); x.type = 'button'; x.setAttribute('aria-label', 'Dismiss ' + p.event);
      x.addEventListener('click', function () { alertGone[alertKey(p)] = 1; renderAlerts(); });
      hd.appendChild(x);
      d.appendChild(hd);
      var body = el('div', 'ab'); body.hidden = true;
      if (p.headline) body.appendChild(el('p', null, p.headline));
      if (p.areaDesc) body.appendChild(el('p', null, p.areaDesc));
      body.appendChild(el('p', null, 'Source: National Weather Service' + (p.senderName ? ' \u00b7 ' + p.senderName : '')));
      d.appendChild(body);
      tg.addEventListener('click', function () { body.hidden = !body.hidden; tg.setAttribute('aria-expanded', String(!body.hidden)); });
      alertsEl.appendChild(d);
    });
    if (vis.length > 3) alertsEl.appendChild(el('div', 'meta', 'and ' + (vis.length - 3) + ' more active alert' + (vis.length - 3 === 1 ? '' : 's') + ' for this area'));
  }
  function loadAlerts() {
    var url = 'https://api.weather.gov/alerts/active?point=' + wxLoc.lat.toFixed(4) + ',' + wxLoc.lon.toFixed(4);
    fetch(url, { headers: { accept: 'application/geo+json' } }).then(function (r) { if (!r.ok) throw new Error('alerts'); return r.json(); }).then(function (g) {
      var seen = {};
      state.alerts = (g.features || []).map(function (f) { return f.properties || {}; }).filter(function (p) { if (!p.event || seen[p.event]) return false; seen[p.event] = 1; return true; });
      var rank = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };
      state.alerts.sort(function (a, b) { return (rank[a.severity] == null ? 4 : rank[a.severity]) - (rank[b.severity] == null ? 4 : rank[b.severity]); });
      render(); // re-ranks the Breaking slot and redraws the strip
    }).catch(function () { state.alerts = []; render(); });
  }

  /* ---------- list ---------- */
  var listEl = document.getElementById('list');
  var metaEl = document.createElement('div'); // headline count is no longer shown

  function skeletons() {
    listEl.textContent = '';
    listEl.classList.toggle('news-one', state.cat === 'news'); // News loads as one column too
    listEl.setAttribute('aria-busy', 'true');
    for (var i = 0; i < 8; i++) {
      var c = el('div', 'sk-card');
      var l = el('div');
      var a = el('div', 'sk sk-line'); a.style.width = '30%'; l.appendChild(a);
      var b = el('div', 'sk sk-line'); b.style.width = '100%'; l.appendChild(b);
      var d = el('div', 'sk sk-line'); d.style.width = '60%'; l.appendChild(d);
      c.appendChild(el('div', 'sk sk-img')); c.appendChild(l);
      listEl.appendChild(c);
    }
  }

  function stateBox(title, body, btnLabel, fn) {
    listEl.textContent = '';
    listEl.setAttribute('aria-busy', 'false');
    var s = el('div', 'state');
    s.style.gridColumn = '1 / -1';
    s.appendChild(el('h2', null, title));
    s.appendChild(el('p', null, body));
    if (btnLabel) { var b = el('button', 'primary', btnLabel); b.type = 'button'; b.addEventListener('click', fn); s.appendChild(b); }
    listEl.appendChild(s);
  }

  /* ---------- classifieds and deals: posted by readers and local businesses ---------- */
  var CL = [
    { name: 'Evansville', host: 'evansville.craigslist.org' },
    { name: 'Western Kentucky', host: 'westky.craigslist.org' },
    { name: 'Southern Illinois', host: 'carbondale.craigslist.org' },
    { name: 'Terre Haute', host: 'terrehaute.craigslist.org' }
  ];
  var CATS_ITEM = ['Furniture', 'Electronics', 'Vehicles', 'Tools', 'Home & garden', 'Clothing', 'Sports & outdoors', 'Toys & kids', 'Other'];
  var CATS_DEAL = ['Food & drink', 'Shopping', 'Services', 'Entertainment', 'Auto', 'Other'];
  var CATS_EVENT = ['Music', 'Food & drink', 'Family', 'Sports', 'Arts', 'Community', 'Other'];
  var CONDS = ['New', 'Like new', 'Good', 'Fair'];
  var PHONE_RE = /^\+?1?[\s.-]*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}$/, EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function inDays(n) { var d = new Date(Date.now() + n * 864e5); return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
  var CATS_JOB = ['Healthcare', 'Trades & construction', 'Retail & food service', 'Warehouse & driving', 'Office & admin', 'Education', 'Other'];
  var JOB_TYPES = ['Full-time', 'Part-time', 'Seasonal', 'Contract'];
  var clEl = document.getElementById('cl');
  var boards = {
    item: { items: [], loaded: false, configured: null, form: false, filter: '', mine: [], key: 'tsn.mine', cats: CATS_ITEM, el: clEl },
    deal: { items: [], loaded: false, configured: null, form: false, filter: '', mine: [], key: 'tsn.mineDeals', cats: CATS_DEAL, el: document.getElementById('dl') },
    event: { items: [], loaded: false, configured: null, form: false, filter: '', mine: [], key: 'tsn.mineEvents', cats: CATS_EVENT, el: document.getElementById('ev') },
    obit: { items: [], loaded: false, configured: null, form: false, filter: '', town: '', mine: [], key: 'tsn.mineObits', cats: [], el: document.getElementById('ob') },
    job: { items: [], loaded: false, configured: null, form: false, filter: '', jt: '', town: '', mine: [], key: 'tsn.mineJobs', cats: CATS_JOB, el: document.getElementById('jb') }
  };
  Object.keys(boards).forEach(function (k) { try { boards[k].mine = JSON.parse(localStorage.getItem(boards[k].key) || '[]'); } catch (e) {} });
  function saveMine(b) { try { localStorage.setItem(b.key, JSON.stringify(b.mine.slice(-50))); } catch (e) {} }
  // One request per board at a time: a render, a tab switch or a hover while one is in flight reuses it (b.pending).
  function loadBoard(kind) {
    var b = boards[kind];
    if (b.pending) return b.pending;
    b.pending = fetch('/api/listings?kind=' + kind, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      b.configured = !!(d && d.configured); b.items = d && d.items ? d.items : []; b.loaded = true;
    }).catch(function () { b.loaded = true; b.configured = false; }).then(function () { b.pending = null; renderTabs(); drawBoard(kind); if (state.q.trim() && state.cat !== 'submit') render(); });
    return b.pending;
  }
  function loadDeals() { return loadBoard('deal'); }
  function evCat(i) {
    if (i.cat) return i.cat;
    var t = (i.title || '').toLowerCase();
    if (/\b(aces|hoosiers|basketball|football|soccer|baseball|wwe|smackdown|vs\.?|racing|derby|tournament|classic)\b/.test(t)) return 'Sports';
    if (/\b(concert|tour|tribute|philharmonic|orchestra|symphony|band|music|jazz|live)\b|tobymac|tracy lawrence|ty myers/.test(t)) return 'Music';
    if (/\b(ballet|nutcracker|theatre|theater|labyrinth|musical|opera|art|gallery|comedy|giggles|teachers)\b/.test(t)) return 'Arts';
    if (/\b(family|kids|children|zoo|pumpkin|trick|halloween)\b/.test(t)) return 'Family';
    if (/\b(food|taste|wine|beer|brew|bbq|bar-b-q|dinner|festival)\b/.test(t)) return 'Food & drink';
    return 'Community';
  }
  function feedEvents() {
    var today = inDays(0);
    return state.items.filter(function (i) { return kindOf(i.sourceId) === 'events' && i.published; }).map(function (i) {
      var d = new Date(i.published), z = 'America/Chicago';
      var date = d.toLocaleDateString('en-CA', { timeZone: z });
      var hm = d.toLocaleTimeString('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit', hour12: false }).replace(/^24/, '00');
      return { id: 'feed-' + i.id, title: i.title, date: date, time: (hm === '00:00' || hm < '06:00') ? '' : hm, place: i.venue || '', town: i.area || '', start: i.published, image: i.image || '', fromPrice: i.fromPrice || '', category: evCat(i), desc: (i.summary || '').replace(/\s*…\s*more:.*$/, '…'), contact: '', link: i.link, feed: true, source: i.source, logo: (state.sources.filter(function (x) { return x.id === i.sourceId; })[0] || {}).logo || '' };
    }).filter(function (x) { return x.date >= today; });
  }
  function townOf(x) { return String(x.town || '').split(',')[0].trim(); }
  function weekendRange() {
    var dow = new Date(inDays(0) + 'T12:00:00').getDay();
    if (dow === 6) return [inDays(0), inDays(1)];
    if (dow === 0) return [inDays(0), inDays(0)];
    if (dow === 5) return [inDays(0), inDays(2)];
    return [inDays(5 - dow), inDays(7 - dow)];
  }
  function whenOk(x, when) {
    if (!when || when === 'any') return true;
    if (when === 'today') return x.date === inDays(0);
    if (when === 'tomorrow') return x.date === inDays(1);
    if (when.indexOf('d:') === 0) return x.date === when.slice(2);
    if (when === 'week') return x.date >= inDays(0) && x.date <= inDays(6);
    if (when === 'weekend') { var r = weekendRange(); return x.date >= r[0] && x.date <= r[1]; }
    return true;
  }
  function shownItems(b, kind, ignoreQ) {
    var real = b.items.slice();
    if (kind === 'event') real = real.concat(feedEvents());
    var all = real;
    if (kind === 'job') all.sort(function (x, y) { return x.at < y.at ? 1 : -1; });
    if (kind === 'event') all.sort(function (x, y) { return (x.date + (x.time || '')) < (y.date + (y.time || '')) ? -1 : 1; });
    if (b.filter) all = all.filter(function (x) { return x.category === b.filter; });
    if (kind === 'event' && !ignoreQ) {
      if (b.when && b.when !== 'any') all = all.filter(function (x) { return whenOk(x, b.when); });
    }
    if (kind === 'job' && !ignoreQ && b.jt) all = all.filter(function (x) { return x.jobType === b.jt; });
    if (b.town && !ignoreQ) all = all.filter(function (x) { return townOf(x) === b.town; });
    all = all.filter(function (x) { return x.featured; }).concat(all.filter(function (x) { return !x.featured; }));
    var q = ignoreQ ? '' : state.q.trim().toLowerCase();
    if (q && kind !== 'item') {
      var words = q.split(/\s+/);
      all = all.filter(function (x) { var hay = [x.title, x.business, x.desc, x.town, x.place, x.category, x.jobType, x.pay].join(' ').toLowerCase(); return words.every(function (w) { return hay.indexOf(w) >= 0; }); });
    }
    return all;
  }
  var RENDER = { item: function () { renderClassifieds(); }, deal: function () { renderDeals(); }, event: function () { renderEvents(); }, job: function () { renderJobs(); }, obit: function () { renderObits(); } };
  var TABOF = { item: 'classifieds', deal: 'deals', event: 'events', job: 'jobs', obit: 'obits' };
  function drawBoard(kind) { if (state.cat === TABOF[kind]) RENDER[kind](); }

  /* images: category art for posts without a photo, initials avatars, and client-side photo resizing */
  var ART = {
    'Furniture': ['M3 11a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6H3z', 'M5 9V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2', 'M5 17v3', 'M19 17v3'],
    'Electronics': ['M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16'],
    'Vehicles': ['M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2', 'M9 17h6', 'circle:7:17:2', 'circle:17:17:2'],
    'Tools': ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
    'Home & garden': ['m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
    'Clothing': ['M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z'],
    'Sports & outdoors': ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22', 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22', 'M18 2H6v7a6 6 0 0 0 12 0V2Z'],
    'Sports': ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22', 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22', 'M18 2H6v7a6 6 0 0 0 12 0V2Z'],
    'Toys & kids': ['circle:12:12:10', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01'],
    'Family': ['circle:12:12:10', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01'],
    'Food & drink': ['M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2', 'M7 2v20', 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7'],
    'Shopping': ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z', 'M3 6h18', 'M16 10a4 4 0 0 1-8 0'],
    'Services': ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
    'Auto': ['M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2', 'M9 17h6', 'circle:7:17:2', 'circle:17:17:2'],
    'Entertainment': ['M9 18V5l12-2v13', 'circle:6:18:3', 'circle:18:16:3'],
    'Music': ['M9 18V5l12-2v13', 'circle:6:18:3', 'circle:18:16:3'],
    'Arts': ['rect:3:3:18:18:2', 'circle:9:9:2', 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'],
    'Community': ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'circle:9:7:4', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    'Other': ['M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z', 'circle:7.5:7.5:.5']
  };
  var HUE = { 'Furniture': 28, 'Electronics': 215, 'Vehicles': 200, 'Tools': 18, 'Home & garden': 130, 'Clothing': 320, 'Sports & outdoors': 150, 'Sports': 150, 'Toys & kids': 45, 'Family': 45, 'Food & drink': 12, 'Shopping': 290, 'Services': 190, 'Auto': 200, 'Entertainment': 265, 'Music': 265, 'Arts': 335, 'Community': 170, 'Other': 230 };
  var artCache = {};
  function artUri(cat) {
    if (artCache[cat]) return artCache[cat];
    var parts = (ART[cat] || ART.Other).map(function (d) {
      var a = d.split(':');
      if (a[0] === 'circle') return '<circle cx="' + a[1] + '" cy="' + a[2] + '" r="' + a[3] + '"/>';
      if (a[0] === 'rect') return '<rect x="' + a[1] + '" y="' + a[2] + '" width="' + a[3] + '" height="' + a[4] + '" rx="' + a[5] + '"/>';
      return '<path d="' + d + '"/>';
    }).join('');
    var h = HUE[cat] != null ? HUE[cat] : 230;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="hsl(' + h + ' 45% 50% / .16)"/><g transform="translate(56 36) scale(2)" fill="none" stroke="hsl(' + h + ' 45% 42%)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + parts + '</g></svg>';
    return (artCache[cat] = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg));
  }
  function photoSrc(it) { return it.imgData || (it.img ? '/api/listings?img=' + encodeURIComponent(it.id) : ''); }
  function hueOf(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360; return h; }
  function initials(name) { var w = String(name || '?').split(/\s+/).filter(Boolean); return ((w[0] || '?').charAt(0) + (w.length > 1 ? w[1].charAt(0) : '')).toUpperCase(); }
  function bizAvatar(name, logo) {
    if (logo) { var im = el('img', 'bav'); im.src = logo; im.alt = ''; im.width = 28; im.height = 28; im.loading = 'lazy'; return im; }
    var a = el('span', 'bav bav-i', initials(name)); a.style.setProperty('--h', String(hueOf(name || '?'))); a.setAttribute('aria-hidden', 'true'); return a;
  }
  // Re-encode an uploaded image through a canvas: max edge in px, optional square crop, JPEG under a size cap.
  function processImage(file, maxEdge, square, cap) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Choose an image file.'));
      if (file.size > 15 * 1024 * 1024) return reject(new Error('That image is too large.'));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0, cw = sw, ch = sh, tw, th;
        if (square) { var m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; cw = ch = m; tw = th = Math.min(maxEdge, m); }
        else { var k = Math.min(1, maxEdge / Math.max(sw, sh)); tw = Math.round(sw * k); th = Math.round(sh * k); }
        var cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
        var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, tw, th); cx.drawImage(img, sx, sy, cw, ch, 0, 0, tw, th);
        var q = 0.8, out = cv.toDataURL('image/jpeg', q);
        while (out.length > cap && q > 0.35) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
        if (out.length > cap) return reject(new Error('That image is too detailed. Try a smaller one.'));
        resolve(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Couldn’t read that image.')); };
      img.src = url;
    });
  }
  function photoPicker(label, opts) {
    var wrap = el('div', 'cl-photo'), input = el('input'); input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
    var add = el('button', 'cl-addph', label); add.type = 'button'; add.id = 'f-ph' + (++uidSeq);
    var prev = el('div', 'cl-prev'); prev.hidden = true;
    var pi = el('img'); pi.alt = ''; var rm = el('button', 'cl-link', 'Remove'); rm.type = 'button';
    prev.appendChild(pi); prev.appendChild(rm);
    wrap.appendChild(add); wrap.appendChild(input); wrap.appendChild(prev);
    wrap.value = ''; wrap.msg = el('div', 'cl-fe');
    add.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      wrap.msg.textContent = '';
      var file = input.files && input.files[0]; if (!file) return;
      add.disabled = true;
      processImage(file, opts.edge, opts.square, opts.cap).then(function (d) { wrap.value = d; pi.src = d; prev.hidden = false; add.hidden = true; })
        .catch(function (e) { wrap.msg.textContent = e.message || 'Couldn’t use that image.'; }).then(function () { add.disabled = false; input.value = ''; });
    });
    rm.addEventListener('click', function () { wrap.value = ''; prev.hidden = true; add.hidden = false; pi.removeAttribute('src'); });
    wrap.appendChild(wrap.msg);
    return wrap;
  }

  /* form helpers */
  function field(label, node, o) {
    o = o || {};
    var w = el('div', 'cl-f' + (o.cls ? ' ' + o.cls : ''));
    var lab = el('label', null, label + (o.req ? '' : ' (optional)')); if (node.id) lab.setAttribute('for', node.id);
    w.appendChild(lab); w.appendChild(node);
    if (o.hint) w.appendChild(el('div', 'cl-hint', o.hint));
    var fe = el('div', 'cl-fe'); fe.setAttribute('role', 'alert'); w.appendChild(fe);
    w.err = function (m) { fe.textContent = m || ''; node.setAttribute('aria-invalid', m ? 'true' : 'false'); };
    return w;
  }
  var uidSeq = 0;
  function input(type, name, max, ph) { var i = el('input'); i.type = type; i.name = name; i.maxLength = max; i.id = 'f-' + name + (++uidSeq); if (ph) i.placeholder = ph; if (type === 'text') i.autocomplete = 'off'; return i; }
  function select(name, opts, blank) { return UI.select({ name: name, id: 'f-' + name + (++uidSeq), options: opts, blank: blank }); }
  function counter(node, max) {
    var c = el('div', 'cl-count'); function up() { c.textContent = node.value.length + '/' + max; } node.addEventListener('input', up); up(); return c;
  }
  function segmented(name, opts) {
    var wrap = el('div', 'cl-seg'); wrap.setAttribute('role', 'radiogroup'); wrap.value = '';
    opts.forEach(function (o) {
      var b = el('button', null, o); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
      b.addEventListener('click', function () {
        var on = wrap.value !== o; wrap.value = on ? o : '';
        Array.prototype.forEach.call(wrap.children, function (x) { x.setAttribute('aria-checked', String(x === b && on)); });
      });
      wrap.appendChild(b);
    });
    return wrap;
  }
  function townSelect() { var t = select('town', LOCS.map(function (l) { return l.name; }), 'Choose a town'); return t; }

  function fmtTime(hm) { if (!hm) return ''; var h = +hm.slice(0, 2), m = hm.slice(3, 5); return (h % 12 || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function buildObitForm(b) {
    var f = el('form', 'cl-form'); f.noValidate = true;
    var F = {}, els = {};
    els.title = input('text', 'title', 80, 'Full name'); F.title = field('Full name', els.title, { req: true });
    els.business = input('text', 'business', 60, 'Funeral home'); F.business = field('Funeral home', els.business, { req: true });
    els.town = townSelect(); F.town = field('Town', els.town, { req: true });
    els.svc = input('date', 'svc', 10); els.svc.min = inDays(-14); F.svc = field('Service date', els.svc);
    els.place = input('text', 'place', 60, 'Church or chapel and time'); F.place = field('Service location and time', els.place);
    els.desc = el('textarea'); els.desc.name = 'desc'; els.desc.id = 'f-desc' + (++uidSeq); els.desc.maxLength = 600; els.desc.rows = 5; els.desc.placeholder = 'A short remembrance, survivors, visitation and memorial details';
    F.desc = field('Tribute', els.desc); F.desc.appendChild(counter(els.desc, 600));
    els.contact = input('text', 'contact', 80, '812-555-0142 or office@funeralhome.com'); F.contact = field('Funeral home contact', els.contact, { req: true, hint: 'Shown publicly so families and friends can reach the funeral home.' });
    var two1 = el('div', 'cl-two'); two1.appendChild(F.title); two1.appendChild(F.business);
    var two2 = el('div', 'cl-two'); two2.appendChild(F.town); two2.appendChild(F.svc);
    [two1, two2, F.place, F.desc, F.contact].forEach(function (x) { f.appendChild(x); });
    F.adult = ageConsent(); f.appendChild(F.adult);
    var top = el('div', 'cl-err'); top.setAttribute('role', 'alert'); f.appendChild(top);
    var go = el('button', 'cl-go cl-wide', 'Post obituary'); go.type = 'submit'; f.appendChild(go);
    f.appendChild(el('p', 'cl-note', 'For funeral homes and families. Posts come down after 30 days. No links. Anyone can report a post.'));
    var order = ['title', 'business', 'town', 'svc', 'contact', 'adult'];
    function show(e) { order.forEach(function (k) { if (F[k]) F[k].err(e[k] || ''); }); var first = order.filter(function (k) { return e[k]; })[0]; if (first) { var n = F[first].querySelector('input,select'); if (n) n.focus(); } }
    f.addEventListener('submit', function (ev) {
      ev.preventDefault(); top.textContent = '';
      var e = {}, c = els.contact.value.trim();
      if (els.title.value.trim().length < 3) e.title = 'Add the full name.';
      if (els.business.value.trim().length < 2) e.business = 'Add the funeral home’s name.';
      if (!els.town.value) e.town = 'Choose a town.';
      if (!PHONE_RE.test(c) && !EMAIL_RE.test(c)) e.contact = 'Add the funeral home’s phone number or email.';
      if (!F.adult.input.checked) e.adult = 'Please confirm you’re 18 or older.';
      show(e); if (Object.keys(e).length) return;
      go.disabled = true; go.textContent = 'Posting…';
      fetch('/api/listings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adult: F.adult.input.checked, kind: 'obit', title: els.title.value, business: els.business.value, town: els.town.value, svc: els.svc.value, place: els.place.value, desc: els.desc.value, contact: els.contact.value, uid: uid }) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (o) {
          go.disabled = false; go.textContent = 'Post obituary';
          if (!o.ok || !o.d.item) { var m = (o.d && o.d.error) || 'Couldn’t post that. Try again.'; if (o.d && o.d.field && F[o.d.field]) { var q = {}; q[o.d.field] = m; show(q); } else top.textContent = m; return; }
          b.items.unshift(o.d.item); b.mine.push(o.d.item.id); saveMine(b); b.form = false; renderTabs(); drawBoard('obit');
        }).catch(function () { go.disabled = false; go.textContent = 'Post obituary'; top.textContent = 'Couldn’t post that. Check your connection and try again.'; });
    });
    return f;
  }
  function buildForm(kind, b) {
    if (kind === 'obit') return buildObitForm(b);
    var isDeal = kind === 'deal', isEv = kind === 'event', isJob = kind === 'job';
    var noun = isDeal ? 'deal' : isEv ? 'event' : isJob ? 'job' : 'item';
    var f = el('form', 'cl-form'); f.noValidate = true;
    var F = {}, els = {};
    els.title = input('text', 'title', 80, isJob ? 'Line cook, CNA, delivery driver' : isDeal ? '2-for-1 burgers on Tuesdays' : isEv ? 'Fall Harvest Market' : 'What are you selling?');
    els.category = select('category', b.cats, 'Choose a category');
    els.town = townSelect();
    els.desc = el('textarea'); els.desc.name = 'desc'; els.desc.id = 'f-desc' + (++uidSeq); els.desc.maxLength = 300; els.desc.rows = 3;
    els.desc.placeholder = isJob ? 'Duties, schedule, requirements' : isDeal ? 'Details, limits, hours' : isEv ? 'What to expect, cost, parking' : 'Size, age, pickup details';
    els.contact = input('text', 'contact', 80, isJob ? '812-555-0142 or hiring@company.com' : isDeal ? 'Address or phone' : isEv ? 'Phone or email' : '812-555-0142 or name@email.com');
    if (isDeal) { els.business = input('text', 'business', 50, 'Your business name'); F.business = field('Business', els.business, { req: true }); }
    if (isJob) { els.employer = input('text', 'employer', 50, 'Employer name'); F.employer = field('Employer', els.employer, { req: true }); }
    F.title = field(isJob ? 'Job title' : isDeal ? 'Offer' : isEv ? 'Event name' : 'Title', els.title, { req: true });
    F.category = field('Category', els.category, { req: true });
    F.town = field('Town', els.town, { req: true });
    if (isDeal) {
      els.code = input('text', 'code', 20, 'FALL25'); els.code.classList.add('uc');
      els.ends = input('date', 'ends', 10); els.ends.min = inDays(0);
      F.code = field('Coupon code', els.code, { hint: 'Letters, numbers and dashes' }); F.ends = field('Ends', els.ends);
    } else if (isEv) {
      els.date = input('date', 'date', 10); els.date.min = inDays(0);
      els.time = input('time', 'time', 5); els.place = input('text', 'place', 60, 'Garvin Park, VFW Hall…');
      F.date = field('Date', els.date, { req: true }); F.time = field('Start time', els.time); F.place = field('Where', els.place);
    } else if (isJob) {
      els.jobType = segmented('jobType', JOB_TYPES); F.jobType = field('Type', els.jobType, { req: true });
      els.pay = input('text', 'pay', 40, '$18-22/hr'); F.pay = field('Pay', els.pay, { hint: 'Hourly or yearly. Leave blank if it depends.' });
    } else {
      els.price = input('text', 'price', 12, '50'); els.price.inputMode = 'decimal';
      var pw = el('div', 'cl-price-in'); pw.appendChild(el('span', null, '$')); pw.appendChild(els.price);
      els.free = el('input'); els.free.type = 'checkbox'; els.free.id = 'f-free' + (++uidSeq);
      var fl = el('label', 'cl-check'); fl.setAttribute('for', els.free.id); fl.appendChild(els.free); fl.appendChild(document.createTextNode('Free'));
      els.free.addEventListener('change', function () { els.price.disabled = els.free.checked; if (els.free.checked) els.price.value = ''; });
      var pr = el('div', 'cl-pricerow'); pr.appendChild(pw); pr.appendChild(fl);
      F.price = field('Price', pr);
      els.cond = segmented('condition', CONDS); F.condition = field('Condition', els.cond);
    }
    els.photo = photoPicker(isDeal ? 'Add a photo of the offer' : isEv ? 'Add an event photo' : 'Add a photo', { edge: 800, cap: 190000 });
    F.photo = field('Photo', els.photo);
    if (isDeal || isJob) { els.logo = photoPicker('Add your logo', { edge: 96, square: true, cap: 14000 }); F.logo = field(isJob ? 'Employer logo' : 'Business logo', els.logo, { hint: 'Shown next to the ' + (isJob ? 'employer' : 'business') + ' name.' }); }
    F.desc = field(isJob ? 'About the job' : 'Details', els.desc); F.desc.appendChild(counter(els.desc, 300));
    F.contact = field(isJob ? 'How to apply' : isDeal ? 'Where to find it' : isEv ? 'Organizer contact' : 'Contact', els.contact, { req: !isEv, hint: isJob ? 'Phone number or email. Shown publicly, no links.' : isEv ? 'Optional. Shown publicly.' : isDeal ? 'Shown publicly' : 'Phone or email. Shown publicly so buyers can reach you.' });
    function two(a, c) { var r = el('div', 'cl-two'); r.appendChild(F[a]); r.appendChild(F[c]); f.appendChild(r); }
    if (isDeal) { f.appendChild(F.business); f.appendChild(F.title); two('category', 'town'); two('code', 'ends'); }
    else if (isJob) { f.appendChild(F.employer); f.appendChild(F.title); two('category', 'town'); f.appendChild(F.jobType); f.appendChild(F.pay); }
    else if (isEv) { f.appendChild(F.title); two('category', 'town'); two('date', 'time'); f.appendChild(F.place); }
    else { f.appendChild(F.title); two('category', 'town'); f.appendChild(F.price); f.appendChild(F.condition); }
    if (!isJob) f.appendChild(F.photo); if (isDeal || isJob) f.appendChild(F.logo);
    f.appendChild(F.desc); f.appendChild(F.contact);
    var top = el('div', 'cl-err'); top.setAttribute('role', 'alert');
    var label = 'Post ' + noun;
    var go = el('button', 'cl-go cl-wide', label); go.type = 'submit';
    F.adult = ageConsent(); f.appendChild(F.adult);
    f.appendChild(top); f.appendChild(go);
    f.appendChild(el('p', 'cl-note', 'No links. ' + (isJob ? 'Jobs come down after 45 days. Post only real openings.' : isDeal ? 'Deals come down on their end date or after 30 days.' : isEv ? 'Events come down after they happen.' : 'Listings expire after 30 days.') + ' Anyone can report a post.'));
    var order = isJob ? ['employer', 'title', 'category', 'town', 'jobType', 'pay', 'contact', 'adult'] : isDeal ? ['business', 'title', 'category', 'town', 'code', 'ends', 'contact', 'adult'] : isEv ? ['title', 'category', 'town', 'date', 'time', 'contact', 'adult'] : ['title', 'category', 'town', 'price', 'contact', 'adult'];
    function clientCheck() {
      var e = {};
      if (isDeal && els.business.value.trim().length < 2) e.business = 'Add the business name.';
      if (isJob && els.employer.value.trim().length < 2) e.employer = 'Add the employer name.';
      if (isJob && !els.jobType.value) e.jobType = 'Choose full-time, part-time, seasonal or contract.';
      if (isJob && els.pay.value.trim() && !/\d|negotiable|competitive|commission|tips?/i.test(els.pay.value)) e.pay = 'Pay should look like $18-22/hr or $55,000/yr.';
      if (els.title.value.trim().length < 3) e.title = isDeal ? 'Describe the offer.' : isEv ? 'Add an event name.' : 'Add a title (at least 3 characters).';
      if (!els.category.value) e.category = 'Choose a category.';
      if (!els.town.value) e.town = 'Choose a town.';
      var c = els.contact.value.trim();
      if (isJob) { if (!PHONE_RE.test(c) && !EMAIL_RE.test(c)) e.contact = 'Add a phone number like 812-555-0142 or an email address for applicants.'; }
      else if (isDeal) { if (c.length < 5) e.contact = 'Add the address or phone number.'; }
      else if (isEv) { if (c && c.length < 5) e.contact = 'Add a phone number or email, or leave it blank.'; if (!els.date.value) e.date = 'Pick a date.'; else if (els.date.value < inDays(0)) e.date = 'Pick today or a later date.'; }
      else { if (!PHONE_RE.test(c) && !EMAIL_RE.test(c)) e.contact = 'Enter a phone number like 812-555-0142 or an email address.';
        if (!els.free.checked && els.price.value.trim() && !/^\d[\d,]*(\.\d{2})?$/.test(els.price.value.trim().replace(/^\$/, ''))) e.price = 'Enter an amount like 50 or 1,200.'; }
      if (!F.adult.input.checked) e.adult = 'Please confirm you’re 18 or older.';
      return e;
    }
    function show(e) {
      order.forEach(function (k) { if (F[k]) F[k].err(e[k] || ''); });
      var first = order.filter(function (k) { return e[k]; })[0];
      if (first) { var n = F[first].querySelector('input,select'); if (n) n.focus(); }
    }
    f.addEventListener('submit', function (ev) {
      ev.preventDefault(); top.textContent = '';
      var e = clientCheck(); show(e); if (Object.keys(e).length) return;
      go.disabled = true; go.textContent = 'Posting…';
      var body = { adult: F.adult.input.checked, img: els.photo.value || undefined, logo: els.logo ? (els.logo.value || undefined) : undefined, kind: kind, title: els.title.value, category: els.category.value, town: els.town.value, desc: els.desc.value, contact: els.contact.value, uid: uid };
      if (isJob) { body.employer = els.employer.value; body.jobType = els.jobType.value; body.pay = els.pay.value; }
      else if (isDeal) { body.business = els.business.value; body.code = els.code.value; body.ends = els.ends.value; }
      else if (isEv) { body.date = els.date.value; body.time = els.time.value; body.place = els.place.value; }
      else { body.price = els.free.checked ? 'Free' : (els.price.value.trim() ? '$' + els.price.value.trim().replace(/^\$/, '') : ''); body.condition = els.cond.value; }
      fetch('/api/listings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (o) {
          go.disabled = false; go.textContent = label;
          if (!o.ok || !o.d.item) { var m = (o.d && o.d.error) || 'Couldn’t post that. Try again.'; if (o.d && o.d.field && F[o.d.field]) { var q = {}; q[o.d.field] = m; show(q); } else top.textContent = m; return; }
          if (els.photo.value) o.d.item.imgData = els.photo.value; if (els.logo && els.logo.value) o.d.item.logo = els.logo.value;
          b.items.unshift(o.d.item); b.mine.push(o.d.item.id); saveMine(b); b.form = false; renderTabs(); drawBoard(kind);
        }).catch(function () { go.disabled = false; go.textContent = label; top.textContent = 'Couldn’t post that. Check your connection and try again.'; });
    });
    return f;
  }
  // Whole dollars when there are no cents: 1900 -> "$19", 119900 -> "$1,199", 1950 -> "$19.50".
  var SHOW_SUBSCRIBERS_AT = 100; // the Advertise newsletter line shows "N of 1,500 subscribers" from this many on
  function money(c) { c = Number(c) || 0; return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }); }
  function priceText(p) { return /^free$/i.test(p) ? 'Free' : (p.charAt(0) === '$' ? p : '$' + p); }
  function actions(it, kind, b, foot) {
    if (it.feed) return;
    var mine = b.mine.indexOf(it.id) >= 0;
    var act = el('button', 'cl-link', mine ? 'Remove' : 'Report'); act.type = 'button';
    act.addEventListener('click', function () {
      act.disabled = true;
      var req = mine ? fetch('/api/listings?kind=' + kind + '&id=' + encodeURIComponent(it.id) + '&uid=' + encodeURIComponent(uid), { method: 'DELETE' })
                     : fetch('/api/listings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: kind, action: 'report', id: it.id, uid: uid }) });
      req.then(function () { if (mine) { b.items = b.items.filter(function (x) { return x.id !== it.id; }); renderTabs(); drawBoard(kind); } else { act.textContent = 'Reported'; } }).catch(function () { act.disabled = false; });
    });
    foot.appendChild(act);
    var pr = PAY.prices[kind];
    // The period the server will sell (public/featured.js, shared with checkout): "for N days", or "until <day>" for an
    // event or a deal with an end date; no button when less than a day would remain.
    var fw = pr && window.TSNFeatured ? TSNFeatured.window({ kind: kind, date: it.date, ends: it.ends }, pr.days, Date.now()) : null;
    if (mine && PAY.configured && pr && !it.featured && fw && fw.ok) {
      var period = fw.capped ? 'until ' + TSNFeatured.dayLabel(fw.until) : 'for ' + pr.days + ' days';
      var ft = UI.button('Feature ' + period + ' · ' + money(pr.cents), 'cl-link cl-feature', function () {
        ft.disabled = true; ft.textContent = 'Opening checkout…';
        fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: it.id, kind: kind, uid: uid }) })
          .then(function (r) { return r.json(); }).then(function (d) { if (d && d.url) location.href = d.url; else { ft.disabled = false; ft.textContent = (d && d.error) || 'Try again'; } })
          .catch(function () { ft.disabled = false; ft.textContent = 'Try again'; });
      });
      ft.setAttribute('aria-label', 'Feature this post ' + period + ', ' + money(pr.cents));
      foot.appendChild(ft);
    }
  }
  function catPill(it) { return el('span', 'cl-tag', it.category || 'Other'); }
  function dealCard(it, b) {
    var c = el('article', 'deal');
    var src = photoSrc(it);
    if (src) { var im = el('img', 'deal-img'); im.src = src; im.alt = ''; im.loading = 'lazy'; c.appendChild(im); }
    var body = el('div', 'deal-body');
    var head = el('div', 'deal-head');
    head.appendChild(bizAvatar(it.business || it.title, it.logo));
    head.appendChild(el('span', 'deal-biz', it.business || ''));
    head.appendChild(catPill(it));
    body.appendChild(head);
    body.appendChild(el('h3', 'deal-offer', it.title));
    if (it.desc) body.appendChild(el('p', 'cl-desc', it.desc));
    var meta = [it.town]; if (it.ends) meta.push('Ends ' + new Date(it.ends + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    body.appendChild(el('div', 'cl-meta', meta.filter(Boolean).join(' · ')));
    if (it.code) { var cd = el('div', 'deal-code'); cd.appendChild(el('span', null, 'Use code')); cd.appendChild(el('code', null, it.code)); body.appendChild(cd); }
    var foot = el('div', 'cl-foot'); foot.appendChild(el('span', 'cl-contact', it.contact)); actions(it, 'deal', b, foot); body.appendChild(foot);
    c.appendChild(body);
    return c;
  }
  var EV_HUE = { 'Music': 'music', 'Food & drink': 'food', 'Family': 'family', 'Sports': 'sports', 'Arts': 'arts', 'Community': 'community' };
  var EV_ICON = {
    Music: [['path', { d: 'M9 18V5l12-2v13' }], ['circle', { cx: 6, cy: 18, r: 3 }], ['circle', { cx: 18, cy: 16, r: 3 }]],
    'Food & drink': [['path', { d: 'M3 2v7a3 3 0 0 0 3 3 3 3 0 0 0 3-3V2M6 2v20M19 2c-2.5 1.5-4 4-4 7s1.5 4.5 4 5V2zM19 14v8' }]],
    Family: [['circle', { cx: 9, cy: 7, r: 3 }], ['path', { d: 'M3 21v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M16 3.1a3 3 0 0 1 0 5.8M21 21v-2a5 5 0 0 0-3.5-4.8' }]],
    Sports: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 3v18M3 12h18M5.6 5.6c3 3 3 10.8 0 12.8M18.4 5.6c-3 3-3 10.8 0 12.8' }]],
    Arts: [['path', { d: 'M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A3.6 3.6 0 0 0 21 11C21 6.6 17 3 12 3z' }], ['circle', { cx: 7.5, cy: 11, r: 1 }], ['circle', { cx: 10.5, cy: 7, r: 1 }], ['circle', { cx: 15.5, cy: 7.5, r: 1 }]],
    Community: [['path', { d: 'M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z' }], ['path', { d: 'M9 21V12h6v9' }]],
    Other: [['path', { d: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17l-6.1 3.6 1.4-6.8L2.2 9.1l6.9-.8z' }]]
  };
  var ICON_CAL = [['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }], ['path', { d: 'M16 2v4M8 2v4M3 10h18' }]];
  var ICON_PIN = [['path', { d: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z' }], ['circle', { cx: 12, cy: 10, r: 3 }]];
  var ICON_GO = [['path', { d: 'M5 12h14M13 5l7 7-7 7' }]];
  function ticketLink(u) { return /ticketmaster|gopurpleaces|tickets?\b|eventbrite/i.test(u || ''); }
  function eventCard(it, b) {
    var evSrc = photoSrc(it) || it.image || '';
    if (!evSrc) return plainEventCard(it, b);
    var c = el('article', 'ev');
    var hero = el('div', 'ev-hero');
    var eim = el('img', 'ev-img'); eim.src = evSrc || artUri(it.category); eim.alt = ''; eim.loading = 'lazy'; eim.decoding = 'async'; if (it.image) eim.referrerPolicy = 'no-referrer';
    eim.addEventListener('error', function () { eim.src = artUri(it.category); });
    hero.appendChild(eim);
    var cp = UI.pill({ label: it.category || 'Other', icon: EV_ICON[it.category] || EV_ICON.Other, tone: 'over', hue: EV_HUE[it.category] || 'other' });
    hero.appendChild(cp);
    if (it.feed && it.link) {
      var news = { title: it.title, link: it.link, source: it.source, sourceId: it.sourceId, published: it.start, image: it.image || '' };
      var sb = UI.heart({
        get: function () { return { on: isSaved(it.link), n: likeCount(news), label: it.title }; },
        toggle: function () { toggleSaved(news); },
        after: function () { sb.paint(); renderTabs(); }
      });
    }
    c.appendChild(hero);
    var body = el('div', 'ev-body');
    var h = el('h3', 'ev-title');
    if (it.link) { var a = el('a', null, it.title); a.href = safeHref(it.link); a.target = '_blank'; a.rel = 'noopener noreferrer'; h.appendChild(a); } else h.textContent = it.title;
    body.appendChild(h);
    var d = new Date(it.date + 'T12:00:00');
    var when = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + (it.time ? ' · ' + fmtTime(it.time) : '');
    var r1 = el('div', 'ev-row'); r1.appendChild(svg(ICON_CAL)); r1.appendChild(el('span', null, when)); body.appendChild(r1);
    var where = [it.place, it.town].filter(Boolean).join(' · ');
    if (where) { var r2 = el('div', 'ev-row'); r2.appendChild(svg(ICON_PIN)); r2.appendChild(el('span', null, where)); body.appendChild(r2); }
    if (it.desc) body.appendChild(el('p', 'ev-desc', it.desc));
    if (it.feed) {
      var foot = el('div', 'ev-foot');
      if (it.fromPrice) { var pr = el('div', 'ev-price'); pr.appendChild(el('small', null, 'From')); pr.appendChild(el('b', null, it.fromPrice)); foot.appendChild(pr); }
      else { var sr = el('div', 'ev-src'); sr.appendChild(bizAvatar(it.source, it.logo)); sr.appendChild(el('span', null, it.source)); foot.appendChild(sr); }
      if (it.link) {
        var go = el('a', 'ev-go', ticketLink(it.link) ? 'Get tickets' : 'Details'); go.href = safeHref(it.link); go.target = '_blank'; go.rel = 'noopener noreferrer'; go.appendChild(svg(ICON_GO));
        go.setAttribute('aria-label', (ticketLink(it.link) ? 'Get tickets for ' : 'Details for ') + it.title);
        if (sb) foot.appendChild(actRow(sb, it));
        foot.appendChild(go);
      }
      body.appendChild(foot);
    } else {
      var f2 = el('div', 'cl-foot');
      if (it.contact) f2.appendChild(el('span', 'cl-contact', it.contact));
      actions(it, 'event', b, f2);
      body.appendChild(f2);
    }
    c.appendChild(body);
    return c;
  }
  // No photo: the compact card with a date tile instead of a picture.
  function plainEventCard(it, b) {
    var c = el('article', 'ev ev-plain');
    var d = new Date(it.date + 'T12:00:00');
    var tile = el('div', 'ev-date');
    tile.appendChild(el('span', 'ev-mo', d.toLocaleDateString('en-US', { month: 'short' })));
    tile.appendChild(el('span', 'ev-day', String(d.getDate())));
    tile.appendChild(el('span', 'ev-wd', d.toLocaleDateString('en-US', { weekday: 'long' })));
    if (it.time) tile.appendChild(el('span', 'ev-tm', fmtTime(it.time)));
    c.appendChild(tile);
    var body = el('div', 'ev-body');
    var h = el('h3', 'ev-title');
    if (it.link) { var a = el('a', null, it.title); a.href = safeHref(it.link); a.target = '_blank'; a.rel = 'noopener noreferrer'; h.appendChild(a); } else h.textContent = it.title;
    body.appendChild(h);
    var meta = el('div', 'ev-meta');
    var cp = UI.pill({ label: it.category || 'Other', icon: EV_ICON[it.category] || EV_ICON.Other, hue: EV_HUE[it.category] || 'other' });
    meta.appendChild(cp);
    var where = [it.place, it.town].filter(Boolean).join(' \u00B7 ');
    if (where) meta.appendChild(el('span', 'ev-where', where));
    body.appendChild(meta);
    if (it.desc) body.appendChild(el('p', 'ev-desc', it.desc));
    var foot = el('div', 'ev-foot');
    if (it.feed) {
      var sr = el('div', 'ev-src'); sr.appendChild(bizAvatar(it.source, it.logo)); sr.appendChild(el('span', null, it.source)); foot.appendChild(sr);
      var acts = el('div', 'ev-acts');
      if (it.link) {
        var news = { title: it.title, link: it.link, source: it.source, sourceId: it.sourceId, published: it.start, image: '' };
        var sb = UI.heart({
          get: function () { return { on: isSaved(it.link), n: likeCount(news), label: it.title }; },
          toggle: function () { toggleSaved(news); },
          after: function () { sb.paint(); renderTabs(); }
        });
        acts.appendChild(actRow(sb, it));
        var go = el('a', 'ev-go', ticketLink(it.link) ? 'Get tickets' : 'Details'); go.href = safeHref(it.link); go.target = '_blank'; go.rel = 'noopener noreferrer'; go.appendChild(svg(ICON_GO));
        go.setAttribute('aria-label', (ticketLink(it.link) ? 'Get tickets for ' : 'Details for ') + it.title);
        acts.appendChild(go);
      }
      foot.appendChild(acts);
    } else {
      if (it.contact) foot.appendChild(el('span', 'cl-contact', it.contact));
      actions(it, 'event', b, foot);
    }
    body.appendChild(foot);
    c.appendChild(body);
    return c;
  }
  // "Send flowers" (public/flowers.js; Advertising Policy section 8): a quiet text link under an obituary, never an
  // ad. GET /api/flowers says where it goes: the funeral home's own florist page when we know it, otherwise the
  // affiliate link labeled "paid link" (rel="sponsored noopener"), otherwise the unpaid fallbackUrl (no label,
  // rel="noopener nofollow"). With none of them there is no link at all.
  var FLOWERS = null, flowersAsked = false;
  function loadFlowers() {
    if (flowersAsked) return;
    flowersAsked = true;
    fetch('/api/flowers').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      FLOWERS = d && typeof d === 'object' ? d : null;
      if (FLOWERS && (FLOWERS.affiliate || FLOWERS.fallbackUrl || Object.keys(FLOWERS.homes || {}).length) && state.cat === 'obits') render();
    }).catch(function () {});
  }
  // The obituary action row: "Send flowers", "Plant a tree" and "Donate" together, quiet text links in one row at the
  // bottom of the card (public/flowers.js decides each link; a link with nowhere honest to go is left out).
  // Each link: an icon, the full label and a short one; CSS shows one label (and the icon) by the room the row has.
  var OB_ICON = {
    flowers: [['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M12 7.5a4.5 4.5 0 1 1 4.5 4.5M12 7.5A4.5 4.5 0 1 0 7.5 12M12 7.5V9m-4.5 3a4.5 4.5 0 1 0 4.5 4.5M7.5 12H9m7.5 0a4.5 4.5 0 1 1-4.5 4.5m4.5-4.5H15m-3 4.5V15' }]],
    tree: [['path', { d: 'M17 14l3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z' }], ['path', { d: 'M12 22v-3' }]],
    donate: [['path', { d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' }], ['path', { d: 'M12 8v6M9 11h6' }]]
  };
  function flowersLink(it, tag) {
    var F = window.TSNFlowers; if (!F) return null;
    var acts = [['Send flowers', 'Flowers', 'flowers', F.linkFor(it, FLOWERS)], ['Plant a tree', 'Tree', 'tree', F.treeFor(it, FLOWERS)], ['Donate', 'Donate', 'donate', F.donateFor(it, FLOWERS)]];
    var p = el(tag || 'div', 'ob-flw ob-acts');
    acts.forEach(function (x) {
      var f = x[3]; if (!f) return;
      var w = el('span', 'ob-act'), a = el('a');
      a.appendChild(svg(OB_ICON[x[2]])); a.appendChild(el('span', 'ob-long', x[0])); a.appendChild(el('span', 'ob-short', x[1]));
      a.title = x[0]; a.href = f.href; a.target = '_blank'; a.rel = f.paid ? F.REL_PAID : f.rel;
      w.appendChild(a);
      if (f.paid) { w.appendChild(el('span', 'ob-paid', F.LABEL_PAID)); p.classList.add('ob-paidrow'); }
      p.appendChild(w);
    });
    return p.children.length ? p : null;
  }
  function obitCard(it, b) {
    var c = el('article', 'ob');
    c.appendChild(el('span', 'ob-home', it.business || ''));
    c.appendChild(el('h3', null, it.title));
    var bits = [];
    if (it.svc) bits.push('Service ' + new Date(it.svc + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }));
    if (it.place) bits.push(it.place);
    if (bits.length) c.appendChild(el('div', 'ob-svc', bits.join(' · ')));
    if (it.desc) c.appendChild(el('p', 'cl-desc', it.desc));
    c.appendChild(el('div', 'cl-meta', [it.town, 'Posted ' + new Date(it.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })].filter(Boolean).join(' · ')));
    var foot = el('div', 'cl-foot'), href = applyHref(it.contact);
    if (href) { var a = el('a', 'cl-contact', 'Contact ' + it.business + ': ' + it.contact); a.href = href; foot.appendChild(a); } else foot.appendChild(el('span', 'cl-contact', it.contact));
    actions(it, 'obit', b, foot); c.appendChild(foot);
    var fl = flowersLink(it); if (fl) c.appendChild(fl); // the action row is always the card's last row
    return c;
  }
  function applyHref(c) { c = String(c || '').trim(); if (EMAIL_RE.test(c)) return 'mailto:' + c; if (PHONE_RE.test(c)) return 'tel:' + c.replace(/[^\d+]/g, ''); return ''; }
  function jobCard(it, b) {
    var c = el('article', 'job');
    var head = el('div', 'job-head');
    head.appendChild(bizAvatar(it.business || it.title, it.logo));
    head.appendChild(el('span', 'job-co', it.business || ''));
    if (it.jobType) { var jt = UI.pill({ label: it.jobType, tone: 'blue' }); jt.classList.add('job-type'); head.appendChild(jt); }
    c.appendChild(head);
    c.appendChild(el('h3', 'job-title', it.title));
    var meta = el('div', 'cl-meta');
    var pay = it.pay ? el('span', 'job-pay', it.pay) : null;
    var rest = [it.town, new Date(it.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })].filter(Boolean).join(' · ');
    var line = el('span'); if (pay) { line.appendChild(pay); line.appendChild(document.createTextNode(' · ')); } line.appendChild(document.createTextNode(rest));
    meta.appendChild(catPill(it)); meta.appendChild(line);
    c.appendChild(meta);
    if (it.desc) c.appendChild(el('p', 'cl-desc', it.desc));
    var foot = el('div', 'job-foot'), ap = el('div', 'job-apply'), href = applyHref(it.contact);
    if (href) { var a = el('a', null, 'Apply: ' + it.contact); a.href = href; a.setAttribute('aria-label', 'Apply for ' + it.title + ' at ' + (it.business || 'this employer') + ' using ' + it.contact); ap.appendChild(a); }
    else ap.appendChild(el('span', 'cl-contact', it.contact));
    foot.appendChild(ap); actions(it, 'job', b, foot);
    c.appendChild(foot);
    return c;
  }
  function card(it, kind, b) {
    var c = kind === 'obit' ? obitCard(it, b) : cardBase(it, kind, b);
    if (it.featured) { c.classList.add('is-featured'); c.appendChild(UI.badge('Featured \u00B7 Paid')); } // paid placement is disclosed (FTC)
    return c;
  }
  function cardBase(it, kind, b) {
    if (kind === 'job') return jobCard(it, b);
    if (kind === 'deal') return dealCard(it, b);
    if (kind === 'event') return eventCard(it, b);
    var c = el('article', 'cl-item');
    var th = el('div', 'cl-th'), ti = el('img'); ti.src = photoSrc(it) || artUri(it.category); ti.alt = ''; ti.loading = 'lazy'; th.appendChild(ti); c.appendChild(th);
    var main = el('div', 'cl-main');
    var top = el('div', 'cl-top');
    top.appendChild(el('b', null, it.title));
    if (it.price) top.appendChild(el('span', 'cl-price', priceText(it.price)));
    main.appendChild(top);
    var meta = el('div', 'cl-meta');
    var bits = [it.town]; if (it.condition) bits.push(it.condition);
    bits.push(new Date(it.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }));
    meta.textContent = bits.filter(Boolean).join(' · ');
    meta.insertBefore(catPill(it), meta.firstChild);
    main.appendChild(meta);
    if (it.desc) main.appendChild(el('p', 'cl-desc', it.desc));
    var foot = el('div', 'cl-foot');
    foot.appendChild(el('span', 'cl-contact', it.contact));
    actions(it, 'item', b, foot);
    main.appendChild(foot);
    c.appendChild(main);
    return c;
  }
  function chips(b, kind) {
    var present = {}; b.items.concat(kind === 'event' ? feedEvents() : []).forEach(function (x) { present[x.category] = 1; });
    var items = [{ value: '', label: 'All' }].concat(b.cats.filter(function (c) { return present[c]; }).map(function (c) { return { value: c, label: c }; }));
    return UI.chipRow(items, b.filter || '', function (v) { b.filter = v; drawBoard(kind); });
  }
  function eventFilters(b) {
    var bar = el('div', 'ev-filters');
    bar.appendChild(UI.chipRow([{ value: 'any', label: 'Any date' }, { value: 'today', label: 'Today' }, { value: 'weekend', label: 'This weekend' }, { value: 'week', label: 'Next 7 days' }], b.when || 'any', function (v) { b.when = v; drawBoard('event'); }, 'When'));
    return bar;
  }
  function jobFilters(b) {
    var bar = el('div', 'ev-filters');
    bar.appendChild(UI.chipRow([{ value: '', label: 'Any type' }].concat(JOB_TYPES.map(function (t) { return { value: t, label: t }; })), b.jt || '', function (v) { b.jt = v; drawBoard('job'); }, 'Job type'));
    return bar;
  }
  // The heading of every board is its town picker.
  function townPicker(b, kind, title) {
    var real = b.items.slice(); if (kind === 'event') real = real.concat(feedEvents());
    var pool = real, counts = {};
    pool.forEach(function (x) { var t = townOf(x); if (t) counts[t] = (counts[t] || 0) + 1; });
    if (b.town && !counts[b.town]) counts[b.town] = 0;
    var towns = Object.keys(counts).sort(function (x, y) { return counts[y] - counts[x] || (x < y ? -1 : 1); });
    if (towns.length < 2) return el('b', null, title);
    var lab = el('label', 'ev-town'); lab.appendChild(el('span', 'sr-only', title + ' by town'));
    lab.appendChild(UI.select({ label: title + ' by town', blank: 'All towns', value: b.town, options: towns.map(function (t) { return { value: t, label: t + ' (' + counts[t] + ')' }; }), onChange: function (v) { b.town = v; drawBoard(kind); } }));
    return lab;
  }
  function drawBody(kind, title, postLabel) {
    var b = boards[kind], root = b.el;
    root.textContent = '';
    root.appendChild(el('h2', 'sr-only', title));
    var bar = el('div', 'cl-bar'); bar.appendChild(townPicker(b, kind, title));
    if (b.configured !== false) {
      var post = el('button', 'cl-go', b.form ? 'Cancel' : postLabel); post.type = 'button';
      post.addEventListener('click', function () { b.form = !b.form; drawBoard(kind); });
      bar.appendChild(post);
    }
    root.appendChild(bar);
    var spn = kind !== 'obit' && UI.sponsor(TABOF[kind], true); if (spn) root.appendChild(spn); // no sponsor slot on Obituaries (Advertising policy)
    if (b.form) root.appendChild(buildForm(kind, b));
    if (kind === 'event') root.appendChild(eventFilters(b));
    if (kind === 'job') root.appendChild(jobFilters(b));
    if (kind !== 'obit') { var cr = chips(b, kind); if (cr.children.length > 1) root.appendChild(cr); } // no lone "All" chip on an empty board
    var list = el('div', kind === 'deal' ? 'cl-list deal-grid' : kind === 'job' ? 'cl-list job-grid' : 'cl-list'), items = shownItems(b, kind);
    var adAt = state.q.trim() ? -1 : (window.TSNAds ? TSNAds.position(items.length) : -1); // one ad card per board view
    items.forEach(function (it, i) { list.appendChild(card(it, kind, b)); if (i + 1 === adAt) { var ac = UI.adCard(kind); if (ac) list.appendChild(ac); } });
    if (!items.length && kind === 'obit') { if (!b.form) root.appendChild(el('p', 'cl-note', 'Funeral homes and families can post an obituary here for free. Obituaries from local newspapers appear below.')); return root; }
    if (!items.length) {
      var emp = el('div', 'cl-empty');
      emp.appendChild(el('p', null, state.q.trim() ? 'Nothing matches your search.' : (kind === 'event' && (b.when && b.when !== 'any' || b.town || b.filter)) ? 'No events match these filters.' : ((kind === 'job' || kind === 'item' || kind === 'deal') && (b.jt || b.town || b.filter)) ? 'No posts match these filters.' : b.items.length ? 'Nothing in this category yet.' : 'Nothing posted yet. Be the first.'));
      if (kind === 'event' && (b.when && b.when !== 'any' || b.town || b.filter)) { emp.appendChild(UI.button('Clear filters', 'primary', function () { b.when = 'any'; b.town = ''; b.filter = ''; drawBoard('event'); })); }
      if ((kind === 'job' || kind === 'item' || kind === 'deal') && (b.jt || b.town || b.filter)) { emp.appendChild(UI.button('Clear filters', 'primary', function () { b.jt = ''; b.town = ''; b.filter = ''; drawBoard(kind); })); }
      list.appendChild(emp);
    }
    root.appendChild(list);
    return root;
  }
  function renderClassifieds() {
    var root = drawBody('item', 'For sale', 'Post an item');
    var more = el('div', 'cl-more');
    more.appendChild(el('div', 'cl-label', 'More local classifieds'));
    var links = el('div', 'cl-links');
    CL.forEach(function (r) { var a = el('a', null, r.name); a.href = 'https://' + r.host + '/search/sss'; a.target = '_blank'; a.rel = 'noopener'; links.appendChild(a); });
    var fb = el('a', null, 'Facebook Marketplace'); fb.href = 'https://www.facebook.com/marketplace/evansville/'; fb.target = '_blank'; fb.rel = 'noopener'; links.appendChild(fb);
    more.appendChild(links);
    more.appendChild(el('p', 'cl-note', 'Meet in a public place and never send money before you see the item.'));
    root.appendChild(more);
  }
  var dlEl = boards.deal.el;
  function renderDeals() { drawBody('deal', 'Local deals and coupons', 'Post a deal'); }
  function renderObits() { drawBody('obit', 'Community obituaries', 'Post an obituary'); }
  /* ---------- Events tab (Bandsintown-style): town dropdown, date chips, Featured/Popular row, rows grouped by date ---------- */
  var EVX_PAGE = 30;
  var ICON_L = [['path', { d: 'M15 18l-6-6 6-6' }]], ICON_R = [['path', { d: 'M9 18l6-6-6-6' }]];
  function evxDate(date, o) { return new Date(date + 'T12:00:00').toLocaleDateString('en-US', o); }
  function evxDayLabel(date) {
    var o = { weekday: 'short', month: 'short', day: 'numeric' }; if (date.slice(0, 4) !== inDays(0).slice(0, 4)) o.year = 'numeric';
    return evxDate(date, o);
  }
  function evxRel(date) { return date === inDays(0) ? 'Today' : date === inDays(1) ? 'Tomorrow' : ''; }
  function evxTime(it) { return it.time ? fmtTime(it.time) + ' CT' : ''; }
  function evxWhere(it) {
    var place = it.place || '', town = townOf(it), bits = [place];
    if (town && place.toLowerCase().indexOf(town.toLowerCase()) < 0) bits.push(town);
    return bits.filter(Boolean).join(' \u00B7 ');
  }
  function evxBadge(it) {
    var t = el('div', 'evx-badge');
    t.appendChild(el('span', 'evx-mo', evxDate(it.date, { month: 'short' })));
    t.appendChild(el('span', 'evx-dd', String(new Date(it.date + 'T12:00:00').getDate())));
    return t;
  }
  function evxTile(it) {
    var t = el('div', 'evx-tile'); t.setAttribute('aria-hidden', 'true');
    t.appendChild(el('span', 'evx-mo', evxDate(it.date, { month: 'short' })));
    t.appendChild(el('span', 'evx-dd', String(new Date(it.date + 'T12:00:00').getDate())));
    t.appendChild(el('span', 'evx-wd', evxDate(it.date, { weekday: 'short' })));
    return t;
  }
  // The picture slot: the event photo with a month/day badge on its corner, or a big date tile when there is no photo.
  function evxPic(it, cls) {
    var pic = el('div', cls), src = photoSrc(it) || it.image || '';
    if (!src) { pic.appendChild(evxTile(it)); return pic; }
    var im = el('img'); picLoading(im); if (it.image) im.referrerPolicy = 'no-referrer'; im.decoding = 'async'; im.alt = ''; im.src = src;
    var badge = evxBadge(it);
    im.addEventListener('error', function () { im.remove(); badge.remove(); pic.appendChild(evxTile(it)); });
    pic.appendChild(im); pic.appendChild(badge);
    return pic;
  }
  function evxPaid() { return el('span', 'evx-paid', 'Featured \u00B7 Paid'); }
  function evxTitle(it, tag) {
    var h = el(tag);
    if (it.link) { var a = el('a', null, it.title); a.href = safeHref(it.link); a.target = '_blank'; a.rel = 'noopener noreferrer'; h.appendChild(a); } else h.textContent = it.title;
    return h;
  }
  // Tickets (ticket sellers) or Details (venue / calendar page): always the event's own source link.
  function evxGo(it) {
    var t = ticketLink(it.link), go = el('a', 'ev-go', t ? 'Tickets' : 'Details'); go.href = safeHref(it.link); go.target = '_blank'; go.rel = 'noopener noreferrer';
    go.setAttribute('aria-label', (t ? 'Tickets for ' : 'Details for ') + it.title + (it.source ? ' on ' + it.source : ''));
    return go;
  }
  function evxReact(it) {
    var news = { title: it.title, link: it.link, source: it.source, sourceId: it.sourceId, published: it.start, image: it.image || '' };
    var sb = UI.heart({
      get: function () { return { on: isSaved(it.link), n: likeCount(news), label: it.title }; },
      toggle: function () { toggleSaved(news); },
      after: function () { sb.paint(); renderTabs(); }
    });
    return actRow(sb, it);
  }
  // Row 5, actions: Tickets/Details (+ "From" price) left, heart and share right; community posts keep contact, Report, Feature here.
  function evxFoot(it, b, price) {
    var foot = el('div', 'evt-foot');
    if (it.feed && it.link) {
      foot.appendChild(evxGo(it));
      if (it.fromPrice && price) { var fp = el('span', 'evr-from', 'From '); fp.appendChild(el('b', null, it.fromPrice)); foot.appendChild(fp); }
      foot.appendChild(evxReact(it));
    } else {
      if (it.contact) foot.appendChild(el('span', 'cl-contact', it.contact));
      actions(it, 'event', b, foot);
    }
    return foot;
  }
  // The card template, the same five slots on every card (an empty slot keeps its height):
  // 1 Featured label + category, 2 title (2 lines), 3 date · time CT, 4 venue · town · via source (1 line), 5 actions.
  function evxBody(it, b, cls, rel, price) {
    var body = el('div', 'evt ' + cls), top = el('div', 'evt-top');
    if (it.featured) top.appendChild(evxPaid());
    if (it.category) top.appendChild(el('span', 'evr-cat', it.category));
    body.appendChild(top);
    var h = evxTitle(it, 'h4'); h.className = 'evt-title'; body.appendChild(h);
    var day = (rel && evxRel(it.date)) || evxDate(it.date, { weekday: 'short', month: 'short', day: 'numeric' });
    body.appendChild(el('div', 'evt-when', [day, evxTime(it)].filter(Boolean).join(' \u00B7 ')));
    var via = it.feed && it.source && (it.place || '').indexOf(it.source) < 0 ? 'via ' + it.source : '';
    var wl = [evxWhere(it), via].filter(Boolean).join(' \u00B7 '), w = el('div', 'evt-where', wl); if (wl) w.title = wl;
    body.appendChild(w);
    body.appendChild(evxFoot(it, b, price));
    return body;
  }
  // One event in the date-grouped list: picture (or date tile) in a fixed-width column on the left, the template on the right.
  function evxRow(it, b) {
    var c = el('article', 'evr' + (it.featured ? ' evr-feat' : ''));
    c.style.setProperty('--c', 'var(--h-' + (EV_HUE[it.category] || 'other') + ')');
    c.appendChild(evxPic(it, 'evr-pic'));
    c.appendChild(evxBody(it, b, 'evr-body', false, true));
    return c;
  }
  // A card in the horizontal Featured / Popular row: picture on top, the same template below.
  function evxCard(it, b) {
    var c = el('article', 'evc' + (it.featured ? ' evr-feat' : ''));
    c.style.setProperty('--c', 'var(--h-' + (EV_HUE[it.category] || 'other') + ')');
    c.appendChild(evxPic(it, 'evc-pic'));
    c.appendChild(evxBody(it, b, 'evc-body', true, false));
    return c;
  }
  // Featured posts first (paid, any date), then this week's most-hearted events; ties go to ticketed shows, then to ones with a photo.
  function evxPopular(all) {
    var feat = all.filter(function (x) { return x.featured; });
    var big = /ticketmaster|ford center|victory theatre/i;
    var wk = all.filter(function (x) { return !x.featured && x.feed && x.link && x.image && x.date <= inDays(6); }).map(function (x, i) {
      return { x: x, i: i, s: likeCount({ link: x.link }) * 10 + (big.test(x.source || '') || ticketLink(x.link) ? 2 : 0) };
    }).sort(function (p, q) { return q.s - p.s || p.i - q.i; }).map(function (p) { return p.x; });
    var seen = {}, out = [];
    feat.concat(wk).forEach(function (x) { var k = (x.title + '|' + x.date).toLowerCase(); if (!seen[k] && out.length < 10) { seen[k] = 1; out.push(x); } });
    return out;
  }
  var EVX_WHEN = [['any', 'All dates'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['weekend', 'This weekend'], ['week', 'This week']];
  function evxWhenText(w) {
    if (w && w.indexOf('d:') === 0) return 'on ' + evxDayLabel(w.slice(2));
    return { today: 'today', tomorrow: 'tomorrow', weekend: 'this weekend', week: 'in the next 7 days' }[w] || '';
  }
  function evxSet(b, k, v) { b[k] = v; b.lim = EVX_PAGE; drawBoard('event'); }
  function evxDateChips(b) {
    var row = el('div', 'cl-chips'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'When');
    var cur = b.when || 'any';
    EVX_WHEN.forEach(function (w) { var c = UI.chip(w[1], cur === w[0], function () { evxSet(b, 'when', w[0]); }); if (w[0] === 'week') c.title = 'Next 7 days'; row.appendChild(c); });
    var picked = cur.indexOf('d:') === 0;
    var pk = el('button', 'cl-chip evx-pick'); pk.type = 'button'; pk.setAttribute('aria-pressed', String(picked));
    pk.appendChild(svg(ICON_CAL)); pk.appendChild(document.createTextNode(picked ? evxDayLabel(cur.slice(2)) : 'Pick a date'));
    var inp = el('input'); inp.type = 'date'; inp.min = inDays(0); inp.max = inDays(400); inp.tabIndex = -1; inp.setAttribute('aria-hidden', 'true');
    if (picked) inp.value = cur.slice(2);
    inp.addEventListener('change', function () { if (inp.value) evxSet(b, 'when', 'd:' + inp.value); });
    pk.setAttribute('aria-label', picked ? 'Date: ' + evxDayLabel(cur.slice(2)) + '. Pick another date' : 'Pick a date');
    pk.addEventListener('click', function () {
      try { if (inp.showPicker) { inp.showPicker(); return; } } catch (e) {}
      var d = window.prompt('Show events on (YYYY-MM-DD)', picked ? cur.slice(2) : inDays(0));
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) evxSet(b, 'when', 'd:' + d);
    });
    // The hidden date input sits next to the button, not inside it (a control inside a button: axe nested-interactive).
    var pw = el('span', 'evx-pickw'); pw.appendChild(pk); pw.appendChild(inp);
    row.appendChild(pw);
    requestAnimationFrame(function () { var on = row.querySelector('[aria-pressed="true"]'); if (on && on.offsetLeft + on.offsetWidth > row.clientWidth) row.scrollLeft = on.offsetLeft - 16; }); // keep the chosen chip in view
    return row;
  }
  function evxHeader(b) {
    var head = el('div', 'evx-head'), ht = el('div', 'evx-ht');
    var real = b.items.concat(feedEvents()), counts = {};
    real.forEach(function (x) { var t = townOf(x); if (t) counts[t] = (counts[t] || 0) + 1; });
    if (b.town && !counts[b.town]) counts[b.town] = 0;
    var towns = Object.keys(counts).sort(function (x, y) { return counts[y] - counts[x] || (x < y ? -1 : 1); });
    var place = b.town ? b.town + ' (' + counts[b.town] + ')' : 'All towns';
    // one compact town dropdown: a native select laid over a chip-style label (towns and counts live in the menu)
    var lab = el(towns.length > 1 ? 'label' : 'span', 'evx-near'); lab.appendChild(svg(ICON_PIN)); lab.appendChild(el('span', null, place));
    if (towns.length > 1) {
      lab.appendChild(svg([['path', { d: 'M6 9l6 6 6-6' }]]));
      var sel = el('select'); sel.setAttribute('aria-label', 'Filter events by town');
      [{ value: '', label: 'All towns' }].concat(towns.map(function (t) { return { value: t, label: t + ' (' + counts[t] + ')' }; })).forEach(function (o) { var op = el('option', null, o.label); op.value = o.value; if ((b.town || '') === o.value) op.selected = true; sel.appendChild(op); });
      sel.addEventListener('change', function () { evxSet(b, 'town', sel.value); });
      lab.appendChild(sel);
    }
    ht.appendChild(lab);
    head.appendChild(ht);
    if (b.configured !== false) {
      var post = el('button', 'cl-go', b.form ? 'Cancel' : 'Add an event'); post.type = 'button';
      post.addEventListener('click', function () { b.form = !b.form; drawBoard('event'); });
      head.appendChild(post);
    }
    return head;
  }
  function evxEmpty(b, all) {
    var box = el('div', 'state evx-empty'), when = b.when && b.when !== 'any', btns = el('div', 'evx-btns');
    var filt = when || b.town || b.filter;
    if (!filt) {
      box.appendChild(el('h2', null, 'No upcoming events yet'));
      box.appendChild(el('p', null, 'Venue calendars and Ticketmaster refresh through the day. Hosting something? Post it free.'));
      if (b.configured !== false) btns.appendChild(UI.button('Add an event', 'primary', function () { b.form = true; drawBoard('event'); }));
    } else {
      var what = [b.filter ? b.filter.toLowerCase() : '', 'events'].filter(Boolean).join(' ');
      box.appendChild(el('h2', null, 'No ' + what + ' ' + (evxWhenText(b.when) || 'match these filters') + (b.town ? ' near ' + b.town : '')));
      // the next date that has something (same town and category) after the chosen day or window, else the soonest one
      var pool = all.filter(function (x) { return (!b.town || townOf(x) === b.town) && (!b.filter || x.category === b.filter) && x.date >= inDays(0); })
        .sort(function (x, y) { return x.date < y.date ? -1 : 1; });
      var w = b.when || 'any', from = w.indexOf('d:') === 0 ? w.slice(2) : w === 'weekend' ? weekendRange()[1] : w === 'week' ? inDays(6) : w === 'tomorrow' ? inDays(1) : inDays(0);
      var after = pool.filter(function (x) { return x.date > from; })[0], nextUp = after || pool[0];
      box.appendChild(el('p', null, after ? 'The next date with events is ' + evxDayLabel(after.date) + '.' : nextUp ? 'Nothing listed after that yet. The soonest is ' + evxDayLabel(nextUp.date) + '.' : 'Try another date or town.'));
      if (nextUp && when) btns.appendChild(UI.button('Go to ' + evxDayLabel(nextUp.date), 'primary', function () { evxSet(b, 'when', 'd:' + nextUp.date); }));
      if (when) btns.appendChild(UI.button('All dates', 'ghost', function () { evxSet(b, 'when', 'any'); }));
      if (b.town || b.filter) btns.appendChild(UI.button('Clear filters', when ? 'ghost' : 'primary', function () { b.when = 'any'; b.town = ''; b.filter = ''; evxSet(b, 'lim', EVX_PAGE); }));
    }
    if (btns.firstChild) box.appendChild(btns);
    return box;
  }
  function renderEvents() {
    var b = boards.event, root = b.el;
    leadPic = true;
    root.textContent = ''; root.classList.add('evx');
    root.appendChild(el('h2', 'sr-only', 'Upcoming events'));
    root.appendChild(evxHeader(b));
    var fl = el('div', 'evx-filters'); fl.appendChild(evxDateChips(b));
    var cats = chips(b, 'event'); cats.setAttribute('role', 'group'); cats.setAttribute('aria-label', 'Category');
    Array.prototype.forEach.call(cats.children, function (c) { c.addEventListener('click', function () { b.lim = EVX_PAGE; }, true); });
    fl.appendChild(cats); root.appendChild(fl);
    var spn = UI.sponsor('events', true); if (spn) root.appendChild(spn); // the only sponsor placement on Events
    if (b.form) root.appendChild(buildForm('event', b));
    if (!state.loaded && !b.items.length) { // feeds still loading: placeholder rows
      var sk = el('div', 'evx-sk'); for (var s = 0; s < 3; s++) { var k = el('div', 'sk-card'); k.appendChild(el('div', 'sk sk-img')); var ln = el('div'); ln.appendChild(el('div', 'sk sk-line')); ln.appendChild(el('div', 'sk sk-line')); k.appendChild(ln); sk.appendChild(k); }
      root.appendChild(sk); return root;
    }
    var items = shownItems(b, 'event');
    var plain = !(b.when && b.when !== 'any') && !b.town && !b.filter;
    if (plain && items.length) {
      var pop = evxPopular(items);
      if (pop.length) {
        var sec = el('section', 'evx-sec evx-pop'), sh = el('div', 'evx-sh'), hasF = pop.some(function (x) { return x.featured; });
        sec.setAttribute('aria-label', hasF ? 'Featured and popular this week' : 'Popular this week');
        sh.appendChild(el('h3', null, hasF ? 'Featured & popular this week' : 'Popular this week'));
        var rail = el('div', 'evx-rail'), ar = el('div', 'evx-arrows');
        [[ICON_L, -1, 'Scroll back'], [ICON_R, 1, 'Scroll forward']].forEach(function (a) { var bt = el('button'); bt.type = 'button'; bt.setAttribute('aria-label', a[2]); bt.appendChild(svg(a[0])); bt.addEventListener('click', function () { rail.scrollBy({ left: a[1] * rail.clientWidth * 0.8, behavior: 'smooth' }); }); ar.appendChild(bt); });
        sh.appendChild(ar); sec.appendChild(sh);
        pop.forEach(function (it) { rail.appendChild(evxCard(it, b)); });
        sec.appendChild(rail); root.appendChild(sec);
      }
    }
    if (!items.length) { root.appendChild(evxEmpty(b, b.items.concat(feedEvents()))); return root; }
    var rows = items.slice().sort(function (x, y) { var p = x.date + (x.time || '99'), q = y.date + (y.time || '99'); return p < q ? -1 : p > q ? 1 : (y.featured ? 1 : 0) - (x.featured ? 1 : 0); });
    var lim = b.lim || EVX_PAGE, shown = rows.slice(0, lim), groups = [], byDay = {};
    shown.forEach(function (it) { if (!byDay[it.date]) { byDay[it.date] = []; groups.push(it.date); } byDay[it.date].push(it); });
    var dayCount = {}; rows.forEach(function (it) { dayCount[it.date] = (dayCount[it.date] || 0) + 1; });
    var list = el('div', 'evx-sec'), seen = 0, adAt = state.q.trim() ? -1 : (window.TSNAds ? TSNAds.position(shown.length) : -1); // one ad card per board view
    groups.forEach(function (d) {
      var g = el('section', 'evx-day'), h = el('h3'), rel = evxRel(d);
      if (rel) h.appendChild(el('span', 'evx-rel', rel));
      h.appendChild(document.createTextNode(evxDayLabel(d)));
      h.appendChild(el('small', null, String(dayCount[d])));
      g.setAttribute('aria-label', (rel ? rel + ', ' : '') + evxDayLabel(d));
      g.appendChild(h);
      byDay[d].forEach(function (it) { g.appendChild(evxRow(it, b)); if (++seen === adAt) { var ac = UI.adCard('event'); if (ac) g.appendChild(ac); } });
      list.appendChild(g);
    });
    root.appendChild(list);
    if (rows.length > shown.length) {
      var mw = el('div', 'evx-more'); mw.appendChild(UI.button('Show more events (' + (rows.length - shown.length) + ' left)', null, function () { b.lim = lim + EVX_PAGE; drawBoard('event'); }));
      root.appendChild(mw);
    }
    return root;
  }
  var JOB_BOARDS = [
    ['Indeed: Evansville', 'https://www.indeed.com/jobs?l=Evansville%2C+IN'],
    ['Indeed: Owensboro', 'https://www.indeed.com/jobs?l=Owensboro%2C+KY'],
    ['LinkedIn: Evansville', 'https://www.linkedin.com/jobs/search/?location=Evansville%2C%20Indiana'],
    ['Indiana Career Connect', 'https://www.indianacareerconnect.com/'],
    ['Kentucky Career Center', 'https://kcc.ky.gov/'],
    ['IllinoisJobLink', 'https://illinoisjoblink.illinois.gov/'],
    ['USAJOBS', 'https://www.usajobs.gov/Search/Results?l=Evansville%2C%20Indiana']
  ];
  function renderJobs() {
    var root = drawBody('job', 'Local jobs', 'Post a job');
    var more = el('div', 'cl-more');
    more.appendChild(el('div', 'cl-label', 'More job boards'));
    var links = el('div', 'cl-links');
    JOB_BOARDS.forEach(function (r) { var a = el('a', null, r[0]); a.href = r[1]; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.appendChild(a); });
    more.appendChild(links);
    more.appendChild(el('p', 'cl-note', 'Employers post here for free. Never pay a fee to apply, and be careful with offers that ask for bank details.'));
    root.appendChild(more);
  }

  /* ---------- submit news ---------- */
  var snEl = document.getElementById('sn'), SN_TYPES = ['News tip', 'Photo or video', 'Press release', 'Correction'];
  var SN_DONE = '', SN_VIEW = 'news';
  function icoCheck() { var n = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); n.setAttribute('viewBox', '0 0 24 24'); n.setAttribute('fill', 'none'); n.setAttribute('stroke-width', '2'); n.setAttribute('stroke-linecap', 'round'); n.setAttribute('stroke-linejoin', 'round'); n.setAttribute('aria-hidden', 'true'); var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M20 6 9 17l-5-5'); n.appendChild(p); return n; }
  function openSubmit() { SN_DONE = ''; state.prevCat = state.cat === 'submit' ? (state.prevCat || 'news') : state.cat; state.cat = 'submit'; resetPaging(); render(); window.scrollTo(0, 0); }
  function closeSubmit() { state.cat = state.prevCat || 'news'; resetPaging(); render(); window.scrollTo(0, 0); }
  function renderSubmit() {
    if (SN_VIEW === 'ad') return renderAdvertise();
    snEl.textContent = '';
    var bar = el('div', 'cl-bar'); bar.appendChild(el('b', null, 'Submit news'));
    var back = el('button', 'cl-go', 'Back to news'); back.type = 'button'; back.addEventListener('click', closeSubmit); bar.appendChild(back); snEl.appendChild(bar);
    if (SN_DONE) {
      var d = el('div', 'sn-done'); d.setAttribute('role', 'status');
      d.appendChild(el('h2', null, 'Thanks, we got it'));
      d.appendChild(el('p', 'sn-lede', 'Your submission is with our team. Not every tip is published, and we may contact you for more detail. Keep this reference number if you need to follow up:'));
      d.appendChild(el('span', 'sn-ref', SN_DONE));
      var again = el('button', 'cl-go', 'Send another'); again.type = 'button'; again.addEventListener('click', function () { SN_DONE = ''; renderSubmit(); });
      d.appendChild(again); snEl.appendChild(d); return;
    }
    snEl.appendChild(el('p', 'sn-lede', 'See something happening in the Tri-State? Send us a tip, a photo, a press release or a correction. We review every submission.'));
    var al = el('div', 'sn-alert'); al.appendChild(el('b', null, 'Emergency? Call 911. ')); al.appendChild(document.createTextNode('This form isn’t monitored around the clock.')); snEl.appendChild(al);

    var f = el('form', 'cl-form'); f.noValidate = true;
    var F = {}, els = {};
    els.type = segmented('type', SN_TYPES); F.type = field('What are you sending?', els.type, { req: true });
    els.headline = input('text', 'headline', 120, 'Road closed on Highway 41 after crash'); F.headline = field('Headline', els.headline, { req: true, hint: 'A short summary, like a newspaper headline.' });
    els.details = el('textarea'); els.details.name = 'details'; els.details.id = 'f-details' + (++uidSeq); els.details.rows = 6; els.details.maxLength = 3000; els.details.placeholder = 'Who, what, where, when. Include names, spellings and anything we can check.';
    F.details = field('What happened', els.details, { req: true }); F.details.appendChild(counter(els.details, 3000));
    els.town = townSelect(); F.town = field('Nearest town', els.town, { req: true });
    els.when = input('date', 'when', 10); els.when.max = inDays(0); F.when = field('Date it happened', els.when);
    els.ph1 = photoPicker('Add a photo', { edge: 1000, cap: 190000 }); els.ph2 = photoPicker('Add another', { edge: 1000, cap: 190000 });
    var phw = el('div', 'sn-ph'); phw.appendChild(els.ph1); phw.appendChild(els.ph2);
    F.photos = field('Photos', phw, { hint: 'Up to two. Only send photos you took or have permission to share.' });
    els.name = input('text', 'name', 60, 'Your name'); els.name.autocomplete = 'name'; F.name = field('Your name', els.name, { req: true });
    els.email = input('email', 'email', 80, 'name@email.com'); els.email.autocomplete = 'email'; F.email = field('Email', els.email, { req: true, hint: 'Only used to follow up. Never published.' });
    els.phone = input('tel', 'phone', 20, '812-555-0142'); els.phone.autocomplete = 'tel'; F.phone = field('Phone', els.phone);
    els.hp = input('text', 'website', 40); els.hp.tabIndex = -1; els.hp.autocomplete = 'off'; var hp = el('div', 'sn-hp'); hp.setAttribute('aria-hidden', 'true'); hp.appendChild(els.hp);

    function check(id, text) { var i = el('input'); i.type = 'checkbox'; i.id = 'f-' + id + (++uidSeq); var l = el('label', 'cl-check'); l.setAttribute('for', i.id); l.appendChild(i); l.appendChild(document.createTextNode(text)); l.input = i; return l; }
    els.anon = check('anon', 'Don’t publish my name if you use this');
    els.consent = check('consent', 'I’m 18 or older. I’m the source of this information or have permission to share it, and I understand submitting doesn’t guarantee it will be published.');
    F.consent = el('div', 'sn-sec'); F.consent.appendChild(els.consent); var ce = el('div', 'cl-fe'); ce.setAttribute('role', 'alert'); F.consent.appendChild(ce); F.consent.err = function (m) { ce.textContent = m || ''; };

    function sec(title) { var s = el('div', 'sn-sec'); s.appendChild(el('h2', null, title)); return s; }
    function bare(x) { f.appendChild(x); }
    var s1 = sec('Your story'); [F.type, F.headline, F.details].forEach(function (x) { s1.appendChild(x); });
    var r1 = el('div', 'cl-two'); r1.appendChild(F.town); r1.appendChild(F.when); s1.appendChild(r1); s1.appendChild(F.photos);
    var s2 = sec('Your contact info'); s2.appendChild(F.name); var r2 = el('div', 'cl-two'); r2.appendChild(F.email); r2.appendChild(F.phone); s2.appendChild(r2); s2.appendChild(els.anon); 
    f.style.border = '0'; f.style.padding = '0';
    bare(s1); bare(s2); bare(hp); bare(F.consent);
    var top = el('div', 'cl-err'); top.setAttribute('role', 'alert'); bare(top);
    var go = el('button', 'cl-go cl-wide', 'Send submission'); go.type = 'submit'; bare(go);
    snEl.appendChild(f);

    var tips = sec('What we’re looking for');
    var ul = el('ul', 'sn-list');
    ['Local news: crashes, closures, openings, council and school board decisions', 'Photos and video of events in our area (with permission to share)', 'Press releases from local businesses, schools, churches and nonprofits', 'Corrections to anything we link to or summarize'].forEach(function (t) { var li = el('li'); li.appendChild(icoCheck()); li.appendChild(el('span', null, t)); ul.appendChild(li); });
    tips.appendChild(ul); snEl.appendChild(tips);
    var fine = sec('Good to know');
    ['Please be accurate and stick to what you know firsthand. We may verify before using anything.', 'We don’t publish tips that name private individuals accused of a crime.', 'Your email and phone number are never published.'].forEach(function (t) { fine.appendChild(el('p', 'cl-note', t)); });
    fine.appendChild(legalNote('By sending'));
    snEl.appendChild(fine);

    var order = ['headline', 'details', 'town', 'when', 'name', 'email', 'phone', 'consent'];
    function show(e) {
      order.forEach(function (k) { if (F[k]) F[k].err(e[k] || ''); });
      var first = order.filter(function (k) { return e[k]; })[0];
      if (first) { var n = F[first].querySelector('input,select,textarea'); if (n) n.focus(); }
    }
    function clientCheck() {
      var e = {};
      if (els.headline.value.trim().length < 5) e.headline = 'Add a short headline (at least 5 characters).';
      if (els.details.value.trim().length < 30) e.details = 'Tell us a little more (at least 30 characters).';
      if (!els.town.value) e.town = 'Choose the nearest town.';
      if (els.when.value && els.when.value > inDays(0)) e.when = 'Pick a date that has already happened.';
      if (els.name.value.trim().length < 2) e.name = 'Add your name.';
      if (!EMAIL_RE.test(els.email.value.trim())) e.email = 'Enter a valid email address.';
      if (els.phone.value.trim() && !PHONE_RE.test(els.phone.value.trim())) e.phone = 'Enter a phone number like 812-555-0142, or leave it blank.';
      if (!els.consent.input.checked) e.consent = 'Please confirm this statement.';
      return e;
    }
    f.addEventListener('submit', function (ev) {
      ev.preventDefault(); top.textContent = '';
      var e = clientCheck(); show(e); if (Object.keys(e).length) return;
      go.disabled = true; go.textContent = 'Sending…';
      var body = { type: els.type.value || 'News tip', headline: els.headline.value, details: els.details.value, town: els.town.value, when: els.when.value, name: els.name.value, email: els.email.value, phone: els.phone.value, anon: els.anon.input.checked, consent: true, website: els.hp.value, photos: [els.ph1.value, els.ph2.value].filter(Boolean) };
      fetch('/api/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (o) {
          go.disabled = false; go.textContent = 'Send submission';
          if (!o.ok || !o.d.ok) { var m = (o.d && o.d.error) || 'Couldn’t send that. Try again.'; if (o.d && o.d.field && F[o.d.field]) { var q = {}; q[o.d.field] = m; show(q); } else top.textContent = m; return; }
          SN_DONE = o.d.ref || 'Received'; renderSubmit(); window.scrollTo(0, 0);
        }).catch(function () { go.disabled = false; go.textContent = 'Send submission'; top.textContent = 'Couldn’t send that. Check your connection and try again.'; });
    });
  }
  document.getElementById('snOpen').addEventListener('click', function () { SN_VIEW = 'news'; openSubmit(); });
  document.getElementById('adOpen').addEventListener('click', openAd);
  // /advertise sends here (#advertise) while the advertising page is switched off (ADS_PAGE): open the Advertise form.
  if (location.hash === '#advertise') setTimeout(function () { openAd(); try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) {} }, 0);

  /* ---------- newsletter signup ---------- */
  var nlEl = document.getElementById('nl'), NL_KEY = 'tsn.nl';
  var NL_WAS = (function () { try { return !!localStorage.getItem(NL_KEY); } catch (e) { return false; } })();
  function renderNewsletter() {
    nlEl.textContent = '';
    nlEl.appendChild(el('h2', null, 'The Tri-State in your inbox'));
    nlEl.appendChild(el('p', null, 'Top local stories, events and jobs in one short email. Free, and you can leave anytime. We’ll ask you to confirm by email.'));
    var f = el('form'); f.noValidate = true;
    var em = el('input'); em.type = 'email'; em.name = 'email'; em.placeholder = 'name@email.com'; em.autocomplete = 'email'; em.setAttribute('aria-label', 'Email address'); em.maxLength = 80;
    var hp = el('input'); hp.type = 'text'; hp.name = 'website'; hp.tabIndex = -1; hp.autocomplete = 'off'; hp.className = 'sn-hp'; hp.setAttribute('aria-hidden', 'true');
    var go = el('button', 'cl-go', 'Subscribe'); go.type = 'submit';
    var msg = el('div', 'cl-fe'); msg.setAttribute('role', 'alert');
    f.appendChild(em); f.appendChild(hp); f.appendChild(go); nlEl.appendChild(f); nlEl.appendChild(msg);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault(); msg.textContent = '';
      if (!EMAIL_RE.test(em.value.trim())) { msg.textContent = 'Enter a valid email address.'; em.setAttribute('aria-invalid', 'true'); em.focus(); return; }
      em.removeAttribute('aria-invalid'); go.disabled = true; go.textContent = 'Subscribing…';
      fetch('/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: em.value.trim(), website: hp.value }) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (o) {
          go.disabled = false; go.textContent = 'Subscribe';
          if (!o.ok || !o.d.ok) { msg.textContent = (o.d && o.d.error) || 'Couldn’t sign you up. Try again.'; return; }
          try { localStorage.setItem(NL_KEY, '1'); } catch (e) {}
          // Double opt-in: nothing is sent until the reader taps the link in the confirmation email (api/_subscribe.js).
          nlEl.textContent = ''; nlEl.appendChild(el('h2', null, o.d.emailSent ? 'Check your email' : 'Almost there')); var p = el('p', null, o.d.message || 'Check your email to confirm.'); p.setAttribute('role', 'status'); nlEl.appendChild(p);
        }).catch(function () { go.disabled = false; go.textContent = 'Subscribe'; msg.textContent = 'Couldn’t sign you up. Check your connection and try again.'; });
    });
  }
  renderNewsletter();

  /* ---------- advertise ---------- */
  var AD_INTERESTS = ['Featured job or deal', 'Section sponsorship', 'Newsletter sponsorship', 'Something else'];
  function openAd() { SN_VIEW = 'ad'; SN_DONE = ''; openSubmit(); }
  function renderAdvertise() {
    snEl.textContent = '';
    var bar = el('div', 'cl-bar'); bar.appendChild(el('b', null, 'Advertise with Tri-State News'));
    bar.appendChild(UI.button('Back', 'cl-go', closeSubmit)); snEl.appendChild(bar);
    if (SN_DONE) {
      var d = el('div', 'sn-done'); d.setAttribute('role', 'status');
      d.appendChild(el('h2', null, 'Thanks, we got it'));
      d.appendChild(el('p', 'sn-lede', 'We’ll reply by email, usually within a business day. Your reference number:'));
      d.appendChild(el('span', 'sn-ref', SN_DONE)); snEl.appendChild(d); return;
    }
    snEl.appendChild(el('p', 'sn-lede', 'Reach people across Evansville, Henderson, Owensboro and the Tri-State who come here for local news, events, jobs and deals.'));
    var rt = el('div', 'sn-sec'); rt.appendChild(el('h2', null, 'Ways to be seen'));
    var ul = el('ul', 'rates'), pr = PAY.prices || {};
    [['job', 'Featured job'], ['deal', 'Featured deal'], ['event', 'Featured event'], ['item', 'Featured classified']].forEach(function (k) {
      if (!pr[k[0]]) return;
      var li = el('li'); li.appendChild(el('span', null, k[1] + ' · ' + pr[k[0]].days + ' days at the top of its list')); li.appendChild(el('b', null, money(pr[k[0]].cents))); ul.appendChild(li);
    });
    [['Newsletter sponsorship', 'One sponsor in each email', 'Coming soon']].forEach(function (k) {
      var li = el('li'), sp = el('span', null, k[0] + ' · ' + k[1]); li.appendChild(sp); li.appendChild(el('b', null, k[2])); ul.appendChild(li);
      // Not for sale until 1,500 confirmed subscribers (api/_catalog.js newsletter gate); the live count comes from the catalog.
      fetch('/api/catalog').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (c) {
        // The count stays hidden until there are SHOW_SUBSCRIBERS_AT confirmed subscribers ("0 of 1,500" read badly, audit 2026-10-22).
        var g = c.newsletterGate || {}; if (g.verifiedSubscribers == null || g.verifiedSubscribers < SHOW_SUBSCRIBERS_AT) return;
        sp.appendChild(el('span', 'nl-gate', ' (' + Number(g.verifiedSubscribers).toLocaleString('en-US') + ' of ' + Number(g.minVerifiedSubscribers).toLocaleString('en-US') + ' subscribers)'));
      }).catch(function () {});
    });
    rt.appendChild(ul);
    // A link to the full rates page, only when it's switched on (/advertise answers 200; off, it redirects back here).
    var full = el('p', 'cl-note'); full.hidden = true; rt.appendChild(full);
    fetch('/advertise', { method: 'HEAD', redirect: 'manual', cache: 'no-store' }).then(function (r) {
      if (r.status !== 200) return;
      var a = el('a', null, 'See all rates and packages'); a.href = '/advertise'; full.appendChild(a); full.hidden = false;
    }).catch(function () {});
    if (PAY.configured) rt.appendChild(el('p', 'cl-note', 'To feature a post, publish it on its board, then tap “Feature” on your post.'));
    snEl.appendChild(rt);
    // Ad packages A-C, ordered online (/order.html). Prices and contents come only from /api/packages (api/_catalog.js).
    var pks = el('div', 'sn-sec sn-pk'); pks.hidden = true; pks.appendChild(el('h2', null, 'Ad packages'));
    pks.appendChild(el('p', 'cl-note', '30 days, labeled “Sponsored”, in rotation with up to two other local businesses. Order online; we review your ad before it runs.'));
    var pkl = el('ul', 'rates'); pks.appendChild(pkl); snEl.appendChild(pks);
    fetch('/api/packages').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
      ['A', 'B', 'C'].forEach(function (k) {
        var p = d.packages && d.packages[k]; if (!p) return;
        var c = p.contents || {}, bits = [];
        if (c.newsCard) bits.push('News ad');
        bits.push(c.boardCards >= 4 ? 'card on every board' : 'card on ' + c.boardCards + (c.boardCards === 1 ? ' board' : ' boards'));
        bits.push(c.sponsorLines + (c.sponsorLines === 1 ? ' sponsor line' : ' sponsor lines'));
        if (c.sideAds) bits.push('side ads');
        var li = el('li'), a = el('a', null, p.label); a.href = '/order.html?pkg=' + k;
        var sp = el('span'); sp.appendChild(a); sp.appendChild(document.createTextNode(' · ' + bits.join(', '))); li.appendChild(sp);
        li.appendChild(el('b', null, money(p.cents))); pkl.appendChild(li);
      });
      var o = el('a', 'sn-pk-go', 'Order a package'); o.href = '/order.html'; pks.appendChild(o);
      pks.appendChild(el('p', 'cl-note', 'Sponsored features: coming soon.'));
      pks.hidden = false;
    }).catch(function () {});
    // What the ads look like: every IAB size we use, previewed with a made-up sample business (public/adsizes.js).
    // Readers reach advertising here (/advertise redirects to #advertise while ADS_PAGE is off), so the previews are here too.
    if (window.TSNSizes) {
      var sz = el('div', 'sn-sec'); sz.appendChild(el('h2', null, 'Ad sizes and where they run'));
      sz.appendChild(el('p', 'cl-note', 'Standard sizes, built from your picture, headline, short text and button, or a finished banner you send. These use a made-up business.'));
      // collapsed behind "See ad sizes" so the inquiry form stays near the top
      var gal = el('div', 'sn-sizes'), tg = TSNSizes.toggle(document, gal, 'sn-sizes');
      sz.appendChild(tg); sz.appendChild(gal); snEl.appendChild(sz);
    }
    var f = el('form', 'cl-form'); f.noValidate = true;
    var F = {}, els = {};
    els.business = input('text', 'business', 80, 'Your business name'); F.business = field('Business', els.business, { req: true });
    els.name = input('text', 'name', 60, 'Your name'); els.name.autocomplete = 'name'; F.name = field('Your name', els.name, { req: true });
    els.email = input('email', 'email', 80, 'name@email.com'); els.email.autocomplete = 'email'; F.email = field('Email', els.email, { req: true });
    els.phone = input('tel', 'phone', 20, '812-555-0142'); els.phone.autocomplete = 'tel'; F.phone = field('Phone', els.phone);
    els.interest = UI.select({ name: 'interest', id: 'f-interest' + (++uidSeq), options: AD_INTERESTS }); F.interest = field('Interested in', els.interest, { req: true });
    els.message = el('textarea'); els.message.name = 'message'; els.message.id = 'f-message' + (++uidSeq); els.message.rows = 4; els.message.maxLength = 1500; els.message.placeholder = 'Tell us about your business and what you’d like to promote.'; F.message = field('Message', els.message);
    els.hp = input('text', 'website', 40); els.hp.tabIndex = -1; els.hp.autocomplete = 'off'; var hp = el('div', 'sn-hp'); hp.setAttribute('aria-hidden', 'true'); hp.appendChild(els.hp);
    var two = el('div', 'cl-two'); two.appendChild(F.email); two.appendChild(F.phone);
    [F.business, F.name, two, F.interest, F.message, hp].forEach(function (x) { f.appendChild(x); });
    var top = el('div', 'cl-err'); top.setAttribute('role', 'alert'); f.appendChild(top);
    f.appendChild(legalNote('By sending this'));
    var go = el('button', 'cl-go cl-wide', 'Send inquiry'); go.type = 'submit'; f.appendChild(go);
    snEl.appendChild(f);
    function show(e) { ['business', 'name', 'email', 'phone'].forEach(function (k) { F[k].err(e[k] || ''); }); var first = ['business', 'name', 'email', 'phone'].filter(function (k) { return e[k]; })[0]; if (first) F[first].querySelector('input').focus(); }
    f.addEventListener('submit', function (ev) {
      ev.preventDefault(); top.textContent = '';
      var e = {};
      if (els.business.value.trim().length < 2) e.business = 'Add your business name.';
      if (els.name.value.trim().length < 2) e.name = 'Add your name.';
      if (!EMAIL_RE.test(els.email.value.trim())) e.email = 'Enter a valid email address.';
      if (els.phone.value.trim() && !PHONE_RE.test(els.phone.value.trim())) e.phone = 'Enter a phone number like 812-555-0142, or leave it blank.';
      show(e); if (Object.keys(e).length) return;
      go.disabled = true; go.textContent = 'Sending…';
      fetch('/api/advertise', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ business: els.business.value, name: els.name.value, email: els.email.value, phone: els.phone.value, interest: els.interest.value, message: els.message.value, website: els.hp.value }) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (o) {
          go.disabled = false; go.textContent = 'Send inquiry';
          if (!o.ok || !o.d.ok) { var m = (o.d && o.d.error) || 'Couldn’t send that. Try again.'; if (o.d && o.d.field && F[o.d.field]) { var q = {}; q[o.d.field] = m; show(q); } else top.textContent = m; return; }
          SN_DONE = o.d.ref || 'Received'; renderAdvertise(); window.scrollTo(0, 0);
        }).catch(function () { go.disabled = false; go.textContent = 'Send inquiry'; top.textContent = 'Couldn’t send that. Check your connection and try again.'; });
    });
  }

  /* ---------- sponsors, paid placement and return from checkout ---------- */
  // Only creatives an admin approved (api/_creative.js) fill sponsor lines, cards and side ads; the same list for
  // every reader. From sponsors.json the page reads only "samples": placeholder sample ads for unsold spots, labeled
  // "Sample ad", one switch ("on") for all of them. A real ad always comes first.
  Promise.all([
    fetch('/api/creative?live=1').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch('/sponsors.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (got) {
    var d = got[0], sj = got[1];
    SPONSORS = d && d.slots ? d.slots : {};
    SPONSORS.__rails = d && d.rails ? d.rails : {};
    SPONSORS.__cards = d && d.cards ? d.cards : {};
    SPONSORS.__samples = sj && sj.samples ? sj.samples : null;
    UI.rails(state.cat);
    Object.keys(boards).forEach(drawBoard);
  });
  // Prices and durations come from the server's catalog (api/_catalog.js via /api/catalog), the same table checkout charges.
  fetch('/api/catalog').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (d && d.featured) {
      var f = d.featured, on = Object.keys(f).some(function (k) { return f[k].purchasable; });
      PAY = { configured: on, prices: f, version: d.priceVersion || '' }; Object.keys(boards).forEach(drawBoard);
    }
  }).catch(function () {});
  (function () {
    var m = /[?&]featured=(ok|cancel)/.exec(location.search); if (!m) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    if (m[1] === 'ok') { UI.notice('Payment received. Your post will show as featured in a moment.'); [4000, 12000].forEach(function (t) { setTimeout(function () { Object.keys(boards).forEach(loadBoard); }, t); }); }
    else UI.notice('Checkout canceled. Your post is still live, just not featured.');
  })();

  /* ---------- search ---------- */
  // One index over stories, events, obituaries and any loaded classifieds or deals. Every word must match somewhere;
  // title hits outrank venue/town, which outrank source, which outrank the summary. Matching forgives plurals,
  // endings, prefixes and small typos, and newer or sooner items rank higher.
  var RECENT_KEY = 'tsn.recent', W = { t: 5, v: 3, s: 2, b: 1 };
  var STOP = { the: 1, a: 1, an: 1, of: 1, in: 1, at: 1, on: 1, and: 1, to: 1, for: 1, is: 1, near: 1 };
  var TYPES = [['news', 'Stories'], ['events', 'Events'], ['obits', 'Obituaries'], ['jobs', 'Jobs'], ['classifieds', 'Classifieds'], ['deals', 'Deals']];
  var PREVIEW = { news: 5, events: 4, obits: 4, jobs: 4, classifieds: 4, deals: 4 };
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function toks(s) { var n = norm(s); return n ? n.split(' ') : []; }
  function stem(w) {
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 3 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    if (w.length > 4 && /ed$/.test(w)) return w.slice(0, -2);
    return w;
  }
  function lev(a, b, max) { // Damerau-Levenshtein, gives up past `max`
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var m = a.length, n = b.length, prev2 = null, prev = [], cur, i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i]; var rowMin = i;
      for (j = 1; j <= n; j++) {
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[n];
  }
  function tokScore(q, t, last) {
    if (t === q) return 1;
    if (q.length >= 2 && t.indexOf(q) === 0 && (last || q.length >= 4)) return last ? 0.85 : 0.7;
    if (stem(q) === stem(t)) return 0.9;
    if (q.length >= 4) { var lim = q.length >= 8 ? 2 : 1, d = lev(q, t, lim); if (d <= lim) return 0.6 - 0.05 * d; }
    return 0;
  }
  var docCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function areaOf(id) { var s = state.sources.filter(function (x) { return x.id === id; })[0]; return s ? s.area : ''; }
  function mkDoc(type, it) {
    var f;
    if (type === 'news' || type === 'obits') f = { t: toks(it.title), v: toks(areaOf(it.sourceId) || it.town), s: toks(it.source || it.business), b: toks(it.summary || it.desc) };
    else if (type === 'events') f = { t: toks(it.title), v: toks([it.place, it.town, it.category].join(' ')), s: toks(it.source || ''), b: toks(it.desc) };
    else f = { t: toks(it.title), v: toks([it.town, it.category, it.jobType, it.pay].filter(Boolean).join(' ')), s: toks(it.business || ''), b: toks(it.desc) };
    return { type: type, it: it, f: f, title: norm(it.title) };
  }
  function getDoc(type, it) {
    if (docCache && type !== 'events') { var d = docCache.get(it); if (d) return d; d = mkDoc(type, it); docCache.set(it, d); return d; }
    return mkDoc(type, it);
  }
  function corpus() {
    var docs = [];
    state.items.forEach(function (i) { var k = kindOf(i.sourceId); if (k === 'events') return; docs.push(getDoc(k === 'obits' ? 'obits' : 'news', i)); });
    boards.event.items.concat(feedEvents()).forEach(function (e) { docs.push(getDoc('events', e)); });
    boards.job.items.forEach(function (x) { docs.push(getDoc('jobs', x)); });
    boards.obit.items.forEach(function (x) { docs.push(getDoc('obits', x)); });
    boards.item.items.forEach(function (x) { docs.push(getDoc('classifieds', x)); });
    boards.deal.items.forEach(function (x) { docs.push(getDoc('deals', x)); });
    return docs;
  }
  function scoreDoc(d, qs) {
    var total = 0, i, k, j;
    for (i = 0; i < qs.length; i++) {
      var q = qs[i], last = i === qs.length - 1, best = 0;
      for (k in W) { var arr = d.f[k]; for (j = 0; j < arr.length; j++) { var sc = tokScore(q, arr[j], last) * W[k]; if (sc > best) best = sc; } }
      if (!best) return 0;
      total += best;
    }
    if (qs.length > 1 && d.title.indexOf(qs.join(' ')) >= 0) total += 4;
    var now = Date.now();
    if (d.type === 'news' || d.type === 'obits') { var age = (now - Date.parse(d.it.published)) / 864e5; if (age >= 0) total *= 1 + 0.5 * Math.exp(-age / 3); }
    else if (d.type === 'events') { var dd = (Date.parse(d.it.date + 'T12:00:00') - now) / 864e5; if (dd >= -1 && dd < 14) total *= 1 + 0.3 * (1 - Math.max(0, dd) / 14); }
    return total;
  }
  function queryWords(q) { var t = toks(q), keep = t.filter(function (w) { return !STOP[w]; }); return keep.length ? keep : t; }
  function vocabOf(docs) {
    var v = {};
    docs.forEach(function (d) { ['t', 'v', 's'].forEach(function (k) { d.f[k].forEach(function (w) { if (w.length > 2 && !STOP[w] && !/^\d+$/.test(w)) v[w] = (v[w] || 0) + 1; }); }); });
    return v;
  }
  function nearest(word, vocab) {
    var lim = word.length >= 8 ? 2 : 1, best = null, bd = 9, bc = 0;
    if (word.length < 4) return null;
    for (var w in vocab) { if (Math.abs(w.length - word.length) > lim) continue; var d = lev(word, w, lim); if (d <= lim && (d < bd || (d === bd && vocab[w] > bc))) { best = w; bd = d; bc = vocab[w]; } }
    return best;
  }
  function runSearch(q) {
    var qs = queryWords(q), docs = corpus(), groups = { news: [], events: [], obits: [], jobs: [], classifieds: [], deals: [] }, total = 0;
    if (!qs.length) return { words: qs, groups: groups, total: 0, mean: '' };
    docs.forEach(function (d) { var sc = scoreDoc(d, qs); if (sc > 0) { groups[d.type].push({ d: d, sc: sc }); total++; } });
    TYPES.forEach(function (t) { groups[t[0]].sort(function (a, b) { return b.sc - a.sc; }); });
    var mean = '';
    if (!total) {
      var vocab = vocabOf(docs), changed = false;
      mean = qs.map(function (w) { if (vocab[w]) return w; var n = nearest(w, vocab); if (n) { changed = true; return n; } return w; }).join(' ');
      if (!changed) mean = '';
    }
    return { words: qs, groups: groups, total: total, mean: mean };
  }
  function highlight(node, words) {
    if (!words.length || !node) return;
    var text = node.textContent, out = document.createDocumentFragment(), re = /[A-Za-z0-9À-ɏ]+/g, last = 0, m, hit = false;
    while ((m = re.exec(text))) {
      var t = norm(m[0]), on = false;
      if (t) for (var i = 0; i < words.length; i++) { if (tokScore(words[i], t, i === words.length - 1) >= 0.6) { on = true; break; } }
      if (on) { if (m.index > last) out.appendChild(document.createTextNode(text.slice(last, m.index))); out.appendChild(el('mark', null, m[0])); last = m.index + m[0].length; hit = true; }
    }
    if (!hit) return;
    if (last < text.length) out.appendChild(document.createTextNode(text.slice(last)));
    node.textContent = ''; node.appendChild(out);
  }
  function hlCard(c, words) { c.querySelectorAll('h2, h3 a, h3, .ev-desc, .ev-row span, .cl-desc, .card p').forEach(function (n) { if (!n.children.length) highlight(n, words); }); }

  var srEl = document.getElementById('sr');
  function renderSearch(sq) {
    var res = runSearch(sq), words = res.words;
    mapLogos();
    srEl.textContent = '';
    metaEl.textContent = res.total + ' result' + (res.total === 1 ? '' : 's') + ' for “' + sq + '”';
    if (!res.total) {
      var box = el('div', 'state'); box.appendChild(el('h2', null, 'No results for “' + sq + '”'));
      if (res.mean) {
        var p = el('p', null, 'Did you mean '); var dm = el('button', 'sr-mean', res.mean); dm.type = 'button';
        dm.addEventListener('click', function () { setQuery(res.mean, true); }); p.appendChild(dm); p.appendChild(document.createTextNode('?')); box.appendChild(p);
      } else box.appendChild(el('p', null, 'Try fewer or different words, or browse a tab above.'));
      var row = el('div', 'sr-try'); ['Evansville', 'Owensboro', 'Henderson', 'concert', 'obituary'].forEach(function (w) { var b = el('button', 'cl-chip', w); b.type = 'button'; b.addEventListener('click', function () { setQuery(w, true); }); row.appendChild(b); });
      box.appendChild(row); srEl.appendChild(box); return;
    }
    var bar = el('div', 'sr-bar'), allBtn = el('button', 'cl-chip', 'All ' + res.total); allBtn.type = 'button'; allBtn.setAttribute('aria-pressed', String(state.sf === 'all'));
    allBtn.addEventListener('click', function () { state.sf = 'all'; state.srl = PAGE; renderSearch(sq); });
    bar.appendChild(allBtn);
    TYPES.forEach(function (t) {
      var n = res.groups[t[0]].length; if (!n) return;
      var b = el('button', 'cl-chip', t[1] + ' ' + n); b.type = 'button'; b.setAttribute('aria-pressed', String(state.sf === t[0]));
      b.addEventListener('click', function () { state.sf = t[0]; state.srl = PAGE; renderSearch(sq); });
      bar.appendChild(b);
    });
    srEl.appendChild(bar);
    function cardFor(d) {
      var c;
      if (d.type === 'obits' && !d.it.sourceId) c = card(d.it, 'obit', boards.obit);
      else if (d.type === 'news' || d.type === 'obits') c = makeCard(d.it, false);
      else if (d.type === 'events') c = eventCard(d.it, boards.event);
      else if (d.type === 'jobs') c = card(d.it, 'job', boards.job);
      else if (d.type === 'deals') c = card(d.it, 'deal', boards.deal);
      else c = card(d.it, 'item', boards.item);
      hlCard(c, words); return c;
    }
    function section(t, list, limit) {
      var sec = el('section', 'sr-sec'), n = list.length;
      var h = el('h2', 'sr-h', t[1]); h.appendChild(el('span', 'n', String(n))); sec.appendChild(h);
      var wrap = el('div', t[0] === 'events' ? 'cl-list ev-grid' : t[0] === 'deals' ? 'cl-list deal-grid' : t[0] === 'jobs' ? 'cl-list job-grid' : t[0] === 'classifieds' ? 'cl-list' : 'list');
      list.slice(0, limit).forEach(function (r) { wrap.appendChild(cardFor(r.d)); });
      sec.appendChild(wrap);
      return sec;
    }
    if (state.sf === 'all') {
      TYPES.forEach(function (t) {
        var list = res.groups[t[0]]; if (!list.length) return;
        var sec = section(t, list, PREVIEW[t[0]]);
        if (list.length > PREVIEW[t[0]]) { var more = el('button', 'primary sr-more', 'Show all ' + list.length + ' ' + t[1].toLowerCase()); more.type = 'button'; more.addEventListener('click', function () { state.sf = t[0]; state.srl = PAGE; renderSearch(sq); window.scrollTo({ top: 0 }); }); sec.appendChild(more); }
        srEl.appendChild(sec);
      });
    } else {
      var t = TYPES.filter(function (x) { return x[0] === state.sf; })[0] || TYPES[0], list = res.groups[t[0]];
      var sec = section(t, list, state.srl);
      if (list.length > state.srl) { var mb = el('button', 'primary sr-more', 'Show more (' + (list.length - state.srl) + ' left)'); mb.type = 'button'; mb.addEventListener('click', function () { state.srl += PAGE; renderSearch(sq); }); sec.appendChild(mb); }
      srEl.appendChild(sec);
    }
  }
  srEl.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a')) saveRecent(state.q); });

  /* recent searches + suggestions */
  function recents() { try { var r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(r) ? r.filter(function (x) { return typeof x === 'string'; }).slice(0, 6) : []; } catch (e) { return []; } }
  function saveRecent(q) {
    q = String(q || '').trim(); if (q.length < 2) return;
    var r = recents().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); }); r.unshift(q.slice(0, 60));
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 6))); } catch (e) {}
  }
  function clearRecents() { try { localStorage.removeItem(RECENT_KEY); } catch (e) {} }
  var qSug = document.getElementById('qsug'), sugItems = [], sugIdx = -1;
  function setQuery(v, commit) {
    clearTimeout(qTimer); qEl.value = v; state.q = v; state.sf = 'all'; state.srl = PAGE;
    if (state.cat === 'submit') state.cat = state.prevCat || 'news';
    if (commit) saveRecent(v);
    closeSug(); resetPaging(); render(); if (commit) window.scrollTo({ top: 0 });
  }
  function closeSug() { qSug.hidden = true; sugIdx = -1; qEl.setAttribute('aria-expanded', 'false'); qEl.removeAttribute('aria-activedescendant'); }
  function pickSug(i) { if (sugItems[i]) setQuery(sugItems[i].q, true); }
  function paintSug() {
    [].forEach.call(qSug.querySelectorAll('.opt'), function (b, i) { b.setAttribute('aria-selected', String(i === sugIdx)); if (i === sugIdx) qEl.setAttribute('aria-activedescendant', b.id); });
    if (sugIdx < 0) qEl.removeAttribute('aria-activedescendant');
  }
  function showSug() {
    var v = qEl.value.trim(), items = [], head = '';
    if (!v) {
      recents().forEach(function (r) { items.push({ q: r, recent: true }); }); head = items.length ? 'Recent searches' : '';
      if (!items.length) { head = 'Try searching for'; ['Evansville', 'Owensboro', 'Henderson', 'concert', 'obituary'].forEach(function (w) { items.push({ q: w }); }); }
    } else if (state.loaded) {
      var ws = v.toLowerCase().split(/\s+/), last = norm(ws[ws.length - 1]), lead = ws.slice(0, -1).join(' ');
      if (last.length >= 2) {
        var vocab = vocabOf(corpus()), cand = [];
        for (var w in vocab) if (w.indexOf(last) === 0 && w !== last) cand.push(w);
        cand.sort(function (a, b) { return vocab[b] - vocab[a]; });
        cand.slice(0, 5).forEach(function (w) { items.push({ q: (lead ? lead + ' ' : '') + w }); });
        recents().forEach(function (r) { if (r.toLowerCase().indexOf(v.toLowerCase()) === 0 && r.toLowerCase() !== v.toLowerCase() && items.length < 7) items.push({ q: r, recent: true }); });
      }
    }
    sugItems = items; sugIdx = -1; qSug.textContent = '';
    if (!items.length) { closeSug(); return; }
    if (head) { var hd = el('div', 'sug-h'); hd.appendChild(el('span', null, head)); if (head === 'Recent searches') { var cl = el('button', 'sug-clear', 'Clear'); cl.type = 'button'; cl.addEventListener('mousedown', function (e) { e.preventDefault(); }); cl.addEventListener('click', function () { clearRecents(); showSug(); }); hd.appendChild(cl); } qSug.appendChild(hd); }
    items.forEach(function (it, i) {
      var b = el('button', 'opt'); b.type = 'button'; b.id = 'sug' + i; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', 'false');
      if (it.recent) b.appendChild(svg([['path', { d: 'M3 12a9 9 0 1 0 3-6.7L3 8' }], ['path', { d: 'M3 3v5h5M12 7v5l3 2' }]]));
      else b.appendChild(svg([['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm21 21-4.3-4.3' }]]));
      b.appendChild(el('span', null, it.q));
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { pickSug(i); });
      qSug.appendChild(b);
    });
    qSug.hidden = false; qEl.setAttribute('aria-expanded', 'true');
  }
  qEl.setAttribute('role', 'combobox'); qEl.setAttribute('aria-autocomplete', 'list'); qEl.setAttribute('aria-controls', 'qsug'); qEl.setAttribute('aria-expanded', 'false');
  qEl.addEventListener('focus', showSug);
  qEl.addEventListener('blur', function () { setTimeout(closeSug, 120); if (state.q.trim().length >= 3) saveRecent(state.q); });
  qEl.addEventListener('input', showSug);
  qEl.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (qSug.hidden) showSug();
      if (!sugItems.length) return;
      e.preventDefault(); sugIdx = (sugIdx + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length + 1) % (sugItems.length + 1); if (sugIdx === sugItems.length) sugIdx = -1; paintSug();
    } else if (e.key === 'Enter') { e.preventDefault(); if (sugIdx >= 0) pickSug(sugIdx); else setQuery(qEl.value, true); qEl.blur(); }
    else if (e.key === 'Escape') { if (!qSug.hidden) { closeSug(); } }
  });

  var logoMap = {};
  function mapLogos() { logoMap = {}; state.sources.forEach(function (x) { logoMap[x.id] = x.logo; }); }
  // Short relative time for card meta ("12m ago", "5h ago", "Yesterday", "Oct 15"); the full date is in the tooltip.
  function shortWhen(iso) {
    var t = Date.parse(iso); if (!iso || isNaN(t)) return '';
    var m = Math.round((Date.now() - t) / 6e4);
    if (m < 1) return 'Just now'; if (m < 60) return m + 'm ago';
    if (m < 24 * 60) return Math.round(m / 60) + 'h ago';
    var z = 'America/Chicago', day = function (x) { return new Date(x).toLocaleDateString('en-US', { timeZone: z }); };
    if (day(t + 864e5) === day(Date.now())) return 'Yesterday';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: z });
  }
  // The first picture of a list is usually the largest thing on screen (LCP): it loads at once with high priority;
  // every later one waits until it is near the screen. renderList and renderEvents set leadPic before building cards.
  var leadPic = false;
  function picLoading(im) {
    if (!leadPic) { im.loading = 'lazy'; return; }
    leadPic = false; im.loading = 'eager'; im.setAttribute('fetchpriority', 'high');
  }
  function makeCard(it, big, bk) {
    var card = el('article', big ? 'card breaking' : 'card');
    var kd = kindOf(it.sourceId), safe = kd === 'police' || kd === 'courts';
    card.dataset.sec = safe ? 'safety' : kd === 'institution' ? 'institution' : 'news';
    // Police & courts cards never show photos (no mugshots).
    var pic = safe ? '' : it.image;
    var logo = logoMap[it.sourceId] || '';
    var a = el('a', 'ca');
    a.href = safeHref(it.link); a.target = '_blank'; a.rel = 'noopener noreferrer';
    var body = el('div', 'bd');
    // The red "Breaking" badge already says it, so the lead card drops an outlet's "BREAKING:" prefix (as the top banner does).
    var hTitle = big ? (it.title.replace(/^\s*(breaking( news)?|just in|developing story|news alert)\s*[:|\u2013\u2014-]\s*/i, '') || it.title) : it.title;
    body.appendChild(el('h2', null, hTitle));
    if (bk && (bk.label || bk.end != null)) {
      var bm = el('div', 'bk-meta');
      if (bk.label) bm.appendChild(el('b', null, bk.label));
      var bu = brkUntil(bk); if (bu) bm.appendChild(el('span', null, bu));
      if (state.brk.more) bm.appendChild(el('span', null, '+' + state.brk.more + ' more active'));
      body.appendChild(bm);
    }
    if (it.summary) body.appendChild(el('p', null, it.summary));
    if (safe && it.arrest) body.appendChild(el('p', 'cl-note', 'Charged or arrested, not convicted.'));
    // source + short time: one small line with the outlet's icon
    var src = el('div', 'src');
    if (logo) {
      var av = el('img', 'av'); av.src = logo; av.alt = ''; av.loading = 'lazy'; av.referrerPolicy = 'no-referrer';
      av.addEventListener('error', function () { av.remove(); });
      src.appendChild(av);
    }
    src.appendChild(el('b', null, it.source));
    if (it.place && SC.on && !/^county:/.test(SC.key)) src.appendChild(el('span', 'place', it.place)); // one locality label, only when the classifier is confident
    var w = el('time', 'when', shortWhen(it.published)); if (it.published) { w.dateTime = it.published; w.title = timeAgo(it.published); }
    src.appendChild(w);
    var sb = UI.heart({
      get: function () { return { on: isSaved(it.link), n: likeCount(it), label: it.title }; },
      toggle: function () { toggleSaved(it); },
      after: function () { sb.paint(); renderTabs(); }
    });
    // Option B (ad-card style): picture flush left on desktop / on top on phones; source row, headline and a short
    // description; a bottom row with where the link goes plus the heart and share.
    if (pic) {
      var im = el('img', 'th'); picLoading(im); im.referrerPolicy = 'no-referrer'; im.decoding = 'async'; im.alt = ''; im.src = pic;
      im.addEventListener('error', function () { im.remove(); a.classList.add('noimg'); });
      a.appendChild(im);
    } else a.classList.add('noimg');
    body.insertBefore(src, body.firstChild);
    a.appendChild(body);
    card.appendChild(a);
    var foot = el('div', 'cf');
    // Obituaries: Send flowers / Plant a tree / Donate and the heart and share share ONE row, the card's last, at every
    // width (outside the card's link; ship59). Links first (left), reactions last (right), in reading and focus order;
    // CSS keeps it on one line: short labels and icon reactions when narrow.
    var fl = kd === 'obits' ? flowersLink(it, 'div') : null; if (fl) { foot.classList.add('cf-ob'); foot.appendChild(fl); }
    foot.appendChild(actRow(sb, it));
    card.appendChild(foot);
    if (big) {
      var tag = UI.pill({ label: 'Breaking', tone: 'red', dot: true });
      // over the picture as before; with no picture it sits inline above the source line so it never covers text
      if (a.classList.contains('noimg') || !pic) { var hd = el('div', 'bk-head'); hd.appendChild(tag); body.insertBefore(hd, body.firstChild); }
      else { tag.classList.add('pill-over'); card.appendChild(tag); }
    }
    return card;
  }

  var brkTimer = null;
  // Keep the address bar, <title>, description and canonical on the current tab. A tab change pushes a history
  // entry (back/forward then switch tabs via popstate); the first render only tidies the URL. Views without a
  // route of their own (Submit news) leave the URL alone.
  function syncRoute() {
    if (!RT) return;
    if (SC.geo && state.cat === 'news') { ROUTE_SYNCED = true; return; } // a county or state page: the server set its head
    if (SC.geo) { SC.geo = null; if (SC.key !== 'tristate') { SC.key = 'tristate'; load(false); } } // leaving a county page: back to Tri-State
    var r = RT.byCat(state.cat); if (!r) return;
    if (RT.norm(location.pathname) !== r.path) {
      try { history[ROUTE_SYNCED ? 'pushState' : 'replaceState']({ cat: state.cat }, '', r.path + (ROUTE_SYNCED ? '' : location.search) + location.hash); } catch (e) {}
    }
    ROUTE_SYNCED = true;
    RT.apply(document, r);
  }
  window.addEventListener('popstate', function () {
    var r = RT && RT.byPath(location.pathname);
    state.cat = r ? r.cat : 'news';
    var g = RT && RT.geo && RT.geo(location.pathname), was = SC.key;
    if (g) { SC.geo = g.path; SC.key = g.scope; } else if (SC.geo) { SC.geo = null; SC.key = 'tristate'; }
    if (SC.key !== was) { load(false); }
    if (state.q) { clearTimeout(qTimer); qEl.value = ''; state.q = ''; }
    resetPaging(); render();
  });
  var AD_TABS = ['events', 'jobs', 'deals', 'classifieds', 'news']; // the only tabs with side ads (Advertising policy); never Obituaries
  function render() {
    syncRoute();
    document.body.toggleAttribute('data-ads', AD_TABS.indexOf(state.cat) >= 0 && !state.q.trim());
    if (SPONSORS) UI.rails(state.cat); // the side ads follow the tab (none on News or Obituaries)
    breakCards = {};
    state.brk = breakingPick();
    renderList();
    renderBreaking(); // after the list, so it knows which stories became Breaking cards
    if (alertsEl) renderAlerts();
    clearTimeout(brkTimer);
    var bt = state.brk.top, be = bt && (BK ? BK.endOf(bt) : bt.start + 3 * 3600 * 1000);
    if (be) brkTimer = setTimeout(render, Math.min(Math.max(be - Date.now() + 1000, 1000), 6 * 3600 * 1000));
  }
  function renderList() {
    renderTabs();
    var isCl = state.cat === 'classifieds', isDl = state.cat === 'deals', isEv = state.cat === 'events', isJb = state.cat === 'jobs', isSn = state.cat === 'submit', board = isCl || isDl || isEv || isJb || isSn;
    nlEl.hidden = NL_WAS || !(state.cat === 'news') || !!state.q.trim();
    snEl.hidden = !isSn; clEl.hidden = !isCl; dlEl.hidden = !isDl; boards.event.el.hidden = !isEv; boards.job.el.hidden = !isJb; boards.obit.el.hidden = state.cat !== 'obits'; listEl.hidden = board; document.getElementById('more').hidden = board;
    var srQ = state.q.trim();
    srEl.hidden = !(srQ && !isSn);
    if (srQ && !isSn) {
      snEl.hidden = clEl.hidden = dlEl.hidden = boards.event.el.hidden = boards.job.el.hidden = boards.obit.el.hidden = listEl.hidden = true; document.getElementById('more').hidden = true;
      if (state.loaded) { if (!boards.item.loaded) loadBoard('item'); if (!boards.deal.loaded) loadBoard('deal'); if (!boards.event.loaded) loadBoard('event'); if (!boards.job.loaded) loadBoard('job'); if (!boards.obit.loaded) loadBoard('obit'); renderSearch(srQ); }
      else { srEl.textContent = ''; metaEl.textContent = ''; }
      return;
    }
    if (isSn) { renderSubmit(); metaEl.textContent = ''; return; }
    if (isCl) { renderClassifieds(); metaEl.textContent = ''; if (!boards.item.loaded) loadBoard('item'); return; }
    if (isDl) { renderDeals(); metaEl.textContent = ''; if (!boards.deal.loaded) loadBoard('deal'); return; }
    if (state.cat === 'obits') { loadFlowers(); if (!boards.obit.loaded) loadBoard('obit'); else renderObits(); }
    if (isJb) { renderJobs(); metaEl.textContent = ''; if (!boards.job.loaded) loadBoard('job'); return; }
    if (isEv) { renderEvents(); metaEl.textContent = ''; if (!boards.event.loaded) loadBoard('event'); return; }
    if (!state.loaded) return;
    if (state.error && !state.items.length) {
      metaEl.textContent = 'Couldn’t load headlines';
      return stateBox('Couldn’t reach the news feeds', 'Check your connection and try again.', 'Try again', function () { load(true); });
    }
    var all = filtered();
    var top = state.brk.top;
    var brk = (top && !state.q.trim() && (state.cat === 'news')) ? [top] : []; // at most ONE Breaking item
    var rest = brk.length && top.item ? all.filter(function (i) { return i !== top.item; }) : all;
    var shown = rest.slice(0, state.limit);
    var moreEl = document.getElementById('more'); moreEl.textContent = '';
    var seenSrc = {}; all.forEach(function (i) { seenSrc[i.sourceId] = 1; });
    var n = Object.keys(seenSrc).length;
    var upd = 'Updated ' + new Date(state.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    // the stories embedded in the page are only the first screenful: no counts until the full answer is in
    metaEl.textContent = state.partial ? upd : all.length + ' stor' + (all.length === 1 ? 'y' : 'ies') + ' from ' + n + ' source' + (n === 1 ? '' : 's') + ' · ' + upd;
    if (!shown.length && !brk.length && SC.on && SC.geo && SC.key !== 'tristate' && !state.q.trim()) return scopeEmpty();
    if (!shown.length && !brk.length) {
      var noQ = !state.q.trim();
      return stateBox('No stories to show', noQ ? 'Nothing has been published by these sources recently.' : 'Nothing matches. Try different words.', noQ ? 'Refresh' : 'Clear search', function () { if (noQ) { load(true); } else { state.q = ''; qEl.value = ''; resetPaging(); render(); } });
    }
    listEl.textContent = '';
    listEl.setAttribute('aria-busy', 'false');
    mapLogos();
    leadPic = true;
    brk.forEach(function (b) { var it = b.item || alertItem(b); storyKeys(it).forEach(function (k) { breakCards[k] = 1; }); listEl.appendChild(makeCard(it, true, b)); });
    // In-feed ads on News (public/adslots.js newsSlots): News is one story per row at every width; a card about
    // every 6th story, never next to a Police & courts item; none in search or beside Breaking.
    listEl.classList.toggle('news-one', state.cat === 'news');
    var slots = {};
    if (state.cat === 'news' && !state.q.trim() && window.TSNAds) {
      TSNAds.newsSlots(shown.map(function (it) { var k = kindOf(it.sourceId); return k === 'police' || k === 'courts'; }), TSNAds.NEWS_EVERY).forEach(function (i) { slots[i] = 1; });
    }
    shown.forEach(function (it, i) {
      if (slots[i]) { var ac = UI.newsAd(); if (ac) listEl.appendChild(ac); }
      listEl.appendChild(makeCard(it, false));
    });
    if (rest.length > shown.length) {
      var mb = el('button', null, 'Show more (' + (rest.length - shown.length) + ' left)'); mb.type = 'button';
      mb.addEventListener('click', function () { state.limit += PAGE; render(); });
      moreEl.appendChild(mb);
    } else if (state.cat === 'news' && state.more && !state.q.trim()) {
      // /api/news sends the newest stories; older ones come a page at a time (?before=), only when asked for.
      var ob = el('button', null, 'Show older stories'); ob.type = 'button';
      ob.addEventListener('click', function () { ob.disabled = true; ob.textContent = 'Loading\u2026'; loadOlder().then(function () { state.limit += PAGE; render(); }); });
      moreEl.appendChild(ob);
    }
  }

  var STATE_NAMES = { 'in': 'Indiana', ky: 'Kentucky', il: 'Illinois' };
  function scopeFrom(d) {
    SC.on = !!(d.features && d.features.scopes); SC.routes = !!(d.features && d.features.routes);
    SC.info = d.scope || null;
    if (!SC.on) SC.key = 'tristate';
  }
  // An empty county or state page offers its state's page, or the Tri-State home.
  function goScope(key) {
    var gp = key !== 'tristate' && SC.routes && RT && RT.geoPath ? RT.geoPath(key) : null;
    SC.key = gp ? key : 'tristate'; SC.geo = gp; state.cat = 'news';
    try { history.pushState({ cat: 'news' }, '', gp || '/'); } catch (e) {}
    resetPaging(); skeletons(); load(false);
  }
  function scopeEmpty() {
    var info = SC.info || {}, srcs = info.sources || [], label = info.label || 'this area';
    var county = /^county:/.test(SC.key), st = county ? SC.key.slice(7, 9) : '';
    var t = county ? 'No recent local stories from ' + label : 'No recent stories for ' + label;
    var b = srcs.length ? 'Sources we check here: ' + srcs.join(', ') + '.' : county ? 'We don\u2019t have a local source for this county yet.' : 'Nothing in this area right now.';
    var next = county && STATE_NAMES[st] ? { key: 'state:' + st, label: STATE_NAMES[st] } : { key: 'tristate', label: 'Tri-State' };
    stateBox(t, b, 'Show ' + next.label, function () { goScope(next.key); });
  }

  // The next page of older stories (api/news.js page()): appended once each, the same area as the current list.
  function loadOlder() {
    var m = state.more, want = SC.key; if (!m || !m.before) return Promise.resolve();
    var url = '/api/news?' + (SC.key !== 'tristate' ? 'scope=' + SC.key + '&' : '') + 'before=' + encodeURIComponent(m.before);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('news'); return r.json(); }).then(function (d) {
      if (want !== SC.key || state.more !== m) return;
      var seen = {}; state.items.forEach(function (i) { seen[i.id || i.link] = 1; });
      (d.items || []).forEach(function (i) { if (!seen[i.id || i.link]) state.items.push(i); });
      state.more = d.more || null;
      loadCounts();
    }).catch(function () { /* keep what we have; the button comes back on the next render */ });
  }

  function load(force) {
    var first = !state.loaded;
    if (first || force) { if (first || !state.items.length) skeletons(); }
    var url = '/api/news' + (SC.key !== 'tristate' ? '?scope=' + SC.key : ''), want = SC.key;
    return fetch(url, force ? { cache: 'reload' } : undefined).then(function (r) { if (!r.ok) throw new Error('news'); return r.json(); }).then(function (d) {
      if (want !== SC.key) return; // the reader switched area while this was loading
      state.items = d.items || []; state.sources = d.sources || []; state.updatedAt = d.updatedAt; state.fetchedAt = Date.now(); state.more = d.more || null; state.partial = false;
      scopeFrom(d);
      state.error = false; state.loaded = true;
      render();
      loadCounts();
    }).catch(function () {
      state.error = true; state.loaded = true;
      render();
    });
  }


  // hourly refresh while open, plus catch-up when the tab becomes visible after a long time away
  setInterval(function () { load(false); }, HOUR);
  // weather updates continuously: every 10 minutes, and right away when the tab returns or the connection comes back
  var WX_EVERY = 10 * 60 * 1000, wxAt = Date.now();
  function wxTick() { if (wxPop.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; wxAt = Date.now(); loadWeather(); }
  setInterval(function () { if (!document.hidden) wxTick(); }, WX_EVERY);
  window.addEventListener('online', wxTick);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (Date.now() - state.fetchedAt > HOUR) load(false);
    if (Date.now() - wxAt > 2 * 60 * 1000) wxTick();
  });
  // keep "x min ago" honest
  setInterval(function () { if (state.items.length && !document.hidden) render(); }, 5 * 60 * 1000);

  // Official alerts for the Breaking slot. A failed call keeps the last list (each alert still expires on its own
  // end time), so an outage at /api/alerts or the NWS just falls back to the regular Breaking behavior.
  function loadOfficial() {
    return fetch('/api/alerts').then(function (r) { if (!r.ok) throw new Error('alerts'); return r.json(); })
      .then(function (d) { state.official = Array.isArray(d.alerts) ? d.alerts : []; render(); })
      .catch(function () { /* keep what we had */ });
  }
  setInterval(function () { if (!document.hidden) loadOfficial(); }, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) loadOfficial(); });

  // First stories in the HTML (PR ship69): "/", /obituaries and /institutions arrive with the tab's first stories
  // (api/_tabpage.js, api/_cards.js) as cards and as JSON in #tsn-data. Draw from that at once (the same cards, so
  // nothing moves); load() below then brings the full answer without skeletons and draws again.
  (function () {
    var s = document.getElementById('tsn-data'); if (!s) return;
    var d = null; try { d = JSON.parse(s.textContent); } catch (e) { d = null; }
    if (s.parentNode) s.parentNode.removeChild(s);
    if (!d || !Array.isArray(d.items) || d.cat !== state.cat || SC.key !== 'tristate' || state.loaded) return;
    state.items = d.items; state.sources = Array.isArray(d.sources) ? d.sources : []; state.updatedAt = d.updatedAt; state.partial = true;
    scopeFrom(d);
    state.error = false; state.loaded = true;
    render();
  })();
  loadWeather();
  // With the first stories already drawn, the full answer waits for the page's own load (pictures first) so it doesn't
  // compete with the lead picture on a slow connection.
  if (state.partial && document.readyState !== 'complete') window.addEventListener('load', function () { load(false); }, { once: true });
  else load(false);
  loadOfficial();
  loadDeals(); loadBoard('event'); loadBoard('job');
})();
