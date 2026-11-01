// Ship 72: the NWS feed sends a User-Agent with a contact (api.weather.gov 403s generic ones), retries 403/429/5xx
// with backoff, and the alerts workflow fails only when the NWS fails two refreshes in a row. Never a real network call.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('../api/alerts.js');

test('User-Agent: app, site and an email contact; NWS_USER_AGENT only overrides when it names an email', () => {
  assert.equal(A.userAgent(''), 'TriStateNews (https://tristatenewss.vercel.app; unclesam@mail.grokbot.com)');
  assert.equal(A.userAgent('(tristatenewss.vercel.app, tristatenews-alerts)'), A.userAgent(''), 'the old generic value is not used');
  assert.equal(A.userAgent('MyApp (https://x.example; ops@x.example)'), 'MyApp (https://x.example; ops@x.example)');
  assert.match(A.UA, /@/);
});

function mockFetch(t, answers) {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    calls.push({ url, init });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (a instanceof Error) throw a;
    return { ok: a >= 200 && a < 300, status: a, headers: new Map(), json: async () => ({ features: [] }) };
  });
  return calls;
}
const FAST = { timeouts: [1000, 1000, 1000], waits: [1, 1] };

test('NWS feed: geo+json Accept and the contact UA; the real retry plan fits the 20 s function limit', async t => {
  const calls = mockFetch(t, [200]);
  await A.loadFeed(A.FEEDS.find(f => f.id === 'nws'), Date.now(), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.accept, 'application/geo+json');
  assert.equal(calls[0].init.headers['user-agent'], A.UA);
  const worst = A.NWS_TRY.timeouts.reduce((a, b) => a + b, 0) + 2 * 2000;
  assert.ok(worst < 20000, String(worst));
});

test('get: 403, 429 and 5xx are retried, then succeed', async t => {
  for (const first of [403, 429, 503]) {
    const calls = mockFetch(t, [first, 200]);
    const r = await A.get('https://api.weather.gov/x', 'application/geo+json', FAST);
    assert.equal(r.status, 200); assert.equal(calls.length, 2, String(first));
    t.mock.restoreAll();
  }
});

test('get: network errors are retried; a persistent 403 fails after 3 tries; a 404 is not retried', async t => {
  let calls = mockFetch(t, [new Error('fetch failed'), 200]);
  assert.equal((await A.get('u', 'a', FAST)).status, 200); assert.equal(calls.length, 2);
  t.mock.restoreAll();
  calls = mockFetch(t, [403]);
  await assert.rejects(A.get('u', 'a', FAST), /HTTP 403 \(after 3 tries\)/); assert.equal(calls.length, 3);
  t.mock.restoreAll();
  calls = mockFetch(t, [404]);
  await assert.rejects(A.get('u', 'a', FAST), /^Error: HTTP 404$/); assert.equal(calls.length, 1);
  t.mock.restoreAll();
  calls = mockFetch(t, [403]);
  await assert.rejects(A.get('u', 'a'), /HTTP 403/); assert.equal(calls.length, 1, 'other feeds: one try');
});

test('refresh report counts NWS failures in a row', async t => {
  mockFetch(t, [500]);
  const nws = A.FEEDS.find(f => f.id === 'nws');
  const only = new Set(A.FEEDS.filter(f => f.id !== 'nws').map(f => f.id));
  const saved = A.NWS_TRY.waits.slice(); A.NWS_TRY.waits.splice(0, 2, 1, 1);
  try {
    const now = Date.now();
    const one = await A.refresh({}, now, only, null);
    assert.deepEqual(one.snapshot.sources.map(s => [s.id, s.ok, s.fails]), [['nws', false, 1]]);
    const two = await A.refresh(one.states, now + 3e5, only, null);
    assert.equal(two.snapshot.sources[0].fails, 2);
    t.mock.restoreAll(); mockFetch(t, [200]);
    const ok = await A.refresh(two.states, now + 6e5, only, null);
    assert.deepEqual(ok.snapshot.sources.map(s => [s.id, s.ok, s.fails]), [['nws', true, 0]]);
    assert.equal(nws.type, 'nws');
  } finally { A.NWS_TRY.waits.splice(0, 2, ...saved); }
});

test('workflow: one NWS failure warns, two in a row fail the run', { skip: !hasJq() && 'jq not installed' }, () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'refresh-alerts.yml'), 'utf8');
  const q = /nws_fails=\$\(jq -r '([^']+)' body\.json\)/.exec(yml)[1];
  const run = body => Number(execFileSync('jq', ['-r', q], { input: JSON.stringify(body) }).toString().trim());
  assert.equal(run({ sources: [{ id: 'nws', ok: true, fails: 0 }] }), 0);
  assert.equal(run({ sources: [{ id: 'nws', ok: false, fails: 1 }] }), 1);
  assert.equal(run({ sources: [{ id: 'nws', ok: false, fails: 3 }] }), 3);
  assert.equal(run({ sources: [{ id: 'nws', ok: false }] }), 2, 'an answer without the count still fails');
  assert.match(yml, /if \[ "\$nws_fails" -ge 2 \]; then echo "::error::[^"]*"; exit 1; fi/);
});
function hasJq() { try { execFileSync('jq', ['--version']); return true; } catch (_) { return false; } }
