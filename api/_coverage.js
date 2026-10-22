// Admin Sources & Coverage (plan PRs 7.3, 8.1, 8.3). No new function: news.js hosts it (?__route=coverage; vercel.json
// rewrites /api/coverage there). Same auth as the other admin reads: the x-admin-key header must equal
// LISTINGS_ADMIN_KEY, else 404. Nothing here is personal data: sources, counties, headlines and links that are already
// public, flag states (booleans and batch ids, never values of other variables) and the override audit log.
//   GET  /api/coverage                       { flags, batches, sources[], counties[], review[], overrides[], audit[] }
//   POST /api/coverage { key, countyIds, note }   set a manual county override for one story (countyIds: [] means
//                                                 "no county"); { key, clear: true } removes it. Audited.
// Overrides live in tsn:loc:overrides (hash: story key -> { countyIds, note, at, title }) and take effect at the next
// refresh, which copies them into the snapshot for the scope filters (api/_scope.js). The audit log is
// tsn:loc:audit (newest first, last 1000; no TTL).
'use strict';
const fs = require('fs');
const path = require('path');
const { same } = require('./_safe.js');
const FLAGS = require('./_flags.js');
const REG = require('./_sources.js');
const LOC = require('./_location.js');
const S = require('./_scope.js');

const OVR = 'tsn:loc:overrides', AUDIT = 'tsn:loc:audit';
const DAY = 864e5;
const EVID = path.join(__dirname, '..', 'data', 'sources', 'evidence');
const COV = () => { try { return require('../data/geography/coverage.json'); } catch (_) { return null; } };

function evidence(id) { try { return JSON.parse(fs.readFileSync(path.join(EVID, id + '.json'), 'utf8')); } catch (_) { return null; } }
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (_) { return null; } };
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Health of one source from its stored record (tsn:src:<id>): last fetch, items, newest story, and freshness against
// its own measured cadence (median gap between its stored stories; the evidence record's cadence for batch sources).
function health(src, st, now, extra) {
  const items = (st && Array.isArray(st.items)) ? st.items : [];
  const times = items.map(i => Date.parse(i.published || '')).filter(Number.isFinite).sort((a, b) => b - a);
  const gaps = []; for (let i = 1; i < times.length; i++) gaps.push((times[i - 1] - times[i]) / DAY);
  const ev = extra.batch ? evidence(src.id) : null;
  const cadenceDays = ev && ev.activity && Number.isFinite(ev.activity.medianGapDays) ? ev.activity.medianGapDays : median(gaps);
  const newest = times[0] || null;
  const ageDays = newest ? (now - newest) / DAY : null;
  // Stale: nothing for 3x its usual gap, and at least 2 days (a daily source quiet for a weekend is not stale).
  const allowed = Math.max(2, 3 * (cadenceDays || 1));
  let status = 'ok';
  if (extra.disabled) status = 'paused';
  else if (!extra.active) status = 'off';
  else if (!st) status = 'not_fetched';
  else if (st.error && !items.length) status = 'failing';
  else if (!newest && !st.error) status = 'quiet'; // fetched fine, nothing local right now (geo-filtered sources)
  else if (!newest || ageDays > allowed) status = 'stale';
  else if (st.error) status = 'degraded';
  return {
    id: src.id, name: src.name, area: src.area || '', kind: src.kind || 'news', batch: extra.batch || null, active: !!extra.active,
    disabled: extra.disabled || null, status, lastTry: (st && st.lastTry) || null, lastOk: (st && st.lastOk) || null,
    fails: (st && st.fails) || 0, error: st && st.error ? String(st.error).slice(0, 80) : null, items: items.length,
    newest: newest ? new Date(newest).toISOString() : null, ageDays: ageDays == null ? null : Math.round(ageDays * 10) / 10,
    cadenceDays: cadenceDays == null ? null : Math.round(cadenceDays * 100) / 100, cadenceFrom: ev ? 'evidence' : gaps.length ? 'stored items' : null,
    counties: extra.counties || null,
  };
}

async function report(now) {
  const news = require('./news.js');
  const active = new Set(news.SOURCES.map(s => s.id));
  const batchOn = REG.enabledBatches();
  const list = [];
  for (const s of news.SOURCES) if (!S.BATCH.has(s.id)) list.push([s, { active: true }]);
  for (const s of news.DISABLED_SOURCES) if (!S.BATCH.has(s.id)) list.push([s, { active: false, disabled: s.disabled }]);
  for (const b of REG.BATCHES) for (const s of b.sources) list.push([s, { active: active.has(s.id), batch: b.batch, disabled: s.disabled || null, counties: s.counties }]);
  let states = [], snap = null, ovr = [], audit = [], storeOk = false;
  if (news.stored()) {
    try {
      const out = await news.redis([['MGET'].concat(list.map(([s]) => 'tsn:src:' + s.id)), ['GET', 'tsn:news:snapshot'], ['HGETALL', OVR], ['LRANGE', AUDIT, '0', '49']]);
      states = (out[0] && out[0].result) || []; snap = parse(out[1] && out[1].result);
      const flat = (out[2] && out[2].result) || []; for (let i = 0; i + 1 < flat.length; i += 2) { const v = parse(flat[i + 1]); if (v) ovr.push(Object.assign({ key: flat[i] }, v)); }
      audit = ((out[3] && out[3].result) || []).map(parse).filter(Boolean);
      storeOk = true;
    } catch (_) { storeOk = false; }
  }
  const sources = list.map(([s, x], i) => health(s, parse(states[i]), now, x));

  // Counties: tier, home sources (batch claims plus registry areas), stories in the last 14 days in the current
  // snapshot (all sources, as All Regions sees it), the committed measurement, and whether it is a gap.
  const allSources = news.SOURCES.concat(REG.BATCHES.flatMap(b => b.sources).filter(s => !active.has(s.id)));
  const depthNow = snap ? S.depth(snap, allSources, now) : null;
  const cov = COV();
  const homes = {};
  const add = (c, n) => { const a = homes[c] = homes[c] || []; if (!a.includes(n)) a.push(n); };
  const local = s => !s.kind || ['news', 'police', 'courts', 'institution'].includes(s.kind); // not events or obituaries
  for (const s of REG.BATCHES.flatMap(b => b.sources)) if (local(s)) for (const c of s.counties || []) add(c, s.name + (s.disabled ? ' (paused)' : active.has(s.id) ? '' : ' (batch off)'));
  for (const s of news.SOURCES) { if (S.BATCH.has(s.id) || !local(s) || s.funeralHome) continue; let c = []; try { const r = LOC.sourceCoverage(s); c = r.statewide ? [] : r.countyIds; } catch (_) { c = []; } if (c.length === 1) add(c[0], s.name); }
  const counties = S.COUNTIES.map(c => {
    const stories = depthNow ? depthNow[c.id] : null, measured = cov && cov.depth ? cov.depth[c.id] : null;
    return { id: c.id, name: c.fullName, state: c.state.toUpperCase(), tier: c.core ? 'core' : 'extended', homeSources: homes[c.id] || [], stories14d: stories, measured14d: measured,
      passesGate: (stories != null ? stories : measured || 0) >= S.DEPTH_MIN, gap: !(homes[c.id] || []).length };
  });

  // Review queue: stories the classifier could not place with confidence (ambiguous names, dateline only, review flags),
  // newest first, with any override already set.
  const byId = new Map(allSources.map(s => [s.id, s]));
  const ovrBy = new Map(ovr.map(o => [o.key, o]));
  const review = [];
  for (const it of (snap && snap.items) || []) {
    if (it.isEvent || it.isObit) continue;
    let l; try { l = LOC.classify(it, byId.get(it.sourceId) || { id: it.sourceId }); } catch (_) { continue; }
    const key = S.overrideKey(it);
    if (!(l.requiresReview || ovrBy.has(key))) continue;
    review.push({ key, title: String(it.title || '').slice(0, 200), link: it.link, source: it.source, sourceId: it.sourceId, published: it.published || null,
      suggested: l.countyIds, reason: l.reason || l.level || '', unresolved: (l.unresolved || []).map(u => u.alias), override: ovrBy.has(key) ? ovrBy.get(key).countyIds : null });
    if (review.length >= 300) break;
  }
  // Most useful first: overridden, then named-but-ambiguous places, then stories with a suggestion, then placeless.
  const rank = r => (r.override ? 0 : r.unresolved.length ? 1 : r.suggested.length ? 2 : 3);
  review.sort((a, b) => rank(a) - rank(b));
  review.length = Math.min(review.length, 100);
  return {
    ok: true, at: new Date(now).toISOString(), store: storeOk, snapshotAt: snap ? snap.updatedAt : null,
    flags: FLAGS.all(), batches: { enabled: batchOn, files: REG.BATCHES.map(b => ({ id: b.batch, sources: b.sources.length, active: b.sources.filter(s => active.has(s.id)).length, paused: b.sources.filter(s => s.disabled).map(s => s.id) })) },
    gate: { min: S.DEPTH_MIN, days: S.DEPTH_DAYS, measuredAt: cov ? cov.measuredAt : null },
    sources, counties, review, overrides: ovr, audit,
  };
}

async function override(body, now) {
  const news = require('./news.js');
  const key = String(body.key || '');
  if (!/^o[0-9a-f]{16}$/.test(key)) return { code: 400, body: { error: 'Send the story key from the review queue.' } };
  const clear = body.clear === true;
  let ids = [];
  if (!clear) {
    if (!Array.isArray(body.countyIds) || body.countyIds.length > 12) return { code: 400, body: { error: 'countyIds must be a list of up to 12 county ids ([] for no county).' } };
    ids = [...new Set(body.countyIds.map(String))];
    if (ids.some(id => !S.BY_ID.has(id))) return { code: 400, body: { error: 'Unknown county id.' } };
  }
  const note = String(body.note || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 200);
  const title = String(body.title || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 200);
  const prev = await news.redis([['HGET', OVR, key]]);
  if (prev[0] && prev[0].error) return { code: 502, body: { error: 'The store did not answer.' } };
  const before = parse(prev[0] && prev[0].result);
  const at = new Date(now).toISOString();
  const rec = { countyIds: ids, note, at, title: title || (before && before.title) || '' };
  const entry = { at, action: clear ? 'override_cleared' : before ? 'override_changed' : 'override_set', key, title: rec.title, before: before ? before.countyIds : null, after: clear ? null : ids, note, by: 'admin key' };
  // The change first, then its audit entry: a failed write is never logged as made.
  const out = await news.redis([clear ? ['HDEL', OVR, key] : ['HSET', OVR, key, JSON.stringify(rec)]]);
  if (!out || !out[0] || out[0].error) return { code: 502, body: { error: 'The store did not save the override.' } };
  await news.redis([['LPUSH', AUDIT, JSON.stringify(entry)], ['LTRIM', AUDIT, '0', '999']]);
  return { code: 200, body: { ok: true, entry, note: 'Takes effect at the next refresh.' } };
}

module.exports = async function (req, res) {
  const admin = process.env.LISTINGS_ADMIN_KEY || '';
  const send = (c, o) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex'); return res.status(c).json(o); };
  if (!admin || !same(String(req.headers['x-admin-key'] || ''), admin)) return send(404, { error: 'not found' });
  try {
    if (req.method === 'GET') return send(200, await report(Date.now()));
    if (req.method === 'POST') {
      if (!require('./news.js').stored()) return send(503, { error: 'No store configured.' });
      const body = typeof req.body === 'string' ? (parse(req.body) || {}) : (req.body || {});
      const r = await override(body, Date.now());
      return send(r.code, r.body);
    }
    res.setHeader('Allow', 'GET, POST');
    return send(405, { error: 'method not allowed' });
  } catch (e) {
    return send(502, { error: 'report unavailable' });
  }
};
module.exports.health = health;
module.exports.report = report;
