// Shared heart counts for stories. Stored in Upstash Redis (the Vercel Marketplace "Upstash for Redis"
// integration sets these variables). Without it, the page falls back to counting only the reader's own heart.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const ID_RE = /^[a-z0-9]{4,24}$/;
const UID_RE = /^[a-zA-Z0-9_-]{8,48}$/;
const key = id => 'tsn:likes:' + id;
// A story's like set expires after 180 days with no likes or unlikes; every write pushes that back.
const LIKE_TTL = 180 * 86400;
// Abuse limits: hearts and un-hearts per reader IP (a keyed hash, never the address) per day, and a heart only for a
// story in the current snapshot (the set api/news.js rewrites each refresh, api/_storyid.js). Removing a heart is
// always allowed. Before the first refresh after this shipped the set doesn't exist yet, and any well-formed id passes.
const DAILY_PER_IP = 200;
const IDS = require('./_storyid.js').KEY;
const { clientIp, ipHash } = require('./_ip.js');
const rlKey = (ip, day) => 'tsn:likes:rl:' + ipHash(ip, 'likes|' + day);

async function pipeline(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error('store ' + r.status);
  return r.json();
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!URL_ || !TOKEN) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(200).send(JSON.stringify({ configured: false, counts: {} }));
  }
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (!ID_RE.test(String(body.id)) || !UID_RE.test(String(body.uid))) return res.status(400).send(JSON.stringify({ error: 'bad request' }));
      res.setHeader('Cache-Control', 'no-store');
      const rk = rlKey(clientIp(req) || body.uid, new Date().toISOString().slice(0, 10));
      const pre = await pipeline([['INCR', rk], ['EXPIRE', rk, '86400', 'NX'], ['EXISTS', IDS], ['SISMEMBER', IDS, body.id], ['SCARD', key(body.id)]]);
      const current = Number(pre[4] && pre[4].result) || 0;
      if ((Number(pre[0] && pre[0].result) || 0) > DAILY_PER_IP) return res.status(429).send(JSON.stringify({ configured: true, count: current, error: 'too many' }));
      if (body.liked && Number(pre[2] && pre[2].result) === 1 && Number(pre[3] && pre[3].result) !== 1) return res.status(400).send(JSON.stringify({ configured: true, count: current, error: 'unknown story' }));
      const out = await pipeline([[body.liked ? 'SADD' : 'SREM', key(body.id), body.uid], ['EXPIRE', key(body.id), String(LIKE_TTL)], ['SCARD', key(body.id)]]);
      return res.status(200).send(JSON.stringify({ configured: true, count: Number(out[2] && out[2].result) || 0 }));
    }
    const q = Array.isArray(req.query && req.query.ids) ? req.query.ids.join(',') : String((req.query && req.query.ids) || '');
    const ids = [...new Set(q.split(',').filter(x => ID_RE.test(x)))].slice(0, 300);
    if (!ids.length) return res.status(200).send(JSON.stringify({ configured: true, counts: {} }));
    const out = await pipeline(ids.map(id => ['SCARD', key(id)]));
    const counts = {};
    ids.forEach((id, i) => { const n = Number(out[i] && out[i].result) || 0; if (n > 0) counts[id] = n; });
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15');
    return res.status(200).send(JSON.stringify({ configured: true, counts }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(JSON.stringify({ configured: false, counts: {} }));
  }
}

module.exports = handler;
module.exports.LIKE_TTL = LIKE_TTL;
module.exports.DAILY_PER_IP = DAILY_PER_IP;
