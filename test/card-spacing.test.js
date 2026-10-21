// One set of card spacing tokens (public/index.html, admin.html, creative.html): 16px inside on desktop, 12px on
// phones, one gap between cards, one step between lines, 40px tap targets; Events cards grow with their text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('public/index.html');
const css = html.slice(html.indexOf('/* ---------- card spacing'), html.indexOf('</style>'));

test('index.html: shared tokens, used by every card type', () => {
  assert.ok(css.includes(':root { --card-pad:16px; --card-gap:16px; --card-stack:6px; --card-tap:40px; }'));
  assert.ok(css.includes('@media (max-width:639px) { :root { --card-pad:12px; --card-gap:12px; } }'));
  for (const sel of ['.card a.ca .bd', '.evr-body', '.cl-item', '.ob {', '.ad-card {', '.rail-ad {', '.spon {', '.ev-body'])
    assert.ok(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^}]*var\\(--card-pad\\)').test(css), sel);
  assert.ok(/\.list, \.cl-list, \.evx-day[^}]*gap:var\(--card-gap\)/.test(css));
});

test('Events: no fixed card height or row heights; 40px foot and buttons', () => {
  assert.ok(css.includes('.evr { height:auto; min-height:164px; }'));
  assert.ok(css.includes('grid-template-rows:auto;'));
  assert.ok(css.includes('.evt-foot { height:auto; min-height:var(--card-tap);'));
  assert.ok(css.includes('.ev-go, .evt-foot .ev-go { min-height:var(--card-tap); }'));
});

test('tap targets: Report, Send flowers, ad buttons and links are at least 40px', () => {
  for (const r of ['.cl-link { min-height:var(--card-tap);', '.ob-flw a, .card .ob-flw a { display:inline-flex; align-items:center; min-height:var(--card-tap); }', '.rail-ad .rail-cta { min-height:var(--card-tap);', '.cl-links a { min-height:var(--card-tap); }'])
    assert.ok(css.includes(r), r);
});

test('spacing only: the block sets no colours or fonts, and the card rules are unchanged', () => {
  assert.ok(!/(^|[;{\s])(color|background|font(-family|-size|-weight)?|border-color)\s*:/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no colour or font changes');
  assert.ok(html.includes("var pic = safe ? '' : it.image;"), 'no photos on police items');
  assert.ok(html.includes("'Charged or arrested, not convicted.'"));
  assert.ok(html.includes("var AD_TABS = ['events', 'jobs', 'deals', 'classifieds'];"));
  assert.ok(html.includes('// at most ONE Breaking item'));
});

test('admin and creative pages use the same padding tokens', () => {
  for (const f of ['public/admin.html', 'public/creative.html']) {
    const h = read(f);
    assert.ok(h.includes(':root { --card-pad:16px;') && h.includes('@media (max-width:639px) { :root { --card-pad:12px; } }'), f);
  }
  assert.ok(read('public/admin.html').includes('section { padding:var(--card-pad); }'));
  assert.ok(read('public/creative.html').includes('form { padding:var(--card-pad); }'));
});
