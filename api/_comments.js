// Public anonymous comments on current non-crime news. Hosted by api/react.js (vercel rewrite /api/comments).
//   GET  /api/comments?id=<storyId>              -> { configured, allowed, comments, count }
//   GET  /api/comments?ids=<id,id>               -> { configured, counts }   (allowed stories only)
//   POST /api/comments { id, uid, text }         -> { ok, comment }          (create)
//   POST /api/comments { action:'report', id, uid }
//   GET  /api/comments?review=1  + x-admin-key   -> hidden queue
//   POST { action:'restore'|'delete', id } + x-admin-key
// Trusted allowlist is tsn:news:meta + tsn:news:ids from refresh (api/_storyid.js). Client category is ignored.
// Unknown / expired / police / courts / crime-title / missing meta: fail closed (not allowed, empty thread).
'use strict';
const STORE = require('./_store.js');
const { same } = require('./_safe.js');
const { KEY: IDS, META } = require('./_storyid.js');
const { commentsBlocked } = require('./_crime.js');
const { clientIp, ipHash } = require('./_ip.js');

const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';
const STORY_RE = /^[a-z0-9]{4,24}$/;
const CID_RE = /^c[a-z0-9]{6,20}$/;
const UID_RE = /^[a-zA-Z0-9_-]{8,48}$/;
const COMMENT_TTL = 180 * 86400;
const MAX_TEXT = 300;
const MAX_BODY = 4096;
const MAX_THREAD = 20;
const MAX_LIST = 199;
const DAILY_PER_UID = 8;
const DAILY_PER_IP = 20;
const STORY_PER_IP = 8;
const REPORTS_TO_HIDE = 3;
const REPORTS_PER_IP = 10;
const REVIEW = 'tsn:cm:review';

const pipeline = STORE.pipeline;
const rec = id => 'tsn:cm:' + id;
const listKey = id => 'tsn:cm:list:' + id;
const nKey = id => 'tsn:cm:n:' + id;
const hideKey = id => 'tsn:cm:hide:' + id;
const repKey = id => 'tsn:cm:rep:' + id;
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const hasLink = t => /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|info|biz|xyz|ru|top|shop|site)\b)/i.test(t);
const dayUtc = () => new Date().toISOString().slice(0, 10);
const send = (res, code, obj, cache) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  return res.status(code).send(JSON.stringify(obj));
};
const publicComment = o => o && o.id ? { id: o.id, text: o.text, at: o.at } : null;

function sameOrigin(req) {
  const host = String((req.headers && req.headers.host) || '').split(',')[0].trim();
  if (!host) return false;
  const raw = req.headers.origin || req.headers.referer || '';
  if (!raw) return false;
  try { return new URL(String(raw)).host === host; } catch (_) { return false; }
}

function parseMeta(raw, id) {
  if (!raw) return null;
  try {
    const all = JSON.parse(raw);
    const m = all && all[id];
    return m && typeof m === 'object' ? m : null;
  } catch (_) { return null; }
}

function parseRec(raw) {
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function newCid() {
  return ('c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 21);
}

async function handler(req, res) {
  if (!STORE.stored()) {
    return send(res, 200, { configured: false, allowed: false, comments: [], counts: {}, count: 0 }, 'public, s-maxage=300');
  }
  try {
    if (req.method === 'GET' && String((req.query && req.query.review) || '') === '1') return await review(req, res);
    if (req.method === 'GET') return await read(req, res);
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'bad origin' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(body);
    if (raw.length > MAX_BODY) return send(res, 413, { error: 'too large' });
    const action = String(body.action || '');
    if (action === 'restore' || action === 'delete') return await moderate(req, res, body, action);
    if (action === 'report') return await report(req, res, body);
    return await create(req, res, body);
  } catch (e) {
    require('./_log.js').fail('comments', e);
    return req.method === 'GET'
      ? send(res, 200, { configured: false, allowed: false, comments: [], counts: {}, count: 0 })
      : send(res, 502, { error: 'Couldn’t save that right now. Try again in a moment.' });
  }
}

async function classify(id) {
  const out = await pipeline([['GET', META], ['SISMEMBER', IDS, id], ['EXISTS', IDS]]);
  const meta = parseMeta(out[0] && out[0].result, id);
  const inSet = Number(out[1] && out[1].result) === 1;
  const setExists = Number(out[2] && out[2].result) === 1;
  const allowed = !!(meta && !commentsBlocked(meta));
  return { meta, inSet, setExists, allowed };
}

async function read(req, res) {
  const q = req.query || {};
  if (q.id) {
    const id = String(q.id);
    if (!STORY_RE.test(id)) return send(res, 400, { error: 'bad request' });
    const cls = await classify(id);
    if (!cls.allowed) return send(res, 200, { configured: true, allowed: false, comments: [], count: 0 }, 'public, max-age=0, s-maxage=15');
    const got = await pipeline([['LRANGE', listKey(id), '0', String(MAX_LIST)], ['GET', nKey(id)]]);
    const ids = ((got[0] && got[0].result) || []).filter(x => CID_RE.test(String(x)));
    const recs = ids.length ? await pipeline(ids.map(cid => ['GET', rec(cid)]).concat(ids.map(cid => ['EXISTS', hideKey(cid)]))) : [];
    const comments = [];
    for (let i = 0; i < ids.length && comments.length < MAX_THREAD; i++) {
      if (Number(recs[ids.length + i] && recs[ids.length + i].result)) continue;
      const o = parseRec(recs[i] && recs[i].result);
      if (!o || o.storyId !== id) continue;
      const pub = publicComment(o);
      if (pub) comments.push(pub);
    }
    return send(res, 200, { configured: true, allowed: true, comments, count: Number(got[1] && got[1].result) || comments.length }, 'public, max-age=0, s-maxage=15');
  }
  const rawIds = Array.isArray(q.ids) ? q.ids.join(',') : String(q.ids || '');
  const ids = [...new Set(rawIds.split(',').filter(x => STORY_RE.test(x)))].slice(0, 300);
  if (!ids.length) return send(res, 200, { configured: true, counts: {} }, 'public, max-age=0, s-maxage=15');
  const pre = await pipeline([['GET', META]].concat(ids.map(id => ['GET', nKey(id)])));
  let map = {};
  try { map = JSON.parse(pre[0] && pre[0].result) || {}; } catch (_) { map = {}; }
  const counts = {};
  ids.forEach((id, i) => {
    const meta = map[id];
    if (!meta || commentsBlocked(meta)) return;
    const n = Number(pre[i + 1] && pre[i + 1].result) || 0;
    if (n > 0) counts[id] = n;
  });
  return send(res, 200, { configured: true, counts }, 'public, max-age=0, s-maxage=15');
}

async function create(req, res, body) {
  const id = String(body.id || ''), uid = String(body.uid || '');
  if (!STORY_RE.test(id) || !UID_RE.test(uid)) return send(res, 400, { error: 'bad request' });
  const text = clean(body.text, MAX_TEXT);
  if (text.length < 1) return send(res, 400, { error: 'Add a comment.', field: 'text' });
  if (hasLink(text)) return send(res, 400, { error: 'Links aren’t allowed.', field: 'text' });
  const cls = await classify(id);
  if (!cls.setExists || !cls.inSet) return send(res, 400, { configured: true, error: 'unknown story' });
  if (!cls.allowed) return send(res, 400, { configured: true, error: 'comments off' });
  const ip = clientIp(req) || uid, day = dayUtc();
  const rkIp = 'tsn:cm:rli:' + ipHash(ip, 'cm|' + day);
  const rkUid = 'tsn:cm:rlu:' + uid + '|' + day;
  const rkSt = 'tsn:cm:rls:' + ipHash(ip, 'cm-story|' + day + '|' + id);
  const lim = await pipeline([
    ['INCR', rkIp], ['EXPIRE', rkIp, '86400', 'NX'],
    ['INCR', rkUid], ['EXPIRE', rkUid, '86400', 'NX'],
    ['INCR', rkSt], ['EXPIRE', rkSt, '86400', 'NX']
  ]);
  if ((Number(lim[0] && lim[0].result) || 0) > DAILY_PER_IP || (Number(lim[2] && lim[2].result) || 0) > DAILY_PER_UID || (Number(lim[4] && lim[4].result) || 0) > STORY_PER_IP) {
    return send(res, 429, { error: 'too many' });
  }
  const cid = newCid();
  const now = new Date().toISOString();
  const item = { id: cid, storyId: id, text, at: now, uid };
  await pipeline([
    ['SET', rec(cid), JSON.stringify(item), 'EX', String(COMMENT_TTL)],
    ['LPUSH', listKey(id), cid],
    ['LTRIM', listKey(id), '0', String(MAX_LIST)],
    ['EXPIRE', listKey(id), String(COMMENT_TTL)],
    ['INCR', nKey(id)],
    ['EXPIRE', nKey(id), String(COMMENT_TTL)]
  ]);
  return send(res, 200, { ok: true, comment: publicComment(item) });
}

async function report(req, res, body) {
  const id = String(body.id || ''), uid = String(body.uid || '');
  if (!CID_RE.test(id) || !UID_RE.test(uid)) return send(res, 400, { error: 'bad request' });
  const ip = clientIp(req) || uid, day = dayUtc();
  const rk = 'tsn:cm:reprl:' + ipHash(ip, 'cm-report|' + day);
  const lim = await pipeline([['INCR', rk], ['EXPIRE', rk, '86400', 'NX']]);
  if ((Number(lim[0] && lim[0].result) || 0) > REPORTS_PER_IP) return send(res, 429, { error: 'too many' });
  const g = await pipeline([['GET', rec(id)]]);
  const o = parseRec(g[0] && g[0].result);
  if (!o) return send(res, 200, { ok: true });
  const who = ipHash(ip, 'cm-report');
  const out = await pipeline([['SADD', repKey(id), who], ['EXPIRE', repKey(id), String(COMMENT_TTL)], ['SCARD', repKey(id)], ['EXISTS', hideKey(id)]]);
  const reports = Number(out[2] && out[2].result) || 0;
  if (reports >= REPORTS_TO_HIDE && Number(out[3] && out[3].result) !== 1) {
    const now = Date.now();
    await pipeline([
      ['SET', hideKey(id), '1', 'EX', String(COMMENT_TTL)],
      ['ZADD', REVIEW, String(now), id],
      ['EXPIRE', REVIEW, String(COMMENT_TTL)],
      ['SET', nKey(o.storyId), String(Math.max(0, (await visCount(o.storyId)) - 1)), 'EX', String(COMMENT_TTL)]
    ]);
  }
  return send(res, 200, { ok: true });
}

async function visCount(storyIdVal) {
  const g = await pipeline([['GET', nKey(storyIdVal)]]);
  return Number(g[0] && g[0].result) || 0;
}

async function moderate(req, res, body, action) {
  if (!ADMIN || !same(req.headers['x-admin-key'], ADMIN)) return send(res, 404, { error: 'not found' });
  const id = String(body.id || '');
  if (!CID_RE.test(id)) return send(res, 400, { error: 'bad request' });
  const g = await pipeline([['GET', rec(id)], ['EXISTS', hideKey(id)]]);
  const o = parseRec(g[0] && g[0].result);
  const hidden = Number(g[1] && g[1].result) === 1;
  if (action === 'delete') {
    const cmds = [['DEL', rec(id)], ['DEL', hideKey(id)], ['DEL', repKey(id)], ['ZREM', REVIEW, id]];
    if (o && o.storyId && !hidden) cmds.push(['SET', nKey(o.storyId), String(Math.max(0, await visCount(o.storyId) - 1)), 'EX', String(COMMENT_TTL)]);
    await pipeline(cmds);
    return send(res, 200, { ok: true, deleted: true });
  }
  if (!o) return send(res, 200, { ok: true, restored: false });
  const cmds = [['DEL', hideKey(id)], ['DEL', repKey(id)], ['ZREM', REVIEW, id]];
  if (hidden) cmds.push(['SET', nKey(o.storyId), String((await visCount(o.storyId)) + 1), 'EX', String(COMMENT_TTL)]);
  await pipeline(cmds);
  return send(res, 200, { ok: true, restored: true });
}

async function review(req, res) {
  if (!ADMIN || !same(req.headers['x-admin-key'], ADMIN)) return send(res, 404, { error: 'not found' });
  const q = await pipeline([['ZREVRANGE', REVIEW, '0', '199', 'WITHSCORES']]);
  const flat = (q[0] && q[0].result) || [], rows = [];
  for (let i = 0; i < flat.length; i += 2) if (CID_RE.test(String(flat[i]))) rows.push({ id: flat[i], at: new Date(Number(flat[i + 1])).toISOString() });
  if (!rows.length) return send(res, 200, { items: [] });
  const got = await pipeline(rows.flatMap(r => [['GET', rec(r.id)], ['SCARD', repKey(r.id)], ['EXISTS', hideKey(r.id)]]));
  const items = [];
  rows.forEach((r, i) => {
    const o = parseRec(got[i * 3] && got[i * 3].result);
    if (!o) return;
    items.push({
      id: o.id,
      storyId: o.storyId,
      text: o.text,
      at: o.at,
      reportedAt: r.at,
      reports: Number(got[i * 3 + 1] && got[i * 3 + 1].result) || 0,
      hidden: Number(got[i * 3 + 2] && got[i * 3 + 2].result) === 1
    });
  });
  return send(res, 200, { items });
}

module.exports = handler;
module.exports.COMMENT_TTL = COMMENT_TTL;
module.exports.MAX_TEXT = MAX_TEXT;
module.exports.DAILY_PER_IP = DAILY_PER_IP;
module.exports.DAILY_PER_UID = DAILY_PER_UID;
module.exports.STORY_PER_IP = STORY_PER_IP;
module.exports.REPORTS_TO_HIDE = REPORTS_TO_HIDE;
module.exports.clean = clean;
module.exports.hasLink = hasLink;
module.exports.sameOrigin = sameOrigin;
