'use strict';
// ship123: news-sourced obituaries route to /obituaries, not the News feed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'REDIS_URL', 'EXTRA_FEEDS']) delete process.env[k];

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const N = require('../api/news.js');
const O = require('../public/obit.js');
const Cards = require('../api/_cards.js');
const Src = require('../api/_sources.js');
const { storyId } = require('../api/_storyid.js');

const MORRIS = {
  id: 'gn-hamilton-54',
  title: 'Marilyn Kay Morris, age 73, of Montgomery, TX (formerly of McLeansboro)',
  summary: 'Marilyn Kay Morris, age 73, of Montgomery, TX (formerly of McLeansboro), passed away.',
  link: 'https://news.google.com/rss/articles/CBMipwFBVV95cUxNSFZyN1NQdWJYSzRJX2xXZW1Xd3hUM1RQRzh2YWlKLTFIREJzTlV6Z0s2VDZJWVlUNW9qOU5tMmRualFUb0kyX2RMVW9yMHhmZU9jaUU2UjhZdkhnMVRPWmYtNEE3Rkd5amdKajZOMHlUVllqT2JqcHlGS3FvZGdKUWpVcWp2OUdGYUxfekc0alo5bXVHUG10S1Z3aTljTm1FS1VlbzVMSQ?oc=5',
  published: '2026-11-09T18:00:00Z',
  source: 'Hamilton County news',
  sourceId: 'gn-hamilton'
};
const BENNY = {
  id: 'leadernews-13',
  title: 'Benny M. Shepherd',
  summary: 'GREENVILLE – Mr. Benny M. Shepherd, Jr, age 68, of Greenville, passed away on Friday, November 6, 2026 at Heartford Hous',
  link: 'https://ky-leadernews.com/benny-m-shepherd/',
  published: '2026-11-07T12:00:00Z',
  source: 'Leader-News',
  sourceId: 'leadernews'
};
const NEWS = {
  id: 'n-1',
  title: 'Council passes riverfront plan',
  summary: 'A zoning vote downtown.',
  link: 'https://n.ex/river',
  published: '2026-11-09T17:00:00Z',
  source: 'N',
  sourceId: 'n'
};

test('ship123: classifier routes Morris and Benny via shared detector', () => {
  assert.equal(O.obitStory(MORRIS), true);
  assert.equal(N.looksLikeObit(MORRIS), true);
  assert.equal(storyId(MORRIS.link), 'h1aswpu1o2xx');
  assert.equal(O.obitStory(BENNY), true);
  assert.equal(N.looksLikeObit(BENNY), true);
  const gn = { id: 'gn-hamilton', name: 'Hamilton County', area: 'McLeansboro' };
  const out = N.combine([{ source: gn, items: [MORRIS, NEWS] }], Date.now());
  const news = out.filter(i => !i.isObit);
  const ob = out.filter(i => i.isObit);
  assert.deepEqual(news.map(i => i.title), ['Council passes riverfront plan']);
  assert.equal(ob.length, 1);
  assert.equal(ob[0].sourceId, 'ob-gn-hamilton');
  assert.equal(ob[0].source, 'Hamilton County news');
  assert.equal(ob[0].image, '');
  assert.match(ob[0].link, /google\.com|CBMipw/);
});

test('ship123: page remount moves stored news-kind obits onto Obituaries', () => {
  const snap = {
    updatedAt: '2026-11-09T20:00:00Z',
    sources: [
      { id: 'gn-hamilton', name: 'Hamilton County', kind: 'news' },
      { id: 'leadernews', name: 'Leader-News', kind: 'news' },
      { id: 'n', name: 'N', kind: 'news' },
      { id: 'ob-messinq', name: 'Messenger-Inquirer', kind: 'obits' }
    ],
    items: [
      MORRIS,
      BENNY,
      NEWS,
      {
        id: 'ob-1',
        title: 'Jane Doe',
        summary: 'Jane Doe, 80, of Evansville, passed away.',
        link: 'https://obits.ex/jane',
        published: '2026-11-08T10:00:00Z',
        source: 'Messenger-Inquirer',
        sourceId: 'ob-messinq'
      }
    ]
  };
  const p = N.page(snap);
  const titlesNews = p.items.filter(i => {
    const s = snap.sources.find(x => x.id === i.sourceId);
    const k = s && s.kind ? s.kind : (/^ob-/.test(i.sourceId) ? 'obits' : 'news');
    return k === 'news';
  }).map(i => i.title);
  assert.ok(titlesNews.includes('Council passes riverfront plan'));
  assert.ok(!titlesNews.some(t => /Marilyn Kay Morris|Benny M\. Shepherd/.test(t)));
  const obits = p.items.filter(i => /^ob-/.test(i.sourceId) || (snap.sources.find(x => x.id === i.sourceId) || {}).kind === 'obits');
  assert.ok(obits.some(i => /Marilyn Kay Morris/.test(i.title) && i.sourceId === 'ob-gn-hamilton'));
  assert.ok(obits.some(i => /Benny M\. Shepherd/.test(i.title) && i.sourceId === 'ob-leadernews'));
  assert.ok(obits.some(i => i.title === 'Jane Doe'));
});

test('ship123: Cards.pick excludes obits from News and includes them on Obituaries', () => {
  const view = {
    updatedAt: '2026-11-09T20:00:00Z',
    sources: [
      { id: 'gn-hamilton', name: 'Hamilton County', kind: 'news' },
      { id: 'n', name: 'N', kind: 'news' }
    ],
    items: [MORRIS, NEWS]
  };
  const news = Cards.pick(view, 'news', Date.parse('2026-11-09T22:00:00Z'));
  assert.ok(news);
  assert.ok(news.shown.every(i => !/Marilyn Kay Morris/.test(i.title)));
  assert.ok(news.shown.some(i => /riverfront/.test(i.title)));
  const ob = Cards.pick(view, 'obits', Date.parse('2026-11-09T22:00:00Z'));
  assert.ok(ob);
  assert.ok(ob.shown.some(i => /Marilyn Kay Morris/.test(i.title)));
  const html = Cards.cards(ob, Date.parse('2026-11-09T22:00:00Z'));
  assert.match(html, /Marilyn Kay Morris/);
  assert.doesNotMatch(html, /cm-btn/);
});

test('ship123: strong URL/host signals; title false positives stay clear', () => {
  assert.equal(O.obitUrl({ link: 'https://paper.example/obits/jane-doe' }), true);
  assert.equal(O.obitUrl({ link: 'https://www.legacy.com/us/obituaries/x/name/id' }), true);
  assert.equal(O.obitUrl({ link: 'https://www.ziemerfuneralhome.com/obituary/jane' }), true);
  assert.equal(O.obitUrl({ link: 'https://tributes.com/obituary/show/Jane-Doe-123' }), true);
  assert.equal(O.obitFeedUrl('https://news.google.com/rss/search?q=site%3Apaper.com%2Fobituaries%20when%3A3d'), true);
  assert.equal(O.obitFeedUrl('https://www.davisfuneralhome.com/rss.xml'), true);
  for (const title of [
    'New policy requires age 18 and older to attend',
    'Voters must be age 21 to purchase cannabis',
    'Funeral home fire destroys historic building',
    'School sets visitation day for incoming freshmen',
    'The plant, formerly of Evansville, is relocating'
  ]) {
    assert.equal(O.obitStory({ title }), false, title);
    assert.equal(N.looksLikeObit({ title, summary: '', link: 'https://news.example/story' }), false, title);
  }
});

test('ship123: registry maps funeral-home and /obituaries feeds to kind obits', () => {
  assert.equal(Src.obitFeedSource({ url: 'https://www.ziemerfuneralhome.com/rss.xml', funeralHome: true }), true);
  assert.equal(Src.obitFeedSource({ url: 'https://www.owensborotimes.com/obituaries/feed/' }), true);
  assert.equal(Src.obitFeedSource({ url: 'https://14news.com/feed/' }), false);
  const mapped = Src.registry([{ file: 't', sources: [
    { seq: 1, id: 'fh1', name: 'FH', area: 'E', url: 'https://www.examplefuneralhome.com/rss.xml' },
    { seq: 2, id: 'news1', name: 'News', area: 'E', url: 'https://paper.example/feed/' }
  ] }]);
  assert.equal(mapped.find(s => s.id === 'fh1').kind, 'obits');
  assert.equal(mapped.find(s => s.id === 'news1').kind, undefined);
});

test('ship123: client filters news-kind soft obits out of News and into Obituaries', () => {
  const js = read('public/assets/app.js');
  assert.match(js, /function itemKind\(it\)/);
  assert.match(js, /if \(obitStory\(it\)\) return 'obits'/);
  assert.match(js, /if \(cat === 'obits'\) return k === 'obits'/);
  assert.match(read('api/news.js'), /remountNewsObits/);
  assert.match(read('api/newsletter.js'), /Obit\.obitStory/);
});
