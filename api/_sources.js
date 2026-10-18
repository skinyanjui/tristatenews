// Source registry (plan PR 3.1). The sources live as data in data/sources/*.json, one file per listed area:
// indiana, kentucky, illinois and statewide. A source's file follows its `area`, not where the publisher is based.
// This module loads them, checks them, and hands news.js the same SOURCES array it used to define inline.
//
// Fields of a registry entry (all but seq, id, name, area and url are optional):
//   seq          position in the combined list (1, 2, 3, ... with no gaps across all files). Order matters: sources on
//                one host are fetched in this order, the first copy of a duplicate story wins in combine(), and the
//                snapshot's sources[] is listed in this order. Not passed to news.js.
//   note         free text for maintainers (why a URL or flag was chosen). Not passed to news.js.
//   id           unique, stable id (Redis keys tsn:src:<id> and the page use it; never rename one)
//   name, area   shown on the page
//   url          the feed (http or https). Google News fallbacks are stored as full URLs.
//   altUrls      tried in order when url fails or returns no usable items
//   kind         institution | courts | police | events | obits; absent means news
//   geo          true: the outlet covers a wider region than ours, so only stories naming a REGION_TERMS place are kept
//   strictGeo    ind | ky | ill: statewide publishers; items must name a Tri-State place in that state (api/_places.js)
//   geoTerms     extra place names that are unambiguous inside this one publisher's area
//   maxAgeDays   how long its stories stay on the page; everyMin: minimum minutes between fetches
//   parser       sitemap | venue | ticketmaster (default: RSS, Atom or iCal)
//   funeralHome  true for funeral homes (their card wins over a paper's for the same person)
//   disabled     a reason string: the source stays listed here (easy to re-enable) but is never fetched or shown
const FILES = [
  require('../data/sources/indiana.json'),
  require('../data/sources/kentucky.json'),
  require('../data/sources/illinois.json'),
  require('../data/sources/statewide.json'),
];

const KINDS = ['institution', 'courts', 'police', 'events', 'obits'];
const STRICT = ['ind', 'ky', 'ill'];
const HTTP = /^https?:\/\//;

// Problems with the registry, as strings; [] when it is valid. Tests assert [], so a bad edit fails CI, not production.
function validate(files) {
  const problems = [], ids = new Set(), seqs = new Set();
  for (const f of files || FILES) {
    if (!f || !Array.isArray(f.sources)) { problems.push('file ' + (f && f.file) + ': no sources array'); continue; }
    for (const s of f.sources) {
      const where = f.file + ':' + (s && s.id);
      if (!s || typeof s !== 'object') { problems.push(where + ': not an object'); continue; }
      if (!Number.isInteger(s.seq) || s.seq < 1) problems.push(where + ': seq must be a positive integer');
      else if (seqs.has(s.seq)) problems.push(where + ': duplicate seq ' + s.seq); else seqs.add(s.seq);
      for (const k of ['id', 'name', 'area']) if (typeof s[k] !== 'string' || !s[k]) problems.push(where + ': missing ' + k);
      if (ids.has(s.id)) problems.push(where + ': duplicate id'); else ids.add(s.id);
      if (!HTTP.test(s.url || '')) problems.push(where + ': url must be http(s)');
      if (s.altUrls !== undefined && (!Array.isArray(s.altUrls) || s.altUrls.some(u => !HTTP.test(u)))) problems.push(where + ': altUrls must be http(s) URLs');
      if (s.kind !== undefined && !KINDS.includes(s.kind)) problems.push(where + ': unknown kind ' + s.kind);
      if (s.strictGeo !== undefined && !STRICT.includes(s.strictGeo)) problems.push(where + ': unknown strictGeo ' + s.strictGeo);
      if (s.geoTerms !== undefined && (!Array.isArray(s.geoTerms) || s.geoTerms.some(t => typeof t !== 'string'))) problems.push(where + ': geoTerms must be strings');
    }
  }
  return problems;
}

// All entries in seq order, without the registry-only fields (seq, note); every other key is kept as written.
function registry(files) {
  return (files || FILES).flatMap(f => f.sources).slice().sort((a, b) => a.seq - b.seq).map(s => {
    const o = {};
    for (const k of Object.keys(s)) if (k !== 'seq' && k !== 'note') o[k] = s[k];
    return o;
  });
}

const SOURCES = registry();

// A source with a `disabled` reason stays listed in the registry but is never fetched or shown.
const DISABLED_SOURCES = SOURCES.filter(s => s.disabled);
for (let i = SOURCES.length - 1; i >= 0; i--) if (SOURCES[i].disabled) SOURCES.splice(i, 1);

// Add more feeds without editing code: set EXTRA_FEEDS in the Vercel project to a JSON array like
// [{"id":"usi","name":"USI News","area":"Evansville","kind":"institution","url":"https://example.edu/feed"}]
// Add "geo": true for outlets that cover a wider region than ours, and "everyMin": 60 (minutes between
// fetches) for hosts that rate-limit, such as BLOX papers.
try {
  const extra = JSON.parse(process.env.EXTRA_FEEDS || '[]');
  for (const e of Array.isArray(extra) ? extra : []) {
    if (e && e.id && e.name && /^https?:\/\//.test(e.url || '') && !SOURCES.some(s => s.id === e.id)) {
      SOURCES.push({ id: String(e.id), name: String(e.name), area: String(e.area || ''), kind: ['institution', 'courts', 'police', 'events', 'obits'].includes(e.kind) ? e.kind : undefined, geo: !!e.geo, strictGeo: ['ind', 'ky', 'ill'].includes(e.strictGeo) ? e.strictGeo : undefined, maxAgeDays: Number(e.maxAgeDays) > 0 ? Number(e.maxAgeDays) : undefined, everyMin: Number(e.everyMin) > 0 ? Number(e.everyMin) : undefined, url: e.url, altUrls: Array.isArray(e.altUrls) ? e.altUrls.filter(u => /^https?:\/\//.test(u)) : [] });
    }
  }
} catch (_) { /* ignore malformed EXTRA_FEEDS */ }

module.exports = { SOURCES, DISABLED_SOURCES, validate, registry, FILES };
