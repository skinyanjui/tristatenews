// Rolling per-county depth record for the county-page index gate (D10: >= DEPTH_MIN distinct local stories in
// DEPTH_DAYS days). The public snapshot keeps only the newest MAX_ITEMS news stories (240, about a day or two across
// ~80 sources), so a 14-day count can't come from it. Instead every refresh folds the stories it placed into one
// compact Redis record, tsn:geo:depth, kept for DEPTH_DAYS:
//   { v: 1, updatedAt, days: 14, cap: 40, c: { '<countyId>': [['<story id>', <hour>], ...] } }
// story id: 10 hex chars of sha1(normalized title), the same "distinct title" rule as _scope.depth(); hour: whole hours
// since the epoch of the story's published time. Each county keeps at most CAP newest ids (the gate needs 5), so
// the record is bounded: 57 x 40 entries, under 70 KB even when every county is full.
// Cost: read with the refresh's existing read request (+1 GET) and written with its existing write request (+1 SET),
// so 2 more billed commands per refresh and no extra round trips.
// Readers: the county pages and /sitemap-regions.xml (api/_geopage.js) and the admin coverage report. When the record
// is missing or empty, they fall back to the committed measurement data/geography/coverage.json.
'use strict';
const crypto = require('crypto');
const S = require('./_scope.js');

const KEY = 'tsn:geo:depth';
const CAP = 40;
const TTL = S.DEPTH_DAYS * 86400;
const H = 36e5;
const sid = it => crypto.createHash('sha1').update(String(it.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).digest('hex').slice(0, 10);

function parse(raw) {
  let r = raw; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_) { return null; } }
  return r && r.v === 1 && r.c && typeof r.c === 'object' ? r : null;
}

// Places each story (news only, last DEPTH_DAYS) with the same rules as _scope.depth() and merges it into prev.
// items: every news story this refresh kept before the public cap; overrides: { overrideKey: countyIds }.
function update(prev, items, sources, now, overrides) {
  prev = parse(prev);
  const byId = new Map((sources || []).map(s => [s.id, s]));
  const floor = Math.floor((now - S.DEPTH_DAYS * 864e5) / H);
  const sets = new Map(S.COUNTIES.map(c => [c.id, new Map()]));
  if (prev) for (const [cid, list] of Object.entries(prev.c)) {
    const m = sets.get(cid); if (!m || !Array.isArray(list)) continue;
    for (const e of list) if (Array.isArray(e) && typeof e[0] === 'string' && Number.isFinite(e[1]) && e[1] >= floor) m.set(e[0], Math.max(m.get(e[0]) || 0, e[1]));
  }
  const snapLike = { items: items || [], updatedAt: new Date(now).toISOString(), overrides: overrides || null };
  S.depth(snapLike, sources, now); // sets the module's override map for locOf, exactly as for a snapshot
  for (const it of items || []) {
    if (it.isEvent || it.isObit) continue;
    const t = Date.parse(it.published || ''); if (!(t >= now - S.DEPTH_DAYS * 864e5) || t > now + H) continue;
    const src = byId.get(it.sourceId);
    const l = S.locOf(it, src, snapLike.updatedAt);
    const ids = l.ids.length ? l.ids : (!l.named && S.homeOf(src) ? [S.homeOf(src)] : []);
    const id = sid(it), hr = Math.floor(t / H);
    for (const cid of ids) { const m = sets.get(cid); if (m) m.set(id, Math.max(m.get(id) || 0, hr)); }
  }
  const c = {};
  for (const [cid, m] of sets) if (m.size) c[cid] = [...m].sort((a, b) => b[1] - a[1]).slice(0, CAP);
  return { v: 1, updatedAt: new Date(now).toISOString(), days: S.DEPTH_DAYS, cap: CAP, c };
}

// Distinct stories per county in the window (null when the record is missing or has nothing at all).
function counts(rec, now) {
  rec = parse(rec); if (!rec) return null;
  const floor = Math.floor(((now || Date.now()) - S.DEPTH_DAYS * 864e5) / H);
  const out = {}; let any = 0;
  for (const c of S.COUNTIES) { const n = (rec.c[c.id] || []).filter(e => Array.isArray(e) && e[1] >= floor).length; out[c.id] = n; any += n; }
  return any ? out : null;
}

// The gate the pages use: { source: 'rolling' | 'measured' | 'none', at, depth }.
function gate(rec, now) {
  const n = counts(rec, now);
  if (n) return { source: 'rolling', at: parse(rec).updatedAt, depth: n, min: S.DEPTH_MIN };
  let cov = null; try { cov = require('../data/geography/coverage.json'); } catch (_) { cov = null; }
  if (cov && cov.depth) return { source: 'measured', at: cov.measuredAt || null, depth: cov.depth, min: cov.min || S.DEPTH_MIN };
  return { source: 'none', at: null, depth: {}, min: S.DEPTH_MIN };
}

module.exports = { KEY, CAP, TTL, sid, parse, update, counts, gate };
