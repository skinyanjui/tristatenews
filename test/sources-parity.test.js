// PR 3.1 parity: the registry (data/sources/*.json via api/_sources.js) gives news.js exactly the sources the inline
// SOURCES literal gave it at ba8b34a (main before this PR) and at 3b6c403 (the plan's audit commit): the same ids,
// URLs, kinds and flags, in the same order. Run with EXTRA_FEEDS unset (npm test does not set it).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const news = require('../api/news.js');
const reg = require('../api/_sources.js');
const FIXES = require('./fixtures/source-url-fixes.js'); // documented intentional URL changes since ba8b34a
const FIX = FIXES.current;

const FLAGS = ['id', 'name', 'area', 'url', 'altUrls', 'kind', 'geo', 'strictGeo', 'geoTerms', 'maxAgeDays', 'everyMin', 'parser', 'funeralHome', 'disabled'];

test('SOURCES is byte-for-byte the ba8b34a list (same objects, same key order, same order)', () => {
  assert.strictEqual(JSON.stringify(news.SOURCES), JSON.stringify(FIX.active));
  assert.strictEqual(news.SOURCES.length, 60);
});

test('DISABLED_SOURCES is byte-for-byte the ba8b34a list', () => {
  assert.strictEqual(JSON.stringify(news.DISABLED_SOURCES), JSON.stringify(FIX.disabled));
  assert.deepStrictEqual(news.DISABLED_SOURCES.map(s => s.id), ['ob-davis', 'ob-nass', 'ob-bgt', 'ob-becher']);
});

test('every id, url, kind and flag matches field by field, and no source gained or lost a key', () => {
  const all = [...news.SOURCES, ...news.DISABLED_SOURCES], want = [...FIX.active, ...FIX.disabled];
  assert.strictEqual(all.length, 64);
  for (let i = 0; i < want.length; i++) {
    const got = all[i], ref = want[i];
    assert.deepStrictEqual(Object.keys(got), Object.keys(ref), ref.id + ' keys');
    for (const f of FLAGS) assert.deepStrictEqual(got[f], ref[f], ref.id + '.' + f);
  }
});

test('registry: valid, 4 files, seq 1..64 without gaps, 64 unique ids, no registry-only fields leak', () => {
  assert.deepStrictEqual(reg.validate(), []);
  assert.deepStrictEqual(reg.FILES.map(f => f.file), ['indiana', 'kentucky', 'illinois', 'statewide']);
  const entries = reg.FILES.flatMap(f => f.sources);
  assert.deepStrictEqual(entries.map(s => s.seq).sort((a, b) => a - b), Array.from({ length: 64 }, (_, i) => i + 1));
  assert.strictEqual(new Set(entries.map(s => s.id)).size, 64);
  for (const s of [...news.SOURCES, ...news.DISABLED_SOURCES]) { assert.ok(!('seq' in s), s.id); assert.ok(!('note' in s), s.id); }
  const files = fs.readdirSync(path.join(ROOT, 'data/sources')).filter(f => f.endsWith('.json')).sort();
  assert.deepStrictEqual(files, ['illinois.json', 'indiana.json', 'kentucky.json', 'statewide.json']);
});

test('validate() reports a bad registry', () => {
  const bad = [{ file: 'x', sources: [
    { seq: 1, id: 'a', name: 'A', area: 'Z', url: 'https://a/' },
    { seq: 1, id: 'a', name: '', area: 'Z', url: 'ftp://a/', kind: 'blog', strictGeo: 'mo', altUrls: ['nope'] },
  ] }];
  const p = reg.validate(bad).join('\n');
  for (const m of ['duplicate seq', 'missing name', 'duplicate id', 'url must be http(s)', 'unknown kind', 'unknown strictGeo', 'altUrls']) assert.ok(p.includes(m), m);
});

test('every fast-tier id is a registry source', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/news.js'), 'utf8');
  const m = src.match(/const FAST_IDS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'FAST_IDS found');
  const ids = new Set(news.SOURCES.map(s => s.id));
  for (const id of m[1].match(/'[^']+'/g).map(s => s.slice(1, -1))) assert.ok(ids.has(id), id);
});

test('news.js no longer defines sources inline', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/news.js'), 'utf8');
  assert.ok(!/const SOURCES\s*=\s*\[/.test(src));
  assert.ok(!/const gnews\b/.test(src));
  assert.ok(!/EXTRA_FEEDS \|\|/.test(src));
  assert.ok(!/area: '[^']*'.*url: '/.test(src), 'no source object literals');
  assert.ok(!/(?:rss\.xml|\/feed\/|f=rss|outboundfeeds)/.test(src), 'no feed URLs');
  assert.ok(src.includes("require('./_sources.js')"));
});

// Compare directly against the old news.js at each reference commit (skips where the commit is not in the clone).
function oldApi(rev) {
  try { execFileSync('git', ['cat-file', '-e', rev + '^{commit}'], { cwd: ROOT, stdio: 'ignore' }); } catch (_) { return null; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsn-ref-'));
  execFileSync('sh', ['-c', 'git archive "$0" | tar -x -C "$1"', rev, dir], { cwd: ROOT });
  return dir;
}
for (const rev of ['ba8b34a', '3b6c403']) {
  const dir = oldApi(rev);
  test('same SOURCES and DISABLED_SOURCES as news.js at ' + rev, { skip: dir ? false : rev + ' not in this clone' }, () => {
    const old = require(path.join(dir, 'api/news.js'));
    assert.strictEqual(JSON.stringify(news.SOURCES), JSON.stringify(FIXES.fix(old.SOURCES)));
    assert.strictEqual(JSON.stringify(news.DISABLED_SOURCES), JSON.stringify(FIXES.fix(old.DISABLED_SOURCES)));
  });
}
