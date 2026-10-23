// Source batch 3 (ship58): county home sources for the counties batches 1 and 2 left without one. Covers the news.js
// filter changes the batch needs (a source's own geoTerms in the out-of-area check, the localSection geo-filter skip,
// radio-style death notices), the gnews rate group and the registry rules for labeled Google News fallbacks.
// No network and no Redis.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'KV_URL', 'REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'UPSTASH_REDIS_URL', 'EXTRA_FEEDS'].forEach(k => delete process.env[k]);
const N = require(path.join(__dirname, '..', 'api', 'news.js'));
const reg = require('../api/_sources.js');
const b3 = reg.BATCHES.find(b => b.batch === 'b3');

const g = t => ({ title: t, summary: '', link: 'https://news.google.com/rss/articles/abc' });
const STODDARD = { id: 'gn-stoddard', kind: 'news', geoTerms: ['dexter', 'bloomfield, mo', 'stoddard county'] };
const MCLEAN = { id: 'mcleannews', kind: 'news', localSection: true, geoTerms: ['mclean county', 'calhoun', 'livermore'] };

test('outOfArea: a source\'s own geoTerms keep its "<Town>, Mo." and "Missouri man" stories', () => {
  for (const t of ['Dexter, Mo. man charged after chase', 'Missouri man arrested in Dexter']) {
    assert.equal(N.outOfArea(g(t)), true, 'without the source terms: ' + t);
    assert.equal(N.outOfArea(g(t), STODDARD.geoTerms), false, t);
    assert.equal(N.passesFilters(g(t), STODDARD, true), true, t);
  }
  for (const t of ['Sikeston, Mo. woman hurt in crash', 'Texas man charged after chase']) {
    assert.equal(N.outOfArea(g(t), STODDARD.geoTerms), true, t);
    assert.equal(N.passesFilters(g(t), STODDARD, true), false, t);
  }
});

test('localSection: a Google search held to one weekly\'s local section skips the headline geo filter only', () => {
  const plain = { ...MCLEAN }; delete plain.localSection;
  const local = g('Frizzell eyeing 4 more years as sheriff');
  assert.equal(N.passesFilters(local, MCLEAN, true), true);
  assert.equal(N.passesFilters(local, plain, true), false, 'a town search still needs a geoTerm in the headline');
  assert.equal(N.passesFilters(g('Patricia Ann Dial, age 79 of McLeansboro'), MCLEAN, true), false, 'obituaries still drop');
  assert.equal(N.passesFilters(g('A Texas man is charged after a chase'), MCLEAN, true), false, 'out-of-area copy still drops');
});

test('looksLikeObit: radio-style death notices (age written out, in brackets, or without "of")', () => {
  const obits = ['Patricia Ann Dial, age 79 of McLeansboro', 'Betty Lamb (82) of Olney', 'Richard Ellsworth Lasswell, 85 of McLeansboro',
    'Mary Lou (Rogers) Elliston, 88, McLeansboro,', 'Nancy I. Stevens (77) of Effingham, formerly of Olney', 'John Henry Adams, 61, of Mill Shoals'];
  for (const t of obits) assert.equal(N.looksLikeObit({ title: t, summary: '', link: 'https://example.com/news/1' }), true, t);
  const news = ['Owensboro man, 45, of Henderson arrested', 'Christopher H. Byers, 50 of rural New Haven, IL, was sentenced to 20 years',
    'Frizzell eyeing 4 more years as sheriff', 'Webster County Detention Center Report', 'Incumbent Boyken, challengers Kassinger, Zuehl vie for Livermore mayor',
    'Charleston man dies in car crash', 'Man dies after being struck by train in Poplar Bluff, coroner says'];
  for (const t of news) assert.equal(N.looksLikeObit({ title: t, summary: '', link: 'https://example.com/news/1' }), false, t);
});

test('gnews rate group: batch 3 Google searches share one spaced queue with a per-run cap', () => {
  assert.deepEqual(N.RATE_GROUPS.gnews, { gapMs: 1500, perRun: 5 });
  assert.deepEqual(N.RATE_GROUPS.paxton, { gapMs: 4000, perRun: 3 }, 'ship56 group unchanged');
  for (const s of b3.sources) if (/news\.google\.com/.test(s.url)) assert.equal(s.rateGroup, 'gnews', s.id);
});

test('batch 3 fallbacks: labeled, bounded queries, section searches only for google_news_site', () => {
  for (const s of b3.sources) {
    if (!s.fallback) { assert.ok(!/news\.google\.com/.test(s.url) && !s.localSection, s.id); continue; }
    const q = new URL(s.url).searchParams.get('q');
    assert.match(q, /when:14d$/, s.id + ' current items only');
    if (s.fallback === 'google_news_site') {
      assert.match(q, /^site:[a-z0-9.-]+\/[a-z0-9_/-]+ when:14d$/, s.id);
    } else {
      assert.equal(s.localSection, undefined, s.id);
      assert.equal(s.site, 'https://news.google.com', s.id);
      // more than about 5 site: or 8 OR terms makes Google ignore when: (tested 2026-10-22), so queries stay small
      assert.ok((q.match(/site:/g) || []).length <= 4 && (q.match(/intitle:/g) || []).length <= 4, s.id);
      assert.match(q, / -obituary when:14d$/, s.id);
      assert.ok(Array.isArray(s.geoTerms) && s.geoTerms.length, s.id + ' headline geo filter');
    }
  }
});

test('validate: localSection and fallback rules', () => {
  const file = srcs => [{ file: 'x.json', sources: srcs }];
  const base = { id: 'zz', name: 'Z', area: 'Z', kind: 'news', everyMin: 60 };
  const ok = { ...base, url: 'https://news.google.com/rss/search?q=site%3Aexample.com%2Fsection%2Fnews%20when%3A14d', localSection: true, fallback: 'google_news_site' };
  const probs = s => reg.validate(file([s])).filter(p => /localSection|fallback/.test(p));
  assert.deepEqual(probs(ok), []);
  assert.equal(probs({ ...ok, localSection: 'yes' }).length, 1);
  assert.equal(probs({ ...ok, url: 'https://news.google.com/rss/search?q=Albion%20when%3A14d' }).length, 1, 'localSection needs a site:host/path search');
  assert.equal(probs({ ...ok, localSection: undefined, fallback: 'google' }).length, 1);
  assert.equal(probs({ ...base, url: 'https://example.com/feed/', fallback: 'google_news_towns' }).length, 1, 'fallback labels Google urls only');
});

test('ship60: Todd County uses the gn-todd town fallback (whopam.com answers a Cloudflare challenge to datacenter fetches)', () => {
  const ids = b3.sources.map(s => s.id);
  assert.ok(!ids.includes('whoptodd') && !b3.sources.some(s => /whopam\.com\/category/.test(s.url)));
  const t = b3.sources.find(s => s.id === 'gn-todd');
  assert.deepEqual(t.counties, ['ky-todd']);
  assert.equal(t.fallback, 'google_news_towns');
  assert.equal(t.seq, 86, 'takes whoptodd\'s place, so seq stays continuous');
  assert.match(new URL(t.url).searchParams.get('q'), /site:whopam\.com/);
});
