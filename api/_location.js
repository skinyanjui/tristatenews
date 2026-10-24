// Article location contract (plan §6.4, PR 4.2) and the shadow classifier (stage B).
// A story is placed where it HAPPENS, from evidence in its own text, never from where the publisher is based.
// Three relationships stay separate:
//   sourceCoverage(source)   which counties a SOURCE covers (from its registry `area`), a weak prior only
//   classify(item, source)   the ARTICLE's geography: the location contract below
//   reader preference        lives in the reader's browser only (plan §4); never read or written here
//
// location = { scope, primaryCountyId, countyIds, stateIds, confidence, method, level, evidence, requiresReview,
//              reason, unresolved, publisherPrior, inTriStateHistoric, inCore }
//   scope    county | multi_county | regional (5+ counties) | statewide | unknown
//   method   explicit_county      a county named ("Posey County", "Perry County, Mo.")
//            seat_with_state     a place with its state ("Princeton, Ind.")
//            unique_locality     a place with one candidate (Owensboro), resolved by the feed's state, by a county
//                                named alongside, or (local outlets only) a non-ambiguous name with one candidate here
//            official_source     a police/courts source whose own area is one county, and the text names no place
//            state_named         only a state is named (Indiana lawmakers ...): statewide
//            dateline_prior      only a dateline ("HENDERSON, Ky. (WEHT) -", where the newsroom filed) names a place:
//                                recorded in datelinePrior, confidence 0.3, never a county
//            publisher_prior     nothing in the text; the source's area is recorded, confidence <= 0.4, never a county
//            none                no evidence at all
//   level    verified_county (one county, confidence >= 0.85, explicit_county / seat_with_state) | likely_county
//            (>= 0.7) | possible | out_of_area (only places in other states) | needs_review. publisher_prior alone is never verified, and never assigns a county.
// Ambiguous names (Washington, Marion, Mount Vernon, Princeton, Perry County, Daviess County ...) are never guessed:
// without a state qualifier or a county named alongside they stay unassigned, listed in `unresolved` with the
// alias table's reasons. Place matching itself is api/_places.js locate() over the generated alias table.
const { locate, foldGeo } = require('./_places.js');
const GEO = require('./_geo.js');

const COUNTY = new Map(GEO.counties.map(c => [c.id, c]));
const FILE_STATE = { 'indiana.json': 'IN', 'kentucky.json': 'KY', 'illinois.json': 'IL' };
const STRICT_STATE = { ind: 'IN', ky: 'KY', ill: 'IL' };
const STATE_WORDS = { IN: 'indiana', KY: 'kentucky', IL: 'illinois' }; // the covered states (southeast Missouri was removed in ship62)
const AREA_STATES = new Set(Object.keys(STATE_WORDS));
const REGIONAL = 5; // this many counties or more: a regional story, no primary county

// Base confidence per (alias type, locate() method). Text evidence only; see the header for the meaning.
const CONF = {
  'county:with_state': 0.95, 'county:unique_locality': 0.9, 'county:co_occurring_county': 0.85, 'county:feed_state': 0.85,
  'place:with_state': 0.9, 'place:unique_locality': 0.8, 'place:co_occurring_county': 0.75, 'place:feed_state': 0.75,
  'county:local_outlet': 0.65, 'place:local_outlet': 0.6
};
const methodOf = (type, how) => type === 'county' ? 'explicit_county' : how === 'with_state' ? 'seat_with_state' : 'unique_locality';

// Registry context per source id: the state of its file (or its strictGeo state) and whether it is a statewide outlet.
let REG = null;
function registry() {
  if (REG) return REG;
  REG = new Map();
  for (const [file, f] of [['indiana.json', require('../data/sources/indiana.json')], ['kentucky.json', require('../data/sources/kentucky.json')],
    ['illinois.json', require('../data/sources/illinois.json')], ['statewide.json', require('../data/sources/statewide.json')]]) {
    for (const s of f.sources || []) REG.set(s.id, { file, statewide: file === 'statewide.json', state: FILE_STATE[file] || STRICT_STATE[s.strictGeo] || null });
  }
  return REG;
}
function sourceInfo(source) {
  if (!source) return { statewide: true, state: null };
  const r = registry().get(source.id);
  if (r) return r;
  return { statewide: !!source.strictGeo, state: STRICT_STATE[source.strictGeo] || null }; // EXTRA_FEEDS sources
}

// Source coverage: the counties a source's `area` names. A research/fetch input and a weak prior, not article geography.
function sourceCoverage(source) {
  const info = sourceInfo(source);
  const area = String((source && source.area) || '');
  const r = area ? locate(area, { feedState: info.state }) : { matches: [] };
  const countyIds = [...new Set(r.matches.flatMap(m => m.countyIds))];
  const stateIds = [...new Set(countyIds.map(id => COUNTY.get(id).state).concat(Object.entries(STATE_WORDS).filter(([, w]) => new RegExp('\\b' + w + '\\b', 'i').test(area)).map(([k]) => k)))];
  return { sourceId: (source && source.id) || null, area, kind: (source && source.kind) || 'news', statewide: info.statewide, state: info.state, countyIds, stateIds };
}

// "(Mo.)", "(Ill.)", "(Indiana)" after a name become ", Mo." so locate() reads them as state qualifiers.
function qualifyParens(text) {
  return String(text || '').replace(/\s*\(\s*(mo|ill|ind|ky|missouri|illinois|indiana|kentucky)\.?\s*\)/gi, (m, s) => ', ' + s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() + (s.length <= 3 ? '.' : ''));
}
// A wire-style dateline at the start of a summary: "HENDERSON, Ky. (WEHT) -". Where the reporter filed from, which is
// weaker evidence than the headline: counties named only there are dropped when the story names others.
const DATELINE = /^\s*([A-Z][A-Z .'\u2019-]{1,40}(?:,\s*[A-Za-z. ]{2,14})?)\s*(?:\([^)]{1,20}\))?\s*(?:--|[-\u2013\u2014])\s+/;
function splitDateline(summary) {
  const s = String(summary || '');
  const m = DATELINE.exec(s);
  return m ? { dateline: m[1], body: s.slice(m[0].length) } : { dateline: '', body: s };
}

// The publisher's own name ("Healthy Drinks - Dubois County Herald", "Vincennes Sun-Commercial") is not evidence of
// where a story happened: it is removed before matching.
function withoutPublisher(text, names) {
  let t = String(text || '');
  for (const n of names) if (n && n.length > 3) t = t.split(n).join(' ');
  return t;
}
function fieldsOf(item, names) {
  const { dateline, body } = splitDateline(item && item.summary);
  const f = { title: withoutPublisher((item && item.title) || '', names), dateline, summary: withoutPublisher(body, names) };
  if (item && item.venue) f.venue = String(item.venue);
  return f;
}

function classify(item, source, opts) {
  opts = opts || {};
  const info = sourceInfo(source);
  const fields = fieldsOf(item || {}, [source && source.name, item && item.source].filter(Boolean));
  const keys = Object.keys(fields).filter(k => fields[k]);
  const text = keys.map(k => qualifyParens(fields[k])).join(' . ');
  const r = locate(text, { feedState: info.state });
  const folded = {}; for (const k of keys) folded[k] = foldGeo(qualifyParens(fields[k]));
  const where = t => keys.filter(k => new RegExp('(?<![a-z0-9])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])').test(folded[k]));
  const hits = r.matches.map(m => ({ alias: m.alias, text: m.text, type: m.type, id: m.id, countyIds: m.countyIds, how: m.method, fields: where(m.text) }));
  // A local outlet's non-ambiguous name with exactly one candidate in our 57 counties ("Madisonville" in an Evansville
  // TV feed) counts, at lower confidence. Statewide outlets and ambiguous names never get this.
  const unresolved = [];
  for (const u of r.unresolved) {
    const alias = GEO.aliases.find(a => a.alias === u.alias);
    if (!info.statewide && alias && !alias.ambiguous && u.candidates.length === 1) hits.push({ alias: u.alias, text: u.text, type: u.candidates[0].id === u.candidates[0].countyIds[0] && u.candidates[0].countyIds.length === 1 && /county/.test(u.alias) ? 'county' : 'place', id: u.candidates[0].id, countyIds: u.candidates[0].countyIds, how: 'local_outlet', fields: where(u.text) });
    else unresolved.push({ alias: u.alias, text: u.text, reasons: u.reasons, candidates: [...new Set(u.candidates.flatMap(c => c.countyIds))] });
  }
  const rejected = r.rejected.map(x => ({ alias: x.alias, qualifier: x.qualifier }));

  // Counties with their best evidence. Dateline-only counties drop out when the headline or body names a county.
  const best = new Map(); // countyId -> { conf, method, inTitle, order, spans }
  hits.forEach((h, order) => {
    const conf = CONF[h.type + ':' + h.how] || 0.6;
    for (const c of h.countyIds) {
      const prev = best.get(c);
      const v = { conf: h.countyIds.length > 1 ? conf - 0.15 : conf, method: methodOf(h.type, h.how), inTitle: h.fields.includes('title'), datelineOnly: h.fields.length > 0 && h.fields.every(f => f === 'dateline'), order, spans: h.countyIds.length > 1 };
      if (!prev) best.set(c, v);
      else best.set(c, { conf: Math.max(prev.conf, v.conf), method: prev.conf >= v.conf ? prev.method : v.method, inTitle: prev.inTitle || v.inTitle, datelineOnly: prev.datelineOnly && v.datelineOnly, order: Math.min(prev.order, v.order), spans: prev.spans && v.spans });
    }
  });
  let ids = [...best.keys()];
  if (ids.some(c => !best.get(c).datelineOnly)) ids = ids.filter(c => !best.get(c).datelineOnly);
  ids.sort((a, b) => (best.get(b).inTitle - best.get(a).inTitle) || (best.get(b).conf - best.get(a).conf) || (best.get(a).order - best.get(b).order));

  // An ambiguous name whose candidates meet exactly one county already found ("Owensboro and Daviess County") supports it.
  for (let i = unresolved.length - 1; i >= 0; i--) {
    const inter = unresolved[i].candidates.filter(c => ids.includes(c));
    if (inter.length === 1) { hits.push({ alias: unresolved[i].alias, text: unresolved[i].text, type: /county/.test(unresolved[i].alias) ? 'county' : 'place', id: inter[0], countyIds: inter, how: 'co_occurring', fields: where(unresolved[i].text) }); unresolved.splice(i, 1); }
  }
  // Only a dateline names the place: that is where the newsroom filed from (often its own city), not proof of where
  // the story happened. Kept, but capped below "likely" and sent to review.
  const datelineOnly = ids.length > 0 && ids.every(c => best.get(c).datelineOnly);
  let datelinePrior = null;
  if (datelineOnly) { datelinePrior = { countyIds: ids, text: fields.dateline }; ids = []; }
  const evidence = hits.filter(h => h.countyIds.some(c => ids.includes(c))).map(h => ({ text: h.text, field: h.fields[0] || 'text', rule: h.how, countyIds: h.countyIds }));
  const coverage = sourceCoverage(source);
  const out = { scope: 'unknown', primaryCountyId: null, countyIds: [], stateIds: [], confidence: 0, method: 'none', level: 'needs_review', evidence, requiresReview: false, reason: '', unresolved, rejected, publisherPrior: coverage.countyIds.length ? { countyIds: coverage.countyIds, confidence: 0.3 } : null, datelinePrior: datelinePrior };

  if (ids.length) {
    const top = best.get(ids[0]);
    out.countyIds = ids;
    out.method = top.method;
    if (ids.length >= REGIONAL) { out.scope = 'regional'; out.confidence = round(Math.min(...ids.map(c => best.get(c).conf))); }
    else if (ids.length === 1 && !top.spans) { out.scope = 'county'; out.primaryCountyId = ids[0]; out.confidence = round(top.conf); }
    else if (ids.every(c => best.get(c).spans) && hits.filter(h => h.countyIds.some(c => ids.includes(c))).length === 1) {
      out.scope = 'multi_county'; out.confidence = round(top.conf); out.reason = 'place_spans_counties'; out.requiresReview = true;
    } else {
      out.scope = 'multi_county'; out.confidence = round(top.conf - 0.05);
      const titled = ids.filter(c => best.get(c).inTitle);
      if (titled.length === 1 || (!titled.length && ids.length > 1 && best.get(ids[0]).conf > best.get(ids[1]).conf)) out.primaryCountyId = ids[0];
      else if (titled.length > 1 && best.get(titled[0]).conf > best.get(titled[1]).conf) out.primaryCountyId = titled[0];
    }
    if (unresolved.some(u => !u.candidates.some(c => ids.includes(c)))) { out.requiresReview = true; out.reason = out.reason || 'also_names_ambiguous_place'; }
  } else if (datelinePrior && !Object.values(STATE_WORDS).some(w => new RegExp('(?<![a-z])' + w + '(?![a-z])').test(folded.title || ''))) {
    // Only the dateline names a place (and the headline names no state): kept as a prior, never assigned.
    out.method = 'dateline_prior'; out.confidence = 0.3; out.reason = 'dateline_only'; out.requiresReview = true; out.evidence = [];
  } else if (unresolved.length) {
    out.reason = 'ambiguous_name'; out.requiresReview = true; out.method = 'none';
  } else if (rejected.length) {
    out.reason = 'place_outside_area';
  } else {
    const states = Object.entries(STATE_WORDS).filter(([, w]) => new RegExp('(?<![a-z])' + w + '(?![a-z])').test(keys.map(k => folded[k]).join(' '))).map(([k]) => k);
    const official = (coverage.kind === 'police' || coverage.kind === 'courts') && coverage.countyIds.length === 1;
    if (official) {
      out.scope = 'county'; out.primaryCountyId = coverage.countyIds[0]; out.countyIds = coverage.countyIds.slice(); out.method = 'official_source'; out.confidence = 0.7;
      out.evidence = [{ text: coverage.area, field: 'source.area', rule: 'official_source', countyIds: coverage.countyIds }];
    } else if (states.length) {
      out.scope = 'statewide'; out.stateIds = states; out.method = 'state_named'; out.confidence = 0.5; out.reason = 'state_only';
      out.evidence = states.map(s => ({ text: STATE_WORDS[s], field: 'text', rule: 'state_named', countyIds: [] }));
    } else if (out.publisherPrior) {
      out.method = 'publisher_prior'; out.confidence = 0.3; out.reason = 'no_place_named'; out.requiresReview = true;
    } else out.reason = 'no_place_named';
  }
  if (out.countyIds.length) out.stateIds = [...new Set(out.countyIds.map(c => COUNTY.get(c).state))];
  out.level = levelOf(out);
  out.inTriStateHistoric = out.countyIds.some(c => COUNTY.get(c).groups.includes('tri_state_historic'));
  out.inCore = out.countyIds.some(c => COUNTY.get(c).groups.includes('tri_state_core'));
  if (out.confidence < 0.7 && out.countyIds.length && out.method !== 'official_source') out.requiresReview = true;
  if (!opts.verbose) { if (!out.unresolved.length) delete out.unresolved; if (!out.rejected.length) delete out.rejected; }
  return out;
}
const round = x => Math.round(x * 100) / 100;
function levelOf(l) {
  if (l.reason === 'place_outside_area') return 'out_of_area';
  if (l.scope === 'county' && l.confidence >= 0.85 && (l.method === 'explicit_county' || l.method === 'seat_with_state')) return 'verified_county';
  if (l.countyIds.length && l.confidence >= 0.7) return 'likely_county';
  if (l.countyIds.length || l.scope === 'statewide') return 'possible';
  return 'needs_review';
}

// Shadow record for a snapshot: one compact row per story plus counts. Stored privately by refresh when
// COUNTY_CLASSIFICATION_ENABLED is on; never added to the public snapshot.
const SHADOW_KEY = 'tsn:loc:shadow', SHADOW_TTL = 7 * 86400, SHADOW_ITEMS = 400;
function shadow(snapshot, sources, meta) {
  const byId = new Map((sources || []).map(s => [s.id, s]));
  const rows = [];
  for (const it of (snapshot && snapshot.items) || []) {
    if (it.isEvent || it.isObit) continue; // stories only; events and obituaries carry their own place fields
    const l = classify(it, byId.get(it.sourceId) || { id: it.sourceId });
    rows.push({ id: it.id, sourceId: it.sourceId, title: String(it.title || '').slice(0, 140), location: l });
  }
  return Object.assign({ classifierVersion: VERSION, manifestVersion: GEO.manifestVersion, at: new Date().toISOString() }, meta || {}, { summary: summarize(rows), items: rows.slice(0, SHADOW_ITEMS) });
}
function summarize(rows) {
  const s = { total: rows.length, byScope: {}, byLevel: {}, byMethod: {}, byReason: {}, requiresReview: 0, assigned: 0, ambiguousLeftUnassigned: 0, topCounties: {} };
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const { location: l } of rows) {
    inc(s.byScope, l.scope); inc(s.byLevel, l.level); inc(s.byMethod, l.method); if (l.reason) inc(s.byReason, l.reason);
    if (l.requiresReview) s.requiresReview++;
    if (l.countyIds.length) s.assigned++;
    if (l.reason === 'ambiguous_name') s.ambiguousLeftUnassigned++;
    for (const c of l.countyIds) inc(s.topCounties, c);
  }
  s.topCounties = Object.fromEntries(Object.entries(s.topCounties).sort((a, b) => b[1] - a[1]).slice(0, 15));
  return s;
}
// Accuracy against a labeled sample: labels = [{ id, expected: { countyIds: [...] } | { scope: 'unknown' } }].
// A prediction is correct when its county set equals the label's (both empty counts as correct for "unknown").
// precision = correct assigned / assigned, recall = correct assigned / labels that have counties.
function accuracy(rows, labels) {
  const byId = new Map(rows.map(r => [r.id, r]));
  let assigned = 0, correctAssigned = 0, labeledWithCounty = 0, unknownCorrect = 0, unknownLabels = 0, missing = 0;
  const wrong = [];
  for (const lb of labels || []) {
    const r = byId.get(lb.id); if (!r) { missing++; continue; }
    const want = [...new Set((lb.expected && lb.expected.countyIds) || [])].sort(), got = [...r.location.countyIds].sort();
    const same = want.length === got.length && want.every((c, i) => c === got[i]);
    if (want.length) labeledWithCounty++; else unknownLabels++;
    if (got.length) { assigned++; if (same) correctAssigned++; }
    if (!want.length && !got.length) unknownCorrect++;
    if (!same) wrong.push({ id: lb.id, title: r.title, expected: want, got });
  }
  const pct = (a, b) => b ? Math.round(1000 * a / b) / 10 : null;
  return { labels: (labels || []).length, missing, assigned, correctAssigned, precision: pct(correctAssigned, assigned), recall: pct(correctAssigned, labeledWithCounty), unknownLabels, unknownCorrect, wrong: wrong.slice(0, 50) };
}
const VERSION = 1;

module.exports = { classify, sourceCoverage, shadow, summarize, accuracy, levelOf, splitDateline, qualifyParens, SHADOW_KEY, SHADOW_TTL, VERSION, AREA_STATES };
