// The client's IP address for rate limits, from the headers Vercel's edge sets: x-real-ip first, then
// x-vercel-forwarded-for, then the first x-forwarded-for entry (local server, other hosts). Kept to IP characters
// and 45 long (the longest IPv6 text form). '' when none is present; callers pick their own fallback.
// ipHash(ip, salt) is a keyed hash of it, so rate-limit keys in the store never hold a reader's address.
// rlId(ip, purpose) is that hash for one endpoint's daily rate-limit counter (thresholds and TTLs stay with the caller).
// The key is a server-only secret: the admin key, else the cron secret, else the store's own token (always set when
// there is a store to hold the keys); the constant is only for local runs without any of them.
'use strict';
const crypto = require('crypto');
const first = v => String(Array.isArray(v) ? v[0] : v || '').split(',')[0].trim().replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45);
function clientIp(req) {
  const h = (req && req.headers) || {};
  return first(h['x-real-ip']) || first(h['x-vercel-forwarded-for']) || first(h['x-forwarded-for']);
}
const HASH_KEY = (e = process.env) => e.LISTINGS_ADMIN_KEY || e.CRON_SECRET || e.UPSTASH_REDIS_REST_TOKEN || e.KV_REST_API_TOKEN || 'tsn-ip';
function ipHash(ip, salt) { return crypto.createHmac('sha256', HASH_KEY()).update(String(salt || '') + '|' + String(ip || '')).digest('hex').slice(0, 24); }
const rlId = (ip, purpose) => ipHash(ip, 'rl|' + purpose);
module.exports = { clientIp, ipHash, rlId };
