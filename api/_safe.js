// Small security helpers shared by the API modules.
//   same(a, b)                    constant-time string comparison for secrets (admin key, cron secret)
//   safeFetch(url, init, opts)    fetch for publisher URLs: http/https only, no credentials in the URL, and no private,
//                                 loopback, link-local, CGNAT, multicast or cloud-metadata address (checked after DNS
//                                 resolution, on every redirect hop); at most 3 redirects, each one re-checked
//   readCapped(res, maxBytes)     the body as text, refusing anything over maxBytes (Content-Length first, then while
//                                 streaming, so an oversize body is never held in memory)
//   isPrivateAddress(ip)          the address test used by the guard
// Errors carry a code: ERR_URL_INVALID, ERR_URL_BLOCKED, ERR_DNS, ERR_TOO_MANY_REDIRECTS, ERR_BODY_TOO_LARGE.
const { timingSafeEqual } = require('crypto');
const dns = require('dns');
const net = require('net');

module.exports.same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };

const fail = (code, message) => Object.assign(new Error(message), { code });

// ---------- address test ----------
const V4_BLOCKED = [ // [network, prefix length]
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([n, p]) => [v4int(n), p]);
// Not blocked on purpose: 198.18.0.0/15 (RFC 2544 benchmarking). Transparent proxies answer DNS with fake IPs from that
// range (the build box resolves every host to 198.18.0.1), and nothing internal lives there on Vercel.

function v4int(ip) { return ip.split('.').reduce((a, o) => a * 256 + Number(o), 0); }
function v4blocked(ip) {
  const x = v4int(ip);
  return V4_BLOCKED.some(([n, p]) => Math.floor(x / 2 ** (32 - p)) === Math.floor(n / 2 ** (32 - p)));
}
// IPv6 as 8 16-bit groups (handles "::" and a dotted IPv4 tail).
function v6groups(ip) {
  ip = ip.replace(/%.*$/, '').toLowerCase();
  const tail = ip.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) { const x = v4int(tail[1]); ip = ip.slice(0, -tail[1].length) + (x >>> 16).toString(16) + ':' + (x & 0xffff).toString(16); }
  const [head, rest] = ip.split('::');
  const h = head ? head.split(':') : [], r = rest !== undefined && rest ? rest.split(':') : [];
  const fill = rest !== undefined ? Array(8 - h.length - r.length).fill('0') : [];
  return h.concat(fill, r).map(g => parseInt(g || '0', 16));
}
function isPrivateAddress(ip) {
  ip = String(ip || '').replace(/^\[|\]$/g, '');
  const kind = net.isIP(ip.replace(/%.*$/, ''));
  if (kind === 4) return v4blocked(ip);
  if (kind !== 6) return true; // not an address at all: refuse
  const g = v6groups(ip);
  if (g.length !== 8 || g.some(x => !Number.isFinite(x))) return true;
  const v4 = (a, b) => [a >> 8, a & 255, b >> 8, b & 255].join('.');
  if (g.slice(0, 7).every(x => x === 0) && (g[7] === 0 || g[7] === 1)) return true;           // :: and ::1
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return v4blocked(v4(g[6], g[7]));  // ::ffff:a.b.c.d
  if (g.slice(0, 6).every(x => x === 0)) return true;                                           // ::a.b.c.d (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;                                            // 64:ff9b::/96 NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                                  // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true;                                                  // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true;                                                  // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                                          // 2001:db8::/32 documentation
  if (g[0] === 0x2002) return v4blocked(v4(g[1], g[2]));                                        // 6to4 wrapping a private v4
  return false;
}

// ---------- URL guard ----------
// guard.lookup is the DNS resolver (tests replace it). Answers are cached per host for a minute, so the many Google
// News sources and same-host feeds of one refresh resolve once.
const guard = {
  lookup: host => dns.promises.lookup(host, { all: true, verbatim: true }),
  cacheMs: 60e3,
  lookupTimeoutMs: 5000,
};
const dnsCache = new Map();
function clearDnsCache() { dnsCache.clear(); }

function withSignal(p, signal, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(fail('ERR_DNS', 'DNS timeout')), ms);
    const onAbort = () => { clearTimeout(t); reject(signal.reason || fail('ERR_DNS', 'aborted')); };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
    p.then(v => { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); resolve(v); },
      e => { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); reject(e); });
  });
}

async function resolve(host, signal) {
  const hit = dnsCache.get(host);
  if (hit && hit.until > Date.now()) return hit.addrs;
  let addrs;
  try { addrs = await withSignal(Promise.resolve(guard.lookup(host)), signal, guard.lookupTimeoutMs); } catch (e) {
    if (e && e.code === 'ERR_DNS') throw e;
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw e;
    throw fail('ERR_DNS', 'DNS ' + ((e && e.code) || 'error') + ' ' + host);
  }
  addrs = (Array.isArray(addrs) ? addrs : [addrs]).map(a => (typeof a === 'string' ? a : a && a.address)).filter(Boolean);
  if (!addrs.length) throw fail('ERR_DNS', 'DNS no address ' + host);
  dnsCache.set(host, { addrs, until: Date.now() + guard.cacheMs });
  return addrs;
}

// Resolves to the parsed URL when it may be fetched; throws a coded error otherwise.
async function checkUrl(url, signal) {
  let u;
  try { u = new URL(String(url)); } catch (_) { throw fail('ERR_URL_INVALID', 'invalid URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw fail('ERR_URL_BLOCKED', 'blocked protocol ' + u.protocol);
  if (u.username || u.password) throw fail('ERR_URL_BLOCKED', 'credentials in URL');
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) throw fail('ERR_URL_BLOCKED', 'blocked host ' + host);
  if (net.isIP(host)) { if (isPrivateAddress(host)) throw fail('ERR_URL_BLOCKED', 'blocked address ' + host); return u; }
  const addrs = await resolve(host, signal);
  const bad = addrs.find(isPrivateAddress);
  if (bad) throw fail('ERR_URL_BLOCKED', 'blocked address ' + bad + ' for ' + host);
  return u;
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);
// Same contract as fetch(url, init) with redirect: 'follow', except that every hop is checked by checkUrl and at most
// opts.maxRedirects (default 3) are followed. The Response's url is that of the last hop (finalUrl).
async function safeFetch(url, init, opts) {
  init = Object.assign({}, init || {});
  const max = opts && Number.isInteger(opts.maxRedirects) ? opts.maxRedirects : 3;
  let current = String(url);
  for (let hop = 0; ; hop++) {
    const u = await checkUrl(current, init.signal);
    const res = await globalThis.fetch(u.href, Object.assign({}, init, { redirect: 'manual' }));
    const loc = REDIRECT.has(res.status) && res.headers.get('location');
    if (!loc) { try { Object.defineProperty(res, 'finalUrl', { value: u.href }); } catch (_) { /* frozen */ } return res; }
    try { if (res.body) await res.body.cancel(); } catch (_) { /* nothing to drain */ }
    if (hop >= max) throw fail('ERR_TOO_MANY_REDIRECTS', 'more than ' + max + ' redirects');
    let next;
    try { next = new URL(loc, u).href; } catch (_) { throw fail('ERR_URL_INVALID', 'invalid redirect'); }
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && init.method && init.method.toUpperCase() === 'POST')) {
      init.method = 'GET'; delete init.body;
    }
    current = next;
  }
}

// The body as a string (UTF-8, like Response.text()), or ERR_BODY_TOO_LARGE past maxBytes.
async function readCapped(res, maxBytes) {
  const len = Number(res.headers && res.headers.get('content-length'));
  if (Number.isFinite(len) && len > maxBytes) {
    try { if (res.body) await res.body.cancel(); } catch (_) { /* ignore */ }
    throw fail('ERR_BODY_TOO_LARGE', 'body over ' + maxBytes + ' bytes');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      try { await reader.cancel(); } catch (_) { /* ignore */ }
      throw fail('ERR_BODY_TOO_LARGE', 'body over ' + maxBytes + ' bytes');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength))));
}

module.exports.isPrivateAddress = isPrivateAddress;
module.exports.checkUrl = checkUrl;
module.exports.safeFetch = safeFetch;
module.exports.readCapped = readCapped;
module.exports.guard = guard;
module.exports.clearDnsCache = clearDnsCache;
