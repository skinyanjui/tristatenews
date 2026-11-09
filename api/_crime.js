// Crime / Police & courts: comments off. Matcher is public/crime.js (also window.TSNCrime on the page).
// Unknown metadata fail closed (caller).
'use strict';
const C = require('../public/crime.js');
const BLOCKED_KINDS = new Set(['police', 'courts', 'obits', 'events']);

// meta: { kind, title, summary, link } from the trusted snapshot (tsn:news:meta), never from the client.
// Missing kind, missing meta, police/courts, or a crime headline/dek/slug → comments are not allowed.
function commentsBlocked(meta) {
  if (!meta || typeof meta !== 'object') return true;
  const kind = String(meta.kind || '');
  if (!kind || BLOCKED_KINDS.has(kind)) return true;
  if (kind !== 'news' && kind !== 'institution') return true;
  return C.crimeStory(meta);
}

module.exports = Object.assign({ BLOCKED_KINDS, commentsBlocked }, C);
