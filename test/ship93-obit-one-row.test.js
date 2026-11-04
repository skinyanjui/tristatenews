// ship93: on phones and tablets an obituary card's Flowers / Tree (/ Donate) buttons, its short posted time and its
// reactions sit on ONE row, under the picture too; buttons may ellipsize but are never hidden.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'app.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'app.js'), 'utf8');

const blk = css.slice(css.lastIndexOf('@media (max-width:1023.98px)'));
const R = 'article.card.row.row.row-obit:has(> .ca)';

test('ship93: <1024 obituary bottom row is one line under the picture', () => {
  assert.ok(blk.includes(R + ' .src.src:has(> .ob-acts) { height:var(--meta-h); flex-wrap:nowrap;'), 'one-line row');
  assert.ok(blk.includes(R + ' .ca:has(> .th) .src.src { margin-left:calc((var(--pic) + var(--sp-3)) * -1); }'), 'full card width');
  assert.ok(blk.includes(R + ' .ca:has(> .th) .bd { min-height:'), 'row never overlaps the picture');
  assert.ok(blk.includes('.ob-acts { container-type:normal;'), 'no size container (it measured the buttons as 0 wide)');
  assert.ok(/\.ob-act > a > span \{[^}]*text-overflow:ellipsis/.test(blk), 'labels truncate gracefully');
  assert.ok(blk.includes(R + ' .src.src > .ob-acts .ob-long { display:none; }') && blk.includes(R + ' .src.src > .ob-acts .ob-short { display:inline; }'), 'short labels');
  assert.ok(!/display:none/.test(blk.replace(R + ' .src.src > .ob-acts .ob-long { display:none; }', '')), 'no button is hidden');
  assert.ok(!/(padding|margin|gap)[^;{}]*:\s*[^;{}]*\dpx/.test(blk), 'spacing uses the tokens');
});

test('ship93: short labels and a short posted time on every obituary card', () => {
  assert.ok(js.includes("['Send flowers', 'Flowers', 'flowers'") && js.includes("['Plant a tree', 'Tree', 'tree'"));
  const fn = js.slice(js.indexOf('function obitCard('), js.indexOf('function applyHref('));
  assert.ok(fn.includes('shortWhen(it.at)') && fn.includes('w.title = postDay(it.at)'), 'community obits use the short time, full date in the tooltip');
});
