// Ads PR 4.2: advertiser lead statuses in the admin inquiry inbox. Each inquiry (tsn:ads) gets a status (new,
// contacted, proposal sent, won, lost, spam), our notes and a history in tsn:lead:<ref>, and every change goes in
// tsn:lead:log. Only an admin can change a lead; nothing ever emails the advertiser. The inquiry form gains an optional
// package and budget band (from the catalog). No network: Upstash and Resend are faked by intercepting fetch.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const L = require('../api/_leads.js');
const C = require('../api/_catalog.js');
const ADMIN = 'admin-placeholder-key';

function fakeWorld() {
  const kv = new Map(), exp = new Map(), lists = new Map(), mails = [];
  const run = ([op, k, ...a]) => {
    switch (op) {
      case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
      case 'MGET': return { result: [k, ...a].map(x => (kv.has(x) ? kv.get(x) : null)) };
      case 'SET': { kv.set(k, a[0]); const i = a.indexOf('EX'); if (i >= 0) exp.set(k, Number(a[i + 1])); return { result: 'OK' }; }
      case 'INCR': { const v = Number(kv.get(k) || 0) + 1; kv.set(k, String(v)); return { result: v }; }
      case 'EXPIRE': return { result: 1 };
      case 'LPUSH': { const l = lists.get(k) || []; lists.set(k, l); l.unshift(...a); return { result: l.length }; }
      case 'LTRIM': { const l = lists.get(k) || []; lists.set(k, l.slice(Number(a[0]), Number(a[1]) + 1)); return { result: 'OK' }; }
      case 'LRANGE': return { result: (lists.get(k) || []).slice(Number(a[0]), Number(a[1]) + 1) };
      default: throw new Error('unexpected command ' + op);
    }
  };
  const fetch = async (u, init) => {
    if (String(u) === 'https://api.resend.com/emails') { mails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
    if (!String(u).startsWith('https://kv.test/')) throw new Error('unexpected fetch ' + u);
    return new Response(JSON.stringify(JSON.parse(init.body).map(run)), { status: 200 });
  };
  return { kv, exp, lists, mails, fetch };
}
const ENV = { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', LISTINGS_ADMIN_KEY: ADMIN,
  RESEND_API_KEY: 'resend-placeholder', TIPS_TO_EMAIL: 'inbox@tsn.test', TIPS_FROM_EMAIL: '' };
async function withWorld(fn) {
  const saved = { ...process.env }, realFetch = global.fetch, w = fakeWorld();
  const clear = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k]; };
  clear(); Object.assign(process.env, ENV); global.fetch = w.fetch;
  try {
    const inbox = require('../api/inbox.js');
    const call = async (method, opts) => {
      opts = opts || {};
      const out = { status: 0, body: null };
      const res = { setHeader() {}, status(c) { out.status = c; return res; }, send(b) { out.body = typeof b === 'string' ? JSON.parse(b) : b; return res; }, json(o) { out.body = JSON.parse(JSON.stringify(o)); return res; } };
      const headers = Object.assign({ 'x-forwarded-for': '203.0.113.7' }, opts.admin ? { 'x-admin-key': opts.admin === true ? ADMIN : opts.admin } : {});
      await inbox({ method, url: '/api/advertise', query: { __route: 'advertise' }, headers, body: opts.body }, res);
      return out;
    };
    return await fn({ w, call });
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved); global.fetch = realFetch; clear();
  }
}
const FORM = { business: 'Main Street Shop', name: 'Pat Doe', email: 'pat@shop.test', interest: 'Section sponsorship', message: 'Hello' };

test('the statuses, labels and rules', () => {
  assert.deepStrictEqual(L.STATUSES, ['new', 'contacted', 'proposal_sent', 'won', 'lost', 'spam']);
  assert.deepStrictEqual(L.STATUSES.map(s => L.LABELS[s]), ['New', 'Contacted', 'Proposal sent', 'Won', 'Lost', 'Spam']);
  const now = Date.parse('2026-10-18T18:00:00Z');
  const a = L.change(L.blank('AD-ABCDEF12'), { action: 'status', status: 'contacted', note: 'Called, left a message' }, now);
  assert.strictEqual(a.rec.status, 'contacted');
  assert.deepStrictEqual(a.entry, { at: '2026-10-18T18:00:00.000Z', ref: 'AD-ABCDEF12', action: 'status', from: 'new', to: 'contacted', note: 'Called, left a message' });
  assert.deepStrictEqual(a.rec.notes, [{ at: a.entry.at, text: 'Called, left a message' }]);
  assert.strictEqual(a.rec.history.length, 1);
  assert.strictEqual(L.change(a.rec, { action: 'status', status: 'contacted' }, now).code, 409, 'no change, no entry');
  assert.strictEqual(L.change(a.rec, { action: 'status', status: 'closed' }, now).code, 400);
  assert.strictEqual(L.change(a.rec, { action: 'note', note: ' ' }, now).code, 400);
  assert.strictEqual(L.change(a.rec, { action: 'delete' }, now).code, 400, 'nothing can be erased from the history');
  const n = L.change(a.rec, { action: 'note', note: 'x'.repeat(900) }, now);
  assert.strictEqual(n.rec.status, 'contacted'); assert.strictEqual(n.rec.notes[1].text.length, L.NOTE_MAX); assert.strictEqual(n.entry.action, 'note');
  let r = L.blank('AD-ABCDEF12');
  for (let i = 0; i < 120; i++) r = L.change(r, { action: 'note', note: 'note ' + i }, now + i).rec;
  assert.strictEqual(r.notes.length, L.NOTES_MAX); assert.strictEqual(r.history.length, L.HISTORY_MAX); assert.strictEqual(r.notes[r.notes.length - 1].text, 'note 119');
  assert.deepStrictEqual(L.normalize('AD-X1234', { status: 'hacked', notes: 'x', history: [null] }), L.blank('AD-X1234'));
  const cmds = L.saveCommands(a.rec, a.entry);
  assert.deepStrictEqual(cmds.map(c => c[0]), ['SET', 'LPUSH', 'LTRIM']);
  assert.deepStrictEqual(cmds[0].slice(3), ['EX', String(400 * 86400)], 'kept 400 days after the last change');
  assert.deepStrictEqual(cmds[2], ['LTRIM', 'tsn:lead:log', '0', '999']);
});

test('the inquiry form: optional package and budget band, checked against the catalog', () => withWorld(async ({ w, call }) => {
  const ok = await call('POST', { body: Object.assign({ package: 'B', budget: 'a_b' }, FORM) });
  assert.strictEqual(ok.status, 200); assert.match(ok.body.ref, /^AD-[0-9A-Z]{8}$/);
  const stored = JSON.parse(w.lists.get('tsn:ads')[0]);
  assert.deepStrictEqual([stored.package, stored.budget], ['B', 'a_b']);
  assert.strictEqual(w.mails.length, 1, 'still emailed to our inbox');
  assert.deepStrictEqual(w.mails[0].to, ['inbox@tsn.test'], 'to our own inbox only');
  assert.ok(w.mails[0].html.includes('Package B') && w.mails[0].html.includes('Budget per 30 days: $249 to $599'));
  await call('POST', { body: Object.assign({ package: 'Z', budget: '$1,000,000' }, FORM) });
  const odd = JSON.parse(w.lists.get('tsn:ads')[0]);
  assert.deepStrictEqual([odd.package, odd.budget], ['', ''], 'anything else is dropped');
  assert.deepStrictEqual(C.publicCatalog(false).budgets.map(b => b.key), ['under_a', 'a_b', 'b_c', 'c_d', 'd_up', 'unsure']);
  assert.deepStrictEqual(C.budgetBands().slice(0, 5).map(b => b.label), ['Under $249', '$249 to $599', '$599 to $1,199', '$1,199 to $2,499', '$2,499 or more'], 'cut at the package prices');
}));

test('admin: list with statuses, change a status with a note, add a note, history and activity log; never emails the advertiser', () => withWorld(async ({ w, call }) => {
  const ref = (await call('POST', { body: FORM })).body.ref;
  const mailsAfterForm = w.mails.length;
  let g = await call('GET', { admin: true });
  assert.strictEqual(g.status, 200);
  assert.strictEqual(g.body.items[0].lead.status, 'new', 'untouched inquiries are new');
  assert.deepStrictEqual(g.body.statuses.map(s => s.key), L.STATUSES);
  assert.strictEqual(g.body.counts.new, 1);
  const c = await call('POST', { admin: true, body: { action: 'status', ref, status: 'proposal_sent', note: 'Sent the Package B proposal' } });
  assert.strictEqual(c.status, 200); assert.strictEqual(c.body.lead.status, 'proposal_sent');
  assert.strictEqual(w.exp.get('tsn:lead:' + ref), 400 * 86400);
  assert.strictEqual((await call('POST', { admin: true, body: { action: 'status', ref, status: 'proposal_sent' } })).status, 409);
  assert.strictEqual((await call('POST', { admin: true, body: { action: 'note', ref: ref.toLowerCase(), note: 'They want to start in November' } })).status, 200);
  assert.strictEqual((await call('POST', { admin: true, body: { action: 'status', ref, status: 'won' } })).status, 200);
  g = await call('GET', { admin: true });
  const lead = g.body.items[0].lead;
  assert.strictEqual(lead.status, 'won');
  assert.deepStrictEqual(lead.history.map(h => [h.action, h.from, h.to]), [['status', 'new', 'proposal_sent'], ['note', 'proposal_sent', 'proposal_sent'], ['status', 'proposal_sent', 'won']]);
  assert.deepStrictEqual(lead.notes.map(n => n.text), ['Sent the Package B proposal', 'They want to start in November']);
  assert.deepStrictEqual(g.body.log.map(x => x.action + ':' + x.to), ['status:won', 'note:proposal_sent', 'status:proposal_sent'], 'newest first');
  assert.deepStrictEqual([g.body.counts.won, g.body.counts.new], [1, 0]);
  assert.strictEqual(w.mails.length, mailsAfterForm, 'no email for any status change or note');
  assert.ok(!/resend|fetch\(/i.test(read('api/_leads.js')), 'the lead rules have no way to send anything');
}));

test('only an admin can see or change leads, and only for a real inquiry', () => withWorld(async ({ w, call }) => {
  const ref = (await call('POST', { body: FORM })).body.ref;
  assert.strictEqual((await call('GET')).status, 404);
  assert.strictEqual((await call('GET', { admin: 'wrong' })).status, 404);
  assert.strictEqual((await call('POST', { admin: 'wrong', body: { action: 'status', ref, status: 'spam' } })).status, 404);
  const pub = await call('POST', { body: { action: 'status', ref, status: 'spam' } });
  assert.strictEqual(pub.status, 400, 'without the admin header it is just the public form (and fails validation)');
  assert.strictEqual((await call('POST', { admin: true, body: { action: 'status', ref: 'AD-NOPE0001', status: 'won' } })).status, 404, 'no record for a made-up reference');
  assert.strictEqual((await call('POST', { admin: true, body: { action: 'status', ref: 'tsn:ads', status: 'won' } })).status, 400);
  assert.ok(![...w.kv.keys()].some(k => k.startsWith('tsn:lead:')), 'nothing written');
  assert.strictEqual((await call('PUT', { admin: true })).status, 405);
}));

test('admin page and policy: the status menu, notes, history, the activity log, and the Privacy Policy row', () => {
  const html = read('public/admin.html');
  for (const s of ['id="adf"', 'id="adl"', "action: 'status'", "action: 'note'", 'History (', 'Open (all but spam)', 'never emails the advertiser', "timeZone: 'America/Chicago'"]) assert.ok(html.includes(s), s);
  assert.ok(!/mailto:/.test(html), 'no email links to leads');
  const legal = read('public/legal.html').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const s of ['the package and budget you pick (optional)', 'new, contacted, proposal sent, won, lost or spam', 'kept 400 days after the last change', 'an inquiry we’ve marked as spam doesn’t count']) assert.ok(legal.includes(s), s);
  const page = read('data/pages/advertise.html');
  assert.ok(page.includes('id="package"') && page.includes('id="budget"') && page.includes('cat.budgets'));
});
