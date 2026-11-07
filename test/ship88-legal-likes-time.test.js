// ship88: legal entity/address/county filled (DMCA agent left for Sam); the bottom-row like count never overlaps the
// posted time; posted times short again ("12m ago", "8h ago", "3d ago") with the full date in title and aria-label.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('legal: entity, address, county filled; DMCA agent still a placeholder', () => {
  const h = read('public/legal.html');
  assert.ok(h.includes("entity:    'TristateNow.com',"));
  assert.ok(h.includes("address:   'P.O. Box 15, Evansville, Indiana 47714',"));
  assert.ok(h.includes("county:    'Vanderburgh'"));
  assert.ok(h.includes('<span data-ph="county">Vanderburgh</span> County, Indiana'), 'reads "Vanderburgh County, Indiana"');
  assert.ok(h.includes("dmcaName:  '',") && h.includes("dmcaEmail: '',"));
});

test('like count reserves its own room on the meta line', () => {
  const css = read('public/assets/app.css');
  assert.ok(css.includes('article.card.row.row:not(.breaking):has(> .ca):has(.acts .like) .src.src { padding-right:calc(var(--nact, 2) * (var(--ico) + var(--act-gap)) + var(--sp-1) + 4ch); }'));
});

test('posted time: short text, full date in title and aria-label (page and server)', () => {
  const C = require('../api/_cards.js');
  const src = read('api/_cards.js'), m = src.match(/function shortWhen\(iso, now\) \{[\s\S]*?\n\}/);
  const TZ = 'America/Chicago';
  const shortWhen = new Function('TZ', m[0] + '; return shortWhen;')(TZ);
  const now = Date.parse('2026-11-04T14:00:00Z'), ago = ms => new Date(now - ms).toISOString();
  assert.equal(shortWhen(ago(20e3), now), 'Just now');
  assert.equal(shortWhen(ago(12 * 6e4), now), '12m ago');
  assert.equal(shortWhen(ago(8 * 36e5), now), '8h ago');
  assert.equal(shortWhen(ago(3 * 864e5), now), '3d ago');
  assert.equal(shortWhen(ago(10 * 864e5), now), 'October 25', 'older: spelled-out month');
  // ship110: the full date drops the time for a story dated by day only (datePrecision 'day')
  assert.ok(src.includes(`aria-label="' + esc(full) + '"'`) && src.includes("full = timeAgo(it.published, dayOnly)"));
  const js = read('public/assets/app.js');
  assert.equal((js.match(/w\.title = timeAgo\(it\.published, it\.datePrecision === 'day'\); w\.setAttribute\('aria-label', w\.title\);/g) || []).length, 2);
  assert.ok(js.includes("if (m < 1) return 'Just now'; if (m < 60) return m + 'm ago';"));
  assert.ok(C);
});
