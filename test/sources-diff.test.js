// PR 3.1: scripts/sources-diff.js, the read-only "0 sources changed" check. No network: files and fixtures only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const D = require('../scripts/sources-diff.js');
const FIX = require('./fixtures/sources-ba8b34a.json');

// sources[] exactly as buildSnapshot() in api/news.js lists it at ba8b34a, health fields included.
const snapshotSources = () => FIX.active.map(s => ({ logo: D.logoFor(s.url), id: s.id, name: s.name, area: s.area || '', kind: s.kind || 'news', ok: true, count: 3, lastOk: '2026-10-18T14:19:40.683Z', stale: false }));

test('the registry lists the same sources[] as the ba8b34a snapshot: 0 changed', () => {
  const d = D.compare(snapshotSources(), D.registrySources());
  assert.deepStrictEqual(d, { added: [], removed: [], changed: [], orderSame: true, changedCount: 0 });
  assert.strictEqual(D.registrySources().length, 60);
});

test('logoFor matches news.js', () => {
  assert.strictEqual(D.logoFor('https://www.wthitv.com/arc/outboundfeeds/rss/?outputType=xml'), 'https://www.google.com/s2/favicons?sz=128&domain=wthitv.com');
  assert.strictEqual(D.logoFor('not a url'), '');
});

test('health fields are ignored', () => {
  const a = snapshotSources(), b = snapshotSources().map(s => Object.assign({}, s, { ok: false, count: 0, lastOk: null, stale: true }));
  assert.strictEqual(D.compare(a, b).changedCount, 0);
});

test('rename, logo change, add, remove and reorder are reported', () => {
  const a = snapshotSources();
  let b = a.map(s => Object.assign({}, s)); b[0].name = 'Renamed'; b[1].logo = 'x';
  let d = D.compare(a, b);
  assert.deepStrictEqual(d.changed.map(c => c.id + '.' + c.field), [a[0].id + '.name', a[1].id + '.logo']);
  assert.strictEqual(d.changedCount, 2);
  b = a.slice(1).concat([{ id: 'new', name: 'N', area: '', kind: 'news', logo: '' }]);
  d = D.compare(a, b);
  assert.deepStrictEqual([d.added, d.removed, d.changedCount], [['new'], [a[0].id], 2]);
  b = a.slice(); [b[0], b[1]] = [b[1], b[0]];
  d = D.compare(a, b);
  assert.strictEqual(d.orderSame, false);
  assert.strictEqual(d.changedCount, 1);
});

test('CLI with two files: exit 0 when nothing changed, 1 when something did', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsn-diff-'));
  const f1 = path.join(dir, 'a.json'), f2 = path.join(dir, 'b.json'), f3 = path.join(dir, 'c.json');
  fs.writeFileSync(f1, JSON.stringify({ updatedAt: 'x', sources: snapshotSources(), items: [] }));
  fs.writeFileSync(f2, JSON.stringify({ updatedAt: 'y', sources: snapshotSources().map(s => Object.assign({}, s, { count: 0 })), items: [] }));
  fs.writeFileSync(f3, JSON.stringify({ updatedAt: 'z', sources: snapshotSources().slice(1), items: [] }));
  const run = (...a) => spawnSync(process.execPath, [path.join(__dirname, '../scripts/sources-diff.js'), ...a], { encoding: 'utf8' });
  let r = run(f1, f2);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /RESULT: 0 sources changed, order same/);
  r = run(f1, f3);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /REMOVED wfie/);
  r = run(f1, path.join(dir, 'missing.json'));
  assert.strictEqual(r.status, 2);
});
