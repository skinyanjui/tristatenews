// Self-serve advertising packages A-C (ads Phase 6). Package D, newsletter ads and sponsored features stay off sale.
//   GET  /api/packages                         public: what each package holds, the lead time, and whether card
//                                              payment is open ({ packages, boards, leadDays, aheadDays, card })
//   GET  /api/packages?pkg=B&boards=jobs,deals&start=2026-11-02   public: is that package free for those dates?
//                                              -> { ok, start, end, placements } or { ok: false, error }
//   POST /api/packages {action:'order', pkg, boards[], start, business, name, email, phone?, agree, website}
//        -> { ok, ref, start, end, cents }  the order is saved as 'pending_payment' and its shares are held for
//        HOLD_DAYS; the reference (AD-...) also opens the advertiser's lead in the inquiry inbox and, with the same
//        email, the creative upload page (api/_creative.js access), so nothing new is needed to send the ad.
//   POST /api/packages {action:'checkout', ref, email}  after a creative is uploaded for the reference:
//        Stripe configured -> { url } (Stripe Checkout, one 30-day payment; api/stripe-webhook.js marks it paid)
//        not configured, or Stripe fails -> { ok, invoice: true }: the order stays 'pending_payment' and we invoice
//   GET  /api/packages  with x-admin-key       every order (newest 200) with its creatives, and the action log
//   POST /api/packages  with x-admin-key {action:'invoiced'|'paid'|'activate'|'cancel', ref, note?, creativeId?}
//        invoiced: pending_payment -> invoiced (note: the invoice number)
//        paid:     pending_payment|invoiced|checkout -> paid (note required: how it was paid)
//        activate: paid -> active: books a campaign (api/_campaigns.js) for the package's placements with an
//                  approved creative of this reference, within the caps. A late activation keeps the full 30 days.
//        cancel:   anything not active -> cancelled (note required); releases the held shares
// (vercel.json rewrites /api/packages to /api/inbox?__route=packages; no new function.)
//
// What each package holds (api/_catalog.js PACKAGES[k].contents), for 30 days, as one rotating share of each
// placement (the caps in api/_campaigns.js: 3 shares per card or sponsor line, 2 per side-ad rail). No targeting.
//   A  the Sponsored card on one board (300x250) and that board's sponsor line
//   B  the News in-feed card (728x90 / 320x100), the Sponsored card on two boards and one of those boards' sponsor line
//   C  the News in-feed card, the Sponsored card on all four boards, two boards' sponsor lines and both side ads
//      (160x600 / 300x600 on wide screens)
//
// Storage (Upstash Redis): tsn:pkg:<ref> the order; tsn:pkg:index (zset by time); tsn:pkg:open (orders that hold
// shares: not yet active, cancelled or refunded); tsn:pkg:log (admin actions, newest first); tsn:pkg:rl:<ip>.
// Nothing here emails anyone. Payment never happens here: Stripe takes it, or Sam invoices by hand.
const crypto = require('crypto');
const STORE = require('./_store.js'); // the one Redis helper (pipeline, stored)
const { same } = require('./_safe.js');
const CATALOG = require('./_catalog.js');
const CAMP = require('./_campaigns.js');
const ADMIN = process.env.LISTINGS_ADMIN_KEY || '';
const KEY = process.env.STRIPE_SECRET_KEY || '';

const SELF_SERVE = ['A', 'B', 'C'];
const BOARDS = CAMP.BOARDS;
const LEAD_DAYS = 3, AHEAD_DAYS = 90, HOLD_DAYS = 7, INVOICE_HOLD_DAYS = 14, DAILY_PER_IP = 3, LIST_MAX = 200, LOG_KEEP = 500, NOTE_MAX = 300;
const STATUSES = ['pending_payment', 'checkout', 'invoiced', 'paid', 'active', 'cancelled', 'refunded'];
const LABELS = { pending_payment: 'Pending payment', checkout: 'At checkout', invoiced: 'Invoiced', paid: 'Paid', active: 'Active', cancelled: 'Cancelled', refunded: 'Refunded' };
const HOLDING = ['pending_payment', 'checkout', 'invoiced', 'paid'];
const REF_RE = /^AD-[A-Z0-9]{6,10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?1?[\s.-]*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}$/;
const K = { rec: ref => 'tsn:pkg:' + ref, index: 'tsn:pkg:index', open: 'tsn:pkg:open', log: 'tsn:pkg:log', rl: ip => 'tsn:pkg:rl:' + ip };
const DAY = 864e5;
const dayNum = d => Math.round(Date.parse(d + 'T00:00:00Z') / DAY);
const dateOf = n => new Date(n * DAY).toISOString().slice(0, 10);
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) && Number.isFinite(dayNum(d)) && dateOf(dayNum(d)) === d;
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (_) { return null; } };
// A real Stripe secret key, not a placeholder. Anything else means: invoice by hand.
const cardReady = () => /^(sk|rk)_(test|live)_[A-Za-z0-9]{20,}$/.test(KEY) && STORE.stored();

// How many boards the advertiser picks, and what those picks mean.
const PICKS = { A: 1, B: 2, C: 2 };
const PICK_HELP = { A: 'Pick the board for your card and sponsor line.', B: 'Pick two boards for your cards; the first also gets your sponsor line.', C: 'Your card runs on every board. Pick the two boards for your sponsor lines.' };

// The placements a package holds for the boards picked -> { placements } or { error }.
function placementsFor(pkg, boards) {
  if (!SELF_SERVE.includes(pkg)) return { error: 'Pick Package A, B or C.' };
  const picks = [...new Set((Array.isArray(boards) ? boards : String(boards || '').split(',')).map(String).map(s => s.trim()).filter(Boolean))];
  if (picks.length !== PICKS[pkg] || picks.some(b => !BOARDS.includes(b))) return { error: PICK_HELP[pkg] };
  const c = CATALOG.PACKAGES[pkg].contents, out = [];
  if (c.newsCard) out.push('card:news');
  (c.boardCards >= BOARDS.length ? BOARDS : picks.slice(0, c.boardCards)).forEach(b => out.push('card:' + b));
  picks.slice(0, c.sponsorLines).forEach(b => out.push('line:' + b));
  if (c.sideAds) out.push('rail:left', 'rail:right');
  return { placements: out, boards: picks };
}

// The 30 days from a start date the advertiser picked -> { start, end } or { error }.
function flight(pkg, start, now) {
  const t = CAMP.today(now);
  if (!validDate(start)) return { error: 'Pick a start date.' };
  if (dayNum(start) - dayNum(t) < LEAD_DAYS) return { error: 'Start at least ' + LEAD_DAYS + ' days from today, so we can review your ad.' };
  if (dayNum(start) - dayNum(t) > AHEAD_DAYS) return { error: 'Start within ' + AHEAD_DAYS + ' days.' };
  return { start, end: dateOf(dayNum(start) + CATALOG.PACKAGES[pkg].days - 1) };
}

// Does an order still hold its shares? Unpaid ones let go after HOLD_DAYS (INVOICE_HOLD_DAYS once invoiced).
function holds(o, now) {
  if (!o || !HOLDING.includes(o.status)) return false;
  if (o.status === 'paid') return true;
  const since = Date.parse(o.status === 'invoiced' ? o.invoicedAt || o.at : o.at) || 0;
  return now - since < (o.status === 'invoiced' ? INVOICE_HOLD_DAYS : HOLD_DAYS) * DAY;
}
// Orders as campaign-shaped records, so api/_campaigns.js overCap counts them with the booked campaigns.
const asCampaigns = (orders, now, except) => orders.filter(o => o.ref !== except && holds(o, now)).map(o => ({ status: 'active', placements: o.placements, start: o.start, end: o.end }));

// The whole check for a new order -> { pkg, boards, placements, start, end } or { error, field, code }.
function check(b, campaigns, orders, now) {
  const pkg = String(b.pkg || '').toUpperCase();
  const el = CATALOG.packageEligibility(pkg);
  if (!SELF_SERVE.includes(pkg) || !el.ok) return { error: 'That package isn’t sold online. Ask us about it on the Advertise page.', field: 'pkg', code: 400 };
  const p = placementsFor(pkg, b.boards);
  if (p.error) return { error: p.error, field: 'boards', code: 400 };
  const f = flight(pkg, String(b.start || ''), now);
  if (f.error) return { error: f.error, field: 'start', code: 400 };
  const over = CAMP.overCap(campaigns.concat(asCampaigns(orders, now)), p.placements, f.start, f.end);
  if (over) return { error: 'That package is sold out for some of those days (' + describe(over.placement) + ' on ' + over.day + '). Try a later start date' + (PICKS[pkg] ? ' or other boards' : '') + '.', field: 'start', code: 409, over };
  return { pkg, boards: p.boards, placements: p.placements, start: f.start, end: f.end };
}
function describe(p) {
  const [k, w] = p.split(':');
  if (p === 'card:news') return 'the News card';
  if (k === 'card') return 'the ' + w + ' card';
  if (k === 'line') return 'the ' + w + ' sponsor line';
  return 'the side ads';
}

function contact(b) {
  const business = clean(b.business, 80), name = clean(b.name, 60), email = clean(b.email, 80), phone = clean(b.phone, 20);
  if (business.length < 2) return { error: 'Add your business name.', field: 'business' };
  if (name.length < 2) return { error: 'Add your name.', field: 'name' };
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid email address.', field: 'email' };
  if (phone && !PHONE_RE.test(phone)) return { error: 'Enter a phone number like 812-555-0142, or leave it blank.', field: 'phone' };
  if (b.agree !== true) return { error: 'Agree to the Advertising Policy and Terms to continue.', field: 'agree' };
  return { business, name, email, phone };
}

// An admin action on an order -> { rec, entry } or { error, code }. activate is handled with its campaign in the handler.
function change(o, action, note, now) {
  const n = clean(note, NOTE_MAX), at = new Date(now).toISOString();
  const from = { invoiced: ['pending_payment', 'checkout'], paid: ['pending_payment', 'checkout', 'invoiced'], cancel: ['pending_payment', 'checkout', 'invoiced', 'paid'], activate: ['paid'] }[action];
  if (!from) return { error: 'bad request', code: 400 };
  if (!from.includes(o.status)) return { error: 'This order is ' + LABELS[o.status] + '.', code: 409 };
  if ((action === 'paid' || action === 'cancel') && n.length < 3) return { error: action === 'paid' ? 'Say how it was paid (kept in the log).' : 'Give a reason (kept in the log).', code: 400 };
  const to = { invoiced: 'invoiced', paid: 'paid', cancel: 'cancelled', activate: 'active' }[action];
  const rec = Object.assign({}, o, { status: to, updatedAt: at, history: (o.history || []).concat([{ at, action, note: n }]) });
  if (to === 'invoiced') rec.invoicedAt = at;
  if (to === 'paid') { rec.paidAt = at; rec.paidBy = 'manual'; }
  return { rec, entry: { at, ref: o.ref, action, from: o.status, to, note: n } };
}

// The admin activation: a campaign for the order's placements, starting no earlier than today, 30 days long.
function activation(o, creative, campaigns, orders, now) {
  const t = CAMP.today(now);
  const start = o.start < t ? t : o.start, end = o.start < t ? dateOf(dayNum(t) + CATALOG.PACKAGES[o.pkg].days - 1) : o.end;
  if (!creative || creative.ref !== o.ref) return { error: 'Approve a creative sent with this reference first.', code: 400 };
  return CAMP.newCampaign({ placements: o.placements, start, end, note: o.pkg ? 'Package ' + o.pkg + ' order ' + o.ref : o.ref }, creative, campaigns.concat(asCampaigns(orders, now, o.ref)), now);
}

const publicInfo = () => ({
  packages: Object.fromEntries(SELF_SERVE.map(k => { const p = CATALOG.PACKAGES[k]; return [k, { label: p.label, cents: p.cents, days: p.days, contents: p.contents, picks: PICKS[k], pickHelp: PICK_HELP[k] }]; })),
  boards: BOARDS, leadDays: LEAD_DAYS, aheadDays: AHEAD_DAYS, holdDays: HOLD_DAYS, card: cardReady(),
});

const pipeline = STORE.pipeline;
async function openCampaigns() {
  const g = await pipeline([['SMEMBERS', CAMP.K.open]]);
  const ids = ((g[0] && g[0].result) || []).filter(i => CAMP.ID_RE.test(i));
  if (!ids.length) return [];
  return ((await pipeline([['MGET', ...ids.map(CAMP.K.rec)]]))[0].result || []).map(parse).filter(Boolean);
}
async function openOrders() {
  const g = await pipeline([['SMEMBERS', K.open]]);
  const refs = ((g[0] && g[0].result) || []).filter(r => REF_RE.test(r));
  if (!refs.length) return [];
  return ((await pipeline([['MGET', ...refs.map(K.rec)]]))[0].result || []).map(parse).filter(Boolean);
}
const saveCmds = (rec, entry) => {
  const cmds = [['SET', K.rec(rec.ref), JSON.stringify(rec)], HOLDING.includes(rec.status) ? ['SADD', K.open, rec.ref] : ['SREM', K.open, rec.ref]];
  if (entry) cmds.push(['LPUSH', K.log, JSON.stringify(entry)], ['LTRIM', K.log, '0', String(LOG_KEEP - 1)]);
  return cmds;
};

async function startCheckout(o, req, now) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/[^a-z0-9.:-]/gi, '');
  const site = (process.env.SITE_URL || (host ? 'https://' + host : '')).replace(/\/$/, '');
  if (!site) return null;
  const p = CATALOG.PACKAGES[o.pkg];
  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': CATALOG.CURRENCY,
    'line_items[0][price_data][unit_amount]': String(p.cents),
    'line_items[0][price_data][product_data][name]': p.label + ' · ' + o.start + ' to ' + o.end,
    client_reference_id: o.ref,
    customer_email: o.email,
    'metadata[type]': 'package',
    'metadata[ref]': o.ref,
    'metadata[pkg]': o.pkg,
    'metadata[cents]': String(p.cents),
    'metadata[price_version]': CATALOG.PRICE_VERSION,
    expires_at: String(Math.floor(now / 1000) + 60 * 60),
    success_url: site + '/order.html?ref=' + o.ref + '&paid=1',
    cancel_url: site + '/order.html?ref=' + o.ref + '&paid=0',
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(10000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.url || !/^cs_[A-Za-z0-9_]{1,200}$/.test(String(d.id))) return null;
  return d;
}

// Newsletter sponsorship (api/_catalog.js NEWSLETTER) is never ordered here until every gate is met; today that is
// never, so a newsletter order is always refused on the server with the live count, whatever the page sends.
const isNewsletter = pkg => ['NEWSLETTER', 'SINGLE', 'FOUR', 'DEDICATED', 'NL'].includes(String(pkg || '').toUpperCase());
function newsletterGate(verified) {
  const el = CATALOG.newsletterEligibility({ verifiedSubscribers: verified });
  const count = el.unmet.includes('verified_subscribers') ? ' — ' + Number(verified || 0).toLocaleString('en-US') + ' of ' + CATALOG.NEWSLETTER_MIN_VERIFIED.toLocaleString('en-US') + ' subscribers' : ' (final launch checks pending)';
  return el.ok ? null : { error: 'Newsletter sponsorship is coming soon' + count + '.', field: 'pkg', code: 409, unmet: el.unmet, verified: Number(verified) || 0 };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const send = (c, o) => res.status(c).json(o);
  const stored = STORE.stored(), now = Date.now();
  const isAdmin = () => !!ADMIN && same(req.headers['x-admin-key'], ADMIN) && stored;
  try {
    if (req.method === 'GET') {
      if (req.headers['x-admin-key'] !== undefined) {
        if (!isAdmin()) return send(404, { error: 'not found' });
        const g = await pipeline([['ZREVRANGE', K.index, '0', String(LIST_MAX - 1)], ['LRANGE', K.log, '0', '99']]);
        const refs = ((g[0] && g[0].result) || []).filter(r => REF_RE.test(r));
        const orders = refs.length ? ((await pipeline([['MGET', ...refs.map(K.rec)]]))[0].result || []).map(parse).filter(Boolean) : [];
        const crIds = orders.length ? await pipeline(orders.map(o => ['SMEMBERS', 'tsn:cr:ref:' + o.ref])) : [];
        const ids = [...new Set(crIds.flatMap(x => (x && x.result) || []))].filter(i => /^cr[a-z0-9]{10}$/.test(i));
        const crs = ids.length ? ((await pipeline([['MGET', ...ids.map(i => 'tsn:cr:' + i)]]))[0].result || []).map(parse).filter(Boolean) : [];
        const items = orders.map(o => Object.assign({}, o, { label: LABELS[o.status] || o.status, holding: holds(o, now),
          creatives: crs.filter(c => c.ref === o.ref).map(c => ({ id: c.id, headline: c.headline, status: c.status, placements: c.placements || [], covers: (o.placements || []).every(p => (c.placements || []).includes(p)) })) }));
        return send(200, { items, statuses: STATUSES.map(k => ({ key: k, label: LABELS[k] })), card: cardReady(), today: CAMP.today(now), log: ((g[1] && g[1].result) || []).map(parse).filter(Boolean) });
      }
      const q = req.query || {};
      if (!q.pkg) return send(200, publicInfo());
      if (isNewsletter(q.pkg)) { const g = newsletterGate(stored ? await require('./_subscribe.js').verifiedCount() : 0); if (g) return send(200, { ok: false, error: g.error, field: g.field, unmet: g.unmet }); }
      if (!stored) return send(200, { ok: false, error: 'Online ordering isn’t open yet. Ask us on the Advertise page.' });
      const [campaigns, orders] = await Promise.all([openCampaigns(), openOrders()]);
      const r = check({ pkg: q.pkg, boards: q.boards, start: q.start }, campaigns, orders, now);
      return send(200, r.error ? { ok: false, error: r.error, field: r.field } : { ok: true, start: r.start, end: r.end, placements: r.placements });
    }
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } } b = b && typeof b === 'object' ? b : {};
    if (req.headers['x-admin-key'] !== undefined) {
      if (!isAdmin()) return send(404, { error: 'not found' });
      const ref = String(b.ref || '').toUpperCase();
      if (!REF_RE.test(ref)) return send(400, { error: 'bad reference' });
      const o = parse((await pipeline([['GET', K.rec(ref)]]))[0].result);
      if (!o) return send(404, { error: 'not found' });
      const action = String(b.action || '');
      const r = change(o, action, b.note, now);
      if (r.error) return send(r.code, { error: r.error });
      if (action !== 'activate') { await pipeline(saveCmds(r.rec, r.entry)); return send(200, { ok: true, order: r.rec }); }
      if (!/^cr[a-z0-9]{10}$/.test(String(b.creativeId))) return send(400, { error: 'Pick the approved creative to run.' });
      const [campaigns, orders, cg] = await Promise.all([openCampaigns(), openOrders(), pipeline([['GET', 'tsn:cr:' + b.creativeId]])]);
      const a = activation(o, parse(cg[0] && cg[0].result), campaigns, orders, now);
      if (a.error) return send(a.code, { error: a.error, over: a.over });
      const c = a.rec, ce = { at: c.createdAt, id: c.id, creativeId: c.creativeId, action: 'create', from: '', to: 'active', note: c.history[0].note, placements: c.placements, start: c.start, end: c.end };
      r.rec.campaignId = c.id; r.rec.runs = [c.start, c.end]; r.entry.campaignId = c.id;
      await pipeline([['LPUSH', CAMP.K.audit, JSON.stringify(ce)], ['LTRIM', CAMP.K.audit, '0', '999'], ['SET', CAMP.K.rec(c.id), JSON.stringify(c)], ['ZADD', CAMP.K.index, String(now), c.id], ['SADD', CAMP.K.open, c.id]].concat(saveCmds(r.rec, r.entry)));
      return send(200, { ok: true, order: r.rec, campaign: c });
    }
    if (!stored) return send(503, { error: 'Online ordering isn’t open yet. Ask us on the Advertise page.' });
    if (b.action === 'checkout') {
      const ref = String(b.ref || '').trim().toUpperCase(), email = String(b.email || '').trim().toLowerCase();
      const g = REF_RE.test(ref) ? await pipeline([['GET', K.rec(ref)], ['SCARD', 'tsn:cr:ref:' + ref]]) : null;
      const o = g && parse(g[0].result);
      if (!o || String(o.email).toLowerCase() !== email) return send(404, { error: 'We couldn’t find that order. Check the reference and email.' });
      if (o.status === 'paid' || o.status === 'active') return send(200, { ok: true, paid: true, status: o.status });
      if (!['pending_payment', 'checkout'].includes(o.status)) return send(409, { error: 'This order is ' + LABELS[o.status].toLowerCase() + '. Email us if that’s wrong.' });
      if (!(Number(g[1].result) > 0)) return send(409, { error: 'Send your ad first, then pay.', next: 'creative' });
      if (!holds(o, now)) { // the hold lapsed: only go on if the spots are still free
        const [campaigns, orders] = await Promise.all([openCampaigns(), openOrders()]);
        if (CAMP.overCap(campaigns.concat(asCampaigns(orders, now, o.ref)), o.placements, o.start, o.end)) return send(409, { error: 'Your hold ran out and those dates have filled. Email us and we’ll find you new dates.' });
      }
      if (cardReady()) {
        let d = null;
        try { d = await startCheckout(o, req, now); } catch (_) { d = null; }
        if (d) {
          const rec = Object.assign({}, o, { status: 'checkout', session: d.id, at: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() });
          const order = { type: 'package', session: d.id, ref: o.ref, pkg: o.pkg, cents: o.cents, currency: CATALOG.CURRENCY, days: CATALOG.PACKAGES[o.pkg].days, priceVersion: o.priceVersion, at: new Date(now).toISOString(), status: 'created' };
          await pipeline(saveCmds(rec).concat([['SET', 'tsn:order:' + d.id, JSON.stringify(order), 'EX', String(30 * 86400)]]));
          return send(200, { url: d.url });
        }
      }
      // No card payments (no Stripe key yet, or Stripe failed): we invoice by hand. The order stays pending_payment.
      if (!o.invoiceRequested) await pipeline(saveCmds(Object.assign({}, o, { invoiceRequested: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() })));
      return send(200, { ok: true, invoice: true, holdDays: HOLD_DAYS });
    }
    if (b.action !== 'order') return send(400, { error: 'bad request' });
    if (isNewsletter(b.pkg)) { const g = newsletterGate(await require('./_subscribe.js').verifiedCount()); if (g) return send(g.code, { error: g.error, field: g.field, unmet: g.unmet }); return send(400, { error: 'bad request' }); }
    if (b.website) return send(200, { ok: true, ref: 'AD-' + Date.now().toString(36).toUpperCase().slice(-6) + 'XX' });
    const who = contact(b);
    if (who.error) return send(400, who);
    const ip = require('./_ip.js').clientIp(req) || 'x';
    const rl = await pipeline([['INCR', K.rl(ip)], ['EXPIRE', K.rl(ip), '86400', 'NX']]);
    if ((Number(rl[0] && rl[0].result) || 0) > DAILY_PER_IP) return send(429, { error: 'You’ve started a few orders today. Email us and we’ll help.' });
    const [campaigns, orders] = await Promise.all([openCampaigns(), openOrders()]);
    const r = check(b, campaigns, orders, now);
    if (r.error) return send(r.code, { error: r.error, field: r.field });
    const ref = 'AD-' + now.toString(36).toUpperCase().slice(-6) + crypto.randomBytes(2).toString('hex').toUpperCase();
    const at = new Date(now).toISOString(), p = CATALOG.PACKAGES[r.pkg];
    const rec = Object.assign({ ref, pkg: r.pkg, cents: p.cents, currency: CATALOG.CURRENCY, priceVersion: CATALOG.PRICE_VERSION, boards: r.boards, placements: r.placements, start: r.start, end: r.end }, who,
      { status: 'pending_payment', at, updatedAt: at, history: [{ at, action: 'order', note: '' }] });
    // The inquiry inbox gets it as a lead (same reference), and the reference + email open the upload page.
    const lead = { ref, at, business: who.business, name: who.name, email: who.email, phone: who.phone, interest: 'Section sponsorship', package: r.pkg, budget: '',
      message: 'Online order: ' + p.label + ', ' + r.start + ' to ' + r.end + ' (' + r.placements.join(', ') + '). Pending payment.' };
    await pipeline(saveCmds(rec, { at, ref, action: 'order', from: '', to: 'pending_payment', note: '' }).concat([['ZADD', K.index, String(now), ref], ['LPUSH', 'tsn:ads', JSON.stringify(lead)], ['LTRIM', 'tsn:ads', '0', '299']]));
    return send(200, { ok: true, ref, pkg: r.pkg, start: r.start, end: r.end, cents: p.cents, placements: r.placements });
  } catch (e) {
    require('./_log.js').fail('packages', e);
    return send(502, { error: 'Couldn’t reach the store. Try again in a moment.' });
  }
}

// The webhook's half (api/stripe-webhook.js): a paid package session -> commands that mark the order paid.
function paidCmds(o, s, now) {
  if (!o || !['pending_payment', 'checkout', 'invoiced'].includes(o.status)) return null;
  const at = new Date(now).toISOString();
  const rec = Object.assign({}, o, { status: 'paid', paidAt: at, paidBy: 'stripe', session: s.id, paidCents: Number(s.amount_total), updatedAt: at, history: (o.history || []).concat([{ at, action: 'paid', note: 'Stripe ' + s.id }]) });
  return saveCmds(rec, { at, ref: o.ref, action: 'paid', from: o.status, to: 'paid', note: 'Stripe' });
}
function refundedCmds(o, now) {
  if (!o || o.status === 'refunded') return [];
  const at = new Date(now).toISOString();
  const rec = Object.assign({}, o, { status: 'refunded', statusBeforeRefund: o.status, updatedAt: at, history: (o.history || []).concat([{ at, action: 'refunded', note: o.campaignId ? 'End campaign ' + o.campaignId : '' }]) });
  return saveCmds(rec, { at, ref: o.ref, action: 'refunded', from: o.status, to: 'refunded', note: o.campaignId ? 'End campaign ' + o.campaignId : '' });
}

module.exports = handler;
Object.assign(module.exports, { isNewsletter, newsletterGate, SELF_SERVE, PICKS, LEAD_DAYS, AHEAD_DAYS, HOLD_DAYS, INVOICE_HOLD_DAYS, STATUSES, LABELS, REF_RE, K, cardReady, placementsFor, flight, holds, asCampaigns, check, contact, change, activation, publicInfo, paidCmds, refundedCmds });
