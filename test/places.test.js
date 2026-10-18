// Statewide FBI / U.S. Attorney feeds keep only items that name a Tri-State place.
const test = require('node:test');
const assert = require('node:assert/strict');
const { inTriState } = require('../api/_places.js');
const news = require('../api/news.js');
const src = id => news.SOURCES.find(s => s.id === id);

test('FBI and U.S. Attorney feeds use the strict Tri-State filter', () => {
  for (const id of ['fbispr', 'fbiind', 'fbilou', 'usaosdin', 'usaowdky', 'usaosdil']) assert.ok(src(id) && src(id).strictGeo, id);
  assert.equal(src('fbispr').strictGeo, 'ill');
});

test('FBI Springfield: southern-Illinois items outside the five covered counties are dropped', () => {
  const s = src('fbispr'), keep = t => news.passesFilters({ title: t, summary: '', link: 'https://www.fbi.gov/x' }, s, false);
  assert.equal(keep('Williamson County man sentenced to prison'), false);       // Marion, not covered
  assert.equal(keep('New Jersey man convicted of soliciting child pornography in southern Illinois'), false);
  assert.equal(keep('Chandlerville farmer sentenced for bank fraud'), false);  // not "Chandler, Ind."
  assert.equal(keep('Mount Vernon, Ill., man indicted'), false);                // Jefferson County, Ill.
  assert.equal(keep('McLean County man sentenced'), false);                     // Bloomington, Ill., not McLean County, Ky.
  assert.equal(keep('Carmi man sentenced for wire fraud'), true);               // White County
  assert.equal(keep('Fairfield woman charged'), true);                          // bare "Fairfield" in an Illinois feed
  assert.equal(keep('Mt. Carmel man pleads guilty'), true);                     // Wabash County
  assert.equal(keep('Shawneetown doctor indicted'), true);                      // Gallatin County
  assert.equal(keep('Two from Evansville, Indiana, charged in Illinois scheme'), true);
});

test('same-name places count only with their state, or bare in a feed from that state', () => {
  assert.equal(inTriState({ title: 'Henderson man charged' }, 'ky'), true);
  assert.equal(inTriState({ title: 'Henderson man charged' }, 'ill'), false);
  assert.equal(inTriState({ title: 'Henderson, Nevada, man charged' }, null), false);
  assert.equal(inTriState({ title: 'Man from Henderson, Ky., sentenced' }, 'ill'), true);
  assert.equal(inTriState({ title: 'Princeton man sentenced' }, 'ky'), false);
  assert.equal(inTriState({ title: 'Princeton man sentenced' }, 'ind'), true);
  assert.equal(inTriState({ title: 'Pike County man sentenced' }, 'ky'), false);  // Pikeville, Ky.
  assert.equal(inTriState({ title: 'Pike County, Indiana, man sentenced' }, 'ky'), true);
  assert.equal(inTriState({ title: 'Sentenced', summary: 'John Doe, 40, of Owensboro, was sentenced' }, 'ky'), true);
  assert.equal(inTriState({ title: 'Madisonville, Tennessee, man indicted' }, null), false);
  assert.equal(inTriState({ title: 'Madisonville man indicted' }, 'ky'), true);
});

test('every covered county is recognised', () => {
  const cases = { ind: ['Vanderburgh County', 'Warrick County', 'Posey County', 'Gibson County', 'Pike County', 'Dubois County', 'Spencer County'],
    ky: ['Henderson County', 'Daviess County', 'Union County', 'Webster County', 'Hopkins County', 'Ohio County', 'McLean County'],
    ill: ['White County', 'Wabash County', 'Edwards County', 'Gallatin County', 'Wayne County'] };
  for (const [st, list] of Object.entries(cases)) for (const c of list) assert.equal(inTriState({ title: c + ' man sentenced' }, st), true, st + ' ' + c);
});

test('local news sources keep the wider region filter', () => {
  const s = news.SOURCES.find(x => x.geo && !x.strictGeo && !x.kind);
  assert.ok(s);
  assert.equal(news.passesFilters({ title: 'Carbondale council votes on budget', summary: '', link: 'https://example.com/a' }, s, false), true);
});
