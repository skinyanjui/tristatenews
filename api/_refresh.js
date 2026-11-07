// Scheduled refresh: fetches the feeds that are due and stores the result for /api/news to serve.
//   GET /api/refresh?tier=due   the sources that are due (GitHub Actions, every 5 minutes; tier=fast is the same)
//   GET /api/refresh?tier=all   also every source without an everyMin of its own (manual runs)
// Scheduling, backoff and the shared refresh lock are in api/news.js (planRun, refreshAll).
// Protected by a secret: send  Authorization: Bearer <CRON_SECRET>  (Vercel Cron does this automatically
// when a CRON_SECRET environment variable exists; the GitHub Actions workflow in this repo does too).
// The answer includes store: { requests, commands }, the Upstash round trips and billed commands of the run (PR 1.2),
// the run's id and status counts (PR 1.3), how many sources were due, fetched and deferred, how quickly new stories
// arrived (discovery) and the sources with no success for 6 hours (staleSources). Per-source results, with their
// private error detail, are stored under tsn:runs:<runId> for 7 days.
const { same } = require('./_safe.js');
const { refreshAll, stored, redis } = require('./news.js');

const PRUNE_EVERY_MS = 30 * 6e4;

module.exports = async function (req, res) {
  const secret = process.env.CRON_SECRET || '';
  const send = (c, o) => { res.setHeader('Cache-Control', 'no-store'); res.status(c).json(o); };
  if (!secret) return send(503, { error: 'Set CRON_SECRET to enable scheduled refresh.' });
  if (!same(req.headers.authorization || '', 'Bearer ' + secret)) return send(401, { error: 'unauthorized' });
  if (!stored()) return send(503, { error: 'Redis is not configured, so there is nowhere to store the snapshot.' });
  try {
    const q = req.query && req.query.tier;
    const tier = q === 'all' ? 'all' : 'due';
    const t0 = Date.now();
    const out = await refreshAll({ tier, chores: { prune: PRUNE_EVERY_MS } });
    if (out.busy) return send(200, { ok: true, tier, skipped: 'busy', ms: Date.now() - t0, store: out.store });
    const { snapshot, report, store, runId, run, locations, choresDue } = out;
    // Community boards: expired ids out of every index (their GETs are read-only and CDN-cached, api/listings.js).
    if (choresDue.includes('prune')) { try { await redis(require('./listings.js').pruneCmds(Date.now())); store.requests++; store.commands += 5; } catch (e) { console.error('board prune failed', e && e.message); } }
    const bad = report.filter(r => r.result.startsWith('fail'));
    send(200, { ok: true, tier, runId, ms: Date.now() - t0, stories: snapshot.items.length, sourcesWithStories: snapshot.sources.filter(s => s.count > 0).length, due: run.due, fetched: run.fetched, deferred: run.deferred, snapshotWritten: run.snapshotWritten, notModified: report.filter(r => r.result === '304').length, failing: bad, statuses: run.statusCounts, discovery: run.discovery, staleSources: run.staleSources, store, locations: locations ? { total: locations.total, assigned: locations.assigned, requiresReview: locations.requiresReview } : undefined });
  } catch (e) {
    require('./_log.js').fail('refresh', e);
    send(502, { error: String(e && e.message || e).slice(0, 120) });
  }
};
