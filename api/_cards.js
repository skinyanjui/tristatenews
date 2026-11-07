// First stories in the HTML (PR ship69). The tab page (api/_tabpage.js) serves "/", /obituaries and /institutions
// with the first PAGE stories of the tab from the current snapshot: pre-rendered cards with the same markup the
// page's own makeCard() builds (public/assets/app.js), plus the same stories as JSON in
// <script type="application/json" id="tsn-data">, which app.js reads to draw the list at once and then replaces with
// the full /api/news answer (same first cards, so nothing moves). Nothing here is ever written to a static file: the
// HTML is built per request (edge-cached for 5 minutes) from the snapshot in the store.
// Card rules kept from makeCard: Police & courts cards never carry a photo and say "Charged or arrested, not
// convicted." when the item is an arrest; no ad is ever rendered here (the page adds its in-feed ads itself, by
// public/adslots.js, never next to Police & courts or Breaking; Obituaries never get ads); one story per row.
'use strict';
const BK = require('../public/breaking.js');
const RT = require('../public/routes.js');
const DD = require('../public/dedupe.js'); // ship80: no repeated copy (the page's makeCard uses the same rules)

const PAGE = 24; // app.js PAGE: the first screenful of a tab
const BREAKING_RE = /^\s*(breaking( news)?|just in|developing story|news alert)\b|\bbreaking( news)?\s*[:|\u2013\u2014-]|[\[(]breaking[\])]/i;
const LEAD_RE = /^\s*(breaking( news)?|just in|developing story|news alert)\s*[:|\u2013\u2014-]\s*/i;
const TZ = 'America/Chicago';

const { esc, jsonScript } = require('./_html.js');
function safeHref(u) {
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : '#'; } catch (e) { return '#'; }
}
function shortWhen(iso, now) {
  const t = Date.parse(iso); if (!iso || isNaN(t)) return '';
  const m = Math.round((now - t) / 6e4);
  if (m < 1) return 'Just now'; if (m < 60) return m + 'm ago'; // ship88: short posted times again
  if (m < 24 * 60) return Math.round(m / 60) + 'h ago';
  const d = Math.floor(m / 1440); if (d < 7) return d + 'd ago';
  return new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: TZ });
}
// ship110: a story the publisher dated by day only (datePrecision 'day') shows that day, never a time (app.js dayWhen)
function dayWhen(iso, now) {
  const t = Date.parse(iso); if (!iso || isNaN(t)) return '';
  const day = x => new Date(x).toLocaleDateString('en-CA', { timeZone: TZ });
  if (day(t) === day(now)) return 'Today';
  if (day(t) === day(now - 864e5)) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: TZ });
}
function timeAgo(iso, dayOnly) {
  if (!iso || isNaN(Date.parse(iso))) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ });
  return dayOnly ? day : day + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
}
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg>';
const SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"></path></svg>';

// The tab's stories, as app.js inCat() picks them (kind by source; unknown sources count as news).
function inCat(kind, cat) {
  if (cat === 'news') return kind === 'news' || kind === 'police' || kind === 'courts';
  return kind === cat;
}

// What the page needs to draw a tab before /api/news answers. view: the /api/news answer (api/news.js page()).
// Returns null when there is nothing to draw (the page then loads as before).
function pick(view, cat, now) {
  if (!view || !Array.isArray(view.items) || !Array.isArray(view.sources)) return null;
  now = now == null ? Date.now() : now;
  const kinds = {}; view.sources.forEach(s => { if (s && s.id) kinds[s.id] = s.kind || 'news'; });
  const kindOf = it => kinds[it.sourceId] || 'news';
  const all = view.items.filter(it => it && it.title && inCat(kindOf(it), cat));
  if (!all.length) return null;
  let brk = { top: null, more: 0 }, cands = [];
  if (cat === 'news') {
    // the Breaking slot from stories (app.js breakingPick); official and weather alerts come later from /api/alerts
    view.items.forEach(it => {
      const k = kindOf(it); if (k === 'events' || k === 'obits') return;
      const t = Date.parse(it.published); if (isNaN(t)) return;
      const hit = (k === 'police' || k === 'courts') ? BK.classifyOfficial(it) : null;
      const breaking = !hit && (it.breaking === true || BREAKING_RE.test(it.title)) && now - t <= 3 * 3600 * 1000;
      if (hit) cands.push({ key: 'it:' + (it.id || it.link), kind: 'story', official: true, tier: hit.tier, label: hit.label, start: t, end: null, item: it });
      else if (breaking) cands.push({ key: 'it:' + (it.id || it.link), kind: 'story', tier: 7, label: '', start: t, end: null, item: it });
    });
    brk = BK.pick(cands, now);
  }
  const top = brk.top && brk.top.item;
  const rest = top ? all.filter(i => i !== top) : all;
  const shown = rest.slice(0, PAGE);
  const keep = new Set(shown); if (top) keep.add(top); cands.forEach(c => keep.add(c.item));
  const items = view.items.filter(i => keep.has(i)); // the answer's own order, as the page sorts nothing
  const used = new Set(items.map(i => i.sourceId));
  const data = { updatedAt: view.updatedAt, sources: view.sources.filter(s => used.has(s.id)), items, partial: true };
  if (view.scope) data.scope = view.scope;
  if (view.features) data.features = view.features;
  return { data, shown, brk, kindOf, places: !!(view.features && view.features.scopes) };
}

function card(it, o) {
  const kd = o.kindOf(it), safe = kd === 'police' || kd === 'courts', big = !!o.brk;
  const sec = safe ? 'safety' : kd === 'institution' ? 'institution' : 'news';
  const pic = safe ? '' : (it.image || '');
  const logo = (o.logos[it.sourceId] || '');
  const title = big ? (it.title.replace(LEAD_RE, '') || it.title) : it.title;
  let src = '<div class="src">';
  if (logo) src += '<img class="av" src="' + esc(logo) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
  src += '<b>' + esc(it.source) + '</b>';
  if (it.place && o.places && DD.part(it.place, title, it.source)) src += '<span class="place">' + esc(it.place) + '</span>';
  const dayOnly = it.datePrecision === 'day', full = timeAgo(it.published, dayOnly);
  src += '<time class="when"' + (it.published ? ' datetime="' + esc(it.published) + '" data-ago="' + (dayOnly ? 'day' : 'time') + '" title="' + esc(full) + '" aria-label="' + esc(full) + '"' : '') + '>' + esc(dayOnly ? dayWhen(it.published, o.now) : shortWhen(it.published, o.now)) + '</time></div>';
  let body = '<div class="bd">';
  const tag = '<span class="pill pill-red' + (big && pic ? ' pill-over' : '') + '"><i></i>Breaking</span>';
  if (big && !pic) body += '<div class="bk-head">' + tag + '</div>';
  // ship74 story rows: bold section label, headline, then the source line (the Breaking card keeps source first)
  const kick = big ? '' : DD.part(RT.sectionLabel(kd, it.cat), o.tab); // no label that repeats the tab it is on
  body += big ? src + '<h2>' + esc(title) + '</h2>' : (kick ? '<span class="kicker">' + esc(kick) + '</span>' : '') + '<h2 title="' + esc(title) + '">' + esc(title) + '</h2>';
  if (big && (o.brk.label || o.brk.end != null)) {
    body += '<div class="bk-meta">' + (o.brk.label ? '<b>' + esc(o.brk.label) + '</b>' : '') + (o.more ? '<span>+' + o.more + ' more active</span>' : '') + '</div>';
  }
  const sum = DD.preview(title, it.summary); // a preview never repeats the headline
  if (sum) body += '<p>' + esc(sum) + '</p>';
  if (safe && it.arrest) body += '<p class="cl-note">Charged or arrested, not convicted.</p>';
  if (!big) body += src; // News rows: headline, preview, then the source + time line last
  body += '</div>';
  let img = '';
  if (pic) {
    const lead = o.lead.left; o.lead.left = false;
    img = '<img class="th" ' + (lead ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"') + ' referrerpolicy="no-referrer" decoding="async" alt=""' + (big ? '' : ' width="112" height="112"') + ' src="' + esc(pic) + '">';
  }
  const href = safeHref(it.link);
  const share = href === '#' ? '' : '<button class="share" type="button" aria-label="' + esc('Share: ' + it.title) + '" title="Share">' + SHARE + '</button>';
  return '<article class="card' + (big ? ' breaking' : ' row') + '" data-sec="' + sec + '"><a class="ca' + (pic ? '' : ' noimg') + '" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + img + body + '</a>' +
    '<div class="cf"><div class="acts"><button class="like" type="button" aria-pressed="false" aria-label="' + esc('Like: ' + it.title) + '">' + HEART + '<span></span></button>' + share + '</div></div>' +
    (big && pic ? tag : '') + '</article>';
}

// The list's inner HTML for pick()'s result.
function cards(p, now, tab) {
  now = now == null ? Date.now() : now;
  const logos = {}; p.data.sources.forEach(s => { logos[s.id] = s.logo; });
  const o = { kindOf: p.kindOf, logos, places: p.places, now, lead: { left: true }, tab: tab || '' };
  let h = '';
  const top = p.brk.top && p.brk.top.item;
  if (top) h += card(top, Object.assign({}, o, { brk: p.brk.top, more: p.brk.more }));
  p.shown.forEach(it => { h += card(it, o); });
  return h;
}

module.exports = { pick, cards, card, esc, jsonScript, safeHref, shortWhen, dayWhen, timeAgo, PAGE };
