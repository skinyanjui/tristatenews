// Public anonymous comments on current non-crime news. Hosted by api/react.js (vercel rewrite /api/comments).
//   GET  /api/comments?id=<storyId>&offset=      -> { configured, allowed, comments, count, total }
//   GET  /api/comments?ids=<id,id>               -> { configured, counts }   (allowed stories only)
//   POST /api/comments { action:'ready' }        -> { ready } + Set-Cookie on first issue only
//   POST /api/comments { id, uid, text }         -> { ok, comment }          (create; cookie required)
//   POST /api/comments { action:'mine', ids }    -> { mine }                 (private; cookie hash check)
//   POST /api/comments { action:'delete', id }   -> owner cookie delete, or admin with x-admin-key
//   POST /api/comments { action:'report', id, uid }
//   GET  /api/comments?review=1  + x-admin-key   -> hidden/held queue
//   POST { action:'restore'|'delete', id } + x-admin-key
//   POST { action:'sweep' } + x-admin-key        -> bounded AUTOHIDE of stored matches (not a public GET)
// Trusted allowlist is tsn:news:meta + tsn:news:ids from refresh (api/_storyid.js). Client category is ignored.
// Unknown / expired / police / courts / crime-title / missing meta: fail closed (not allowed, empty thread).
// Visible index is tsn:cm:vis:<storyId> (ZSET, score = expiry unix). Public counts are the in-memory
// filtered vis set (≤ MAX_VIS), not a raw ZCARD, so cards match the thread. Expiry prune may write;
// classification on GET does not. Hide/restore/delete/create/sweep run as one Redis EVAL.
// GET never reads Cookie and stays public/CDN-cacheable. Ownership is a first-party HttpOnly cookie
// (see api/_cmcookie.js). Create requires a valid incoming cookie (round-trip via ready); we never
// treat Set-Cookie on the create response as proof the browser stored it. Filter: api/_cmfilter.js.
'use strict';
const STORE = require('./_store.js');
const { same } = require('./_safe.js');
const { KEY: IDS, META } = require('./_storyid.js');
const { commentsBlocked } = require('./_crime.js');
const { clientIp, ipHash } = require('./_ip.js');
const ATOM = require('./_cmatom.js');
const FILTER = require('./_cmfilter.js');
const COOKIE = require('./_cmcookie.js');

const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';
const STORY_RE = /^[a-z0-9]{4,24}$/;
const CID_RE = /^c[a-z0-9]{6,20}$/;
const UID_RE = /^[a-zA-Z0-9_-]{8,48}$/;
const COMMENT_TTL = 180 * 86400;
const MAX_TEXT = 300;
const MAX_BODY = 4096;
const MAX_THREAD = 20;
const MAX_VIS = 200;
const MAX_MINE = 40;
const DAILY_PER_UID = 8;
const DAILY_PER_IP = 20;
const STORY_PER_IP = 8;
const REPORTS_TO_HIDE = 3;
const REPORTS_PER_IP = 10;
const READY_PER_IP = 40;
const MINE_PER_IP = 40;
const SWEEP_STORIES = 40;
const SWEEP_HID = 50;
const SWEEP_FLAG_CHUNK = 80;
const REVIEW = 'tsn:cm:review';
const PRUNE_CHUNK = 80;
const REJECT_MSG = 'This comment can’t be posted.';
const COOKIE_MSG = 'Comments need a first-party cookie in this browser. Allow cookies for this site, then try again.';

const pipeline = STORE.pipeline;
const rec = id => 'tsn:cm:' + id;
const visKey = id => 'tsn:cm:vis:' + id;
const hideKey = id => 'tsn:cm:hide:' + id;
const repKey = id => 'tsn:cm:rep:' + id;
const ownKey = id => 'tsn:cm:own:' + id;
const okKey = id => 'tsn:cm:ok:' + id;
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// Catch pasted URLs and host-like tokens (example.co, bit.ly) without treating "U.S." / "Mr. Smith" / "ok." as links.
const hasLink = t => /https?:\/\/|www\.|\b(?:bit\.ly|t\.co|tinyurl\.com|goo\.gl|ow\.ly|is\.gd|buff\.ly|cutt\.ly|rb\.gy|shorturl\.at|tiny\.cc)\b|\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|net|org|info|biz|xyz|ru|top|shop|site|co|io|ly|me|us|cc|tv|app|dev|page|link|click|gg|to|uk|de|br|in|au|ca|edu|gov|int)\b/i.test(t);
const dayUtc = () => new Date().toISOString().slice(0, 10);
const nowSec = () => Math.floor(Date.now() / 1000);
const send = (res, code, obj, cache) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'private, no-store');
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

function whyOf(hide) {
  const v = String(hide || '');
  if (v === 'hold') return 'hold';
  if (v.indexOf('auto') === 0 || v === 'filter') return 'filter';
  if (v) return 'reports';
  return '';
}

function renewCookie(req, res, token) {
  res.setHeader('Set-Cookie', COOKIE.setCookieHeader(req, token));
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
    if (action === 'ready') return await ready(req, res);
    if (action === 'mine') return await mine(req, res, body);
    if (action === 'sweep') return await sweep(req, res);
    if (action === 'restore') return await moderate(req, res, body, action);
    if (action === 'delete') {
      if (ADMIN && same(req.headers['x-admin-key'], ADMIN)) return await moderate(req, res, body, action);
      return await ownerDelete(req, res, body);
    }
    if (action === 'report') return await report(req, res, body);
    return await create(req, res, body);
  } catch (e) {
    require('./_log.js').fail('comments', e);
    return req.method === 'GET'
      ? send(res, 200, { configured: false, allowed: false, comments: [], counts: {}, count: 0, total: 0 })
      : send(res, 502, { error: 'Couldn’t save that right now. Try again in a moment.' });
  }
}

async function burst(req, kind, cap) {
  const ip = clientIp(req) || '0';
  const k = 'tsn:cm:rl' + kind + ':' + ipHash(ip, 'cm-' + kind);
  const lim = await pipeline([['INCR', k], ['EXPIRE', k, '60', 'NX']]);
  return (Number(lim[0] && lim[0].result) || 0) > cap;
}

async function ready(req, res) {
  const token = COOKIE.readToken(req);
  if (token) return send(res, 200, { ready: true });
  if (await burst(req, 'ready', READY_PER_IP)) return send(res, 429, { error: 'too many' });
  const issued = COOKIE.newToken();
  renewCookie(req, res, issued);
  return send(res, 200, { ready: false });
}

async function mine(req, res, body) {
  if (await burst(req, 'mine', MINE_PER_IP)) return send(res, 429, { error: 'too many' });
  const token = COOKIE.readToken(req);
  if (!token) return send(res, 200, { mine: [] });
  const raw = Array.isArray(body.ids) ? body.ids : String(body.ids || '').split(',');
  const ids = [...new Set(raw.map(x => String(x)).filter(x => CID_RE.test(x)))].slice(0, MAX_MINE);
  if (!ids.length) return send(res, 200, { mine: [] });
  const want = COOKIE.tokenHash(token);
  const got = await pipeline(ids.map(id => ['GET', ownKey(id)]));
  const mineIds = [];
  ids.forEach((id, i) => {
    const h = got[i] && got[i].result;
    if (h && COOKIE.hashesEqual(String(h), want)) mineIds.push(id);
  });
  return send(res, 200, { mine: mineIds });
}

async function ownerDelete(req, res, body) {
  const token = COOKIE.readToken(req);
  const id = String(body.id || '');
  if (!token || !CID_RE.test(id)) return send(res, 404, { error: 'not found' });
  const want = COOKIE.tokenHash(token);
  const g = await pipeline([['GET', rec(id)], ['GET', ownKey(id)]]);
  const o = parseRec(g[0] && g[0].result);
  const own = g[1] && g[1].result;
  if (!own || !COOKIE.hashesEqual(String(own), want)) return send(res, 404, { error: 'not found' });
  const story = (o && o.storyId) || 'x';
  const out = await evalScript(
    ATOM.SCRIPT_OWN_DELETE,
    [rec(id), hideKey(id), repKey(id), visKey(story), REVIEW, ownKey(id), okKey(id)],
    [id, want]
  );
  const ok = Array.isArray(out) ? Number(out[0]) === 1 : Number(out) === 1;
  if (!ok) return send(res, 404, { error: 'not found' });
  return send(res, 200, { ok: true, deleted: true });
}

async function classify(id) {
  const out = await pipeline([['GET', META], ['SISMEMBER', IDS, id], ['EXISTS', IDS]]);
  const meta = parseMeta(out[0] && out[0].result, id);
  const inSet = Number(out[1] && out[1].result) === 1;
  const setExists = Number(out[2] && out[2].result) === 1;
  const allowed = !!(meta && !commentsBlocked(meta));
  return { meta, inSet, setExists, allowed };
}

// Public view of one story: expiry prune (TTL) may write; classification never writes.
// Filter applies to the whole bounded vis set (≤ MAX_VIS), then the 20-item page is sliced.
async function publicList(id) {
  const vis = visKey(id);
  const got = await pipeline([['ZREVRANGE', vis, '0', String(MAX_VIS - 1)]]);
  const ids = ((got[0] && got[0].result) || []).filter(x => CID_RE.test(String(x)));
  if (!ids.length) return [];
  const recs = await pipeline(ids.map(cid => ['GET', rec(cid)]));
  const hold = [];
  const keep = {};
  ids.forEach((cid, i) => {
    const o = parseRec(recs[i] && recs[i].result);
    if (!o || o.storyId !== id) return;
    const pub = publicComment(o);
    if (!pub) return;
    if (FILTER.classify(o.text).action === 'ok') keep[cid] = pub;
    else hold.push(cid);
  });
  if (hold.length) {
    const oks = await pipeline(hold.map(cid => ['EXISTS', okKey(cid)]));
    hold.forEach((cid, i) => {
      if (Number(oks[i] && oks[i].result) !== 1) return;
      const recI = ids.indexOf(cid);
      const o = parseRec(recs[recI] && recs[recI].result);
      const pub = publicComment(o);
      if (pub) keep[cid] = pub;
    });
  }
  return ids.map(cid => keep[cid]).filter(Boolean);
}

async function liveThread(id, offset) {
  const vis = visKey(id);
  await pipeline([['ZREMRANGEBYSCORE', vis, '-inf', String(nowSec())]]);
  const all = await publicList(id);
  return { comments: all.slice(offset, offset + MAX_THREAD), total: all.length };
}

// Homepage GET ?ids= (≤300): prune first, then rec GETs only for nonempty vis, 200 at a time.
// Typical feed is a few stories with comments; worst case is bounded (300 × MAX_VIS).
async function filteredCounts(storyIds) {
  const counts = {};
  if (!storyIds.length) return counts;
  const ranges = await pipeline(storyIds.map(id => ['ZREVRANGE', visKey(id), '0', String(MAX_VIS - 1)]));
  const flat = [];
  storyIds.forEach((id, si) => {
    const ids = ((ranges[si] && ranges[si].result) || []).filter(x => CID_RE.test(String(x)));
    ids.forEach(cid => flat.push({ id, cid }));
  });
  for (let i = 0; i < flat.length; i += 200) {
    const slice = flat.slice(i, i + 200);
    const recs = await pipeline(slice.map(x => ['GET', rec(x.cid)]));
    const maybe = [];
    slice.forEach((x, j) => {
      const o = parseRec(recs[j] && recs[j].result);
      if (!o || o.storyId !== x.id) return;
      if (FILTER.classify(o.text).action === 'ok') counts[x.id] = (counts[x.id] || 0) + 1;
      else maybe.push(x);
    });
    if (!maybe.length) continue;
    const oks = await pipeline(maybe.map(x => ['EXISTS', okKey(x.cid)]));
    maybe.forEach((x, j) => {
      if (Number(oks[j] && oks[j].result) === 1) counts[x.id] = (counts[x.id] || 0) + 1;
    });
  }
  return counts;
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
  const nonempty = Object.keys(counts);
  if (nonempty.length) {
    const filtered = await filteredCounts(nonempty);
    nonempty.forEach(id => {
      const n = Number(filtered[id]) || 0;
      if (n) counts[id] = n;
      else delete counts[id];
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
  const token = COOKIE.readToken(req);
  if (!token) return send(res, 400, { error: COOKIE_MSG });
  const hit = FILTER.classify(text);
  if (hit.action === 'reject') return send(res, 400, { error: REJECT_MSG, field: 'text' });
  const cid = newCid();
  const now = new Date().toISOString();
  const item = { id: cid, storyId: id, text, at: now };
  const exp = nowSec() + COMMENT_TTL;
  const hash = COOKIE.tokenHash(token);
  if (hit.action === 'hold') {
    await evalScript(
      ATOM.SCRIPT_HOLD,
      [rec(cid), hideKey(cid), REVIEW, ownKey(cid)],
      [JSON.stringify(item), cid, nowSec(), COMMENT_TTL, hash]
    );
    renewCookie(req, res, token);
    return send(res, 200, { ok: true, pending: true, id: cid });
  }
  await evalScript(
    ATOM.SCRIPT_CREATE,
    [rec(cid), visKey(id), ownKey(cid)],
    [JSON.stringify(item), cid, exp, COMMENT_TTL, nowSec(), MAX_VIS, hash]
  );
  renewCookie(req, res, token);
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

async function sweep(req, res) {
  if (!ADMIN || !same(req.headers['x-admin-key'], ADMIN)) return send(res, 404, { error: 'not found' });
  const pre = await pipeline([['GET', META]]);
  let map = {};
  try { map = JSON.parse(pre[0] && pre[0].result) || {}; } catch (_) { map = {}; }
  const ver = String(FILTER.VERSION);
  const allowed = Object.keys(map).filter(id => STORY_RE.test(id) && map[id] && !commentsBlocked(map[id]));
  let hid = 0, scanned = 0, more = false;
  for (let s = 0; s < allowed.length && scanned < SWEEP_STORIES && hid < SWEEP_HID; ) {
    const batch = allowed.slice(s, s + SWEEP_FLAG_CHUNK);
    const flags = await pipeline(batch.map(id => ['GET', 'tsn:cm:fsweep:' + id]));
    for (let b = 0; b < batch.length; b++) {
      if (scanned >= SWEEP_STORIES || hid >= SWEEP_HID) { more = true; break; }
      const id = batch[b];
      if (String(flags[b] && flags[b].result) === ver) continue;
      scanned++;
      const vis = visKey(id);
      const flag = 'tsn:cm:fsweep:' + id;
      await pipeline([['ZREMRANGEBYSCORE', vis, '-inf', String(nowSec())]]);
      const members = await pipeline([['ZREVRANGE', vis, '0', String(MAX_VIS - 1)]]);
      const ids = ((members[0] && members[0].result) || []).filter(x => CID_RE.test(String(x)));
      let finished = true;
      if (ids.length) {
        const recs = await pipeline(ids.map(cid => ['GET', rec(cid)]));
        for (let i = 0; i < ids.length; i++) {
          if (hid >= SWEEP_HID) { finished = false; more = true; break; }
          const o = parseRec(recs[i] && recs[i].result);
          if (!o) continue;
          const hit = FILTER.classify(o.text);
          if (hit.action === 'ok') continue;
          const out = await evalScript(
            ATOM.SCRIPT_AUTOHIDE,
            [rec(ids[i]), hideKey(ids[i]), vis, REVIEW, okKey(ids[i])],
            [ids[i], nowSec(), COMMENT_TTL, 'auto-' + (hit.rule || 'filter')]
          );
          if ((Array.isArray(out) ? Number(out[0]) : Number(out)) === 1) hid++;
        }
      }
      if (finished) await pipeline([['SET', flag, ver, 'EX', String(COMMENT_TTL)]]);
    }
    s += batch.length;
    if (s < allowed.length && (scanned >= SWEEP_STORIES || hid >= SWEEP_HID)) more = true;
  }
  return send(res, 200, { ok: true, scanned, hid, more });
}

async function moderate(req, res, body, action) {
  if (!ADMIN || !same(req.headers['x-admin-key'], ADMIN)) return send(res, 404, { error: 'not found' });
  const id = String(body.id || '');
  if (!CID_RE.test(id)) return send(res, 400, { error: 'bad request' });
  const g = await pipeline([['GET', rec(id)]]);
  const o = parseRec(g[0] && g[0].result);
  const story = (o && o.storyId) || 'x';
  if (action === 'delete') {
    await evalScript(ATOM.SCRIPT_DELETE, [rec(id), hideKey(id), repKey(id), visKey(story), REVIEW, ownKey(id), okKey(id)], [id]);
    return send(res, 200, { ok: true, deleted: true });
  }
  if (!o) {
    await evalScript(ATOM.SCRIPT_RESTORE, [hideKey(id), visKey(story), rec(id), REVIEW, repKey(id), okKey(id)], [id, COMMENT_TTL, nowSec()]);
    return send(res, 200, { ok: true, restored: false });
  }
  const out = await evalScript(ATOM.SCRIPT_RESTORE, [hideKey(id), visKey(o.storyId), rec(id), REVIEW, repKey(id), okKey(id)], [id, COMMENT_TTL, nowSec()]);
  const hidden = Array.isArray(out) ? Number(out[0]) : Number(out);
  return send(res, 200, { ok: true, restored: hidden === 1 });
}

async function review(req, res) {
  if (!ADMIN || !same(req.headers['x-admin-key'], ADMIN)) return send(res, 404, { error: 'not found' });
  const q = await pipeline([['ZREVRANGE', REVIEW, '0', '199', 'WITHSCORES']]);
  const flat = (q[0] && q[0].result) || [], rows = [];
  for (let i = 0; i < flat.length; i += 2) if (CID_RE.test(String(flat[i]))) rows.push({ id: flat[i], at: new Date(Number(flat[i + 1]) * 1000).toISOString() });
  if (!rows.length) return send(res, 200, { items: [] });
  const got = await pipeline(rows.flatMap(r => [['GET', rec(r.id)], ['SCARD', repKey(r.id)], ['GET', hideKey(r.id)]]));
  const items = [];
  rows.forEach((r, i) => {
    const o = parseRec(got[i * 3] && got[i * 3].result);
    if (!o) return;
    const hide = got[i * 3 + 2] && got[i * 3 + 2].result;
    items.push({
      id: o.id,
      storyId: o.storyId,
      text: o.text,
      at: o.at,
      reportedAt: r.at,
      reports: Number(got[i * 3 + 1] && got[i * 3 + 1].result) || 0,
      hidden: !!hide,
      why: whyOf(hide)
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
module.exports.READY_PER_IP = READY_PER_IP;
module.exports.MINE_PER_IP = MINE_PER_IP;
module.exports.REJECT_MSG = REJECT_MSG;
module.exports.COOKIE_MSG = COOKIE_MSG;
module.exports.clean = clean;
module.exports.hasLink = hasLink;
module.exports.sameOrigin = sameOrigin;
module.exports.visKey = visKey;
module.exports.ownKey = ownKey;
module.exports.okKey = okKey;
module.exports.whyOf = whyOf;
