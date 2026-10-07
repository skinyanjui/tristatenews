// Shared heart counts for stories. Stored in Upstash Redis (the Vercel Marketplace "Upstash for Redis"
// integration sets these variables). Without it, the page falls back to counting only the reader's own heart.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const ID_RE = /^[a-z0-9]{4,24}$/;
const UID_RE = /^[a-zA-Z0-9_-]{8,48}$/;
const key = id => 'tsn:likes:' + id;

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
      const out = await pipeline([[body.liked ? 'SADD' : 'SREM', key(body.id), body.uid], ['SCARD', key(body.id)]]);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(JSON.stringify({ configured: true, count: Number(out[1] && out[1].result) || 0 }));
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
