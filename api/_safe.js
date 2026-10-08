// Constant-time string comparison for secrets (admin key, cron secret).
const { timingSafeEqual } = require('crypto');
module.exports.same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };
