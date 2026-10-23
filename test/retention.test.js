// Police & courts retention: arrest/charge items leave after 14 days from every official source kind; since the
// 2026-10-22 audit every other police or court item (plea, conviction, sentencing...) leaves News after 14 days too.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../api/news.js');
const src = id => N.SOURCES.find(s => s.id === id);
const item = (title, s) => ({ title, link: 'https://example.gov/' + encodeURIComponent(title), summary: '', image: 'https://example.gov/x.jpg', published: new Date().toISOString(), source: s.name, sourceId: s.id, maxAgeDays: s.maxAgeDays });

test('arrest/charge items from courts, prosecutors, U.S. Attorneys and the FBI drop at 14 days, like police', () => {
  assert.equal(N.ARREST_MAX_DAYS, 14);
  for (const id of ['vcpo', 'usaosdin', 'fbiind', 'vcso']) {
    const s = src(id); assert.ok(s, id);
    const v = N.safetyView(item('Evansville man charged with fraud', s), s);
    assert.equal(v.arrest, true, id); assert.equal(v.maxAgeDays, 14, id); assert.equal(v.image, '', id);
  }
});

test('conviction and sentencing items: no arrest note, and at most 14 days in News like every police and court item', () => {
  for (const [id, title] of [['vcpo', 'Evansville man sentenced to 20 years'], ['usaosdin', 'Jury finds Owensboro woman guilty: convicted of wire fraud'], ['fbiind', 'Henderson man pleads guilty to robbery charges']]) {
    const s = src(id);
    const v = N.safetyView(item(title, s), s);
    assert.equal(v.arrest, false, title); assert.ok(s.maxAgeDays > 14); assert.equal(v.maxAgeDays, N.SAFETY_MAX_DAYS, title); assert.equal(N.SAFETY_MAX_DAYS, 14);
  }
});
