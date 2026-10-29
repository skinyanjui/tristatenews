// Ad campaigns (ads plan Phase 5.1/5.2): an approved creative booked on named placements for a date range, with hard
// inventory caps. Admin only; vercel.json rewrites /api/campaigns to /api/inbox?__route=campaigns (no new function).
//   GET  /api/campaigns   with x-admin-key  campaigns (newest 200) with their phase, the approved creatives that can
//                                          be booked, the caps, booked shares per placement for the next 30 days,
//                                          whether ADS_CAMPAIGNS is on, and the audit log
//   POST /api/campaigns   with x-admin-key  {action:'create', creativeId, placements[], start, end, note}
//                                          {action:'pause'|'resume'|'end', id, note}
// Serving: with ADS_CAMPAIGNS=on, GET /api/creative?live=1 fills the card, sponsor lines and side ads only from
// campaigns running today (Chicago date, start and end inclusive, status active, creative still approved). With the
// flag off it keeps serving every approved creative on its approved placements, as before. Either way nothing is
// targeted: every reader of a board gets the same list, and public/adslots.js rotates it in equal turns by the clock.
//
// Inventory caps (docs/packages.md section 3): shares per placement on any one day. A paused campaign still holds its
// share (it was sold); an ended one frees the rest of its dates. A booking that would put any placement over its cap
// on any day is refused, naming the placement and the day.
//
// Storage (Upstash Redis): tsn:camp:<id> the record (no TTL: a sales record, like orders); tsn:camp:index sorted set of
// every campaign by creation time; tsn:camp:open set of campaigns not ended; tsn:camp:audit list of every action
// (newest first, last 1000).
const crypto = require('crypto');
const STORE = require('./_store.js'); // the one Redis helper (pipeline, stored)
const { same } = require('./_safe.js');
const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';

const BOARDS = ['jobs', 'deals', 'events', 'classifieds'];
// card:news is the in-feed card between News stories (never next to a Police & courts item; public/adslots.js
// newsSlots). News has no sponsor line; Obituaries, Breaking and Police & courts have no placement at all.
const PLACEMENTS = BOARDS.map(b => 'card:' + b).concat(['card:news'], BOARDS.map(b => 'line:' + b), ['rail:left', 'rail:right']);
const CAPS = Object.fromEntries(PLACEMENTS.map(p => [p, p.startsWith('rail:') ? 2 : 3]));
const STATUSES = ['active', 'paused', 'ended'];
const MAX_DAYS = 366, AHEAD_DAYS = 366, AUDIT_KEEP = 1000, NOTE_MAX = 300, LIST_MAX = 200;
const ID_RE = /^cp[a-z0-9]{10}$/, CR_RE = /^cr[a-z0-9]{10}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const K = { rec: id => 'tsn:camp:' + id, index: 'tsn:camp:index', open: 'tsn:camp:open', audit: 'tsn:camp:audit', cr: id => 'tsn:cr:' + id };

const enabled = () => String(process.env.ADS_CAMPAIGNS || '').trim().toLowerCase() === 'on';
const DAY = 864e5;
// The Chicago calendar date, YYYY-MM-DD.
const today = now => new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const dayNum = d => Math.round(Date.parse(d + 'T00:00:00Z') / DAY);
const dateOf = n => new Date(n * DAY).toISOString().slice(0, 10);
const validDate = d => DATE_RE.test(String(d)) && dateOf(dayNum(d)) === d;
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (_) { return null; } };

// Where a campaign is today: upcoming | running | finished | paused | ended.
function phase(c, now) {
  if (c.status === 'ended') return 'ended';
  const t = today(now);
  if (t > c.end) return 'finished';
  if (c.status === 'paused') return 'paused';
  return t < c.start ? 'upcoming' : 'running';
}
const holdsShare = c => c && (c.status === 'active' || c.status === 'paused');
const runningOn = (c, d) => c && c.status === 'active' && c.start <= d && d <= c.end;

// The most shares any day of [start, end] would have on each placement, counting `others` (records) plus one more.
// -> null when it fits, else { placement, day, booked, cap }.
function overCap(others, placements, start, end) {
  const a = dayNum(start), b = dayNum(end);
  for (const p of placements) {
    const holders = others.filter(c => holdsShare(c) && (c.placements || []).includes(p) && c.start <= end && start <= c.end);
    for (let d = a; d <= b; d++) {
      const ds = dateOf(d), booked = holders.filter(c => c.start <= ds && ds <= c.end).length;
      if (booked + 1 > CAPS[p]) return { placement: p, day: ds, booked, cap: CAPS[p] };
    }
  }
  return null;
}

// Booked shares per placement for each of the next `days` days (the admin's inventory view).
function inventory(records, now, days) {
  const t = dayNum(today(now)), out = {};
  for (const p of PLACEMENTS) {
    const holders = records.filter(c => holdsShare(c) && (c.placements || []).includes(p));
    const per = [];
    for (let d = t; d < t + days; d++) { const ds = dateOf(d); per.push(holders.filter(c => c.start <= ds && ds <= c.end).length); }
    out[p] = { cap: CAPS[p], today: per[0], max: Math.max(0, ...per), free: CAPS[p] - Math.max(0, ...per) };
  }
  return out;
}

// A new booking -> { rec } or { error, code, field }.
function newCampaign(b, creative, others, now) {
  if (!creative || creative.status !== 'approved') return { error: 'Pick an approved creative.', code: 400, field: 'creativeId' };
  const placements = [...new Set(Array.isArray(b.placements) ? b.placements.map(String) : [])];
  if (!placements.length || placements.some(p => !PLACEMENTS.includes(p))) return { error: 'Pick where it runs.', code: 400, field: 'placements' };
  const outside = placements.filter(p => !(creative.placements || []).includes(p));
  if (outside.length) return { error: 'This creative is approved only for ' + (creative.placements || []).join(', ') + '; not ' + outside.join(', ') + '.', code: 400, field: 'placements' };
  const start = String(b.start || ''), end = String(b.end || ''), t = today(now);
  if (!validDate(start) || !validDate(end)) return { error: 'Give a start and end date (YYYY-MM-DD).', code: 400, field: 'start' };
  if (end < start) return { error: 'The end date is before the start.', code: 400, field: 'end' };
  if (end < t) return { error: 'That flight is already over.', code: 400, field: 'end' };
  if (dayNum(end) - dayNum(start) + 1 > MAX_DAYS) return { error: 'A flight can be at most ' + MAX_DAYS + ' days.', code: 400, field: 'end' };
  if (dayNum(start) - dayNum(t) > AHEAD_DAYS) return { error: 'Start within a year.', code: 400, field: 'start' };
  const over = overCap(others, placements, start, end);
  if (over) return { error: over.placement + ' is full on ' + over.day + ' (' + over.booked + ' of ' + over.cap + ' shares booked).', code: 409, field: 'placements', over };
  const at = new Date(now).toISOString(), note = clean(b.note, NOTE_MAX);
  const id = 'cp' + crypto.randomBytes(8).toString('hex').slice(0, 10);
  return { rec: { id, creativeId: creative.id, ref: creative.ref, advertiser: creative.headline, placements, start, end, status: 'active', createdAt: at, updatedAt: at, history: [{ at, action: 'create', note }] } };
}

// pause / resume / end -> { rec, entry } or { error, code }.
function act(c, action, note, now) {
  const allowed = { pause: ['active'], resume: ['paused'], end: ['active', 'paused'] }[action];
  if (!allowed) return { error: 'bad request', code: 400 };
  if (!allowed.includes(c.status)) return { error: 'This campaign is ' + c.status + '.', code: 409 };
  const at = new Date(now).toISOString(), n = clean(note, NOTE_MAX);
  if (action === 'end' && n.length < 3) return { error: 'Give a reason for ending it (kept in the log).', code: 400, field: 'note' };
  const to = { pause: 'paused', resume: 'active', end: 'ended' }[action];
  const rec = Object.assign({}, c, { status: to, updatedAt: at, history: (c.history || []).concat([{ at, action, note: n }]) });
  if (to === 'ended') rec.endedAt = at;
  return { rec, entry: { at, id: c.id, creativeId: c.creativeId, action, from: c.status, to, note: n } };
}

// What runs today: { cards, slots, rails } of public ads, from campaign records and their creatives. Each list is in
// a fixed order (start date, then id), so the rotation turns are the same for everyone and every sponsor gets one.
function plan(records, creatives, now, pub) {
  const t = today(now), byId = new Map(creatives.filter(Boolean).map(c => [c.id, c]));
  const out = { cards: {}, slots: {}, rails: { left: [], right: [] } };
  BOARDS.forEach(b => { out.cards[b] = []; out.slots[b] = []; });
  out.cards.news = [];
  records.filter(c => runningOn(c, t)).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1)).forEach(c => {
    const cr = byId.get(c.creativeId);
    if (!cr || cr.status !== 'approved') return; // a withdrawn creative stops its campaigns
    for (const p of c.placements || []) {
      if (!(cr.placements || []).includes(p)) continue;
      const [kind, where] = p.split(':'), ad = Object.assign(pub(cr), { cid: c.id, pl: p }); // cid and pl let api/_adstats.js count it
      if (kind === 'card' && out.cards[where]) out.cards[where].push(ad);
      else if (kind === 'line' && out.slots[where]) out.slots[where].push(ad);
      else if (kind === 'rail' && out.rails[where]) out.rails[where].push(ad);
    }
  });
  return out;
}

const pipeline = STORE.pipeline;
async function openRecords() {
  const ids = (await pipeline([['SMEMBERS', K.open]]))[0].result || [];
  return ids.length ? ((await pipeline([['MGET', ...ids.map(K.rec)]]))[0].result || []).map(parse).filter(Boolean) : [];
}
// For GET /api/creative?live=1 when the flag is on.
async function livePlan(now, pub) {
  const recs = (await openRecords()).filter(c => runningOn(c, today(now)));
  const crIds = [...new Set(recs.map(c => c.creativeId))].filter(id => CR_RE.test(id));
  const crs = crIds.length ? ((await pipeline([['MGET', ...crIds.map(K.cr)]]))[0].result || []).map(parse) : [];
  return plan(recs, crs, now, pub);
}

async function handler(req, res) {
  const send = (c, o) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); return res.status(c).send(JSON.stringify(o)); };
  if (!STORE.stored() || !ADMIN || !same(req.headers['x-admin-key'], ADMIN)) return send(404, { error: 'not found' });
  const now = Date.now();
  try {
    if (req.method === 'GET') {
      const g = await pipeline([['ZREVRANGE', K.index, '0', String(LIST_MAX - 1)], ['SMEMBERS', K.open], ['LRANGE', K.audit, '0', '99'], ['SMEMBERS', 'tsn:cr:live']]);
      const ids = [...new Set(((g[0] && g[0].result) || []).concat((g[1] && g[1].result) || []))].filter(i => ID_RE.test(i));
      const crIds = ((g[3] && g[3].result) || []).filter(i => CR_RE.test(i));
      const m = await pipeline([['MGET', ...(ids.length ? ids.map(K.rec) : ['tsn:camp:none'])], ['MGET', ...(crIds.length ? crIds.map(K.cr) : ['tsn:cr:none'])]]);
      const recs = ids.length ? (m[0].result || []).map(parse).filter(Boolean) : [];
      const crs = crIds.length ? (m[1].result || []).map(parse).filter(c => c && c.status === 'approved') : [];
      const crById = new Map(crs.map(c => [c.id, c]));
      const campaigns = recs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(c => Object.assign({}, c, { phase: phase(c, now), creativeLive: crById.has(c.creativeId) }));
      return send(200, {
        on: enabled(), today: today(now), caps: CAPS, placements: PLACEMENTS, campaigns,
        creatives: crs.map(c => ({ id: c.id, headline: c.headline, ref: c.ref, placements: c.placements || [] })),
        inventory: inventory(recs, now, 30), audit: ((g[2] && g[2].result) || []).map(parse).filter(Boolean),
      });
    }
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } } b = b && typeof b === 'object' ? b : {};
    if (b.action === 'create') {
      if (!CR_RE.test(String(b.creativeId))) return send(400, { error: 'Pick an approved creative.', field: 'creativeId' });
      const [others, g] = await Promise.all([openRecords(), pipeline([['GET', K.cr(b.creativeId)]])]);
      const r = newCampaign(b, parse(g[0] && g[0].result), others, now);
      if (r.error) return send(r.code, { error: r.error, field: r.field, over: r.over });
      const entry = { at: r.rec.createdAt, id: r.rec.id, creativeId: r.rec.creativeId, action: 'create', from: '', to: 'active', note: r.rec.history[0].note, placements: r.rec.placements, start: r.rec.start, end: r.rec.end };
      // Two admins booking the last share at the same moment could both pass the check; there is one admin today.
      await pipeline([['LPUSH', K.audit, JSON.stringify(entry)], ['LTRIM', K.audit, '0', String(AUDIT_KEEP - 1)], ['SET', K.rec(r.rec.id), JSON.stringify(r.rec)], ['ZADD', K.index, String(now), r.rec.id], ['SADD', K.open, r.rec.id]]);
      return send(200, { ok: true, campaign: r.rec });
    }
    if (!ID_RE.test(String(b.id))) return send(400, { error: 'bad request' });
    const g = await pipeline([['GET', K.rec(b.id)]]);
    const c = parse(g[0] && g[0].result);
    if (!c) return send(404, { error: 'not found' });
    const r = act(c, String(b.action || ''), b.note, now);
    if (r.error) return send(r.code, { error: r.error, field: r.field });
    const cmds = [['LPUSH', K.audit, JSON.stringify(r.entry)], ['LTRIM', K.audit, '0', String(AUDIT_KEEP - 1)], ['SET', K.rec(c.id), JSON.stringify(r.rec)]];
    if (r.rec.status === 'ended') cmds.push(['SREM', K.open, c.id]);
    await pipeline(cmds);
    return send(200, { ok: true, campaign: r.rec });
  } catch (e) {
    require('./_log.js').fail('campaigns', e);
    return send(502, { error: 'Couldn’t reach the store. Try again.' });
  }
}

module.exports = handler;
Object.assign(module.exports, { ID_RE, BOARDS, PLACEMENTS, CAPS, STATUSES, MAX_DAYS, K, enabled, today, phase, overCap, inventory, newCampaign, act, plan, livePlan, holdsShare, runningOn });
