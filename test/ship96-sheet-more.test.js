// ship96: the story sheet shows the feed's longer text, the heart and share, and Continue as the main action.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseFeed } = require('../api/news.js');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'app.css'), 'utf8');
const fn = app.slice(app.indexOf('function storySheet('), app.indexOf('function hostName('));

const rss = desc => `<rss><channel><item><title>Evansville council approves budget</title><link>https://www.14news.com/a</link><pubDate>${new Date().toUTCString()}</pubDate><description>${desc}</description></item></channel></rss>`;
const SRC = { id: 'wfie', name: '14 News', kind: 'news' };

test('ship96: a long feed description is kept (up to 700 chars, cut at a word) beside the 220-char card summary', () => {
  const long = ('The Evansville City Council approved the 2027 budget on Monday night after a long debate about road repairs. ').repeat(10);
  const [it] = parseFeed(rss(long), SRC);
  assert.ok(it.summary.length <= 220 && it.summary.endsWith('\u2026'));
  assert.ok(it.more.length <= 700 && it.more.length > 600 && it.more.endsWith('\u2026'));
  assert.ok(long.startsWith(it.more.slice(0, -1).trim()), 'only the feed\u2019s own words');
});

test('ship96: a short description adds nothing; events and obituaries never carry it', () => {
  assert.equal(parseFeed(rss('Short blurb.'), SRC)[0].more, undefined);
  const long = 'word '.repeat(80);
  assert.equal(parseFeed(rss(long), { ...SRC, kind: 'events' })[0].more, undefined);
  assert.equal(parseFeed(rss(long), { ...SRC, kind: 'obits' })[0].more, undefined);
});

test('ship96: the sheet: longer text, heart + share (card state, fixed slot), Continue with the logo', () => {
  assert.ok(fn.includes("String(it.more || it.summary || '').trim().replace("));
  assert.ok(fn.includes("var ar = newsActs(sh, it); ar.classList.add('st-acts');") && fn.includes('cardHeart.paint()'));
  assert.ok(fn.includes("toggle: function () { toggleLiked(it); }"), 'the card row\u2019s own like call');
  assert.ok(fn.includes("go = el('a', 'st-go');") && fn.includes("gl.alt = ''") && fn.includes("el('span', null, 'Continue to ' + (it.source || 'the story'))"));
  assert.ok(!/st-why|Why this is here/.test(fn), 'ship98: no "Why this is here" line');
  assert.ok(fn.includes('if (pic) {'), 'no photo for Police & courts or crime stories, as on the card');
  assert.ok(/\.st-acts\.st-acts \.like \{[^}]*width:calc\(24px \+ var\(--sp-1\) \+ 4ch\); min-width:calc\(24px \+ var\(--sp-1\) \+ 4ch\);/.test(css));
  assert.ok(/\.st-go \{[^}]*min-height:56px;[^}]*font-weight:700;/.test(css));
});
