/* Duplicate tragedy / crime clustering for the News feed. When two or more stories cover the same
   incident (high title-token overlap after stopwords, within 72h), keep the newest card and link the
   others as “Also covered by <Outlet>”. Only crime or tragedy stories merge — ordinary news stays
   separate. Shared as window.TSNCluster. */
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
  var SYN = {
    murder: 'death', murders: 'death', murdered: 'death', homicide: 'death', homicides: 'death',
    killing: 'death', killings: 'death', killed: 'death', kills: 'death', fatal: 'death',
    fatally: 'death', died: 'death', dies: 'death', dead: 'death', deaths: 'death',
    wife: 'spouse', wives: 'spouse', husband: 'spouse', husbands: 'spouse',
    sentenced: 'sentence', sentence: 'sentence', sentencing: 'sentence',
    cruelty: 'cruelty', cruel: 'cruelty', abuse: 'cruelty', abusing: 'cruelty', abused: 'cruelty',
    animal: 'animal', animals: 'animal', dog: 'animal', dogs: 'animal', puppy: 'animal', cat: 'animal'
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
    return o.shared >= MIN_SHARED && o.jaccard >= MIN_JACCARD;
  }

  // Returns a new list: clustered groups collapse to the newest item with alsoCovered: [{ source, link, title }].
  function clusterTragedies(items) {
    items = Array.isArray(items) ? items.slice() : [];
    var n = items.length;
    if (n < 2) return items;
    var parent = [];
    for (var i = 0; i < n; i++) parent[i] = i;
    function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    function uni(a, b) {
      a = find(a); b = find(b);
      if (a === b) return;
      // Prefer the newer story as root.
      if (pubMs(items[a]) >= pubMs(items[b])) parent[b] = a;
      else parent[a] = b;
    }
    for (var i = 0; i < n; i++) {
      if (!eligible(items[i])) continue;
      for (var j = i + 1; j < n; j++) {
        if (!eligible(items[j])) continue;
        if (sameIncident(items[i], items[j])) uni(i, j);
      }
    }
    var groups = {};
    for (var i = 0; i < n; i++) {
      var r = find(i);
      if (!groups[r]) groups[r] = [];
      groups[r].push(i);
    }
    var drop = {};
    Object.keys(groups).forEach(function (r) {
      var g = groups[r];
      if (g.length < 2) return;
      g.sort(function (a, b) { return pubMs(items[b]) - pubMs(items[a]); });
      var head = g[0];
      var also = [];
      for (var k = 1; k < g.length; k++) {
        drop[g[k]] = 1;
        var it = items[g[k]];
        also.push({ source: it.source || 'another outlet', link: it.link || '', title: it.title || '' });
      }
      var lead = items[head];
      // Shallow clone so callers can keep the original list.
      var copy = {};
      Object.keys(lead).forEach(function (k) { copy[k] = lead[k]; });
      copy.alsoCovered = also;
      items[head] = copy;
    });
    return items.filter(function (_, i) { return !drop[i]; });
  }

  return {
    STOP: STOP,
    SYN: SYN,
    WINDOW_MS: WINDOW_MS,
    MIN_SHARED: MIN_SHARED,
    MIN_JACCARD: MIN_JACCARD,
    tokens: tokens,
    overlap: overlap,
    eligible: eligible,
    sameIncident: sameIncident,
    clusterTragedies: clusterTragedies
  };
});
