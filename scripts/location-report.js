#!/usr/bin/env node
// Shadow county-classification report (plan stage B), read-only. Classifies the stories in a news snapshot with
// api/_location.js and prints counts; with --labels, also precision and recall against a hand-labeled sample.
//   node scripts/location-report.js                         public https://tristatenewss.vercel.app/api/news (GET only)
//   node scripts/location-report.js --file snap.json        a saved /api/news body
//   node scripts/location-report.js --labels labels.json    labels: [{ id, expected: { countyIds: ["ky-daviess"] } }]
//   node scripts/location-report.js --sample 200 --out labels-todo.json
//        writes a labeling sheet: every row's `expected` is null for a person to fill in; the classifier's answer is
//        in `classifier` for comparison only and must not be copied into `expected` unchecked.
//   --json   print the whole record (rows included) instead of the summary
// It never writes to Redis and needs no secrets. The admin endpoint GET /api/locations?live=1 gives the same summary.
const fs = require('fs');
const LOC = require('../api/_location.js');
const { SOURCES } = require('../api/news.js');

function arg(name) { const i = process.argv.indexOf('--' + name); return i > 0 ? (process.argv[i + 1] || true) : null; }

async function load() {
  const file = arg('file');
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = arg('url') || 'https://tristatenewss.vercel.app/api/news';
  const r = await fetch(url, { headers: { 'User-Agent': 'tsn-location-report' } });
  if (!r.ok) throw new Error('GET ' + url + ' ' + r.status);
  return r.json();
}

function pct(n, d) { return d ? (Math.round(1000 * n / d) / 10) + '%' : '-'; }

async function main() {
  const snap = await load();
  const rec = LOC.shadow(snap, SOURCES, { snapshotAt: snap.updatedAt || null });
  const s = rec.summary;
  if (arg('json')) { console.log(JSON.stringify(rec, null, 2)); return; }
  console.log('Classifier v' + rec.classifierVersion + ', manifest ' + rec.manifestVersion + ', snapshot ' + (snap.updatedAt || '?'));
  console.log('Stories classified: ' + s.total + ' (events and obituaries skipped)');
  console.log('Assigned to at least one county: ' + s.assigned + ' (' + pct(s.assigned, s.total) + ')');
  console.log('Flagged for review: ' + s.requiresReview + ' (' + pct(s.requiresReview, s.total) + ')');
  console.log('Ambiguous name left unassigned: ' + s.ambiguousLeftUnassigned);
  for (const k of ['byScope', 'byLevel', 'byMethod', 'byReason', 'topCounties']) console.log(k + ': ' + JSON.stringify(s[k]));
  const labelsFile = arg('labels');
  if (labelsFile) {
    const labels = JSON.parse(fs.readFileSync(labelsFile, 'utf8')).filter(l => l && l.expected);
    const a = LOC.accuracy(rec.items, labels);
    console.log('Accuracy on ' + a.labels + ' labels (' + a.missing + ' not in this snapshot): precision ' + a.precision + '%, recall ' + a.recall + '%, unknown kept unknown ' + a.unknownCorrect + '/' + a.unknownLabels);
    for (const w of a.wrong.slice(0, 20)) console.log('  wrong: ' + w.id + ' expected ' + JSON.stringify(w.expected) + ' got ' + JSON.stringify(w.got) + '  ' + w.title);
  }
  const n = Number(arg('sample')), out = arg('out');
  if (n && out) {
    // Every Nth story so the sheet spans sources and time, not just the newest.
    const step = Math.max(1, Math.floor(rec.items.length / n));
    const rows = rec.items.filter((_, i) => i % step === 0).slice(0, n)
      .map(r => ({ id: r.id, sourceId: r.sourceId, title: r.title, expected: null, classifier: { scope: r.location.scope, countyIds: r.location.countyIds, level: r.location.level } }));
    fs.writeFileSync(out, JSON.stringify(rows, null, 2) + '\n');
    console.log('Wrote ' + rows.length + ' rows to ' + out + ' (fill in expected: { countyIds: [...] } by hand).');
  }
}

if (require.main === module) main().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
module.exports = { main };
