// The short story id the page uses for hearts (public/assets/app.js storyId, cyrb53 of the story link), computed the
// same way on the server so api/news.js can record which ids are current and api/react.js only accepts those.
'use strict';
function storyId(link) {
  link = String(link || '');
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < link.length; i++) { const c = link.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'h' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
// The Redis set of current story ids, rewritten by every refresh (built under TMP, then RENAMEd over KEY).
const KEY = 'tsn:news:ids', TMP = 'tsn:news:ids:next';
// Commands that replace the set with the ids of these items.
function idsCmds(items, ttlSec) {
  const ids = [...new Set((items || []).filter(i => i && i.link).map(i => storyId(i.link)))];
  if (!ids.length) return [];
  return [['DEL', TMP], ['SADD', TMP, ...ids], ['RENAME', TMP, KEY], ['EXPIRE', KEY, String(ttlSec || 2 * 86400)]];
}
module.exports = { storyId, idsCmds, KEY };
