// One-line error logs for the function log (Vercel). Never the request body, headers, env or a full URL: the message
// is trimmed, addresses and emails in it are masked, and only the fields a caller passes (ids, types) are added.
'use strict';
function scrub(s) {
  return String(s == null ? '' : s)
    .replace(/https?:\/\/([^/\s?#]+)[^\s]*/gi, 'https://$1/…')
    .replace(/[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b(Bearer|token|key|secret)[=:\s]+\S+/gi, '$1 [hidden]')
    .slice(0, 300);
}
// where: the endpoint or step ("listings", "stripe-webhook"); extra: { id, type, ... } (no personal data).
function fail(where, e, extra) {
  try {
    const msg = scrub(e && (e.message || e.code) || e);
    const name = e && e.name && e.name !== 'Error' ? e.name + ': ' : '';
    const bits = extra ? Object.keys(extra).filter(k => extra[k] != null && extra[k] !== '').map(k => k + '=' + scrub(extra[k]).slice(0, 80)) : [];
    console.error('[tsn] ' + where + ' failed: ' + name + msg + (bits.length ? ' (' + bits.join(' ') + ')' : ''));
  } catch (_) { /* logging must never throw */ }
}
module.exports = { fail, scrub };
