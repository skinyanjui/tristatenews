// Sticky footer (ship61): on every public page the footer sits at the bottom of the screen when the content is short
// and follows the content when it is long. The rule is a column body at least one screen tall (100dvh, 100vh first as
// the fallback) whose main takes the spare height; the footer is pushed down by that height, never position:fixed.
// County pages (/news/<state>/<county>) are public/index.html served by api/_geopage.js; admin.html has no footer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const flat = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
const styleOf = f => flat(f.endsWith('.css') ? read(f) : (read(f).match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1]);
// every declaration block for a selector, in source order, merged
function rules(css, sel) {
  const out = {}; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) {
    if (!m[1].split(',').map(s => s.trim()).includes(sel)) continue;
    for (const d of m[2].split(';')) { const i = d.indexOf(':'); if (i > 0) { const k = d.slice(0, i).trim(); (out[k] = out[k] || []).push(d.slice(i + 1).trim()); } }
  }
  return out;
}
function bodyIsScreenTallColumn(css, label) {
  const b = rules(css, 'body');
  assert.deepEqual(b['min-height'], ['100vh', '100dvh'], label + ': body min-height 100vh then 100dvh');
  assert.deepEqual(b.display, ['flex'], label + ': body is flex'); assert.deepEqual(b['flex-direction'], ['column'], label + ': body is a column');
}
function mainTakesSpare(css, sel, label) {
  const m = rules(css, sel);
  assert.ok((m.flex || []).some(v => /^1 [01] auto$/.test(v)), label + ': ' + sel + ' grows into the spare height');
  assert.ok((m.width || []).includes('100%') , label + ': ' + sel + ' keeps its full (max-)width as a flex item');
}
function neverFixed(css, sels, label) {
  for (const s of sels) assert.ok(!(rules(css, s).position || []).some(v => /fixed|absolute/.test(v)), label + ': ' + s + ' is not fixed');
}

test('index.html (News, Events, Obituaries, Jobs, Deals, Classifieds, county pages): footer pushed to the bottom', () => {
  const css = styleOf('public/index.html'), html = read('public/index.html');
  bodyIsScreenTallColumn(css, 'index'); mainTakesSpare(css, 'body > main', 'index');
  assert.deepEqual(rules(css, 'body > main').display, ['flex']); assert.deepEqual(rules(css, 'body > main')['flex-direction'], ['column']);
  assert.ok(rules(css, '.foot-push').flex.includes('1 0 0'), 'spacer soaks up the spare height');
  const main = html.slice(html.indexOf('<main id="main"'), html.indexOf('</main>'));
  assert.match(main, /<div class="foot-push" aria-hidden="true"><\/div>\s*<div class="legal-foot">[\s\S]*<\/div>\s*$/, 'spacer sits right before the footer, which ends main');
  assert.equal((html.match(/class="foot-push"/g) || []).length, 1);
  neverFixed(css, ['.legal-foot', '.foot-push'], 'index');
  assert.match(read('api/_geopage.js'), /'public', 'index\.html'/, 'county pages are index.html');
});

test('legal.css pages (legal, newsletter, unsubscribe, 404): header, main, footer column', () => {
  const css = styleOf('public/legal.css');
  bodyIsScreenTallColumn(css, 'legal.css'); mainTakesSpare(css, 'body > main', 'legal.css');
  assert.deepEqual(rules(css, '.lg-foot')['flex-shrink'], ['0']);
  neverFixed(css, ['.lg-foot'], 'legal.css');
  for (const f of ['public/legal.html', 'public/newsletter.html', 'public/unsubscribe.html', 'data/pages/404.html']) {
    const h = read(f); assert.match(h, /href="\/legal\.css"/, f);
    assert.match(h, /<\/header>\s*<main id="main">[\s\S]*<\/main>\s*<footer class="lg-foot">/, f + ': footer is main\'s next sibling in body');
    assert.doesNotMatch((h.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1], /(^|[\s}])(body|main|#main)\s*\{/, f + ": no inline override of the body/main rule (the old 100vh - 170px hack is gone)");
  }
});

test('order.html and /advertise: flex column main, footer pushed with margin-top:auto', () => {
  for (const f of ['public/order.html', 'data/pages/advertise.html']) {
    const css = styleOf(f);
    bodyIsScreenTallColumn(css, f); mainTakesSpare(css, 'main', f);
    assert.deepEqual(rules(css, 'main').display, ['flex'], f); assert.deepEqual(rules(css, 'main')['flex-direction'], ['column'], f);
    assert.deepEqual(rules(css, 'main > footer')['margin-top'], ['auto'], f);
    neverFixed(css, ['footer', 'main > footer', 'footer.m'], f);
    const h = read(f); assert.match(h.slice(h.indexOf('<main'), h.indexOf('</main>') + 7), /<footer[^>]*>[\s\S]*<\/footer>\s*<\/main>$/, f + ': footer is main\'s last child');
  }
});

test('the only position:fixed things are the toast and the wide-screen rails, never a footer', () => {
  const css = styleOf('public/index.html');
  const fixed = [...css.matchAll(/([^{}]+)\{[^{}]*position:\s*fixed[^{}]*\}/g)].map(m => m[1].trim().replace(/^@media[^{]*\{\s*/, ''));
  for (const s of fixed) assert.doesNotMatch(s, /foot/, s);
});
