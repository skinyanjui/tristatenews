// Intentional source URL changes since the ba8b34a reference list, applied to the reference before comparing. Every
// other id, URL, kind and flag must still match exactly. Each change has its own regression test.
// 2026-10-22 (test/blox-wire.test.js): six BLOX papers moved from the unfiltered site-wide search feed, which AP wire
// copy filled (so every item was rejected as wire and the source showed nothing), to their local-news section feed.
const URL_FIXES = {
  messinq: 'https://www.messenger-inquirer.com/search/?f=rss&t=article&c=news/local&l=50&s=start_time&sd=desc',
  dcherald: 'https://www.duboiscountyherald.com/search/?f=rss&t=article&c=news/local&l=50&s=start_time&sd=desc',
  wth: 'https://www.washtimesherald.com/search/?f=rss&t=article&c[]=news/local*&l=50&s=start_time&sd=desc',
  sunc: 'https://www.suncommercial.com/search/?f=rss&t=article&c=news&l=50&s=start_time&sd=desc',
  pdclarion: 'https://www.pdclarion.com/search/?f=rss&t=article&c[]=news/local*&l=50&s=start_time&sd=desc',
  mtcarmel: 'https://www.hometownregister.com/search/?f=rss&t=article&c[]=news/local*&l=50&s=start_time&sd=desc',
};
const fixOne = s => (s && URL_FIXES[s.id] ? Object.assign({}, s, { url: URL_FIXES[s.id] }) : s);
const fix = list => (list || []).map(fixOne);
const RAW = require('./sources-ba8b34a.json');
module.exports = { URL_FIXES, fix, fixOne, current: { active: fix(RAW.active), disabled: fix(RAW.disabled) } };
