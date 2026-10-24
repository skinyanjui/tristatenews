// Read-only geography API (plan PR 2.3), served by api/news.js through vercel.json rewrites:
//   /api/counties -> /api/news?__route=counties
//   /api/regions  -> /api/news?__route=regions
// Both answer from api/_geo.js, the module scripts/build-geo.js generates from data/geography/. Nothing here reads
// or writes Redis, fetches anything, or keeps state: the same request always gets the same bytes until the next
// deploy, so responses are CDN-cacheable and carry a strong ETag.
// Coverage is Illinois, Indiana and Kentucky (southeast Missouri was removed in ship62).
'use strict';
const crypto = require('crypto');
const GEO = require('./_geo.js');

const CACHE = 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800';
const NOTE = 'Read-only reference data. Regions and subregions are editorial judgment, not official boundaries. ' +
  'Coverage is Illinois, Indiana and Kentucky.';
const R = GEO.registry;
const groupById = new Map(R.groups.map(g => [g.id, g]));
const isRegion = g => g.kind === 'editorial_region' || g.kind === 'editorial_subregion';
const TIERS = R.groups.filter(g => g.kind === 'tier');
const STATES = [...new Set(R.counties.map(c => c.state))].sort();

function countyView(c) {
  const of = type => c.memberships.filter(m => m.type === type && isRegion(groupById.get(m.groupId)));
  const top = t => of(t).filter(m => groupById.get(m.groupId).kind === 'editorial_region').map(m => m.groupId);
  const sub = of('primary').filter(m => groupById.get(m.groupId).kind === 'editorial_subregion').map(m => m.groupId);
  return {
    id: c.id, state: c.state, name: c.name, fullName: c.fullName, fips: c.fips,
    tier: c.tier, tierName: groupById.get(c.tier).name,
    historicTriState: c.memberships.some(m => m.groupId === 'tri_state_historic'),
    seat: c.seat, internalPoint: c.internalPoint,
    regions: { primary: top('primary')[0] || null, secondary: top('secondary'), subregion: sub[0] || null },
  };
}
function regionView(g) {
  const ids = t => g.members.filter(m => m.type === t).map(m => m.countyId);
  const all = g.members.map(m => m.countyId);
  return {
    id: g.id, slug: g.id.replace(/^region:/, ''), name: g.name, kind: g.kind, parent: g.parent,
    description: g.description, membershipStatus: g.membershipStatus, overlapping: g.overlapping, hubCountyIds: g.hubCountyIds,
    states: [...new Set(all.map(id => id.slice(0, 2).toUpperCase()))].sort(),
    counties: { primary: ids('primary'), secondary: ids('secondary') },
    subregions: R.groups.filter(s => s.parent === g.id && isRegion(s)).map(s => s.id),
  };
}
const COUNTIES = R.counties.map(countyView);
const REGIONS = R.groups.filter(isRegion).map(regionView);
const regionIds = new Set(REGIONS.map(r => r.id));

const one = v => (Array.isArray(v) ? v[0] : v);
function params(req) { // query from req.query (Vercel, Express) or the URL; the rewrite's __route is not a filter
  const q = Object.assign({}, req.query || {});
  if (!req.query) { try { for (const [k, v] of new URL(req.url || '/', 'http://x').searchParams) q[k] = v; } catch (_) { /* none */ } }
  delete q.__route;
  return q;
}
function send(req, res, code, obj, cache) {
  const body = JSON.stringify(obj);
  const etag = '"' + crypto.createHash('sha256').update(body).digest('base64url').slice(0, 27) + '"';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  if (code === 200) res.setHeader('ETag', etag);
  if (code === 200 && String((req.headers || {})['if-none-match'] || '').split(/\s*,\s*/).includes(etag)) return res.status(304).end();
  if (req.method === 'HEAD') return res.status(code).end();
  return res.status(code).send(body);
}
function guard(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  res.setHeader('Allow', 'GET, HEAD');
  send(req, res, 405, { error: 'method not allowed' }, 'no-store');
  return false;
}
const bad = (req, res, field, allowed) => send(req, res, 400, { error: 'unknown ' + field, allowed }, 'public, max-age=60, s-maxage=3600');
const regionId = v => (v && !v.startsWith('region:') ? 'region:' + v : v);

// GET /api/counties[?state=KY][&tier=tri_state_core|extended][&region=<id>][&id=<county id>[,<county id>...]]
function counties(req, res) {
  if (!guard(req, res)) return;
  const q = params(req);
  let list = COUNTIES;
  const applied = {};
  const state = one(q.state), tier = one(q.tier), region = one(q.region), id = one(q.id);
  if (state) {
    if (!STATES.includes(state.toUpperCase())) return bad(req, res, 'state', STATES);
    applied.state = state.toUpperCase(); list = list.filter(c => c.state === applied.state);
  }
  if (tier) {
    if (!TIERS.some(t => t.id === tier)) return bad(req, res, 'tier', TIERS.map(t => t.id));
    applied.tier = tier; list = list.filter(c => c.tier === tier);
  }
  if (region) {
    const rid = regionId(region);
    if (!regionIds.has(rid)) return bad(req, res, 'region', [...regionIds]);
    applied.region = rid;
    const r = REGIONS.find(x => x.id === rid), members = new Set(r.counties.primary.concat(r.counties.secondary));
    list = list.filter(c => members.has(c.id));
  }
  if (id) {
    const want = id.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const unknown = want.filter(w => !COUNTIES.some(c => c.id === w));
    if (!want.length || unknown.length) return send(req, res, 404, { error: 'unknown county id', ids: unknown }, 'public, max-age=60, s-maxage=3600');
    applied.id = want; list = list.filter(c => want.includes(c.id));
  }
  return send(req, res, 200, {
    schemaVersion: 1, manifestVersion: GEO.manifestVersion, note: NOTE, filters: applied, count: list.length,
    tiers: TIERS.map(t => ({ id: t.id, name: t.name, description: t.description, count: COUNTIES.filter(c => c.tier === t.id).length })),
    counties: list, sources: R.sources,
  }, CACHE);
}

// GET /api/regions[?id=<region or subregion id>]
function regions(req, res) {
  if (!guard(req, res)) return;
  const q = params(req);
  const id = one(q.id);
  let list = REGIONS;
  if (id) {
    const rid = regionId(id);
    if (!regionIds.has(rid)) return send(req, res, 404, { error: 'unknown region id', allowed: [...regionIds] }, 'public, max-age=60, s-maxage=3600');
    list = REGIONS.filter(r => r.id === rid);
  }
  return send(req, res, 200, {
    schemaVersion: 1, manifestVersion: GEO.manifestVersion, note: NOTE, filters: id ? { id: regionId(id) } : {}, count: list.length, regions: list,
  }, CACHE);
}

module.exports = { counties, regions, COUNTIES, REGIONS };
