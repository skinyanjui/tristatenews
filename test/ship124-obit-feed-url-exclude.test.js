'use strict';
// ship124: Google News "-obituary" exclusions are not obituary feeds; slug hints don't double-count.
const test = require('node:test');
const assert = require('node:assert/strict');
for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'REDIS_URL', 'EXTRA_FEEDS']) delete process.env[k];

const O = require('../public/obit.js');
const N = require('../api/news.js');
const Src = require('../api/_sources.js');
const Cards = require('../api/_cards.js');
const batch3 = require('../data/sources/batches/batch-3.json');

const GN_EXCLUDE_IDS = [
  'gn-todd', 'gn-edwards', 'gn-hamilton', 'gn-saline', 'gn-unionky',
  'gn-perryil', 'gn-johnson', 'gn-fultonhick', 'gn-carlballard'
];

const POSITIVE_GN = 'https://news.google.com/rss/search?q=site%3Aduboiscountyherald.com%2Fobituaries%20when%3A3d&hl=en-US&gl=US&ceid=US:en';
const POSITIVE_Q = 'https://news.google.com/rss/search?q=obituaries%20when%3A3d&hl=en-US&gl=US&ceid=US:en';

test('ship124: each gn-* -obituary feed URL stays news (not an obituary feed)', () => {
  for (const id of GN_EXCLUDE_IDS) {
    const src = batch3.sources.find(s => s.id === id);
    assert.ok(src && src.url, id + ' in batch-3');
    assert.match(src.url, /-obituary/, id + ' excludes obituaries');
    assert.equal(O.obitFeedUrl(src.url), false, id);
    assert.equal(Src.obitFeedSource({ id, url: src.url }), false, id);
    const mapped = Src.registry([{ file: 't', sources: [{ seq: 1, id, name: id, area: 'X', url: src.url }] }]);
    assert.equal(mapped[0].kind, undefined, id + ' kind');
  }
});

test('ship124: positive Google News obituaries queries become obits feeds', () => {
  assert.equal(O.obitFeedUrl(POSITIVE_GN), true, 'site:.../obituaries path');
  assert.equal(O.obitFeedUrl(POSITIVE_Q), true, 'q=obituaries');
  assert.equal(O.positiveObituarInQuery('obituaries when:3d'), true);
  assert.equal(O.positiveObituarInQuery('intitle:Albion -obituary when:14d'), false);
  assert.equal(O.positiveObituarInQuery('town -(obituary OR death)'), false);
  assert.equal(O.positiveObituarInQuery('NOT obituary Albion'), false);
  assert.equal(O.positiveObituarInQuery('site:paper.com/obituaries'), true);
  const mapped = Src.registry([{
    file: 't',
    sources: [{ seq: 1, id: 'gn-obits-pos', name: 'Obits', area: 'X', url: POSITIVE_Q }]
  }]);
  assert.equal(mapped[0].kind, 'obits');
});

test('ship124: Edwards civic titles stay in News even when source was wrongly kind=obits', () => {
  const civic = [
    'EDWARDS COUNTY FARM BUREAU ANNOUNCES $500 DOUGH FOR DOES RAFFLE',
    'ALBION WATER DEPARTMENT ANNOUNCES WATER LINE FLUSHING SCHEDULE FOR NOV',
    'EDWARDS COUNTY TOYS FOR TOTS HOLDING NOVEMBER SIGN-UPS AND ACCEPTING D'
  ];
  for (const title of civic) {
    assert.equal(O.obitStory({ title, sourceId: 'gn-edwards', link: 'https://news.google.com/rss/articles/x' }), false, title);
  }
  const snap = {
    updatedAt: '2026-11-09T22:00:00Z',
    sources: [
      { id: 'gn-edwards', name: 'Edwards', kind: 'obits' },
      { id: 'gn-hamilton', name: 'Hamilton', kind: 'obits' }
    ],
    items: civic.map((title, i) => ({
      id: 'c' + i,
      title,
      summary: '',
      link: 'https://news.google.com/rss/articles/civic-' + i,
      published: '2026-11-09T20:00:00Z',
      source: 'Edwards',
      sourceId: 'gn-edwards'
    })).concat([{
      id: 'gn-hamilton-54',
      title: 'Marilyn Kay Morris, age 73, of Montgomery, TX (formerly of McLeansboro)',
      summary: 'Marilyn Kay Morris, age 73, of Montgomery, TX (formerly of McLeansboro), passed away.',
      link: 'https://news.google.com/rss/articles/morris',
      published: '2026-11-09T18:00:00Z',
      source: 'Hamilton',
      sourceId: 'gn-hamilton'
    }])
  };
  const kinds = N.effectiveKinds(snap.sources);
  assert.equal(kinds['gn-edwards'], 'news');
  assert.equal(kinds['gn-hamilton'], 'news');
  const p = N.page(snap);
  const edwards = (p.sources || []).find(s => s.id === 'gn-edwards');
  assert.ok(!edwards.kind || edwards.kind === 'news');
  // Civic stories remain under gn-edwards (news); Morris remounts to ob-gn-hamilton.
  assert.ok(p.items.some(i => /FARM BUREAU/.test(i.title) && i.sourceId === 'gn-edwards'));
  assert.ok(p.items.some(i => /WATER DEPARTMENT/.test(i.title) && i.sourceId === 'gn-edwards'));
  assert.ok(p.items.some(i => /TOYS FOR TOTS/.test(i.title) && i.sourceId === 'gn-edwards'));
  assert.ok(p.items.some(i => /Marilyn Kay Morris/.test(i.title) && i.sourceId === 'ob-gn-hamilton'));
  const view = { updatedAt: snap.updatedAt, sources: p.sources, items: p.items };
  const newsPick = Cards.pick(view, 'news', Date.parse('2026-11-09T22:00:00Z'));
  assert.ok(newsPick.shown.some(i => /FARM BUREAU/.test(i.title)));
  assert.ok(!newsPick.shown.some(i => /Marilyn Kay Morris/.test(i.title)));
  const obPick = Cards.pick(view, 'obits', Date.parse('2026-11-09T22:00:00Z'));
  assert.ok(obPick.shown.some(i => /Marilyn Kay Morris/.test(i.title)));
  assert.ok(!obPick.shown.some(i => /FARM BUREAU|WATER DEPARTMENT|TOYS FOR TOTS/.test(i.title)));
});

test('ship124: slug does not double-count a title weak hint', () => {
  const title = 'The plant, formerly of Evansville, is relocating';
  const link = 'https://news.example/' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  assert.equal(O.obitStory({ title }), false);
  assert.equal(O.obitStory({ title, summary: '', link }), false);
  assert.equal(O.weakHintCountFields(title, '', 'the plant formerly of evansville is relocating'), 1);
});

test('ship124: ship122 title-only false positives still clear', () => {
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
