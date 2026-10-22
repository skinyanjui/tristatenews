// The advertising catalog: every price Tri-State News charges or quotes, in integer cents, with a price version.
// The server reads prices only from here (api/_checkout.js); the page shows the same numbers from GET /api/catalog
// (vercel.json rewrites it to /api/listings?__route=catalog; no new function). A price the browser sends is ignored.
//
// Changing a price: add a new PRICE_VERSION and keep the old table in HISTORY. Orders record the version they were
// sold at (Stripe metadata price_version, and the tsn:order:<session> record), and anything already bought keeps
// what was agreed: the webhook applies the days recorded on the order, never today's table.
//
// status:
//   available         sold self-serve (Featured posts, when Stripe is configured; Packages A-C, ordered online
//                     through api/_packages.js and paid by card when Stripe is set up, else invoiced by us)
//   inquiry           priced, sold through the Advertise form; no self-serve checkout yet
//   request_proposal  quoted per advertiser (Package D); never purchasable online
//   not_available     priced, but not for sale until its gates are met (newsletter, sponsored feature, creative)
// purchasable is true only for status 'available'.
const PRICE_VERSION = '2026-10-18';
const CURRENCY = 'usd';

// Board kinds as stored by api/listings.js: 'item' is a Classified. Obituaries are never featurable (Advertising Policy).
const FEATURED = {
  item: { label: 'Featured classified', cents: 1900, days: 7 },
  event: { label: 'Featured event', cents: 5900, days: 7 },
  deal: { label: 'Featured deal', cents: 7900, days: 14 },
  job: { label: 'Featured job', cents: 9900, days: 30 },
};

const PACKAGES = {
  A: { label: 'Package A', cents: 24900, days: 30, status: 'available', contents: { boardCards: 1, sponsorLines: 1, newsCard: false, sideAds: false } },
  B: { label: 'Package B', cents: 59900, days: 30, status: 'available', contents: { boardCards: 2, sponsorLines: 1, newsCard: true, sideAds: false } },
  C: { label: 'Package C', cents: 119900, days: 30, status: 'available', contents: { boardCards: 4, sponsorLines: 2, newsCard: true, sideAds: true } },
  D: { label: 'Package D', cents: 249900, days: 30, status: 'request_proposal' },
};

// Newsletter sponsorship stays off sale until every gate in NEWSLETTER_GATES is met: NEWSLETTER_MIN_VERIFIED verified
// (confirmed) subscribers, measured deliverability, defined inventory (which issues carry how many sponsor slots),
// and Sam's approval. The list has 0 verified subscribers today (there is no confirmation step yet), so these are
// priced but not purchasable. A dedicated email is quoted per advertiser (no list price).
const NEWSLETTER_MIN_VERIFIED = 1500;
const NEWSLETTER_GATES = ['verified_subscribers', 'measured_deliverability', 'defined_inventory', 'approved'];
const NEWSLETTER = {
  single: { label: 'Newsletter sponsorship, 1 send', cents: 19900, sends: 1, status: 'not_available' },
  four: { label: 'Newsletter sponsorship, 4 sends', cents: 69900, sends: 4, status: 'not_available' },
  dedicated: { label: 'Dedicated newsletter email', sends: 1, status: 'request_proposal' },
};

// Creative ($99) is waived with a package of CREATIVE_WAIVER_MIN_CENTS ($599) or more.
const CREATIVE_WAIVER_MIN_CENTS = 59900;
const ADDONS = {
  sponsoredFeature: { label: 'Sponsored feature', cents: 49900, status: 'not_available' },
  creative: { label: 'Ad creative', cents: 9900, status: 'not_available', waivedFromPackageCents: CREATIVE_WAIVER_MIN_CENTS },
};

// Earlier tables, for orders recorded under them. 'legacy' is api/_checkout.js PRICES before this catalog.
const HISTORY = {
  legacy: { featured: { job: { cents: 2900, days: 30 }, deal: { cents: 1900, days: 14 }, event: { cents: 1500, days: 7 }, item: { cents: 500, days: 7 } } },
};

// Budget bands for the advertising inquiry form (per 30 days), cut at the package prices so no amount is typed in
// twice. The form sends the key; api/_advertise.js accepts only these keys.
const dollars = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
function budgetBands() {
  const [a, b, c, d] = ['A', 'B', 'C', 'D'].map(k => PACKAGES[k].cents);
  return [
    { key: 'under_a', label: 'Under ' + dollars(a) },
    { key: 'a_b', label: dollars(a) + ' to ' + dollars(b) },
    { key: 'b_c', label: dollars(b) + ' to ' + dollars(c) },
    { key: 'c_d', label: dollars(c) + ' to ' + dollars(d) },
    { key: 'd_up', label: dollars(d) + ' or more' },
    { key: 'unsure', label: 'Not sure yet' },
  ];
}

const purchasable = status => status === 'available';
const withFlags = o => Object.assign({}, o, { purchasable: purchasable(o.status) });
const freeze = o => { Object.values(o).forEach(v => { if (v && typeof v === 'object') freeze(v); }); return Object.freeze(o); };

// The Featured price for a board kind, or null. Never takes a client-sent price.
function featuredPrice(kind) {
  if (!Object.prototype.hasOwnProperty.call(FEATURED, kind)) return null;
  const p = FEATURED[kind];
  return { kind, label: p.label, cents: p.cents, days: p.days, priceVersion: PRICE_VERSION };
}

// The Featured price recorded for a price version (the current one, or one kept in HISTORY), or null. The webhook
// checks a payment against this, so an order keeps the price it was sold at after the table changes.
function featuredPriceAt(version, kind) {
  const table = version === PRICE_VERSION ? FEATURED : (Object.prototype.hasOwnProperty.call(HISTORY, version) ? HISTORY[version].featured : null);
  if (!table || !Object.prototype.hasOwnProperty.call(table, kind)) return null;
  return { kind, cents: table[kind].cents, days: table[kind].days, priceVersion: version };
}

// Can this package be bought online? (D never; A–C not until self-serve package checkout ships.)
function packageEligibility(id) {
  const p = Object.prototype.hasOwnProperty.call(PACKAGES, id) ? PACKAGES[id] : null;
  if (!p) return { ok: false, reason: 'unknown_package' };
  if (p.status === 'request_proposal') return { ok: false, reason: 'request_proposal' };
  if (!purchasable(p.status)) return { ok: false, reason: 'inquiry_only' };
  return { ok: true };
}

// Creative fee for an order: waived when the package is $599 or more.
function creativeCents(packageId) {
  const p = Object.prototype.hasOwnProperty.call(PACKAGES, packageId) ? PACKAGES[packageId] : null;
  return p && p.cents >= CREATIVE_WAIVER_MIN_CENTS ? 0 : ADDONS.creative.cents;
}

// Newsletter gates. facts: { verifiedSubscribers, deliverabilityMeasured, inventoryDefined, approved }. Missing facts
// count as not met.
function newsletterEligibility(facts) {
  facts = facts || {};
  const unmet = [];
  if (!(Number(facts.verifiedSubscribers) >= NEWSLETTER_MIN_VERIFIED)) unmet.push('verified_subscribers');
  if (facts.deliverabilityMeasured !== true) unmet.push('measured_deliverability');
  if (facts.inventoryDefined !== true) unmet.push('defined_inventory');
  if (facts.approved !== true) unmet.push('approved');
  return { ok: unmet.length === 0, unmet, minVerified: NEWSLETTER_MIN_VERIFIED };
}

// The public catalog (GET /api/catalog). checkoutConfigured: whether Featured checkout is switched on.
function publicCatalog(checkoutConfigured) {
  const map = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v, k)]));
  return {
    priceVersion: PRICE_VERSION,
    currency: CURRENCY,
    featured: map(FEATURED, v => ({ label: v.label, cents: v.cents, days: v.days, status: checkoutConfigured ? 'available' : 'not_available', purchasable: !!checkoutConfigured })),
    packages: map(PACKAGES, v => withFlags(v)),
    newsletter: map(NEWSLETTER, v => withFlags(v)),
    newsletterGate: { minVerifiedSubscribers: NEWSLETTER_MIN_VERIFIED, gates: NEWSLETTER_GATES.slice() },
    addons: map(ADDONS, v => withFlags(v)),
    budgets: budgetBands(),
  };
}

function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Cache-Control', 'no-store'); return res.status(405).send(JSON.stringify({ error: 'method' })); }
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.status(200).send(JSON.stringify(publicCatalog(require('./_checkout.js').isConfigured())));
}

module.exports = handler;
Object.assign(module.exports, {
  PRICE_VERSION, CURRENCY, FEATURED: freeze(FEATURED), PACKAGES: freeze(PACKAGES), NEWSLETTER: freeze(NEWSLETTER), ADDONS: freeze(ADDONS),
  HISTORY: freeze(HISTORY), NEWSLETTER_MIN_VERIFIED, CREATIVE_WAIVER_MIN_CENTS,
  featuredPrice, featuredPriceAt, packageEligibility, creativeCents, newsletterEligibility, publicCatalog, budgetBands,
});
