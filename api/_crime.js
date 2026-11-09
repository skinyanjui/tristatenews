// Crime / Police & courts / obituaries: comments off. Matchers are public/crime.js and public/obit.js
// (also window.TSNCrime / window.TSNObit on the page). Unknown metadata fail closed (caller).
'use strict';
const C = require('../public/crime.js');
const O = require('../public/obit.js');
const BLOCKED_KINDS = new Set(['police', 'courts', 'obits', 'events']);

// meta: { kind, title, summary, link, sourceId, source } from the trusted snapshot (tsn:news:meta), never from the client.
// Missing kind, missing meta, police/courts/obits/events, crime headline/dek/slug, or obituary signals → comments off.
function commentsBlocked(meta) {
  if (!meta || typeof meta !== 'object') return true;
  const kind = String(meta.kind || '');
  if (!kind || BLOCKED_KINDS.has(kind)) return true;
  if (kind !== 'news' && kind !== 'institution') return true;
  if (C.crimeStory(meta)) return true;
  if (O.obitStory(meta)) return true;
  return false;
}

module.exports = Object.assign({ BLOCKED_KINDS, commentsBlocked, obitStory: O.obitStory, obitTitle: O.obitTitle }, C, O);
