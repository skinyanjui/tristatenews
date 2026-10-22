// PR 3.1: EXTRA_FEEDS (extra sources from an environment variable) behaves exactly as it did inline in news.js.
// Each case loads news.js in a fresh process with EXTRA_FEEDS set, because the variable is read once at load.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FIXES = require('./fixtures/source-url-fixes.js'); // documented intentional URL changes since ba8b34a
const BASE = FIXES.current;

function load(dir, extra) {
  const env = Object.assign({}, process.env);
  for (const k of Object.keys(env)) if (/^(KV_|UPSTASH_|REDIS_URL$)/.test(k)) delete env[k];
  if (extra === undefined) delete env.EXTRA_FEEDS; else env.EXTRA_FEEDS = extra;
  const code = 'const n = require(' + JSON.stringify(path.join(dir, 'api/news.js')) + '); process.stdout.write(JSON.stringify({ s: n.SOURCES, d: n.DISABLED_SOURCES }))';
  return JSON.parse(execFileSync(process.execPath, ['-e', code], { env, cwd: dir }).toString());
}
const added = r => r.s.slice(BASE.active.length);
const J = v => JSON.stringify(v);

const CASES = {
  minimal: J([{ id: 'usi', name: 'USI News', url: 'https://example.edu/feed' }]),
  allFields: J([{ id: 'usi', name: 'USI News', area: 'Evansville', kind: 'institution', geo: true, strictGeo: 'ind', maxAgeDays: 30, everyMin: 60, url: 'https://example.edu/feed', altUrls: ['https://example.edu/alt', 'ftp://bad'] }]),
  coerced: J([{ id: 7, name: 8, area: 9, kind: 'blog', geo: 'yes', strictGeo: 'mo', maxAgeDays: '-1', everyMin: 'x', url: 'http://example.com/rss', altUrls: 'https://x', parser: 'sitemap', funeralHome: true, disabled: 'x', geoTerms: ['a'] }]),
  builtinDuplicate: J([{ id: 'wfie', name: 'Other', url: 'https://example.com/feed' }]),
  firstDuplicateWins: J([{ id: 'a', name: 'First', url: 'https://one/' }, { id: 'a', name: 'Second', url: 'https://two/' }]),
  disabledIdCanBeAdded: J([{ id: 'ob-davis', name: 'Davis', url: 'https://example.com/rss.xml' }]),
  invalidSkipped: J([null, 5, {}, { id: 'x', name: 'X' }, { id: 'y', name: 'Y', url: 'ftp://y' }, { name: 'Z', url: 'https://z/' }, { id: 'w', url: 'https://w/' }, { id: 'ok', name: 'OK', url: 'https://ok/' }]),
  notAnArray: J({ id: 'usi', name: 'USI', url: 'https://example.edu/feed' }),
  malformed: '[{"id":',
  empty: '',
};

test('unset: no extra sources', () => {
  const r = load(ROOT);
  assert.strictEqual(J(r.s), J(BASE.active));
  assert.strictEqual(J(r.d), J(BASE.disabled));
});

test('minimal entry: defaults filled in, appended after the registry', () => {
  const r = load(ROOT, CASES.minimal);
  assert.strictEqual(J(r.s.slice(0, BASE.active.length)), J(BASE.active));
  assert.deepStrictEqual(added(r), [{ id: 'usi', name: 'USI News', area: '', geo: false, url: 'https://example.edu/feed', altUrls: [] }]);
});

test('all fields: kept, non-http altUrls dropped', () => {
  assert.deepStrictEqual(added(load(ROOT, CASES.allFields)), [{ id: 'usi', name: 'USI News', area: 'Evansville', kind: 'institution', geo: true, strictGeo: 'ind', maxAgeDays: 30, everyMin: 60, url: 'https://example.edu/feed', altUrls: ['https://example.edu/alt'] }]);
});

test('coercions: strings, unknown kind/strictGeo dropped, geo boolean; parser, funeralHome, disabled, geoTerms not passed', () => {
  assert.deepStrictEqual(added(load(ROOT, CASES.coerced)), [{ id: '7', name: '8', area: '9', geo: true, url: 'http://example.com/rss', altUrls: [] }]);
});

test('an id already in the registry is ignored; the first of two duplicates wins', () => {
  assert.deepStrictEqual(added(load(ROOT, CASES.builtinDuplicate)), []);
  assert.deepStrictEqual(added(load(ROOT, CASES.firstDuplicateWins)).map(s => s.name), ['First']);
});

test('a disabled id can be added (disabled entries are removed before EXTRA_FEEDS)', () => {
  const r = load(ROOT, CASES.disabledIdCanBeAdded);
  assert.deepStrictEqual(added(r).map(s => s.id), ['ob-davis']);
  assert.ok(r.d.some(s => s.id === 'ob-davis'));
});

test('invalid entries skipped; not-an-array, malformed JSON and empty string add nothing', () => {
  assert.deepStrictEqual(added(load(ROOT, CASES.invalidSkipped)).map(s => s.id), ['ok']);
  for (const k of ['notAnArray', 'malformed', 'empty']) assert.strictEqual(J(load(ROOT, CASES[k]).s), J(BASE.active), k);
});

test('read once at load: changing the variable later changes nothing', () => {
  const env = Object.assign({}, process.env, { EXTRA_FEEDS: CASES.minimal });
  for (const k of Object.keys(env)) if (/^(KV_|UPSTASH_|REDIS_URL$)/.test(k)) delete env[k];
  const code = 'const n = require("./api/news.js"); const a = n.SOURCES.length; process.env.EXTRA_FEEDS = "[]"; delete require.cache[require.resolve("./api/news.js")]; const b = require("./api/news.js").SOURCES.length; process.stdout.write(a + " " + b)';
  assert.strictEqual(execFileSync(process.execPath, ['-e', code], { env, cwd: ROOT }).toString(), (BASE.active.length + 1) + ' ' + (BASE.active.length + 1));
});

// Differential: every case gives the same SOURCES and DISABLED_SOURCES as the inline code at ba8b34a.
function oldApi(rev) {
  try { execFileSync('git', ['cat-file', '-e', rev + '^{commit}'], { cwd: ROOT, stdio: 'ignore' }); } catch (_) { return null; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsn-ref-'));
  execFileSync('sh', ['-c', 'git archive "$0" | tar -x -C "$1"', rev, dir], { cwd: ROOT });
  return dir;
}
const OLD = oldApi('ba8b34a');
test('every case matches the old news.js at ba8b34a', { skip: OLD ? false : 'ba8b34a not in this clone' }, () => {
  for (const [k, v] of Object.entries(Object.assign({ unset: undefined }, CASES))) {
    const old = load(OLD, v);
    assert.strictEqual(J(load(ROOT, v)), J({ s: FIXES.fix(old.s), d: FIXES.fix(old.d) }), k);
  }
});
