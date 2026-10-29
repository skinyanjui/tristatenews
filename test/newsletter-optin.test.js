// Ads Phase 7: newsletter double opt-in (api/_subscribe.js), the admin's counts / CSV / issue preview / test copy,
// and the newsletter-sponsor gate (1,500 confirmed subscribers) on the catalog, /advertise, the panel and the order
// flow. No network: Upstash, Resend and the site's own /api/news are faked; keys are placeholders.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const API = path.join(root, 'api');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const ADMIN = 'admin-placeholder-key';
const NOW = Date.parse('2026-10-21T18:00:00Z');
const NEWS = { sources: [{ id: 'wfie', kind: 'news' }], items: [1, 2, 3].map(n => ({ title: 'Story ' + n, link: 'https://www.14news.com/s' + n, source: '14 News', sourceId: 'wfie', published: new Date(NOW - n * 36e5).toISOString() })) };
const PROVIDER = { RESEND_API_KEY: 're_placeholder', NEWSLETTER_FROM: 'Tri-State News <news@example.com>' };
const ALL = Object.assign({ NEWSLETTER_POSTAL_ADDRESS: 'PO Box 1, Evansville, IN 47708', NEWSLETTER_SECRET: 'nl-secret' }, PROVIDER);

function world() {
  const kv = new Map(), sets = new Map(), z = new Map(), log = [], mail = [];
  const S = k => { if (!sets.has(k)) sets.set(k, new Set()); return sets.get(k); };
  const Z = k => { if (!z.has(k)) z.set(k, new Map()); return z.get(k); };
  const run = ([op, k, ...a]) => {
    log.push([op, k, ...a]);
    switch (op) {
      case 'GET': return { result: kv.has(k) ? kv.get(k) : null };
      case 'SET': kv.set(k, a[0]); return { result: 'OK' };
      case 'DEL': return { result: kv.delete(k) ? 1 : 0 };
      case 'INCR': kv.set(k, String((Number(kv.get(k)) || 0) + 1)); return { result: Number(kv.get(k)) };
      case 'EXPIRE': return { result: 1 };
      case 'SADD': { const s = S(k), n = s.has(a[0]) ? 0 : 1; s.add(a[0]); return { result: n }; }
      case 'SREM': return { result: S(k).delete(a[0]) ? 1 : 0 };
      case 'SMEMBERS': return { result: [...S(k)] };
      case 'SCARD': return { result: S(k).size };
      case 'SISMEMBER': return { result: S(k).has(a[0]) ? 1 : 0 };
      case 'ZADD': Z(k).set(a[1], Number(a[0])); return { result: 1 };
      case 'ZREM': return { result: Z(k).delete(a[0]) ? 1 : 0 };
      case 'ZCARD': return { result: Z(k).size };
      case 'ZREMRANGEBYSCORE': { let n = 0; for (const [m, sc] of Z(k)) if (sc >= Number(a[0]) && sc <= Number(a[1])) { Z(k).delete(m); n++; } return { result: n }; }
      case 'SMEMBERS_': default: throw new Error('unexpected ' + op);
    }
  };
  const fetch = async (u, init) => {
    u = String(u);
    if (u === 'https://kv.test/pipeline') return new Response(JSON.stringify(JSON.parse(init.body).map(run)));
    if (u === 'https://api.resend.com/emails') { mail.push(JSON.parse(init.body)); return new Response('{"id":"x"}'); }
    if (u === 'https://site.test/api/news') return new Response(JSON.stringify(NEWS));
    if (u.startsWith('https://site.test/api/listings')) return new Response('{"items":[]}');
    throw new Error('unexpected fetch ' + u);
  };
  return { kv, sets, z, log, mail, fetch };
}
async function withWorld(env, fn) {
  const saved = { ...process.env }, realFetch = global.fetch, realNow = Date.now, w = world();
  const clear = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(API + path.sep)) delete require.cache[k]; };
  clear();
  for (const k of ['RESEND_API_KEY', 'NEWSLETTER_FROM', 'NEWSLETTER_POSTAL_ADDRESS', 'NEWSLETTER_SECRET', 'CRON_SECRET', 'RESEND_AUDIENCE_ID', 'STRIPE_SECRET_KEY', 'NEWSLETTER_ENABLED']) delete process.env[k];
  Object.assign(process.env, { UPSTASH_REDIS_REST_URL: 'https://kv.test', UPSTASH_REDIS_REST_TOKEN: 'fake', KV_REST_API_URL: '', KV_REST_API_TOKEN: '', LISTINGS_ADMIN_KEY: ADMIN, SITE_URL: 'https://site.test' }, env);
  global.fetch = w.fetch; Date.now = () => NOW;
  try {
    const host = require('../api/unsubscribe.js');
    const call = async (route, method, opts) => {
      opts = opts || {};
      const out = { status: 0, body: null };
      const res = { setHeader() {}, status(c) { out.status = c; return res; }, json(o) { out.body = o; return res; }, send(b) { out.body = typeof b === 'string' ? JSON.parse(b) : b; return res; }, end() { return res; } };
      const h = route === 'unsubscribe' ? host : route === 'packages' ? require('../api/inbox.js') : route === 'catalog' ? require('../api/listings.js') : host;
      await h({ method, url: '/api/' + route, query: Object.assign(route === 'unsubscribe' ? {} : { __route: route }, opts.query || {}), headers: Object.assign({ 'x-forwarded-for': opts.ip || '203.0.113.5' }, opts.admin ? { 'x-admin-key': opts.admin } : {}), body: opts.body || {} }, res);
      return out;
    };
    return await fn(w, call);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved); global.fetch = realFetch; Date.now = realNow; clear();
  }
}
const sub = (call, email, ip, extra) => call('subscribe', 'POST', { body: Object.assign({ email }, extra || {}), ip });

test('no email provider: the sign-up is saved as pending, nothing is sent, nobody is on the list, the admin sees it', () => withWorld({}, async (w, call) => {
  const r = await sub(call, 'Reader@Example.com');
  assert.deepStrictEqual([r.status, r.body.ok, r.body.pending, r.body.emailSent], [200, true, true, false]);
  assert.match(r.body.message, /confirmation emails aren’t switched on yet/);
  assert.strictEqual(w.mail.length, 0);
  assert.ok(!w.sets.has('tsn:nl:subs') || !w.sets.get('tsn:nl:subs').has('reader@example.com'), 'not on the list until confirmed');
  const pend = [...w.kv].find(([k]) => k.startsWith('tsn:nl:pend:'));
  assert.match(pend[0], /^tsn:nl:pend:[0-9a-f]{64}$/); assert.strictEqual(pend[1], 'reader@example.com');
  assert.ok(w.log.some(c => c[0] === 'SET' && c[1] === pend[0] && c[3] === 'EX' && c[4] === String(7 * 86400)), 'pending expires in 7 days');
  const adm = await call('subscribe', 'GET', { admin: ADMIN });
  assert.deepStrictEqual(adm.body.counts, { pending: 1, verified: 0, legacy: 0, unsubscribed: 0 });
  assert.deepStrictEqual([adm.body.provider.confirmReady, adm.body.provider.issueReady], [false, false]);
  assert.deepStrictEqual(adm.body.provider.missing.slice(0, 2), ['RESEND_API_KEY', 'NEWSLETTER_FROM']);
  assert.deepStrictEqual(adm.body.gate, { verified: 0, min: 1500 });
  assert.strictEqual((await call('subscribe', 'GET', { admin: 'wrong' })).status, 404);
}));

test('with Resend: a confirmation email with a one-time link and List-Unsubscribe; confirming adds the address once', () => withWorld(ALL, async (w, call) => {
  const r = await sub(call, 'reader@example.com');
  assert.deepStrictEqual([r.body.emailSent, r.body.message.startsWith('Almost done')], [true, true]);
  assert.strictEqual(w.mail.length, 1);
  const m = w.mail[0];
  assert.deepStrictEqual([m.to, m.from, m.subject], [['reader@example.com'], PROVIDER.NEWSLETTER_FROM, 'Confirm your Tri-State News subscription']);
  const token = /\/newsletter\?confirm=([0-9a-f]{64})/.exec(m.text)[1];
  assert.ok(!JSON.stringify([...w.kv]).includes(token), 'only the hash of the token is stored');
  assert.match(m.headers['List-Unsubscribe'], /^<https:\/\/site\.test\/api\/unsubscribe\?email=reader%40example\.com&token=[0-9a-f]{32}>$/);
  assert.strictEqual(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(m.html.includes('PO Box 1, Evansville, IN 47708') && m.text.includes('Unsubscribe: https://site.test/unsubscribe.html'));
  assert.strictEqual((await call('subscribe', 'POST', { body: { action: 'confirm', token: 'nothex' } })).status, 400);
  assert.strictEqual((await call('subscribe', 'POST', { body: { action: 'confirm', token: 'f'.repeat(64) } })).status, 404);
  const ok = await call('subscribe', 'POST', { body: { action: 'confirm', token } });
  assert.deepStrictEqual([ok.status, ok.body.confirmed], [200, true]);
  assert.ok(w.sets.get('tsn:nl:subs').has('reader@example.com') && w.sets.get('tsn:nl:confirmed').has('reader@example.com'));
  assert.strictEqual(w.z.get('tsn:nl:pending').size, 0);
  assert.strictEqual((await call('subscribe', 'POST', { body: { action: 'confirm', token } })).status, 404, 'a link works once');
  // signing up again with a confirmed address: the same answer, no new email
  const again = await sub(call, 'reader@example.com', '198.51.100.1');
  assert.deepStrictEqual([again.body.message, w.mail.length], [r.body.message, 1]);
  const adm = await call('subscribe', 'GET', { admin: ADMIN });
  assert.deepStrictEqual([adm.body.count, adm.body.emails, adm.body.counts.verified, adm.body.provider.issueReady], [1, ['reader@example.com'], 1, true]);
}));

test('a provider that fails: still saved as pending, honest message, no crash', () => withWorld(PROVIDER, async (w, call) => {
  global.fetch = async (u, i) => (String(u) === 'https://api.resend.com/emails' ? new Response('{}', { status: 500 }) : w.fetch(u, i));
  const r = await sub(call, 'reader@example.com');
  assert.deepStrictEqual([r.status, r.body.emailSent], [200, false]);
  assert.match(r.body.message, /couldn’t send the confirmation email just now/);
  assert.ok([...w.kv.keys()].some(k => k.startsWith('tsn:nl:pend:')));
}));

test('bot protection: honeypot writes nothing; 5 sign-ups a day per connection; bad addresses refused', () => withWorld({}, async (w, call) => {
  const hp = await sub(call, 'bot@example.com', '1.1.1.1', { website: 'http://spam' });
  assert.strictEqual(hp.status, 200); assert.strictEqual(w.log.length, 0, 'honeypot touches nothing');
  for (const bad of ['nope', 'a b@example.com', '<x>@y.co']) assert.strictEqual((await sub(call, bad)).status, 400, bad);
  for (let i = 0; i < 5; i++) assert.strictEqual((await sub(call, 'r' + i + '@example.com', '2.2.2.2')).status, 200);
  assert.strictEqual((await sub(call, 'r9@example.com', '2.2.2.2')).status, 429);
  assert.strictEqual((await sub(call, 'r9@example.com', '3.3.3.3')).status, 200);
}));

test('unsubscribe removes the address from the list, the verified set and pending, and records it', () => withWorld({}, async (w, call) => {
  for (const k of ['tsn:nl:subs', 'tsn:nl:confirmed']) w.sets.set(k, new Set(['reader@example.com']));
  const r = await call('unsubscribe', 'POST', { body: { email: 'reader@example.com' } });
  assert.strictEqual(r.status, 200);
  assert.ok(!w.sets.get('tsn:nl:subs').has('reader@example.com') && !w.sets.get('tsn:nl:confirmed').has('reader@example.com'));
  assert.ok(w.sets.get('tsn:nl:unsubs').has('reader@example.com'));
  await call('unsubscribe', 'POST', { body: { email: 'stranger@example.com' }, ip: '4.4.4.4' });
  assert.ok(!w.sets.get('tsn:nl:unsubs').has('stranger@example.com'), 'addresses never on the list are not recorded');
}));

test('admin compose: preview with the sponsor slot as a labeled sample; test copy only with a provider, only to one address; no list send', () => withWorld({}, async (w, call) => {
  const pv = await call('subscribe', 'GET', { admin: ADMIN, query: { preview: '1' } });
  assert.strictEqual(pv.body.ok, true, JSON.stringify(pv.body));
  assert.ok(pv.body.html.includes('Sample ad') && pv.body.html.includes('Ninebark Bakehouse') && pv.body.html.includes('Story 1'));
  assert.strictEqual(pv.body.sponsorSlot, 'sample');
  assert.ok(pv.body.missingForSend.includes('RESEND_API_KEY'));
  assert.strictEqual(w.mail.length, 0);
  const nl = require('../api/newsletter.js');
  const real = nl.render({ headlines: [], events: [], weekOf: 'x', subject: 's' }, 'a@example.com');
  assert.ok(!real.html.includes('Sample ad') && !real.html.includes('Sponsored'), 'a real issue carries no sponsor block today');
  const no = await call('subscribe', 'POST', { admin: ADMIN, body: { action: 'test', to: 'sam@example.com' } });
  assert.strictEqual(no.status, 409); assert.match(no.body.error, /Nothing was sent/);
  assert.strictEqual((await call('subscribe', 'POST', { body: { action: 'test', to: 'sam@example.com' } })).status, 404, 'not without the admin key');
  assert.strictEqual(w.mail.length, 0);
  assert.strictEqual((await call('subscribe', 'GET', { query: { preview: '1' } })).status, 404);
}));

test('admin test copy with the provider set: one email to the typed address, marked [Test]', () => withWorld(ALL, async (w, call) => {
  const r = await call('subscribe', 'POST', { admin: ADMIN, body: { action: 'test', to: 'sam@example.com' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual([w.mail.length, w.mail[0].to, w.mail[0].subject.startsWith('[Test] ')], [1, ['sam@example.com'], true]);
  assert.ok(w.mail[0].headers['List-Unsubscribe']);
}));

test('sponsor gate: the catalog shows the live count; newsletter orders refused on the server below 1,500 (and until the other gates)', () => withWorld({}, async (w, call) => {
  w.sets.set('tsn:nl:confirmed', new Set(['a@example.com', 'b@example.com']));
  const cat = await call('catalog', 'GET');
  assert.deepStrictEqual([cat.body.newsletterGate.verifiedSubscribers, cat.body.newsletterGate.minVerifiedSubscribers], [2, 1500]);
  assert.ok(Object.values(cat.body.newsletter).every(n => n.purchasable === false));
  for (const pkg of ['single', 'four', 'newsletter', 'NL']) {
    const r = await call('packages', 'POST', { body: { action: 'order', pkg, business: 'Shop', name: 'Pat', email: 'pat@example.com', agree: true } });
    assert.deepStrictEqual([r.status, r.body.error], [409, 'Newsletter sponsorship is coming soon — 2 of 1,500 subscribers.'], pkg);
  }
  const av = await call('packages', 'GET', { query: { pkg: 'single' } });
  assert.strictEqual(av.body.ok, false);
  const P = require('../api/_packages.js'), C = require('../api/_catalog.js');
  assert.match(P.newsletterGate(1500).error, /final launch checks pending/, 'the count alone never opens it');
  assert.strictEqual(C.NEWSLETTER.single.placement, 'newsletter:sponsor');
}));

test('wiring and pages: /newsletter rewrite, sign-up and confirm page, home box, advertise gating text, admin, policy', () => {
  const vj = JSON.parse(read('vercel.json'));
  assert.ok(vj.rewrites.some(r => r.source === '/newsletter' && r.destination === '/newsletter.html'));
  assert.strictEqual(fs.readdirSync(API).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
  const pg = read('public/newsletter.html');
  for (const s of ["action: 'confirm'", 'id="nlWebsite"', 'Confirm my subscription', "q.get('confirm')", 'one-click unsubscribe']) assert.ok(pg.includes(s), s);
  assert.ok(!/localStorage\.setItem|sessionStorage|document\.cookie/.test(pg));
  const idx = require('./_page.js')();
  assert.ok(idx.includes('href="/newsletter">Newsletter</a>') && idx.includes("o.d.message || 'Check your email to confirm.'") && idx.includes("' of ' + Number(g.minVerifiedSubscribers)"));
  const ad = read('data/pages/advertise.html');
  assert.ok(ad.includes("'Coming soon — ' + g.verifiedSubscribers.toLocaleString('en-US') + ' of '") && ad.includes('TSNSizes.newsletterPreview'));
  const S = require('../public/adsizes.js');
  assert.strictEqual(typeof S.newsletterPreview, 'function');
  const adm = read('public/admin.html');
  for (const s of ['id="nlc"', "get('/api/subscribe?preview=1')", 'sandbox=""', "action: 'test'", 'subscribers-verified.csv', 'Unconfirmed (before double opt-in)']) assert.ok(adm.includes(s), s);
  const legal = read('public/legal.html').replace(/<[^>]+>/g, '');
  for (const s of ['We send nothing until you confirm', 'an unconfirmed sign-up expires after 7 days', 'one-click unsubscribe link and our postal address', 'at least 1,500 confirmed (double opt-in) subscribers', 'one-way version of it', 'do-not-email list'])
    assert.ok(legal.includes(s), s);
  assert.ok(read('public/legal.html').includes('data-ph="address">[MAILING ADDRESS]'), 'the postal address is still a flagged placeholder');
  assert.ok(read('docs/legal-review.md').includes('36. **CAN-SPAM postal address'));
});
