/* Duplicate tragedy / crime clustering for the News feed. When two or more stories cover the same
   incident (token overlap + a shared distinctive token, within 72h), keep the newest card and link
   the others as “Also covered by <Outlet>”. Prefer missing a merge over a wrong one. Dog/cat are
   not collapsed to a generic animal. Links attach only to a lead story (no transitive union-find).
   Shared as window.TSNCluster. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./crime.js'), require('./tragedy.js'), require('./obit.js'));
  else root.TSNCluster = factory(root.TSNCrime, root.TSNTragedy, root.TSNObit);
})(typeof self !== 'undefined' ? self : this, function (Crime, Tragedy, Obit) {
  'use strict';
  var STOP = {
    a: 1, an: 1, the: 1, and: 1, or: 1, but: 1, of: 1, in: 1, on: 1, at: 1, to: 1, for: 1, from: 1,
    by: 1, with: 1, as: 1, is: 1, was: 1, were: 1, be: 1, been: 1, are: 1, after: 1, before: 1,
    over: 1, under: 1, into: 1, about: 1, than: 1, then: 1, that: 1, this: 1, its: 1, his: 1,
    her: 1, their: 1, who: 1, whom: 1, which: 1, what: 1, when: 1, where: 1, how: 1, not: 1,
    no: 1, yes: 1, man: 1, woman: 1, men: 1, women: 1, county: 1, city: 1, area: 1, local: 1,
    say: 1, says: 1, said: 1, police: 1, according: 1, near: 1, after: 1
  };
  // Synonyms for overlap only. Do NOT fold dog/cat → animal (different cruelty cases stay separate).
  var SYN = {
    murder: 'death', murders: 'death', murdered: 'death', homicide: 'death', homicides: 'death',
    killing: 'death', killings: 'death', killed: 'death', kills: 'death', fatal: 'death',
    fatally: 'death', died: 'death', dies: 'death', dead: 'death', deaths: 'death',
    wife: 'spouse', wives: 'spouse', husband: 'spouse', husbands: 'spouse',
    sentenced: 'sentence', sentence: 'sentence', sentencing: 'sentence',
    cruelty: 'cruelty', cruel: 'cruelty', abuse: 'cruelty', abusing: 'cruelty', abused: 'cruelty'
  };
  // Common capitalized openers that are not distinctive place/person tokens.
  var WEAK_CAP = {
    Man: 1, Woman: 1, Men: 1, Women: 1, Couple: 1, Pair: 1, Police: 1, Sheriff: 1, Deputies: 1,
    County: 1, City: 1, Local: 1, Area: 1, Update: 1, Breaking: 1, Officials: 1, Authorities: 1,
    Person: 1, People: 1, Suspect: 1, Victim: 1, Victims: 1, Driver: 1, Teen: 1, Teenager: 1,
    // Route words alone are not distinctive — the number from hwy/route patterns is.
    Highway: 1, Hwy: 1, Route: 1, Interstate: 1, Crash: 1, Accident: 1, Collision: 1
  };
  var WINDOW_MS = 72 * 3600 * 1000;
  var MIN_SHARED = 3;
  var MIN_JACCARD = 0.34;

  function tokens(title) {
    return String(title || '').toLowerCase()
      .replace(/[^a-z0-9'\u2019]+/g, ' ')
      .replace(/['\u2019]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map(function (w) { return SYN[w] || w; })
      .filter(function (w) { return w.length > 1 && !STOP[w] && !/^\d+$/.test(w); });
  }

  function setOf(toks) {
    var s = {};
    toks.forEach(function (t) { s[t] = 1; });
    return s;
  }

  function overlap(a, b) {
    var A = setOf(a), B = setOf(b), shared = 0, na = 0, nb = 0, k;
    for (k in A) { if (Object.prototype.hasOwnProperty.call(A, k)) { na++; if (B[k]) shared++; } }
    for (k in B) { if (Object.prototype.hasOwnProperty.call(B, k)) nb++; }
    if (!shared) return { shared: 0, jaccard: 0 };
    return { shared: shared, jaccard: shared / (na + nb - shared) };
  }

  // Distinctive tokens: place/person caps, highway/route ids, sentence lengths. Checked on title+summary.
  function distinctive(it) {
    var text = [String((it && it.title) || ''), String((it && (it.summary || it.dek)) || '')].join('\n');
    var out = {};
    function add(k) {
      k = String(k || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (k.length > 1) out[k] = 1;
    }
    var m;
    var hwy = /\b(?:i-?\d+|us-?\d+|hwy\.?\s*\d+|highway\s+\d+|route\s+\d+|rt\.?\s*\d+)\b/gi;
    while ((m = hwy.exec(text))) add(m[0]);
    var years = /\b(\d{1,3})\s*years?\b/gi;
    while ((m = years.exec(text))) add(m[1] + 'years');
    var wordRe = /\b[A-Z][a-zA-Z'’.-]+\b/g;
    while ((m = wordRe.exec(text))) {
      if (WEAK_CAP[m[0]]) continue;
      if (/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)$/.test(m[0])) continue;
      add(m[0]);
    }
    return out;
  }

  function sharedDistinctive(a, b) {
    var A = distinctive(a), B = distinctive(b), k;
    for (k in A) {
      if (Object.prototype.hasOwnProperty.call(A, k) && B[k]) return true;
    }
    return false;
  }

  function eligible(it) {
    if (!it || !it.title) return false;
    if (Obit && Obit.obitStory && Obit.obitStory(it)) return false; // obituaries stay single cards
    var crime = Crime && Crime.crimeStory ? Crime.crimeStory(it) : false;
    var death = Tragedy && Tragedy.deathStory ? Tragedy.deathStory(it) : false;
    return !!(crime || death);
  }

  function pubMs(it) {
    var t = Date.parse(it && it.published);
    return isNaN(t) ? 0 : t;
  }

  function sameIncident(a, b) {
    if (!eligible(a) || !eligible(b)) return false;
    var da = Math.abs(pubMs(a) - pubMs(b));
    if (da > WINDOW_MS) return false;
    var o = overlap(tokens(a.title), tokens(b.title));
    if (!(o.shared >= MIN_SHARED && o.jaccard >= MIN_JACCARD)) return false;
    // Require a shared distinctive token so Highway 41 ≠ Highway 66, Patoka ≠ Warrick, etc.
    return sharedDistinctive(a, b);
  }

  // Star-to-lead: each older story may attach only to a newer lead it directly matches.
  // No union-find chaining (A~B and B~C does not force A~C).
  function clusterTragedies(items) {
    items = Array.isArray(items) ? items.slice() : [];
    var n = items.length;
    if (n < 2) return items;
    var order = [];
    for (var i = 0; i < n; i++) order.push(i);
    order.sort(function (a, b) { return pubMs(items[b]) - pubMs(items[a]); });
    var used = {};
    var alsoFor = {};
    for (var oi = 0; oi < order.length; oi++) {
      var hi = order[oi];
      if (used[hi] || !eligible(items[hi])) continue;
      var also = [];
      for (var oj = oi + 1; oj < order.length; oj++) {
        var ji = order[oj];
        if (used[ji] || !eligible(items[ji])) continue;
        if (sameIncident(items[hi], items[ji])) {
          also.push(ji);
          used[ji] = 1;
        }
      }
      if (also.length) alsoFor[hi] = also;
    }
    Object.keys(alsoFor).forEach(function (hs) {
      var head = +hs;
      var also = alsoFor[hs].map(function (ix) {
        var it = items[ix];
        return { source: it.source || 'another outlet', link: it.link || '', title: it.title || '' };
      });
      var lead = items[head];
      var copy = {};
      Object.keys(lead).forEach(function (k) { copy[k] = lead[k]; });
      copy.alsoCovered = also;
      items[head] = copy;
    });
    return items.filter(function (_, i) { return !used[i]; });
  }

  return {
    STOP: STOP,
    SYN: SYN,
    WEAK_CAP: WEAK_CAP,
    WINDOW_MS: WINDOW_MS,
    MIN_SHARED: MIN_SHARED,
    MIN_JACCARD: MIN_JACCARD,
    tokens: tokens,
    overlap: overlap,
    distinctive: distinctive,
    sharedDistinctive: sharedDistinctive,
    eligible: eligible,
    sameIncident: sameIncident,
    clusterTragedies: clusterTragedies
  };
});
