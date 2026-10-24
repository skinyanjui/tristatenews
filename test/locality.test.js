// Locality lookups (api/_places.js locate / inCore30) over the generated alias table: the plan's §3.10 collisions,
// explicit ambiguity, and parity with the legacy strict filter.
const test = require('node:test');
const assert = require('node:assert/strict');
const { locate, inCore30, inTriState, PLACES } = require('../api/_places.js');
const A = require('../data/geography/locality-aliases.json');
const alias = k => A.aliases.find(a => a.alias === k);
const ids = (t, o) => locate(t, o).matches.map(m => m.countyIds.join('+')).sort();
const unresolved = (t, o) => locate(t, o).unresolved.map(u => u.alias);

test('the review flags Washington, Marion and Mount Vernon and the other shared names as ambiguous', () => {
  for (const k of ['washington', 'marion', 'mount vernon', 'princeton', 'benton', 'clay', 'hardin', 'johnson', 'calhoun',
    'perry county', 'union county', 'daviess county']) {
    assert.ok(alias(k), k);
    assert.equal(alias(k).ambiguous, true, k);
    assert.equal(alias(k).requiresState, true, k);
  }
  for (const k of ['washington', 'marion', 'mount vernon']) assert.ok(alias(k).reasons.includes('always_ambiguous'), k);
  assert.ok(alias('washington').reasons.includes('state_name'));
  assert.deepEqual(alias('benton').countyIds, ['il-franklin', 'ky-marshall']);
  assert.deepEqual(alias('princeton').countyIds, ['in-gibson', 'ky-caldwell']);
  // Without southeast Missouri (ship62) Greenville, Shawneetown and Wayne County have one candidate here: no longer
  // ambiguous, but they still need a state (namesakes elsewhere); Jackson is no local place at all.
  for (const k of ['greenville', 'shawneetown', 'wayne county']) { assert.equal(alias(k).ambiguous, false, k); assert.equal(alias(k).requiresState, true, k); }
  assert.deepEqual(alias('greenville').countyIds, ['ky-muhlenberg']);
  assert.equal(alias('jackson'), undefined);
  assert.deepEqual(alias('marion').countyIds, ['il-williamson', 'ky-crittenden']);
  assert.deepEqual(alias('mount vernon').countyIds, ['il-jefferson', 'in-posey']);
  assert.deepEqual(alias('mount vernon').forms, ['mount vernon', 'mt vernon', 'mt. vernon']);
});

test('ambiguity rules hold for every alias', () => {
  for (const a of A.aliases) {
    const amb = ['same_name_in_area', 'state_name', 'common_word', 'always_ambiguous'].some(r => a.reasons.includes(r));
    assert.equal(a.ambiguous, amb, a.alias);
    if (a.ambiguous) assert.equal(a.requiresState, true, a.alias);
    assert.equal(a.reasons.includes('same_name_in_area'), a.refs.length > 1, a.alias);
    if (!a.requiresState) assert.equal(a.refs.length, 1, a.alias);
    if (a.reasons.includes('namesakes_elsewhere') && !a.requiresState) assert.ok(a.review, a.alias + ' needs a reviewed override');
  }
  assert.equal(alias('owensboro').requiresState, false);
  assert.equal(alias('henderson').requiresState, true);
  assert.equal(alias('henderson').ambiguous, false);
});

test('Case A: Perry, Union and Daviess counties resolve only with their state', () => {
  const cases = { Perry: { Ill: 'il-perry', Ind: 'in-perry' },
    Union: { Ill: 'il-union', Ky: 'ky-union' }, Daviess: { Ind: 'in-daviess', Ky: 'ky-daviess' } };
  const full = { Ill: 'Illinois', Ind: 'Indiana', Ky: 'Kentucky' }, postal = { Ill: 'IL', Ind: 'IN', Ky: 'KY' };
  for (const [name, st] of Object.entries(cases)) {
    for (const [ap, id] of Object.entries(st)) {
      for (const q of [ap + '.', full[ap], postal[ap]]) assert.deepEqual(ids(name + ' County, ' + q + ', man sentenced'), [id], name + ' ' + q);
      assert.deepEqual(ids(name + ' Co., ' + ap + '.'), [id], name + ' Co.');
    }
    for (const st2 of ['Ill', 'Ind', 'Ky']) {
      assert.deepEqual(ids(name + ' County man sentenced', { feedState: st2.toLowerCase() === 'ill' ? 'ill' : st2.toUpperCase() }), [], name + ' bare in a ' + st2 + ' feed');
    }
    assert.deepEqual(unresolved(name + ' County deputies'), [name.toLowerCase() + ' county']);
    assert.deepEqual(ids(name + ' County, Ohio'), [], name + ' County, Ohio is not ours');
  }
});

test('Mount Vernon, Ind. vs Mount Vernon, Ill.', () => {
  for (const t of ['Mount Vernon, Ind., council', 'Mt. Vernon, Indiana', 'MT. VERNON, IN', 'Mt Vernon, Ind.']) assert.deepEqual(ids(t), ['in-posey'], t);
  for (const t of ['Mount Vernon, Ill., man indicted', 'Mt. Vernon, Illinois', 'MOUNT VERNON, ILL.']) assert.deepEqual(ids(t), ['il-jefferson'], t);
  assert.deepEqual(ids('Mount Vernon man charged', { feedState: 'ind' }), [], 'a feed state never resolves an ambiguous name');
  assert.deepEqual(unresolved('Mount Vernon man charged', { feedState: 'ill' }), ['mount vernon']);
  assert.deepEqual(locate('Mount Vernon, Wash., man').rejected.map(r => r.qualifier), ['WA']);
  assert.deepEqual(ids('Mount Vernon police and the Jefferson County sheriff', { feedState: 'ill' }).filter(x => x === 'il-jefferson').length, 2,
    'the county alias resolves with the feed state and then picks Mount Vernon, Ill.');
  assert.equal(locate('Mount Vernon police and the Jefferson County sheriff', { feedState: 'ill' }).matches.find(m => m.alias === 'mount vernon').method, 'co_occurring_county');
});

test('Marion, Ill. vs Marion elsewhere', () => {
  assert.deepEqual(ids('Marion, Ill., man charged'), ['il-williamson']);
  assert.deepEqual(ids('MARION, Ill. (AP)'), ['il-williamson']);
  assert.deepEqual(ids('Marion, Ky., fire'), ['ky-crittenden']);
  for (const t of ['Marion, Ind., crash', 'Marion, Ohio, plant', 'Marion, Iowa', 'Marion, Va.']) {
    assert.deepEqual(ids(t), [], t);
    assert.equal(locate(t).rejected.length, 1, t);
  }
  assert.deepEqual(unresolved('Marion man charged', { feedState: 'ill' }), ['marion']);
  assert.deepEqual(unresolved('Marion Cotillard stars'), ['marion']);
  const m = locate('Marion police said a Williamson County deputy', { feedState: 'ill' }).matches.find(x => x.alias === 'marion');
  assert.deepEqual([m.countyIds, m.method], [['il-williamson'], 'co_occurring_county']);
  assert.deepEqual(ids('Marion and Crittenden County, Ky., officials').sort(), ['ky-crittenden', 'ky-crittenden']);
});

test('shared seats and towns: Benton, Princeton, Greenville, Jackson, Washington', () => {
  assert.deepEqual(ids('Benton, Ill.'), ['il-franklin']);
  assert.deepEqual(ids('Benton, Ky.'), ['ky-marshall']);
  assert.deepEqual(ids('Benton, Mo.'), [], 'Missouri is not covered (ship62)');
  assert.deepEqual(ids('Benton, Ark.'), []);
  assert.deepEqual(ids('Princeton, Ind.'), ['in-gibson']);
  assert.deepEqual(ids('Princeton, Ky.'), ['ky-caldwell']);
  assert.deepEqual(ids('Princeton, N.J.'), []);
  assert.deepEqual(unresolved('Princeton man sentenced', { feedState: 'ind' }), ['princeton']);
  assert.deepEqual(ids('Greenville, Ky.'), ['ky-muhlenberg']);
  assert.deepEqual(ids('Greenville, Mo.'), []);
  assert.deepEqual(ids('Greenville, S.C.'), []);
  assert.deepEqual(ids('Jackson, Mo.'), []);
  assert.deepEqual(ids('Wayne County, Mo., deputies'), []);
  assert.deepEqual(ids('Wayne County, Ill., deputies'), ['il-wayne']);
  assert.deepEqual(ids('Cape Girardeau man charged'), []);
  assert.deepEqual(ids('Sikeston, Mo.'), []);
  assert.deepEqual(ids('Jackson County, Ill.'), ['il-jackson']);
  assert.deepEqual(ids('Washington, Ind.'), ['in-daviess']);
  assert.deepEqual(unresolved('Washington lawmakers', { feedState: 'ind' }), ['washington']);
  assert.deepEqual(ids('Washington, D.C.'), []);
});

test('other §3.10 cases: Louisville, Ill. and Elizabethtown, Ill. are not the Kentucky cities', () => {
  assert.deepEqual(ids('Louisville, Ill.'), ['il-clay']);
  assert.deepEqual(ids('Louisville, Ky.'), [], 'Louisville, Ky. is outside the 57 counties');
  assert.deepEqual(ids('Louisville man', { feedState: 'ky' }), [], 'bare Louisville in a Kentucky feed is not Clay County, Ill.');
  assert.deepEqual(ids('Elizabethtown, Ill.'), ['il-hardin']);
  assert.deepEqual(ids('Elizabethtown, Ky.'), []);
  assert.deepEqual(ids('Elizabethtown man', { feedState: 'ky' }), []);
});

test('names with namesakes elsewhere: state qualifier or the feed state, never bare in a foreign feed', () => {
  assert.deepEqual(ids('Henderson man charged', { feedState: 'ky' }), ['ky-henderson']);
  assert.equal(locate('Henderson man charged', { feedState: 'ky' }).matches[0].method, 'feed_state');
  assert.deepEqual(ids('Henderson man charged', { feedState: 'ill' }), []);
  assert.deepEqual(ids('Henderson, Nevada, man charged'), []);
  assert.deepEqual(ids('Man from Henderson, Ky., sentenced', { feedState: 'ill' }), ['ky-henderson']);
  assert.deepEqual(ids('Carbondale police', { feedState: 'ill' }), ['il-jackson+il-williamson'], 'multi-county place');
  assert.deepEqual(ids('Carbondale, Pa.'), []);
  assert.deepEqual(ids('Owensboro'), ['ky-daviess']);
  assert.equal(locate('Owensboro').matches[0].method, 'unique_locality');
  assert.deepEqual(ids('Vanderburgh deputies'), ['in-vanderburgh']);
  assert.deepEqual(ids('Evansville, in a statement'), ['in-vanderburgh'], 'lower-case ", in" is not Indiana');
  assert.deepEqual(ids('East Cape Girardeau'), ['il-alexander'], 'longest name wins');
  assert.deepEqual(ids('St. Meinrad Archabbey'), ['in-spencer']);
});

test('legacy parity: every name in the old "anywhere" list is still found, in the same county', () => {
  const county = { evansville: 'in-vanderburgh', owensboro: 'ky-daviess', carmi: 'il-white', morganfield: 'ky-union', grayville: 'il-white' };
  const skip = new Set(['shawneetown']); // the Shawneetown CDP in Cape Girardeau County, Mo. is a namesake elsewhere, so it needs ", Ill."
  for (const st of Object.keys(PLACES)) {
    for (const name of PLACES[st].anywhere) {
      if (skip.has(name)) continue;
      const t = name.replace(/, (ind|ky|ill)$/, (m, s) => ', ' + { ind: 'Ind.', ky: 'Ky.', ill: 'Ill.' }[s]);
      const r = locate(t + ' man sentenced');
      assert.ok(r.matches.length >= 1, name);
      assert.ok(inTriState({ title: t + ' man sentenced' }, null), name);
      if (county[name]) assert.ok(r.matches.some(m => m.countyIds.includes(county[name])), name);
    }
  }
  assert.ok(alias('shawneetown').refs.every(r => r.state === 'IL'));
  assert.deepEqual(ids('Shawneetown, Ill.'), ['il-gallatin']);
});

test('inCore30 uses the 30-county core and is not wired into any route', () => {
  assert.equal(inCore30({ title: 'Mount Vernon, Ind., man sentenced' }, 'ind'), true);
  assert.equal(inCore30({ title: 'Mount Vernon man sentenced' }, 'ind'), false, 'ambiguous without a state');
  assert.equal(inCore30({ title: 'Marion, Ill., man sentenced' }, 'ill'), false, 'Williamson County is extended, not core');
  assert.equal(inCore30({ title: 'Fairfield woman charged' }, 'ill'), true, 'Wayne County, Ill., from an Illinois feed');
  assert.equal(inCore30({ title: 'Paducah man sentenced' }, 'ky'), false, 'McCracken County is extended, not core');
  assert.equal(inCore30({ title: 'Jackson, Mo., man' }, null), false, 'Missouri is not covered');
  assert.equal(inCore30({ title: 'Sentenced', summary: 'of Owensboro' }, 'ky'), true);
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'news.js'), 'utf8');
  assert.ok(!/inCore30|locate\(|_geo\.js/.test(src), 'news.js still uses inTriState only');
  assert.ok(!/inCore30|locate\(|_places/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'api', '_geoapi.js'), 'utf8')), 'the geography API does not filter news');
});
