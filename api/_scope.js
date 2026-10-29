// Geography scope for /api/news (plan PR 6.1) and the county pages (PR 6.2-6.4).
//   ?scope=tristate            the default view (also what no ?scope gives)
//   ?scope=all                 every story, every region (the extended counties included)
//   ?scope=state:ky            one state (in, ky, il)
//   ?scope=county:ky-henderson one county
//   ?scope=counties:a,b        several counties ("My Counties"; up to 12, sorted and de-duplicated)
// Filtering uses the step 1 classifier (api/_location.js classify): a story counts for a county when the classifier
// assigns that county with confidence >= 0.6 (it leaves ambiguous names unassigned). A story that names no place at all still counts for its
// source's verified home county (a batch entry's `counties`, e.g. a weekly paper's own news), so small counties are not emptied by short headlines.
// The default view is the stored snapshot unchanged, with one rule (plan D8, extended counties never enter the
// default feed): items from expansion-batch sources (SOURCE_BATCHES) stay out of it unless they name a core county.
// With no batch sources in the snapshot, the default view is the snapshot itself, byte for byte.
// Southeast Missouri was removed (ship62): there is no Missouri scope, state page or county page; /news/missouri is a 404.
'use strict';
const path = require('path');
const crypto = require('crypto');
const LOC = require('./_location.js');
const REG = require('./_sources.js');
const TARGET = require(path.join(__dirname, '..', 'data', 'geography', 'target-counties.json'));

const STATES = { in: 'Indiana', ky: 'Kentucky', il: 'Illinois' };
const SLUGS = { in: 'indiana', ky: 'kentucky', il: 'illinois' };
const COUNTIES = TARGET.counties.map(c => ({ id: c.id, state: c.id.slice(0, 2), name: c.name, fullName: c.fullName, core: c.tier === 'tri_state_core' }));
const BY_ID = new Map(COUNTIES.map(c => [c.id, c]));
const CORE = new Set(COUNTIES.filter(c => c.core).map(c => c.id));
const MAX_COUNTIES = 12;
const MIN_CONF = 0.6; // the classifier only assigns a county it can stand behind (ambiguous names stay unassigned); 0.6 admits a
// county named without its state ("Henderson County"), which the classifier scores 0.65
const DEPTH_DAYS = 14;
// Index gate for county pages (plan D10): at least this many distinct local stories in 14 days. Provisional value,
// to be revisited with the phase 5.1 measurement; scripts/build-sitemap.js records the counts it used.
const DEPTH_MIN = 5;
// Batch sources and their claimed home counties (registry-only fields, kept here and never sent to readers).
const BATCH = new Map(REG.BATCHES.flatMap(b => b.sources).map(s => [s.id, s]));

const slugOf = c => c.id.slice(3);
const short = c => c.name + ' Co., ' + c.state.toUpperCase();

// Scope string -> { key, kind, countyIds, state, label } or { error }. key is canonical (the CDN cache key).
function parse(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s || s === 'tristate') return { key: 'tristate', kind: 'tristate', label: 'Tri-State' };
  if (s === 'all') return { key: 'all', kind: 'all', label: 'All Regions' };
  let m = /^state:([a-z]{2})$/.exec(s);
  if (m) return STATES[m[1]] ? { key: 'state:' + m[1], kind: 'state', state: m[1], countyIds: COUNTIES.filter(c => c.state === m[1]).map(c => c.id), label: STATES[m[1]] } : { error: 'unknown state' };
  m = /^county:([a-z]{2}-[a-z-]+)$/.exec(s);
  if (m) { const c = BY_ID.get(m[1]); return c ? { key: 'county:' + c.id, kind: 'county', countyIds: [c.id], label: c.fullName + ', ' + c.state.toUpperCase() } : { error: 'unknown county' }; }
  m = /^counties:([a-z, -]+)$/.exec(s);
  if (m) {
    const ids = [...new Set(m[1].split(',').map(x => x.trim()).filter(Boolean))].sort();
    if (!ids.length || ids.length > MAX_COUNTIES) return { error: 'choose 1 to ' + MAX_COUNTIES + ' counties' };
    if (ids.some(id => !BY_ID.has(id))) return { error: 'unknown county' };
    return { key: 'counties:' + ids.join(','), kind: 'counties', countyIds: ids, label: 'My Counties' };
  }
  return { error: 'unknown scope' };
}

// Manual county overrides (admin Sources & Coverage, api/_coverage.js): key -> countyIds ([] = no county). Keyed by
// the story link (or title), so a story keeps its override across refreshes. refreshAll copies the stored overrides
// into the snapshot (snap.overrides); an override replaces the classifier for that story everywhere scopes are used.
function overrideKey(item) { return 'o' + crypto.createHash('sha1').update(String((item && (item.link || item.title)) || '')).digest('hex').slice(0, 16); }

// One classification per story, kept while the same snapshot is served (a warm function serves many requests).
let memo = { at: null, map: new Map() };
let ovr = null;
function locOf(item, source, snapAt) {
  if (memo.at !== snapAt) memo = { at: snapAt, map: new Map() };
  const o = ovr && ovr[overrideKey(item)];
  if (Array.isArray(o)) {
    const ids = o.filter(id => BY_ID.has(id));
    return { ids, statewide: [], named: true, label: ids.length === 1 ? short(BY_ID.get(ids[0])) : null, override: true };
  }
  const k = (item.sourceId || '') + '|' + (item.link || '') + '|' + (item.title || '');
  let v = memo.map.get(k);
  if (!v) {
    let l = null;
    try { l = LOC.classify(item, source || { id: item.sourceId }); } catch (_) { l = null; }
    const ids = l && l.confidence >= MIN_CONF ? l.countyIds.filter(id => BY_ID.has(id)) : [];
    const level = l ? LOC.levelOf(l) : 'needs_review';
    const prim = l && l.primaryCountyId && BY_ID.get(l.primaryCountyId);
    const statewide = l && l.scope === 'statewide' ? (l.stateIds || []).map(x => String(x).toLowerCase()) : [];
    v = { ids, statewide, named: !!(l && (l.countyIds.length || l.reason === 'place_outside_area' || (l.unresolved || []).length)),
      label: prim && ids.length && (level === 'verified_county' || level === 'likely_county') ? short(prim) : null };
    memo.map.set(k, v);
  }
  return v;
}

// A source's home county: a batch entry's single verified home county (its evidence record shows stories there).
// The older registry has no such field; its regional outlets (an Evansville TV station) are not one county's paper.
const homeMemo = new Map();
function homeOf(source) {
  if (!source) return null;
  if (homeMemo.has(source.id)) return homeMemo.get(source.id);
  let h = null;
  const b = BATCH.get(source.id);
  if (b) h = b.counties && b.counties.length === 1 ? b.counties[0] : null;
  homeMemo.set(source.id, h);
  return h;
}

function inScope(item, source, scope, snapAt) {
  if (scope.kind === 'all') return true;
  const isBatch = BATCH.has(item.sourceId);
  if (scope.kind === 'tristate') {
    if (!isBatch) return true; // the existing sources' stories are the default view, exactly as before
    return locOf(item, source, snapAt).ids.some(id => CORE.has(id));
  }
  const want = new Set(scope.countyIds);
  const l = locOf(item, source, snapAt);
  if (l.ids.length) return l.ids.some(id => want.has(id));
  if (scope.kind === 'state' && l.statewide.includes(scope.state)) return true;
  if (l.named) return false; // it names somewhere, just not confidently here
  const h = homeOf(source);
  return !!h && want.has(h);
}

// The served view of a snapshot. Default (tristate) returns the snapshot object itself when it holds no batch items.
function view(snap, scope, sources, opts) {
  scope = scope || parse('');
  opts = opts || {};
  if (!snap || !Array.isArray(snap.items)) return snap;
  ovr = snap.overrides || null;
  const byId = new Map((sources || []).map(s => [s.id, s]));
  if (scope.kind === 'tristate' && !opts.labels && !snap.items.some(i => BATCH.has(i.sourceId))) return stripOverrides(snap);
  const items = snap.items.filter(i => inScope(i, byId.get(i.sourceId), scope, snap.updatedAt));
  const out = Object.assign({}, stripOverrides(snap), { items });
  if (opts.labels) {
    out.items = items.map(i => { const lab = locOf(i, byId.get(i.sourceId), snap.updatedAt).label; return lab ? Object.assign({}, i, { place: lab }) : i; });
    out.scope = { key: scope.key, kind: scope.kind, label: scope.label };
    if (scope.countyIds && scope.kind !== 'state') out.scope.sources = (sources || []).filter(s => scope.countyIds.includes(homeOf(s))).map(s => s.name);
  }
  return out;
}

// The override map is admin data: it stays out of what readers get (their stories just land in the right county).
function stripOverrides(snap) { if (!snap || !('overrides' in snap)) return snap; const o = Object.assign({}, snap); delete o.overrides; return o; }

// Distinct local stories per county in the last 14 days (the D10 depth measure): stories the classifier places in the
// county, counted once per title.
function depth(snap, sources, now) {
  const byId = new Map((sources || []).map(s => [s.id, s]));
  ovr = (snap && snap.overrides) || null;
  const since = (now || Date.now()) - DEPTH_DAYS * 864e5;
  const seen = new Map(COUNTIES.map(c => [c.id, new Set()]));
  for (const it of (snap && snap.items) || []) {
    if (it.isEvent || it.isObit) continue;
    const t = Date.parse(it.published || ''); if (!(t >= since)) continue;
    const l = locOf(it, byId.get(it.sourceId), (snap && snap.updatedAt) || null);
    const ids = l.ids.length ? l.ids : (!l.named && homeOf(byId.get(it.sourceId)) ? [homeOf(byId.get(it.sourceId))] : []);
    const key = String(it.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    for (const id of ids) if (seen.has(id)) seen.get(id).add(key);
  }
  const out = {}; for (const [id, s] of seen) out[id] = s.size;
  return out;
}

// /news/<state>[/<county>] <-> scope. Returns null for anything that isn't one of our 3 states or 57 counties.
function fromPath(p) {
  const m = /^\/news\/([a-z]+)(?:\/([a-z-]+))?\/?$/.exec(String(p || '').toLowerCase().split(/[?#]/)[0]);
  if (!m) return null;
  const st = Object.keys(SLUGS).find(k => SLUGS[k] === m[1]); if (!st) return null;
  if (!m[2]) return parse('state:' + st);
  const c = BY_ID.get(st + '-' + m[2]);
  return c ? parse('county:' + c.id) : null;
}
function pathOf(scope) {
  if (scope.kind === 'state') return '/news/' + SLUGS[scope.state];
  if (scope.kind === 'county') { const c = BY_ID.get(scope.countyIds[0]); return '/news/' + SLUGS[c.state] + '/' + slugOf(c); }
  return null;
}

module.exports = { overrideKey, locOf, homeOf, BY_ID, BATCH, parse, view, depth, fromPath, pathOf, COUNTIES, CORE, STATES, SLUGS, DEPTH_MIN, DEPTH_DAYS };
