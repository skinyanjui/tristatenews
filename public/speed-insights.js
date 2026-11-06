/* Vercel Speed Insights. scripts/build-assets.js puts the official @vercel/speed-insights injector (its framework-
   agnostic injectSpeedInsights) in front of this file as assets/speed-insights.js. It adds Vercel's first-party script
   (/_vercel/speed-insights/script.js), which reports Core Web Vitals to /_vercel/speed-insights/vitals on this origin
   when the page is hidden or the URL changes (pushState/popstate), so tab switches are covered.
   - Not on local hosts: the local server has no /_vercel routes (the package's development mode would load a debug
     script from a CDN instead). Tests opt in with window.TSN_SPEED_INSIGHTS = 'force' and mock /_vercel.
   - Routes are grouped (/news/[state]/[county]) and every URL is sent without its ?query or #hash, so search terms
     and other text in a URL never leave the page.
   - Once per page: the package skips a script that is already in <head>, and this file starts it only once. */
(function () {
  'use strict';
  var SI = window.TSNSpeedInsights;
  if (!SI || window.TSNSpeedInsightsStarted) return;
  var host = location.hostname;
  var local = !host || host === 'localhost' || host === '[::1]' || /^127(\.\d+){3}$/.test(host) || /\.localhost$/.test(host);
  if (local && window.TSN_SPEED_INSIGHTS !== 'force') return;
  window.TSNSpeedInsightsStarted = true;

  function route(p) {
    p = String(p || '/').replace(/\/+$/, '') || '/';
    if (/^\/news\/[^/]+\/[^/]+$/.test(p)) return '/news/[state]/[county]';
    if (/^\/news\/[^/]+$/.test(p)) return '/news/[state]';
    return p;
  }
  function beforeSend(e) {
    try {
      var u = new URL(e.url, location.href);
      u.search = '';
      u.hash = '';
      return Object.assign({}, e, { url: u.href });
    } catch (x) { return null; }
  }

  var si = SI.injectSpeedInsights({ route: route(location.pathname), beforeSend: beforeSend });
  if (!si) return;
  var sync = function () { try { si.setRoute(route(location.pathname)); } catch (e) {} };
  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = history[k];
    history[k] = function () { var r = orig.apply(this, arguments); sync(); return r; };
  });
  addEventListener('popstate', sync);
  window.TSNSpeedInsights.route = route;
})();
