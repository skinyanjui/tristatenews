// Scheduled refresh: fetches the feeds and stores the result for /api/news to serve.
//   GET /api/refresh?tier=all   every source (run every 30 minutes)
//   GET /api/refresh?tier=fast  TV, daily papers and law enforcement only (run every 10 minutes)
// Protected by a secret: send  Authorization: Bearer <CRON_SECRET>  (Vercel Cron does this automatically
// when a CRON_SECRET environment variable exists; the GitHub Actions workflow in this repo does too).
const { same } = require('./_safe.js');
const { refreshAll, stored } = require('./news.js');

module.exports = async function (req, res) {
  const secret = process.env.CRON_SECRET || '';
  const send = (c, o) => { res.setHeader('Cache-Control', 'no-store'); res.status(c).json(o); };
  if (!secret) return send(503, { error: 'Set CRON_SECRET to enable scheduled refresh.' });
  if (!same(req.headers.authorization || '', 'Bearer ' + secret)) return send(401, { error: 'unauthorized' });
  if (!stored()) return send(503, { error: 'Redis is not configured, so there is nowhere to store the snapshot.' });
  try {
    const tier = req.query && req.query.tier === 'fast' ? 'fast' : 'all';
    const t0 = Date.now();
    const { snapshot, report } = await refreshAll({ tier });
    const bad = report.filter(r => r.result.startsWith('fail'));
    send(200, { ok: true, tier, ms: Date.now() - t0, stories: snapshot.items.length, sourcesWithStories: snapshot.sources.filter(s => s.count > 0).length, notModified: report.filter(r => r.result === '304').length, failing: bad });
  } catch (e) {
    send(502, { error: String(e && e.message || e).slice(0, 120) });
  }
};
