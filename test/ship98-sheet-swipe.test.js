// ship98: swipe (phones) or arrow keys / Previous-Next (desktop) move through the news stories of the list that
// opened the sheet, stopping at the ends; no "Why this is here" line.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'app.css'), 'utf8');
const fn = app.slice(app.indexOf('function storySheet('), app.indexOf('function hostName('));
const mk = app.slice(app.indexOf('function makeCard('), app.indexOf('function obitRow('));

test('ship98: the list is the opening card\u2019s own list of news cards, in order; the Breaking card opens alone', () => {
  assert.ok(mk.includes('if (!big) card._story = { it: it, pic: pic, logo: logo, title: hTitle, heart: sb };'));
  assert.ok(fn.includes('[].filter.call(card.parentElement.children, function (c) { return !!c._story; })'), 'only news cards; ads and other kinds skipped');
  assert.ok(fn.includes('if (at < 0) { list = []; at = 0; }'));
});

test('ship98: stops at the ends (a nudge, no wrap); arrows and buttons on desktop', () => {
  assert.ok(fn.includes('if (i < 0 || i >= list.length) { nudge(n); return false; }'));
  assert.ok(fn.includes("prev.disabled = i === 0; next.disabled = i === list.length - 1;"));
  assert.ok(fn.includes("e.key === 'ArrowRight'") && fn.includes("e.key === 'ArrowLeft'"));
  assert.ok(fn.includes("'Previous story'") && fn.includes("'Next story'"));
  assert.ok(/@media \(min-width:600px\) and \(hover:hover\) \{\s*\.st-nav \{ display:grid; \}/.test(css), 'buttons only where there is a pointer');
});

test('ship98: a swipe never fights vertical scrolling', () => {
  assert.ok(css.includes('.st-sheet { touch-action:pan-y; }'));
  assert.ok(fn.includes('var ST_SWIPE_LOCK = 12, ST_SWIPE_GO = 60;') || app.includes('var ST_SWIPE_LOCK = 12, ST_SWIPE_GO = 60;'));
  assert.ok(fn.includes('t0.side = Math.abs(dx) > Math.abs(dy) * 1.5;'), 'sideways only when clearly sideways');
  assert.ok(fn.includes('Math.round(end ? dx * 0.25 : dx)'), 'resistance at the ends');
});

test('ship98: every page keeps the sheet rules: photo rule, longer text, heart + share, Continue; no "Why this is here"', () => {
  assert.ok(fn.includes('if (pic) {') && fn.includes('String(it.more || it.summary') && fn.includes("ar.classList.add('st-acts')") && fn.includes("go.target = '_blank'; go.rel = 'noopener noreferrer';"));
  assert.ok(!/Why this is here|st-why/.test(app + css));
});
