// Admin-only county-classification report (plan stage B). No new function: news.js hosts it (?__route=locations).
//   GET /api/locations              x-admin-key   the last shadow record refresh stored (tsn:loc:shadow), with
//                                                 flag state; { stored: null } until a refresh runs with the flag on
//   GET /api/locations?live=1       x-admin-key   classify the current snapshot now, in memory, store nothing
//   POST /api/locations {labels}    x-admin-key   accuracy of the live classification against a labeled sample
//                                                 (labels: [{ id, expected: { countyIds: [...] } }], at most 500)
// A missing or wrong key answers 404, like the other admin reads. Nothing here changes what readers see.
const { same } = require('./_safe.js');
const FLAGS = require('./_flags.js');
const LOC = require('./_location.js');

async function getStored() {
  const news = require('./news.js');
  if (!news.stored()) return null;
  const out = await news.redis([['GET', LOC.SHADOW_KEY]]);
  try { return out[0] && out[0].result ? JSON.parse(out[0].result) : null; } catch (_) { return null; }
}
async function live() {
  const news = require('./news.js');
  const snap = await news.readSnapshot();
  if (!snap) return null;
  return LOC.shadow(snap, news.SOURCES, { live: true, snapshotAt: snap.updatedAt });
}

module.exports = async function (req, res) {
  const admin = process.env.LISTINGS_ADMIN_KEY || '';
  const send = (c, o) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex'); return res.status(c).json(o); };
  if (!admin || !same(String(req.headers['x-admin-key'] || ''), admin)) return send(404, { error: 'not found' });
  const flags = { COUNTY_CLASSIFICATION_ENABLED: FLAGS.countyClassification() };
  try {
    if (req.method === 'GET') {
      if (req.query && req.query.live === '1') { const rec = await live(); return send(200, { ok: true, flags, live: rec }); }
      return send(200, { ok: true, flags, stored: await getStored() });
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const labels = Array.isArray(body.labels) ? body.labels.slice(0, 500) : null;
      if (!labels) return send(400, { error: 'Send { labels: [{ id, expected: { countyIds } }] }.' });
      const rec = await live();
      if (!rec) return send(503, { error: 'No snapshot to classify yet.' });
      return send(200, { ok: true, flags, summary: rec.summary, accuracy: LOC.accuracy(rec.items, labels) });
    }
    res.setHeader('Allow', 'GET, POST');
    return send(405, { error: 'method not allowed' });
  } catch (e) {
    require('./_log.js').fail('locations', e);
    return send(502, { error: 'report unavailable' });
  }
};
