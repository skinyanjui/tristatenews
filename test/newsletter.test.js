// Weekly digest: dry run by default, gated sending, per-recipient unsubscribe, one issue per week.
const test = require('node:test');
const assert = require('node:assert/strict');

const NOW = Date.now(), iso = t => new Date(t).toISOString();
const NEWS = {
  sources: [{ id: 'wfie', kind: 'news' }, { id: 'weht', kind: 'news' }, { id: 'epd', kind: 'police' }, { id: 'ev-x', kind: 'events' }],
  items: [
    ...[1, 2, 3].map(n => ({ title: 'WFIE story ' + n, link: 'https://www.14news.com/s' + n, source: '14 News', sourceId: 'wfie', published: iso(NOW - n * 36e5) })),
    { title: 'Bridge reopens <script>', link: 'https://www.tristatehomepage.com/b', source: 'Eyewitness News', sourceId: 'weht', published: iso(NOW - 5 * 36e5) },
    { title: 'Man arrested on Main St', link: 'https://evansvillepolice.com/a', source: 'EPD', sourceId: 'epd', published: iso(NOW - 36e5) },
    { title: 'Old story', link: 'https://www.14news.com/old', source: '14 News', sourceId: 'weht', published: iso(NOW - 9 * 864e5) },
    { title: 'Jazz night', link: 'https://example.org/jazz', source: 'Ev', sourceId: 'ev-x', isEvent: true, venue: 'Victory Theatre', published: iso(NOW + 2 * 864e5) },
    { title: 'Past concert', link: 'https://example.org/past', source: 'Ev', sourceId: 'ev-x', isEvent: true, published: iso(NOW - 2 * 864e5) },
  ],
};
const LISTINGS = { items: [{ title: 'Fall market', date: new Date(NOW + 3 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }), time: '09:00', place: 'Park', town: 'Henderson, KY' }] };

function setup(env) {
  const store = { 'tsn:nl:subs': new Set(['a@example.com', 'b@example.com']) }, calls = { resend: [] };
  Object.assign(process.env, { KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 't', CRON_SECRET: 'cron-secret', SITE_URL: 'https://site.test' }, env || {});
  global.fetch = async (url, opt) => {
    url = String(url);
    if (url === 'https://site.test/api/news') return Response.json(NEWS);
    if (url.startsWith('https://site.test/api/listings')) return Response.json(LISTINGS);
    if (url === 'https://kv.test/pipeline') {
      return Response.json(JSON.parse(opt.body).map(([op, k, ...a]) => {
        const s = store[k] instanceof Set ? store[k] : null;
        if (op === 'SMEMBERS') return { result: s ? [...s] : [] };
        if (op === 'SCARD') return { result: s ? s.size : 0 };
        if (op === 'SADD') { store[k] = s || new Set(); a.forEach(x => store[k].add(x)); return { result: a.length }; }
        if (op === 'SET') { if (a.includes('NX') && store[k] != null) return { result: null }; store[k] = a[0]; return { result: 'OK' }; }
        if (op === 'DEL') { delete store[k]; return { result: 1 }; }
        return { result: 1 };
      }));
    }
    if (url === 'https://api.resend.com/emails/batch') { calls.resend.push({ headers: opt.headers, body: JSON.parse(opt.body) }); return Response.json({ data: [] }); }
    throw new Error('unexpected fetch ' + url);
  };
  for (const m of ['../api/newsletter.js', '../api/unsubscribe.js']) delete require.cache[require.resolve(m)];
  return { nl: require('../api/newsletter.js'), unsub: require('../api/unsubscribe.js'), store, calls };
}
function call(nl, query, method, auth) {
  return new Promise(done => {
    const res = { headers: {}, code: 0, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; },
      json(o) { this.body = o; done(this); return this; }, send(b) { this.body = b; done(this); return this; } };
    nl({ method: method || 'GET', query: query || {}, headers: { authorization: auth === undefined ? 'Bearer cron-secret' : auth } }, res);
  });
}
const realFetch = global.fetch;
const CLEAN = ['NEWSLETTER_ENABLED', 'RESEND_API_KEY', 'NEWSLETTER_FROM', 'NEWSLETTER_POSTAL_ADDRESS', 'NEWSLETTER_SECRET'];
test.afterEach(() => { global.fetch = realFetch; CLEAN.forEach(k => delete process.env[k]); });

test('needs the cron secret', async () => {
  const { nl } = setup();
  assert.equal((await call(nl, {}, 'GET', '')).code, 404);
  assert.equal((await call(nl, {}, 'GET', 'Bearer nope')).code, 404);
});

test('dry run: builds the issue, sends nothing, lists what is missing', async () => {
  const { nl, calls } = setup();
  const r = await call(nl, { dry: '1' });
  assert.equal(r.code, 200); assert.equal(r.body.dryRun, true); assert.equal(calls.resend.length, 0);
  assert.equal(r.body.subscribers, 2);
  assert.equal(r.body.headlines, 3);                         // 2 per source, no police, nothing older than 7 days
  assert.equal(r.body.events, 2);                            // upcoming news event + listing event, not the past one
  assert.deepEqual(r.body.missingForSend.sort(), ['NEWSLETTER_ENABLED=true', 'NEWSLETTER_FROM', 'NEWSLETTER_POSTAL_ADDRESS', 'RESEND_API_KEY'].sort());
  assert.ok(!r.body.html.includes('Man arrested'));
  assert.ok(!r.body.html.includes('<script>'));               // escaped
  assert.ok(!r.body.html.includes('WFIE story 3'));
  assert.match(r.body.html, /unsubscribe\.html\?email=preview%40example\.com&amp;token=[0-9a-f]{32}/);
  assert.equal(r.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(r.body.headers['List-Unsubscribe'], /^<https:\/\/site\.test\/api\/unsubscribe\?email=preview%40example\.com&token=[0-9a-f]{32}>$/);
});

test('format=html answers the email itself', async () => {
  const { nl } = setup();
  const r = await call(nl, { format: 'html' });
  assert.match(r.headers['content-type'], /text\/html/); assert.match(r.body, /^<!doctype html>/); assert.match(r.body, /Jazz night/);
});

test('send=1 refuses unless enabled and configured', async () => {
  const { nl, calls } = setup({ RESEND_API_KEY: 're_x', NEWSLETTER_FROM: 'Tri-State News <news@example.com>', NEWSLETTER_POSTAL_ADDRESS: 'PO Box 1, Evansville, IN' });
  const r = await call(nl, { send: '1' }, 'POST');
  assert.equal(r.code, 409); assert.deepEqual(r.body.missing, ['NEWSLETTER_ENABLED=true']); assert.equal(calls.resend.length, 0);
  assert.equal((await call(nl, { send: '1' }, 'GET')).code, 405);
});

test('send: one email per subscriber with its own unsubscribe link, once per week', async () => {
  const { nl, unsub, calls } = setup({ NEWSLETTER_ENABLED: 'true', RESEND_API_KEY: 're_x', NEWSLETTER_FROM: 'Tri-State News <news@example.com>', NEWSLETTER_POSTAL_ADDRESS: 'PO Box 1, Evansville, IN 47708' });
  const r = await call(nl, { send: '1' }, 'POST');
  assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(r.body.sent, 2);
  assert.equal(calls.resend.length, 1);
  const mails = calls.resend[0].body;
  assert.deepEqual(mails.map(m => m.to[0]).sort(), ['a@example.com', 'b@example.com']);
  for (const m of mails) {
    const e = m.to[0], tok = /token=([0-9a-f]{32})>/.exec(m.headers['List-Unsubscribe'])[1];
    assert.ok(unsub.validToken(e, tok));                     // api/unsubscribe.js accepts the one-click link
    assert.ok(m.html.includes(unsub.link(e, 'https://site.test').replace(/&/g, '&amp;')));
    assert.ok(m.html.includes('PO Box 1, Evansville, IN 47708'));
    assert.match(m.text, /Unsubscribe: https:\/\/site\.test\/unsubscribe\.html/);
  }
  assert.ok(calls.resend[0].headers['idempotency-key']);
  const again = await call(nl, { send: '1' }, 'POST');
  assert.equal(again.body.sent, 0); assert.equal(again.body.skippedAlreadySent, 2); assert.equal(calls.resend.length, 1);
});
