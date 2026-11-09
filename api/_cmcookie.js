// First-party comment ownership cookie. Opaque 32-byte token; Redis stores sha256 only. No HMAC secret.
'use strict';
const crypto = require('crypto');

const MAX_AGE = 180 * 86400;
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1']);
const CANON = new Set(['www.tristatenow.com', 'tristatenow.com']);
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function hostOf(req) {
  return String((req && req.headers && req.headers.host) || '').split(',')[0].trim().split(':')[0].toLowerCase();
}

function isLoopback(req) { return LOCAL.has(hostOf(req)); }

// Secure/__Host- only when we are really on HTTPS for this site — not a bare X-Forwarded-Proto spoof.
function cookieSecure(req) {
  if (isLoopback(req)) return false;
  const proto = String((req.headers && req.headers['x-forwarded-proto']) || '').split(',')[0].trim().toLowerCase();
  if (proto !== 'https') return false;
  const vercel = !!(req.headers['x-vercel-id'] || req.headers['x-vercel-deployment-url']);
  return vercel || CANON.has(hostOf(req));
}

function cookieName(req) { return cookieSecure(req) ? '__Host-tsn_cm' : 'tsn_cm'; }

function newToken() { return crypto.randomBytes(32).toString('base64url'); }

function tokenHash(token) { return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex'); }

function hashesEqual(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function validToken(found) {
  if (!TOKEN_RE.test(found)) return null;
  let buf;
  try { buf = Buffer.from(found, 'base64url'); } catch (_) { return null; }
  if (buf.length !== 32) return null;
  return found;
}

function pickCookie(s, name) {
  const parts = s.split(';');
  let found = null, n = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i], eq = p.indexOf('=');
    if (eq < 0) continue;
    if (p.slice(0, eq).trim() !== name) continue;
    n++;
    found = p.slice(eq + 1).trim();
  }
  if (n > 1) return null;
  if (n === 1) return validToken(found);
  return undefined;
}

function readToken(req) {
  const raw = req && req.headers && req.headers.cookie;
  if (raw == null) return null;
  const s = String(raw);
  if (s.length > 4096) return null;
  const primary = cookieName(req);
  const main = pickCookie(s, primary);
  if (main) return main;
  if (main === null) return null;
  if (primary === '__Host-tsn_cm') {
    const legacy = pickCookie(s, 'tsn_cm');
    if (legacy) return legacy;
  }
  return null;
}

function shouldMigrate(req) {
  if (!cookieSecure(req)) return false;
  const raw = req && req.headers && req.headers.cookie;
  if (raw == null) return false;
  const s = String(raw);
  if (s.length > 4096) return false;
  const host = pickCookie(s, '__Host-tsn_cm');
  if (host) return false;
  return !!pickCookie(s, 'tsn_cm');
}

function setCookieHeader(req, token) {
  const secure = cookieSecure(req);
  const name = cookieName(req);
  let v = name + '=' + token + '; Path=/; Max-Age=' + MAX_AGE + '; HttpOnly; SameSite=Lax';
  if (secure) v += '; Secure';
  return v;
}

module.exports = {
  MAX_AGE, cookieSecure, cookieName, newToken, tokenHash, hashesEqual, readToken, setCookieHeader, shouldMigrate
};
