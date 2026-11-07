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
// 2026-11-07 (test/ship110-news-timing.test.js): publishers in Eastern-time places carry their zone (tz, right after
// area) for feed dates written without one, and the FBI field offices are polled hourly (everyMin, before url) instead
// of every 10 minutes.
const IND_VIN = 'America/Indiana/Vincennes', IND_IND = 'America/Indiana/Indianapolis';
const TZ_FIXES = {
  dcherald: IND_VIN, wth: IND_VIN, wthi: IND_IND, sunc: IND_VIN, 'ob-dcherald': IND_VIN, 'ob-sunc': IND_VIN, 'ob-nass': IND_VIN,
  'ob-becher': IND_VIN, 'ob-goodwin': IND_VIN, 'ob-duesterberg': IND_VIN, 'ev-vin': IND_VIN,
  inchron: IND_IND, usaosdin: IND_IND, fbiind: IND_IND, kylantern: 'America/New_York',
  usaowdky: 'America/Kentucky/Louisville', fbilou: 'America/Kentucky/Louisville',
};
const EVERY_FIXES = { fbilou: 60, fbiind: 60, fbispr: 60 };
const insertAfter = (o, after, k, v) => { const out = {}; for (const [kk, vv] of Object.entries(o)) { out[kk] = vv; if (kk === after) out[k] = v; } return out; };
const fixOne = s => {
  if (!s) return s;
  let o = URL_FIXES[s.id] ? Object.assign({}, s, { url: URL_FIXES[s.id] }) : s;
  if (TZ_FIXES[s.id]) o = insertAfter(o, 'area', 'tz', TZ_FIXES[s.id]);
  if (EVERY_FIXES[s.id]) o = insertAfter(o, 'maxAgeDays' in o ? 'maxAgeDays' : 'area', 'everyMin', EVERY_FIXES[s.id]);
  return o;
};
const fix = list => (list || []).map(fixOne);
const RAW = require('./sources-ba8b34a.json');
module.exports = { URL_FIXES, TZ_FIXES, EVERY_FIXES, fix, fixOne, current: { active: fix(RAW.active), disabled: fix(RAW.disabled) } };
