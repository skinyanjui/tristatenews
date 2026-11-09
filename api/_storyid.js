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
// META is the trusted kind/title/summary/link for comments (api/_comments.js): never take the client's category.
const KEY = 'tsn:news:ids', TMP = 'tsn:news:ids:next', META = 'tsn:news:meta';
function metaOf(items, sources) {
  const kinds = {};
  (sources || []).forEach(s => { if (s && s.id) kinds[s.id] = String(s.kind || ''); });
  const out = {};
  (items || []).forEach(i => {
    if (!i || !i.link) return;
    out[storyId(i.link)] = {
      kind: kinds[i.sourceId] || '',
      title: String(i.title || ''),
      summary: String(i.summary || ''),
      link: String(i.link || ''),
      sourceId: String(i.sourceId || '')
    };
  });
  return out;
}
// Commands that replace the set with the ids of these items, and the comments allowlist hash.
function idsCmds(items, ttlSec, sources) {
  const ids = [...new Set((items || []).filter(i => i && i.link).map(i => storyId(i.link)))];
  if (!ids.length) return [];
  const ttl = String(ttlSec || 2 * 86400);
  return [
    ['DEL', TMP], ['SADD', TMP, ...ids], ['RENAME', TMP, KEY], ['EXPIRE', KEY, ttl],
    ['SET', META, JSON.stringify(metaOf(items, sources)), 'EX', ttl]
  ];
}
module.exports = { storyId, idsCmds, KEY, META, metaOf };
