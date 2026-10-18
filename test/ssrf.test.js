// PR 1.3: the outbound-fetch guard and body caps in api/_safe.js. Never touches the network: DNS answers come from a
// stub resolver (guard.lookup) and fetch is a stub that records every URL it was asked for.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../api/_safe.js');

const realLookup = S.guard.lookup, realFetch = globalThis.fetch;
function dnsTable(table) {
  const asked = [];
  S.clearDnsCache();
  S.guard.lookup = async host => { asked.push(host); if (!(host in table)) throw Object.assign(new Error('getaddrinfo ENOTFOUND ' + host), { code: 'ENOTFOUND' }); return [].concat(table[host]).map(a => ({ address: a, family: a.includes(':') ? 6 : 4 })); };
  return asked;
}
function fetchStub(routes) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = routes[String(url)];
    if (!r) return new Response('not found', { status: 404 });
    return typeof r === 'function' ? r(init) : r.clone ? r.clone() : r;
  };
  return calls;
}
test.afterEach(() => { S.guard.lookup = realLookup; globalThis.fetch = realFetch; S.clearDnsCache(); });

const redirect = (to, status = 302) => () => new Response('moved', { status, headers: { location: to } });

test('isPrivateAddress: private, loopback, link-local, metadata, CGNAT, multicast and reserved ranges are refused', () => {
  const blocked = ['0.0.0.0', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.8.9.10', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.0.0.170', '192.0.2.1', '192.168.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.251', '239.255.255.250', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1',
    '::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe', '2002:a9fe:a9fe::1', '[::1]', 'not-an-ip', ''];
  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '198.18.0.1', '198.19.255.255', '100.63.255.255', '100.128.0.1', '192.169.0.1',
    '2606:4700:4700::1111', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8', '2002:0808:0808::1'];
  for (const ip of blocked) assert.equal(S.isPrivateAddress(ip), true, ip);
  for (const ip of allowed) assert.equal(S.isPrivateAddress(ip), false, ip);
});

test('checkUrl: only http(s), no credentials, no localhost, no private literal or resolved address', async () => {
  dnsTable({ 'feeds.example.com': '93.184.216.34', 'intranet.example.com': '10.0.0.5', 'mixed.example.com': ['93.184.216.34', '127.0.0.1'], 'v6.example.com': '2606:4700::6810:85e5', 'v6priv.example.com': 'fd00::5' });
  const code = async (u) => { try { await S.checkUrl(u); return 'ok'; } catch (e) { return e.code; } };
  assert.equal(await code('https://feeds.example.com/rss'), 'ok');
  assert.equal(await code('http://feeds.example.com:8080/rss'), 'ok');
  assert.equal(await code('https://v6.example.com/'), 'ok');
  for (const u of ['ftp://feeds.example.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,hi', 'gopher://feeds.example.com/'])
    assert.equal(await code(u), 'ERR_URL_BLOCKED', u);
  for (const u of ['not a url', '', 'https://']) assert.equal(await code(u), 'ERR_URL_INVALID', JSON.stringify(u));
  for (const u of ['https://user:pw@feeds.example.com/', 'https://localhost/', 'http://LOCALHOST./', 'http://api.localhost/', 'http://127.0.0.1/', 'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/', 'http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://[::ffff:169.254.169.254]/', 'http://10.0.0.1:6379/',
    'https://intranet.example.com/', 'https://mixed.example.com/', 'https://v6priv.example.com/'])
    assert.equal(await code(u), 'ERR_URL_BLOCKED', u);
  assert.equal(await code('https://no-such-host.example/'), 'ERR_DNS');
});

test('safeFetch: a redirect to the cloud metadata address is refused before it is fetched', async () => {
  dnsTable({ 'feeds.example.com': '93.184.216.34' });
  const calls = fetchStub({ 'https://feeds.example.com/rss': redirect('http://169.254.169.254/latest/meta-data/iam/security-credentials/') });
  await assert.rejects(S.safeFetch('https://feeds.example.com/rss', {}), e => e.code === 'ERR_URL_BLOCKED' && /169\.254\.169\.254/.test(e.message));
  assert.deepEqual(calls.map(c => c.url), ['https://feeds.example.com/rss'], 'the metadata URL was never requested');
});

test('safeFetch: a redirect to a name that resolves to a private address is refused', async () => {
  dnsTable({ 'feeds.example.com': '93.184.216.34', 'rebind.example.net': '192.168.1.10' });
  const calls = fetchStub({ 'https://feeds.example.com/rss': redirect('https://rebind.example.net/admin', 301) });
  await assert.rejects(S.safeFetch('https://feeds.example.com/rss'), { code: 'ERR_URL_BLOCKED' });
  assert.equal(calls.length, 1);
});

test('safeFetch: follows up to 3 redirects (relative ones too), each re-checked, keeping headers and signal', async () => {
  const asked = dnsTable({ 'a.example.com': '93.184.216.34', 'b.example.com': '93.184.216.35', 'c.example.com': '93.184.216.36' });
  const calls = fetchStub({
    'https://a.example.com/feed': redirect('https://b.example.com/feed', 301),
    'https://b.example.com/feed': redirect('/feed.xml', 307),
    'https://b.example.com/feed.xml': redirect('https://c.example.com/rss', 308),
    'https://c.example.com/rss': () => new Response('<rss/>', { status: 200, headers: { etag: '"x"' } }),
  });
  const signal = AbortSignal.timeout(10000);
  const r = await S.safeFetch('https://a.example.com/feed', { headers: { 'user-agent': 'UA', 'if-none-match': '"old"' }, signal });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<rss/>');
  assert.equal(r.finalUrl, 'https://c.example.com/rss');
  assert.deepEqual(calls.map(c => c.url), ['https://a.example.com/feed', 'https://b.example.com/feed', 'https://b.example.com/feed.xml', 'https://c.example.com/rss']);
  for (const c of calls) { assert.equal(c.init.redirect, 'manual'); assert.equal(c.init.headers['user-agent'], 'UA'); assert.equal(c.init.signal, signal); }
  assert.deepEqual(asked, ['a.example.com', 'b.example.com', 'c.example.com'], 'b.example.com resolved once (cached)');
});

test('safeFetch: a 4th redirect is refused; maxRedirects is configurable', async () => {
  dnsTable({ 'loop.example.com': '93.184.216.34' });
  const routes = {}; for (let i = 0; i < 6; i++) routes['https://loop.example.com/' + i] = redirect('https://loop.example.com/' + (i + 1));
  routes['https://loop.example.com/6'] = () => new Response('end', { status: 200 });
  let calls = fetchStub(routes);
  await assert.rejects(S.safeFetch('https://loop.example.com/0'), { code: 'ERR_TOO_MANY_REDIRECTS' });
  assert.equal(calls.length, 4, 'the original request and 3 redirects');
  calls = fetchStub(routes);
  assert.equal((await S.safeFetch('https://loop.example.com/3')).status, 200, 'exactly 3 redirects is fine');
  calls = fetchStub(routes);
  await assert.rejects(S.safeFetch('https://loop.example.com/5', {}, { maxRedirects: 0 }), { code: 'ERR_TOO_MANY_REDIRECTS' });
});

test('safeFetch: non-redirect answers (304, 403, 429, 500, 3xx without Location) come back as they are', async () => {
  dnsTable({ 'feeds.example.com': '93.184.216.34' });
  for (const status of [200, 304, 403, 404, 429, 500, 503, 300]) {
    fetchStub({ 'https://feeds.example.com/x': () => new Response(status === 304 ? null : 'b', { status }) });
    assert.equal((await S.safeFetch('https://feeds.example.com/x')).status, status);
  }
});

test('safeFetch: a guard refusal never calls fetch; DNS errors and timeouts are coded', async () => {
  dnsTable({});
  const calls = fetchStub({});
  await assert.rejects(S.safeFetch('http://127.0.0.1:8080/'), { code: 'ERR_URL_BLOCKED' });
  await assert.rejects(S.safeFetch('https://gone.example.com/'), e => e.code === 'ERR_DNS' && /ENOTFOUND/.test(e.message));
  S.guard.lookup = () => new Promise(() => {});
  const saved = S.guard.lookupTimeoutMs; S.guard.lookupTimeoutMs = 30;
  try { await assert.rejects(S.safeFetch('https://slow.example.com/'), { code: 'ERR_DNS' }); } finally { S.guard.lookupTimeoutMs = saved; }
  const ac = new AbortController(); ac.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  await assert.rejects(S.safeFetch('https://slow2.example.com/', { signal: ac.signal }), { name: 'TimeoutError' });
  assert.equal(calls.length, 0);
});

const streamOf = (chunks) => new ReadableStream({ pull(c) { const x = chunks.shift(); if (x === undefined) c.close(); else c.enqueue(typeof x === 'string' ? new TextEncoder().encode(x) : x); } });

test('readCapped: an oversize body is refused by Content-Length before reading, or while streaming', async () => {
  let pulled = 0;
  const big = new Response(new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); } }), { headers: { 'content-length': String(5 * 1024 * 1024) } });
  await assert.rejects(S.readCapped(big, 4 * 1024 * 1024), { code: 'ERR_BODY_TOO_LARGE' });
  assert.ok(pulled <= 1, 'not read: ' + pulled);
  // no Content-Length (chunked): stops as soon as the cap is passed, without buffering the rest
  let sent = 0;
  const endless = new Response(new ReadableStream({ pull(c) { sent++; c.enqueue(new Uint8Array(64 * 1024)); } }));
  await assert.rejects(S.readCapped(endless, 1024 * 1024), { code: 'ERR_BODY_TOO_LARGE' });
  assert.ok(sent <= 18, 'stopped after the cap: ' + sent + ' chunks');
  // a lying Content-Length (smaller than the body) is still caught while streaming
  const liar = new Response(streamOf(['x'.repeat(600), 'y'.repeat(600)]), { headers: { 'content-length': '10' } });
  await assert.rejects(S.readCapped(liar, 1000), { code: 'ERR_BODY_TOO_LARGE' });
});

test('readCapped: under the cap it returns exactly what Response.text() would', async () => {
  const bodies = ['', '<rss><item><title>Évansville café — “quotes” 🙂</title></item></rss>', '\ufeff<?xml version="1.0"?><rss/>', 'a'.repeat(100000)];
  for (const b of bodies) {
    const bytes = new TextEncoder().encode(b);
    const split = [bytes.slice(0, 3), bytes.slice(3, 7), bytes.slice(7)]; // splits multi-byte characters across chunks
    assert.equal(await S.readCapped(new Response(streamOf(split.filter(x => x.length))), 200000), await new Response(b).text());
  }
  const bad = new Uint8Array([0x3c, 0x61, 0xff, 0xfe, 0x3e]);
  assert.equal(await S.readCapped(new Response(bad), 100), await new Response(bad).text(), 'invalid UTF-8 replaced the same way');
  assert.equal(await S.readCapped(new Response(null, { status: 304 }), 100), '');
  assert.equal(await S.readCapped(new Response('exactly10!'), 10), 'exactly10!', 'a body of exactly the cap is fine');
});

test('same() is unchanged', () => {
  assert.equal(S.same('Bearer abc', 'Bearer abc'), true);
  assert.equal(S.same('Bearer abc', 'Bearer abd'), false);
  assert.equal(S.same('', ''), false);
  assert.equal(S.same(undefined, 'x'), false);
});
