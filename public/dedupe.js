/* Repeated copy on cards (ship80): one rule, shared by the page (window.TSNDedupe), the server's pre-rendered rows
   (api/_cards.js) and the tests. Every comparison ignores case, accents, punctuation and extra spaces, so
   "Ford Center", "FORD CENTER." and "ford-center" are the same words. Each fact is shown once, in its most useful place:
   - preview(title, text): a preview that repeats the headline as its lead (the headline, then . : | or a dash) loses
     that lead; it is dropped if nothing is left, or if it is only the start of the headline;
   - part(x, others...): '' when x says the same as, or is contained in, any of the others (a label equal to the
     section heading, a town already in the title, a "via" source already in the venue, a venue equal to the town);
   - parts(list, others...): the same for a list of label parts, also dropping repeats within the list;
   - lead(text, label): text without a leading label it repeats (an ad's "Sponsored: ..." under its "Sponsored" tag). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TSNDedupe = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function norm(s) {
    s = String(s == null ? '' : s).toLowerCase();
    if (s.normalize) s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return s.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function same(a, b) { var x = norm(a); return !!x && x === norm(b); }
  // b's words appear, whole and in order, inside a.
  function has(a, b) { var x = norm(a), y = norm(b); return !!y && (' ' + x + ' ').indexOf(' ' + y + ' ') >= 0; }
  // Cut the first n normalized characters' worth of the raw string s.
  // The raw rest of s after its first n normalized characters, and whether a separator (. : ; ! ? | dash ·) ends that
  // lead: "Line cook wanted" does not repeat the headline "Line cook" as a lead, "Line cook. Nights..." does.
  function cutLead(s, n, needSep) {
    var seen = 0, i = 0;
    while (i < s.length && seen < n) { seen = norm(s.slice(0, i + 1)).length; i++; }
    var rest = s.slice(i);
    if (needSep && !/^\s*[.:;!?|\u2013\u2014\u00B7-]/.test(rest)) return null;
    return rest.replace(/^[\s.,:;!?|\u2013\u2014\u00B7-]+/, '').trim();
  }
  function preview(title, text) {
    var t = String(text == null ? '' : text).trim(), nt = norm(t), nh = norm(title);
    if (!nt) return '';
    if (!nh) return t;
    if (nt === nh || nh.indexOf(nt) === 0) return ''; // equal to, or only the start of, the headline
    if (nt.indexOf(nh + ' ') === 0) { var r = cutLead(t, nh.length, true); if (r === null) return t; return norm(r) ? r : ''; }
    return t;
  }
  function part(x) {
    if (!norm(x)) return '';
    for (var i = 1; i < arguments.length; i++) { var o = arguments[i]; if (o && (same(x, o) || has(o, x))) return ''; }
    return String(x);
  }
  function parts(list) {
    var others = Array.prototype.slice.call(arguments, 1), out = [];
    (list || []).forEach(function (p) {
      if (!p || typeof p !== 'string') { if (p) out.push(p); return; }
      if (!part.apply(null, [p].concat(others))) return;
      if (out.some(function (q) { return typeof q === 'string' && same(q, p); })) return;
      out.push(p);
    });
    return out;
  }
  function lead(text, label) {
    var t = String(text == null ? '' : text).trim(), nl = norm(label), nt = norm(t);
    if (!nl || !nt) return t;
    if (nt === nl) return '';
    if (nt.indexOf(nl + ' ') === 0) { var r = cutLead(t, nl.length, true); return r === null ? t : r; }
    return t;
  }
  return { norm: norm, same: same, has: has, preview: preview, part: part, parts: parts, lead: lead };
});
