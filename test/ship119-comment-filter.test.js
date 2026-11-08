'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../api/_cmfilter.js');

test('ship119: strong profanity rejects; damn/hell/crap allowed', () => {
  assert.equal(F.classify('fuck this riverfront').action, 'reject');
  assert.equal(F.classify('What a load of bullshit.').action, 'reject');
  assert.equal(F.classify('motherfucker').action, 'reject');
  assert.equal(F.classify('You asshole').action, 'reject');
  assert.equal(F.classify('cocksucker').action, 'reject');
  assert.equal(F.classify('this is shit').action, 'reject');
  assert.equal(F.classify('Damn, that meeting ran long.').action, 'ok');
  assert.equal(F.classify('Hell of a game last night.').action, 'ok');
  assert.equal(F.classify('That plan is crap but legal.').action, 'ok');
});

test('ship119: slurs reject; whole-word Scunthorpe and identity mentions stay ok', () => {
  assert.equal(F.classify('nigger').rule, 'slur');
  assert.equal(F.classify('faggot').action, 'reject');
  assert.equal(F.classify('retard').action, 'reject');
  assert.equal(F.classify('kike').action, 'reject');
  assert.equal(F.classify('Scunthorpe is in England').action, 'ok');
  assert.equal(F.classify('I assume the classic assistant class passed.').action, 'ok');
  assert.equal(F.classify('Black-owned bakery opens downtown').action, 'ok');
  assert.equal(F.classify('Jewish community center hosts a market').action, 'ok');
  assert.equal(F.classify('Muslim students won the debate').action, 'ok');
  assert.equal(F.classify('Racism has no place in Evansville').action, 'ok');
  assert.equal(F.classify('The council’s policy is a disaster for Main Street').action, 'ok');
});

test('ship119: disguises (case, leet, punct, zero-width, spaced letters)', () => {
  assert.equal(F.classify('FuCk').action, 'reject');
  assert.equal(F.classify('f.u.c.k').action, 'reject');
  assert.equal(F.classify('f u c k').action, 'reject');
  assert.equal(F.classify('f*ck').action, 'reject');
  assert.equal(F.classify('f\u200buck').action, 'reject');
  assert.equal(F.classify('a$$hole').action, 'reject');
  assert.equal(F.classify('bull shit').action, 'reject');
});

test('ship119: hate without slurs holds; quoting a slur still rejects; not an AI', () => {
  assert.equal(F.classify('kill all jews').action, 'reject');
  assert.equal(F.classify('I hate all muslims').action, 'hold');
  assert.equal(F.classify('immigrants should die').action, 'hold');
  assert.equal(F.classify('Don’t use the word nigger here').action, 'reject');
  assert.equal(F.classify('The speaker used a homophobic slur; that was wrong').action, 'ok');
  assert.ok(!String(F.classify).includes('openai') && !String(require('fs').readFileSync(require.resolve('../api/_cmfilter.js'), 'utf8')).includes('fetch('));
});
