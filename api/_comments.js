// Public anonymous comments on current non-crime news. Hosted by api/react.js (vercel rewrite /api/comments).
//   GET  /api/comments?id=<storyId>&offset=      -> { configured, allowed, comments, count, total }
//   GET  /api/comments?ids=<id,id>               -> { configured, counts }   (allowed stories only)
//   POST /api/comments { id, uid, text }         -> { ok, comment }          (create)
//   POST /api/comments { action:'report', id, uid }
//   GET  /api/comments?review=1  + x-admin-key   -> hidden queue
//   POST { action:'restore'|'delete', id } + x-admin-key
// Trusted allowlist is tsn:news:meta + tsn:news:ids from refresh (api/_storyid.js). Client category is ignored.
// Unknown / expired / police / courts / crime-title / missing meta: fail closed (not allowed, empty thread).
// Visible index is tsn:cm:vis:<storyId> (ZSET, score = expiry unix). Count is ZCARD after pruning expired
// members, not a separate n±1 key. Hide/restore/delete/create run as one Redis EVAL.
'use strict';
const STORE = require('./_store.js');
const { same } = require('./_safe.js');
const { KEY: IDS, META } = require('./_storyid.js');
const { commentsBlocked } = require('./_crime.js');
const { clientIp, ipHash } = require('./_ip.js');
const ATOM = require('./_cmatom.js');

const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';
const STORY_RE = /^[a-z0-9]{4,24}$/;
const CID_RE = /^c[a-z0-9]{6,20}$/;
const UID_RE = /^[a-zA-Z0-9_-]{8,48}$/;
const COMMENT_TTL = 180 * 86400;
const MAX_TEXT = 300;
const MAX_BODY = 4096;
const MAX_THREAD = 20;
const MAX_VIS = 200;
const DAILY_PER_UID = 8;
const DAILY_PER_IP = 20;
const STORY_PER_IP = 8;
const REPORTS_TO_HIDE = 3;
const REPORTS_PER_IP = 10;
const REVIEW = 'tsn:cm:review';
const PRUNE_CHUNK = 80;

const pipeline = STORE.pipeline;
const rec = id => 'tsn:cm:' + id;
const visKey = id => 'tsn:cm:vis:' + id;
const hideKey = id => 'tsn:cm:hide:' + id;
const repKey = id => 'tsn:cm:rep:' + id;
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// Catch pasted URLs and host-like tokens (example.co, bit.ly) without treating "U.S." / "Mr. Smith" / "ok." as links.
const hasLink = t => /https?:\/\/|www\.|\b(?:bit\.ly|t\.co|tinyurl\.com|goo\.gl|ow\.ly|is\.gd|buff\.ly|cutt\.ly|rb\.gy|shorturl\.at|tiny\.cc)\b|\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|net|org|info|biz|xyz|ru|top|shop|site|co|io|ly|me|us|cc|tv|app|dev|page|link|click|gg|to|uk|de|br|in|au|ca|edu|gov|int)\b/i.test(t);
const dayUtc = () => new Date().toISOString().slice(0, 10);
const nowSec = () => Math.floor(Date.now() / 1000);
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

async function evalScript(script, keys, argv) {
  const cmd = ['EVAL', script, String(keys.length)].concat(keys, argv.map(String));
  const out = await pipeline([cmd]);
  return out[0] && out[0].result;
}

async function handler(req, res) {
  if (!STORE.stored()) {
    return send(res, 200, { configured: false, allowed: false, comments: [], counts: {}, count: 0, total: 0 }, 'public, s-maxage=300');
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
      ? send(res, 200, { configured: false, allowed: false, comments: [], counts: {}, count: 0, total: 0 })
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

async function liveThread(id, offset) {
  const vis = visKey(id);
  await pipeline([['ZREMRANGEBYSCORE', vis, '-inf', String(nowSec())]]);
  const got = await pipeline([['ZREVRANGE', vis, String(offset), String(offset + MAX_THREAD - 1)], ['ZCARD', vis]]);
  const ids = ((got[0] && got[0].result) || []).filter(x => CID_RE.test(String(x)));
  let total = Number(got[1] && got[1].result) || 0;
  if (!ids.length) return { comments: [], total };
  const recs = await pipeline(ids.map(cid => ['GET', rec(cid)]).concat(ids.map(cid => ['EXISTS', hideKey(cid)])));
  const comments = [], ghosts = [];
  ids.forEach((cid, i) => {
    if (Number(recs[ids.length + i] && recs[ids.length + i].result)) { ghosts.push(cid); return; }
    const o = parseRec(recs[i] && recs[i].result);
    if (!o || o.storyId !== id) { ghosts.push(cid); return; }
    const pub = publicComment(o);
    if (pub) comments.push(pub);
    else ghosts.push(cid);
  });
  if (ghosts.length) {
    await pipeline(ghosts.map(cid => ['ZREM', vis, cid]));
    const n = await pipeline([['ZCARD', vis]]);
    total = Number(n[0] && n[0].result) || comments.length;
  }
  return { comments, total };
}

async function read(req, res) {
  const q = req.query || {};
  if (q.id) {
    const id = String(q.id);
    if (!STORY_RE.test(id)) return send(res, 400, { error: 'bad request' });
    const cls = await classify(id);
    if (!cls.allowed) return send(res, 200, { configured: true, allowed: false, comments: [], count: 0, total: 0 }, 'public, max-age=0, s-maxage=15');
    const offset = Math.max(0, Math.min(MAX_VIS, parseInt(q.offset, 10) || 0));
    const { comments, total } = await liveThread(id, offset);
    return send(res, 200, { configured: true, allowed: true, comments, count: total, total, offset }, 'public, max-age=0, s-maxage=15');
  }
  const rawIds = Array.isArray(q.ids) ? q.ids.join(',') : String(q.ids || '');
  const ids = [...new Set(rawIds.split(',').filter(x => STORY_RE.test(x)))].slice(0, 300);
  if (!ids.length) return send(res, 200, { configured: true, counts: {} }, 'public, max-age=0, s-maxage=15');
  const pre = await pipeline([['GET', META]]);
  let map = {};
  try { map = JSON.parse(pre[0] && pre[0].result) || {}; } catch (_) { map = {}; }
  const allowed = ids.filter(id => map[id] && !commentsBlocked(map[id]));
  const counts = {};
  const now = String(nowSec());
  for (let i = 0; i < allowed.length; i += PRUNE_CHUNK) {
    const chunk = allowed.slice(i, i + PRUNE_CHUNK);
    const nums = await evalScript(ATOM.SCRIPT_PRUNE, chunk.map(visKey), [now]);
    const arr = Array.isArray(nums) ? nums : [];
    chunk.forEach((id, j) => {
      const n = Number(arr[j]) || 0;
      if (n > 0) counts[id] = n;
    });
  }
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
  const item = { id: cid, storyId: id, text, at: now };
  const exp = nowSec() + COMMENT_TTL;
  await evalScript(ATOM.SCRIPT_CREATE, [rec(cid), visKey(id)], [JSON.stringify(item), cid, exp, COMMENT_TTL, nowSec(), MAX_VIS]);
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
  if (!o || !o.storyId) return send(res, 200, { ok: true });
  const who = ipHash(ip, 'cm-report');
  await evalScript(
    ATOM.SCRIPT_REPORT,
    [rec(id), repKey(id), hideKey(id), visKey(o.storyId), REVIEW],
    [who, id, nowSec(), COMMENT_TTL, REPORTS_TO_HIDE]
  );
  return send(res, 200, { ok: true });
}

async function moderate(req, res, body, action) {
  if (!ADMIN || !same(req.headers['x-admin-key'], ADMIN)) return send(res, 404, { error: 'not found' });
  const id = String(body.id || '');
  if (!CID_RE.test(id)) return send(res, 400, { error: 'bad request' });
  const g = await pipeline([['GET', rec(id)]]);
  const o = parseRec(g[0] && g[0].result);
  const story = (o && o.storyId) || 'x';
  if (action === 'delete') {
    await evalScript(ATOM.SCRIPT_DELETE, [rec(id), hideKey(id), repKey(id), visKey(story), REVIEW], [id]);
    return send(res, 200, { ok: true, deleted: true });
  }
  if (!o) {
    await evalScript(ATOM.SCRIPT_RESTORE, [hideKey(id), visKey(story), rec(id), REVIEW, repKey(id)], [id, COMMENT_TTL, nowSec()]);
    return send(res, 200, { ok: true, restored: false });
  }
  const out = await evalScript(ATOM.SCRIPT_RESTORE, [hideKey(id), visKey(o.storyId), rec(id), REVIEW, repKey(id)], [id, COMMENT_TTL, nowSec()]);
  const hidden = Array.isArray(out) ? Number(out[0]) : Number(out);
  return send(res, 200, { ok: true, restored: hidden === 1 });
}

async function review(req, res) {
  if (!ADMIN || !same(req.headers['x-admin-key'], ADMIN)) return send(res, 404, { error: 'not found' });
  const q = await pipeline([['ZREVRANGE', REVIEW, '0', '199', 'WITHSCORES']]);
  const flat = (q[0] && q[0].result) || [], rows = [];
  for (let i = 0; i < flat.length; i += 2) if (CID_RE.test(String(flat[i]))) rows.push({ id: flat[i], at: new Date(Number(flat[i + 1]) * 1000).toISOString() });
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
module.exports.MAX_THREAD = MAX_THREAD;
module.exports.MAX_VIS = MAX_VIS;
module.exports.DAILY_PER_IP = DAILY_PER_IP;
module.exports.DAILY_PER_UID = DAILY_PER_UID;
module.exports.STORY_PER_IP = STORY_PER_IP;
module.exports.REPORTS_TO_HIDE = REPORTS_TO_HIDE;
module.exports.clean = clean;
module.exports.hasLink = hasLink;
module.exports.sameOrigin = sameOrigin;
module.exports.visKey = visKey;
