'use strict';
// Jobs/Deals phone footers wrap instead of spilling past the card. Chip rows stay one nowrap scroller.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public/assets/app.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/assets/app.js'), 'utf8');
const API = path.join(root, 'api');

test('ship115: Jobs and Deals cards stay in-bounds; chips stay nowrap; samples remain', () => {
  assert.match(css, /#jb \.job, #dl \.deal \{[^}]*overflow:visible/);
  assert.match(css, /article\.card\.row\.row:not\(\.breaking\):has\(> \.ca\) \.src \{[^}]*flex-wrap:nowrap/);
  assert.match(css, /#cl \.cl-chips, #jb \.cl-chips, #dl \.cl-chips, #ev \.cl-chips \{[\s\S]*?flex-wrap:nowrap/);
  assert.ok(!/html\s*\{[^}]*overflow-x:\s*hidden/.test(css));
  assert.ok(!/body\s*\{[^}]*overflow-x:\s*hidden/.test(css));
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  assert.match(js, /BOARD_SAMPLES = \{ on: true/);
  assert.ok((js.match(/id: 'sjob\d+'/g) || []).length >= 8);
  assert.ok((js.match(/id: 'sdeal\d+'/g) || []).length >= 8);
});
