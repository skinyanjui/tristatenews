/* One shareable URL per tab. Shared by the page (window.TSNRoutes, loaded in <head> so the title, description
   and canonical are right before anything renders) and by node (tests, sitemap check).
   vercel.json rewrites these paths to /index.html; the page reads location.pathname to open the tab and uses
   history.pushState when the tab changes, so back/forward and direct loads work. "/" is the News tab (the landing
   tab). Old paths that no longer have a tab of their own (ALIASES: /news, /all, /liked) open News at "/"; vercel.json
   also redirects them to "/" so shared links keep working. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNRoutes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var ORIGIN = 'https://tristatenewss.vercel.app';
  var SITE = 'Tri-State News';
  // cat: the page's tab id (CATS in index.html). index: listed in sitemap.xml and indexable.
  var ROUTES = [
    { cat: 'news', path: '/', index: true, title: SITE,
      desc: 'The latest local news, police and courts from Evansville, Henderson, Owensboro and the Tri-State, gathered from the region\u2019s newsrooms and official sources.' },
    // No institution feeds are wired today (the tab hides when empty), so it stays out of the sitemap and noindex.
    { cat: 'institution', path: '/institutions', index: false, title: 'Institutions · ' + SITE,
      desc: 'News from Tri-State schools, universities, hospitals and public agencies.' },
    { cat: 'events', path: '/events', index: true, title: 'Events · ' + SITE,
      desc: 'Things to do in Evansville and the Tri-State: concerts, festivals, family events, sports and community events by date.' },
    { cat: 'obits', path: '/obituaries', index: true, title: 'Obituaries · ' + SITE,
      desc: 'Recent obituaries from Tri-State funeral homes and newspapers in Indiana, Kentucky and Illinois.' },
    { cat: 'jobs', path: '/jobs', index: true, title: 'Jobs · ' + SITE,
      desc: 'Local job listings from Tri-State employers in Evansville, Henderson, Owensboro and nearby towns.' },
    { cat: 'deals', path: '/deals', index: true, title: 'Deals · ' + SITE,
      desc: 'Coupons and specials from local Tri-State businesses.' },
    { cat: 'classifieds', path: '/classifieds', index: true, title: 'Classifieds · ' + SITE,
      desc: 'Free local classifieds: furniture, electronics, vehicles and more for sale across the Tri-State.' }
  ];
  // Retired tab paths: the All tab (it duplicated News), the Liked page (removed), the old /news path and the
  // Police & courts tab (merged into News, where its items keep their rules).
  var ALIASES = { '/news': '/', '/all': '/', '/liked': '/', '/police-courts': '/', '/police': '/', '/courts': '/' };
  // Retired tab ids in an old hash or ?tab= link (#all, ?tab=all, #liked, ...), all of which now mean News.
  var OLD_TABS = { all: 1, news: 1, liked: 1, saved: 1, likes: 1, safety: 1, police: 1, courts: 1, 'police-courts': 1 };
  function norm(path) { var p = String(path || '/').split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase(); return p || '/'; }
  function byPath(path) { var p = norm(path); if (ALIASES[p]) p = ALIASES[p]; for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].path === p) return ROUTES[i]; return null; }
  function byCat(cat) { for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].cat === cat) return ROUTES[i]; return null; }
  function meta(doc, sel, attr, make) {
    var m = doc.head.querySelector(sel);
    if (!m && make) { m = doc.createElement(make.tag); for (var k in make.attrs) m.setAttribute(k, make.attrs[k]); doc.head.appendChild(m); }
    return m;
  }
  // Point the document's head at one route: <title>, description, canonical, og:* and robots.
  function apply(doc, r) {
    if (!doc || !r) return;
    var url = ORIGIN + (r.path === '/' ? '/' : r.path);
    doc.title = r.title;
    var d = meta(doc, 'meta[name="description"]', 'content', { tag: 'meta', attrs: { name: 'description' } }); d.setAttribute('content', r.desc);
    var c = meta(doc, 'link[rel="canonical"]', 'href', { tag: 'link', attrs: { rel: 'canonical' } }); c.setAttribute('href', url);
    var ou = meta(doc, 'meta[property="og:url"]'); if (ou) ou.setAttribute('content', url);
    var ot = meta(doc, 'meta[property="og:title"]'); if (ot) ot.setAttribute('content', r.title);
    var od = meta(doc, 'meta[property="og:description"]'); if (od) od.setAttribute('content', r.desc);
    var rb = meta(doc, 'meta[name="robots"]', 'content', r.index ? null : { tag: 'meta', attrs: { name: 'robots' } });
    if (rb) { if (r.index) rb.parentNode.removeChild(rb); else rb.setAttribute('content', 'noindex'); }
  }
  return { ORIGIN: ORIGIN, ROUTES: ROUTES, ALIASES: ALIASES, OLD_TABS: OLD_TABS, norm: norm, byPath: byPath, byCat: byCat, apply: apply };
});
