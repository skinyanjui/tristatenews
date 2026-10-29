// The client's IP address for rate limits, from the headers Vercel's edge sets: x-real-ip first, then
// x-vercel-forwarded-for, then the first x-forwarded-for entry (local server, other hosts). Kept to IP characters
// and 45 long (the longest IPv6 text form). '' when none is present; callers pick their own fallback.
// ipHash(ip, salt) is a keyed hash of it, so rate-limit keys in the store never hold a reader's address.
'use strict';
const crypto = require('crypto');
const first = v => String(Array.isArray(v) ? v[0] : v || '').split(',')[0].trim().replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45);
function clientIp(req) {
  const h = (req && req.headers) || {};
  return first(h['x-real-ip']) || first(h['x-vercel-forwarded-for']) || first(h['x-forwarded-for']);
}
const HASH_KEY = () => process.env.LISTINGS_ADMIN_KEY || process.env.CRON_SECRET || 'tsn-ip';
function ipHash(ip, salt) { return crypto.createHmac('sha256', HASH_KEY()).update(String(salt || '') + '|' + String(ip || '')).digest('hex').slice(0, 24); }
module.exports = { clientIp, ipHash };
