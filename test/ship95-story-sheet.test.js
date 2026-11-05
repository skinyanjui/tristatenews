// ship95 (experiment): a news story opens a sheet over the feed (picture, headline, summary, "Continue to <publisher>")
// before the reader leaves the site. Not a /story page; the heart, flag and share keep working without opening it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'app.css'), 'utf8');
const fn = app.slice(app.indexOf('function storySheet('), app.indexOf('function hostName('));
const mk = app.slice(app.indexOf('function makeCard('), app.indexOf('function obitRow('));

test('ship95: a plain click on a news card opens the sheet; modified or middle clicks still go straight to the publisher', () => {
  assert.ok(mk.includes("a.addEventListener('click', function (e) {"));
  assert.ok(mk.includes('if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;'));
  assert.ok(mk.includes('e.preventDefault(); storySheet(it, pic, logo, hTitle);'));
  assert.ok(mk.includes("a.href = safeHref(it.link); a.target = '_blank'; a.rel = 'noopener noreferrer';"), 'the card is still a real link');
  // reactions live in the footer, outside the card link, so they never open the sheet
  assert.ok(mk.indexOf("var foot = el('div', 'cf');") > mk.indexOf('card.appendChild(a);'));
  assert.ok(!/storySheet\(/.test(app.slice(app.indexOf('function obitRow('), app.indexOf('function obitRow(') + 3000)), 'obituaries keep their own links');
});

test('ship95: the sheet: card picture rules, headline, RSS summary, one Continue link in a new tab, three ways out', () => {
  assert.ok(fn.includes("el('dialog', 'st-sheet')") && fn.includes("d.setAttribute('aria-labelledby', 'st-sheet-h')"));
  assert.ok(fn.includes('if (pic) {'), 'only the picture the card may show (none for Police & courts or crime stories)');
  assert.ok(fn.includes("el('p', 'st-sum', sm)"), 'the feed summary only');
  assert.ok(!/fetch\(/.test(fn), 'no article scrape');
  assert.ok(fn.includes("'Continue to ' + (it.source || 'the story')") && fn.includes("go.target = '_blank'; go.rel = 'noopener noreferrer';"));
  assert.ok(fn.includes("x.setAttribute('aria-label', 'Close')") && fn.includes('if (e.target === d) d.close();') && fn.includes('d.showModal()'), 'Close, backdrop and Esc (a modal dialog)');
  assert.ok(fn.includes('back.focus()'), 'focus returns to the card');
});

test('ship95: sheet styles: bottom sheet on phones, centred card from 600px, spacing tokens', () => {
  const blk = css.slice(css.indexOf('/* ship95'), css.indexOf('/* ship95') + 4000);
  assert.ok(blk.includes('.st-sheet::backdrop {') && blk.includes('html.st-open { overflow:hidden; }'));
  assert.ok(/@media \(max-width:599\.98px\) \{\s*\.st-sheet \{ width:100vw;[^}]*margin:auto 0 0; border-radius:16px 16px 0 0;/.test(blk));
  assert.ok(!/var\(--sp-5\)/.test(blk), 'only defined spacing tokens');
  assert.ok(css.indexOf('/* ship95') < css.indexOf('/* ---------- card spacing'));
});
