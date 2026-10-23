#!/usr/bin/env node
// Read-only check for plan PR 3.1 ("live snapshot diff: 0 sources changed"). Compares the public sources[] list of
// /api/news (one GET, no refresh, no Redis, no credentials) on the fields a reader sees: id, name, area, kind, logo,
// and the order. Health fields (ok, count, lastOk, stale) change every run and are ignored.
//
//   node scripts/sources-diff.js                     live site vs this checkout's registry
//   node scripts/sources-diff.js --save before.json  the same, and save the live answer to before.json
//   node scripts/sources-diff.js before.json         a saved answer vs live (run after the deploy)
//   node scripts/sources-diff.js a.json b.json       two saved answers
// SITE_URL overrides https://tristatenewss.vercel.app. Exit 0: 0 sources changed; 1: differences; 2: error.
// Note: GET /api/news starts a visitor refresh only when the stored snapshot is more than 3 hours old.
const fs = require('fs');
const path = require('path');

const FIELDS = ['id', 'name', 'area', 'kind', 'logo'];
const SITE = (process.env.SITE_URL || 'https://tristatenewss.vercel.app').replace(/\/+$/, '');

// logoFor() as api/news.js had it at ba8b34a (the snapshot this check compares against). Since ship56 news.js
// self-hosts twelve icons (LOGOS) and reads a Google News URL's site: domain; this historical check keeps the old rule.
function logoFor(url) {
  try { return 'https://www.google.com/s2/favicons?sz=128&domain=' + new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

// sources[] as the snapshot would list it, from this checkout's registry (EXTRA_FEEDS as set in this shell).
function registrySources() {
  const { SOURCES } = require(path.join(__dirname, '../api/_sources.js'));
  return SOURCES.map(s => ({ logo: logoFor(s.url), id: s.id, name: s.name, area: s.area || '', kind: s.kind || 'news' }));
}

function pick(s) { const o = {}; for (const f of FIELDS) o[f] = s[f] === undefined ? null : s[f]; return o; }

// { added, removed, changed: [{id, field, before, after}], orderSame, changedCount }
function compare(before, after) {
  const a = (before || []).map(pick), b = (after || []).map(pick);
  const A = new Map(a.map(s => [s.id, s])), B = new Map(b.map(s => [s.id, s]));
  const added = b.filter(s => !A.has(s.id)).map(s => s.id), removed = a.filter(s => !B.has(s.id)).map(s => s.id);
  const changed = [];
  for (const s of a) if (B.has(s.id)) for (const f of FIELDS) if (s[f] !== B.get(s.id)[f]) changed.push({ id: s.id, field: f, before: s[f], after: B.get(s.id)[f] });
  const common = id => A.has(id) && B.has(id);
  const orderSame = J(a.map(s => s.id).filter(common)) === J(b.map(s => s.id).filter(common));
  const ids = new Set([...added, ...removed, ...changed.map(c => c.id)]);
  return { added, removed, changed, orderSame, changedCount: ids.size + (orderSame ? 0 : 1) };
}
const J = JSON.stringify;

function sourcesOf(doc, label) {
  if (!doc || !Array.isArray(doc.sources)) throw new Error(label + ': no sources[] array');
  return doc.sources;
}
async function live() {
  const r = await fetch(SITE + '/api/news', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('GET ' + SITE + '/api/news: HTTP ' + r.status);
  return r.json();
}
const readDoc = f => JSON.parse(fs.readFileSync(f, 'utf8'));

async function main(argv) {
  let save = null; const files = [];
  for (let i = 0; i < argv.length; i++) { if (argv[i] === '--save') save = argv[++i]; else files.push(argv[i]); }
  if (save === undefined || files.length > 2) throw new Error('usage: sources-diff.js [--save file] [before.json [after.json]]');
  let before, after, la, lb;
  if (files.length === 2) { before = sourcesOf(readDoc(files[0]), files[0]); after = sourcesOf(readDoc(files[1]), files[1]); la = files[0]; lb = files[1]; }
  else {
    const doc = await live();
    if (save) fs.writeFileSync(save, J(doc, null, 1) + '\n');
    after = sourcesOf(doc, 'live'); lb = 'live ' + SITE + ' (updatedAt ' + doc.updatedAt + ')';
    if (files.length === 1) { before = sourcesOf(readDoc(files[0]), files[0]); la = files[0]; }
    else { before = registrySources(); la = 'registry'; }
  }
  const d = compare(before, after);
  console.log(la + ': ' + before.length + ' sources; ' + lb + ': ' + after.length + ' sources');
  for (const id of d.added) console.log('ADDED   ' + id);
  for (const id of d.removed) console.log('REMOVED ' + id);
  for (const c of d.changed) console.log('CHANGED ' + c.id + '.' + c.field + ': ' + J(c.before) + ' -> ' + J(c.after));
  if (!d.orderSame) console.log('ORDER   differs');
  console.log('RESULT: ' + d.changedCount + ' sources changed' + (d.orderSame ? ', order same' : ''));
  return d.changedCount === 0 ? 0 : 1;
}

if (require.main === module) main(process.argv.slice(2)).then(c => process.exit(c), e => { console.error('error: ' + e.message); process.exit(2); });
module.exports = { compare, registrySources, logoFor, FIELDS };
