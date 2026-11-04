// ship86 (audit): a real /favicon.ico (browsers ask for it on pages without an icon link, e.g. sitemap.xml), and
// obituary buttons back on the time line on wide rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

test('favicon.ico exists and is an ICO file', () => {
  const b = fs.readFileSync(path.join(root, 'public/favicon.ico'));
  assert.ok(b.length > 0 && b.length < 50000);
  assert.deepEqual([...b.subarray(0, 4)], [0, 0, 1, 0], 'ICO header');
});

test('obituary buttons: stacked on phones/tablets, one line at 1024px+', () => {
  const css = fs.readFileSync(path.join(root, 'public/assets/app.css'), 'utf8');
  const i = css.indexOf('/* ship86:');
  assert.ok(i > 0);
  const b = css.slice(i);
  assert.ok(b.includes('@media (min-width:1024px) {'));
  assert.ok(b.includes('.src.src:has(> .ob-acts) { flex-wrap:nowrap; padding-top:0; }'));
  assert.ok(b.includes('.src.src > .ob-acts { flex:0 1 auto; flex-wrap:nowrap; }'));
  assert.ok(css.includes('.src.src > .ob-acts { flex:1 0 100%; min-width:0; }'), 'ship83 stacked layout kept below 1024px');
});
