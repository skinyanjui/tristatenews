#!/usr/bin/env node
// Publisher verification (plan §12 and PR 3.2). Fetches a candidate feed with the project's own fetch and parser
// (api/news.js loadSource: SSRF guard, size caps, RSS/Atom/iCal parsing and the same item filters) and writes the
// evidence record. It never touches Redis and needs no secrets.
//
//   node scripts/verify-source.js --candidate data/sources/batches/batch-1.json --id pasun [--write]
//   node scripts/verify-source.js --candidate batch.json --all --write      every source in the batch file
//   node scripts/verify-source.js --url https://example.com/feed --name "Example" --area "Paducah"   ad hoc, prints only
//
// --write saves data/sources/evidence/<id>.json. Steps the script measures (observed on this machine):
//   2  site: the homepage answers and its <title>                     7  fetch + parse with the project parser
//   4  activity: latest item, items in the last 30 days, cadence      8  item links: same site, <= 3 redirects
//   5/10 coverage: counties the classifier finds in the items          9  item dates parse and are current
//   6  robots.txt allows the feed path for our user agent
// Steps that need a person (1 identity, 3 original reporting, 11 paywall and reuse terms, 13 the decision to add) come
// from the candidate's `review` object and are copied into the record as written; the script never fills them in.
// The record's `decision` is "verified" only when every measured check passes AND the review says approved;
// otherwise "researching" with the reasons. A Vercel-side fetch (IP blocks) is not measurable from here: observed.runner
// says where the fetch ran.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const news = require('../api/news.js');
const { safeFetch, readCapped } = require('../api/_safe.js');
const LOC = require('../api/_location.js');

const UA = 'Mozilla/5.0 (compatible; TriStateNews/1.1; +https://tristatenewss.vercel.app)';
const DAY = 864e5;
const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : null; };

async function get(url, max) {
  const r = await safeFetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(12000) });
  const body = r.ok ? await readCapped(r, max || 400000).catch(() => '') : '';
  return { status: r.status, finalUrl: r.finalUrl || url, body };
}

// robots.txt rules for "*" (and our UA token) as [allow|disallow, prefix]; longest match wins, like Google.
function robotsAllows(txt, pathname) {
  const groups = []; let cur = null;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!cur || cur.rules.length) groups.push(cur = { agents: [], rules: [] }); cur.agents.push(v.toLowerCase()); }
    else if ((k === 'allow' || k === 'disallow') && cur) cur.rules.push([k, v]);
  }
  const mine = groups.filter(g => g.agents.some(a => a === 'tristatenews')); const star = groups.filter(g => g.agents.includes('*'));
  const rules = (mine.length ? mine : star).flatMap(g => g.rules).filter(([, p]) => p !== '');
  let best = null;
  for (const [k, p] of rules) {
    const re = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(pathname) && (!best || p.length > best[1].length || (p.length === best[1].length && k === 'allow'))) best = [k, p];
  }
  return !best || best[0] === 'allow';
}

const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
const isGoogle = u => /(^|\.)news\.google\.com$/.test(host(u) || '') || /news\.google\.com/.test(u);

async function verify(src, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const site = src.site || (src.url ? new URL(src.url).origin : '');
  const rec = { sourceId: src.id, name: src.name, site, feedUrl: src.url, checkedAt: new Date(now).toISOString(), method: 'scripts/verify-source.js', checks: {}, observed: {}, activity: {}, coverageEvidence: [], review: src.review || null };
  const fail = [];
  // 2: the site answers
  try { const h = await get(site + '/', 300000); const t = /<title[^>]*>([^<]{0,140})/i.exec(h.body); rec.checks.site = { status: h.status, finalUrl: h.finalUrl, title: t ? t[1].replace(/\s+/g, ' ').trim() : null }; }
  catch (e) { rec.checks.site = { error: String(e.code || e.message).slice(0, 60) }; }
  // 6: robots.txt (for Google News fallbacks: the publisher's robots is about the publisher, the feed is Google's)
  const feedHost = new URL(src.url).origin;
  try {
    const r = await get(feedHost + '/robots.txt', 200000);
    const u = new URL(src.url);
    rec.checks.robots = { status: r.status, allowsFeed: r.status === 200 ? robotsAllows(r.body, u.pathname + u.search) : true, checked: feedHost + '/robots.txt' };
  } catch (e) { rec.checks.robots = { error: String(e.code || e.message).slice(0, 60), allowsFeed: null }; }
  // news.google.com/robots.txt disallows /rss/search for every crawler. A Google News search is only ever a labeled batch
  // fallback (`fallback`: google_news_site or google_news_towns), used where the publisher's own feed is rate-limited or
  // missing, as the base registry already does (courier, gleaner, the BLOX altUrls); the record keeps the robots result
  // and a warning so the person approving the batch sees it, instead of the check failing the source.
  if (rec.checks.robots.allowsFeed === false) {
    if (src.fallback && isGoogle(src.url)) rec.warnings = ['google_news_robots: news.google.com/robots.txt disallows /rss/search; labeled ' + src.fallback + ' fallback'];
    else fail.push('robots_disallows_feed');
  }
  // 7: fetch and parse with the project's code
  const t0 = Date.now();
  const r = await news.loadSource(src, null, now);
  rec.observed = { status: r.httpStatus || null, error: r.error || null, received: r.received == null ? null : r.received, accepted: r.items.length, durationMs: Date.now() - t0, runner: opts.runner || 'box', fetchedUrl: r.url || src.url };
  if (!r.items.length) fail.push('no_items:' + (r.error || 'empty'));
  // 9 and 4: dates and activity
  const dates = r.items.map(i => Date.parse(i.published)).filter(t => Number.isFinite(t)).sort((a, b) => b - a);
  const undated = r.items.length - dates.length;
  const last30 = dates.filter(t => t > now - 30 * DAY && t <= now + 36e5).length;
  const gaps = []; for (let i = 1; i < dates.length; i++) gaps.push((dates[i - 1] - dates[i]) / DAY);
  gaps.sort((a, b) => a - b);
  const medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  rec.activity = { latest: dates.length ? new Date(dates[0]).toISOString() : null, last30d: last30, undated, inFeed: r.items.length,
    cadence: medGap == null ? 'unknown' : medGap <= 1.5 ? 'daily' : medGap <= 8 ? 'weekly' : 'irregular', medianGapDays: medGap == null ? null : Math.round(medGap * 100) / 100 };
  if (!dates.length || dates[0] < now - 14 * DAY) fail.push('not_current');
  // 8: item links go to the publisher (or, for Google News fallbacks, carry the publisher's site in the query)
  const pubHost = host(site);
  const linkHosts = {}; for (const i of r.items) { const h = host(i.link); linkHosts[h] = (linkHosts[h] || 0) + 1; }
  const own = r.items.filter(i => host(i.link) === pubHost || host(i.link).endsWith('.' + pubHost)).length;
  rec.checks.links = { hosts: linkHosts, ownSiteShare: r.items.length ? Math.round(100 * own / r.items.length) : 0, via: isGoogle(src.url) ? 'google_news' : 'direct' };
  if (!isGoogle(src.url)) {
    const sample = r.items.slice(0, 3); const res = [];
    for (const it of sample) { try { const g = await safeFetch(it.link, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000) }); try { await g.body?.cancel(); } catch (_) {} res.push({ status: g.status, sameSite: host(g.finalUrl || it.link) === pubHost || host(g.finalUrl || it.link).endsWith('.' + pubHost) }); } catch (e) { res.push({ error: String(e.code || e.message).slice(0, 40) }); } }
    rec.checks.links.sample = res;
    if (rec.checks.links.ownSiteShare < 80) fail.push('links_leave_site');
    if (res.some(x => x.error && /REDIRECT/.test(x.error))) fail.push('too_many_redirects');
  }
  // 5 and 10: where the stories are, by the classifier (article geography, not the outlet's claim)
  const counts = {}; const examples = {}; let located = 0;
  for (const it of r.items) {
    const l = LOC.classify(it, src);
    if (l.countyIds.length) located++;
    for (const c of l.countyIds) { counts[c] = (counts[c] || 0) + 1; (examples[c] = examples[c] || []).length < 2 && examples[c].push(it.title.slice(0, 100)); }
  }
  rec.coverageEvidence = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([countyId, n]) => ({ countyId, items: n, examples: examples[countyId] }));
  rec.checks.geography = { located, of: r.items.length, share: r.items.length ? Math.round(100 * located / r.items.length) : 0 };
  if (src.counties && src.counties.length && !src.counties.some(c => counts[c])) fail.push('no_items_in_claimed_counties');
  // 11, 1, 3, 13: from the reviewer
  const rv = src.review || {};
  rec.licensing = rv.licensing || { paywall: null, summaryOk: null, imagesOk: null };
  if (rv.approved !== true) fail.push('awaiting_review');
  rec.decision = fail.length ? 'researching' : 'verified';
  rec.reasons = fail;
  if (src.fallback) rec.fallback = src.fallback;
  rec.reviewer = rv.reviewer || null;
  return rec;
}

async function main() {
  let list;
  if (arg('candidate')) {
    const f = JSON.parse(fs.readFileSync(path.resolve(arg('candidate')), 'utf8'));
    list = arg('all') ? f.sources : f.sources.filter(s => s.id === arg('id'));
  } else if (arg('url')) list = [{ id: arg('id') || 'adhoc', name: arg('name') || 'ad hoc', area: arg('area') || '', url: arg('url') }];
  if (!list || !list.length) { console.error('Nothing to verify. See the header for usage.'); process.exit(2); }
  for (const s of list) {
    const rec = await verify(s);
    console.log([s.id, rec.decision, 'HTTP ' + rec.observed.status, 'items ' + rec.observed.accepted, '30d ' + rec.activity.last30d, 'latest ' + (rec.activity.latest || '-').slice(0, 10), rec.activity.cadence, 'robots ' + rec.checks.robots.allowsFeed, 'own-site ' + rec.checks.links.ownSiteShare + '%', 'counties ' + rec.coverageEvidence.slice(0, 4).map(c => c.countyId + ':' + c.items).join(','), rec.reasons.join(',')].join(' | '));
    if (arg('write')) fs.writeFileSync(path.join(root, 'data/sources/evidence', s.id + '.json'), JSON.stringify(rec, null, 2) + '\n');
  }
}

if (require.main === module) main().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
module.exports = { verify, robotsAllows };
