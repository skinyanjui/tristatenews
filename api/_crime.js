// Crime / Police & courts headlines: comments are off. The regex is copied from public/assets/app.js
// (crimeStory): headline words only, so a sports "shooting guard" keeps comments and its photo.
// Unknown metadata must fail closed (caller).
'use strict';
const CRIME_RE = /\b(?:murder(?:s|ed|er|ers)?|homicides?|manslaughter|sex offenders?|rap(?:e|ed|ist)|sexual(?:ly)? assault(?:ed)?|molest(?:ed|ation|ing)?|arrest(?:s|ed)?|charged|charges|indicted|indictment|accused|suspects?|mugshots?|convicted|sentenced|in custody|booked|jailed|inmates?|warrants?|wanted|kidnapp(?:ed|ing)|abduct(?:ed|ion)|stabb(?:ed|ing)|robber(?:y|ies)|burglar(?:y|ies)|carjack(?:ed|ing)|shooting(?! (?:guard|percentage|woes|slump|touch|clinic|range|star))|shot and killed|fatally shot|deputies say|police say)\b/i;
const BLOCKED_KINDS = new Set(['police', 'courts', 'obits', 'events']);

function crimeTitle(title) { return CRIME_RE.test(String(title || '')); }

// meta: { kind, title } from the trusted snapshot (tsn:news:meta), never from the client.
// Missing kind, missing meta, police/courts, or a crime headline → comments are not allowed.
function commentsBlocked(meta) {
  if (!meta || typeof meta !== 'object') return true;
  const kind = String(meta.kind || '');
  if (!kind || BLOCKED_KINDS.has(kind)) return true;
  if (kind !== 'news' && kind !== 'institution') return true;
  return crimeTitle(meta.title);
}

module.exports = { CRIME_RE, crimeTitle, commentsBlocked, BLOCKED_KINDS };
