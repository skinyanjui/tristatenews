// Newsletter digest crime filter (api/newsletter.js pick) and the Content-Security-Policy header (vercel.json).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const NL = require('../api/newsletter.js');

const now = Date.parse('2026-10-21T18:00:00Z');
const at = h => new Date(now - h * 36e5).toISOString();
function news(items, extraSources) {
  const sources = [{ id: 'a', kind: 'news' }, { id: 'b', kind: 'news' }, { id: 'c', kind: 'news' }, { id: 'd', kind: 'news' },
    { id: 'e', kind: 'news' }, { id: 'f', kind: 'news' }, { id: 'g', kind: 'news' }, { id: 'pd', kind: 'police' }, { id: 'ct', kind: 'courts' }].concat(extraSources || []);
  return { sources, items: items.map((t, n) => Object.assign({ link: 'https://ex.com/' + n, source: 'S', sourceId: 'abcdefg'[n % 7], published: at(n + 1) }, typeof t === 'string' ? { title: t } : t)) };
}
const titles = p => p.headlines.map(h => h.title);

test('crime and police-report titles are left out of the digest', () => {
  const p = NL.pick(news(['Police Reports: Wednesday, October 21', "Man's 120-year sentence caps long case", 'Man arrested after chase',
    'Woman charged with theft', 'Fatal shooting on Main St', 'Homicide investigation continues', 'Murder trial set', 'Pickleball park opens']), null, now, { excludeTerms: '' });
  assert.deepStrictEqual(titles(p), ['Pickleball park opens']);
});

test('excluded stories are backfilled with the next ones, still 10 headlines', () => {
  const items = ['Shooting near school', 'Arrested in Henderson', 'Police report: thefts up'];
  for (let n = 0; n < 12; n++) items.push('Story ' + n);
  const p = NL.pick(news(items), null, now, { excludeTerms: '' });
  assert.strictEqual(p.headlines.length, 10);
  assert.ok(titles(p).every(t => /^Story /.test(t)));
  assert.ok(titles(p).includes('Story 9'));
});

test('Police & courts sources, arrest-flagged items and crime categories are excluded', () => {
  const p = NL.pick(news([{ title: 'Sheriff update', sourceId: 'pd' }, { title: 'Court calendar', sourceId: 'ct' },
    { title: 'Release from the county', arrest: false }, { title: 'Weekly roundup', cat: 'Crime' }, { title: 'Bridge reopens' }]), null, now, { excludeTerms: '' });
  assert.deepStrictEqual(titles(p), ['Bridge reopens']);
  assert.strictEqual(NL.excluded({ title: 'x', cat: 'Police & courts' }, 'news'), 'category');
  assert.strictEqual(NL.excluded({ title: 'x', cat: 'Sports' }, 'news'), '');
});

test('the keyword list is conservative: whole words only, and murder-mystery theater stays', () => {
  const re = NL.excludeRe('');
  for (const t of ['Supercharged robotics team wins', 'Dearrested development', 'Sentenceless poetry night', 'Murder Mystery Theater returns', 'Arrestor bed installed at airport'])
    assert.strictEqual(NL.excluded({ title: t }, 'news', re), '', t);
  for (const t of ['Life sentences handed down', 'ARRESTED: two in burglary', 'Two shootings overnight', 'Stabbing at bar'])
    assert.strictEqual(NL.excluded({ title: t }, 'news', re), 'keyword', t);
});

test('extra terms are configurable (option or NEWSLETTER_EXCLUDE_TERMS) on top of the defaults', () => {
  const items = ['Overdose deaths rise', 'Fatal crash on US 41', 'Man arrested', 'Library hours change'];
  assert.deepStrictEqual(titles(NL.pick(news(items), null, now, { excludeTerms: 'overdose, fatal crash' })), ['Library hours change']);
  const old = process.env.NEWSLETTER_EXCLUDE_TERMS;
  process.env.NEWSLETTER_EXCLUDE_TERMS = 'overdose';
  try { assert.deepStrictEqual(titles(NL.pick(news(items), null, now)), ['Fatal crash on US 41', 'Library hours change']); }
  finally { if (old === undefined) delete process.env.NEWSLETTER_EXCLUDE_TERMS; else process.env.NEWSLETTER_EXCLUDE_TERMS = old; }
  assert.ok(NL.EXCLUDE_TERMS.includes('police report') && NL.EXCLUDE_TERMS.includes('murder'));
});

// ---- CSP ----
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
function csp() {
  for (const h of vercel.headers || []) for (const x of h.headers || []) if (x.key === 'Content-Security-Policy') return x.value;
  return '';
}
const directives = () => Object.fromEntries(csp().split(';').map(s => s.trim()).filter(Boolean).map(s => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));
function walk(dir, out) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name.startsWith('.')) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out); else if (/\.(html|js|css)$/.test(f.name)) out.push(p);
  }
  return out;
}
const pageFiles = () => walk(path.join(root, 'public'), walk(path.join(root, 'data/pages'), []));

test('CSP carries no Google ad, analytics or tag domains', () => {
  const v = csp();
  assert.ok(v, 'CSP header present');
  for (const d of ['googlesyndication', 'doubleclick', 'googletagservices', 'adservice.google', '*.google.com', 'google-analytics', 'googletagmanager'])
    assert.ok(!v.includes(d), d);
  const d = directives();
  assert.deepStrictEqual(d['script-src'], ["'self'", "'unsafe-inline'"]);
  assert.deepStrictEqual(d['frame-src'], ["'self'"]);
  for (const k of ['object-src', 'frame-ancestors']) assert.deepStrictEqual(d[k], ["'none'"], k);
  assert.deepStrictEqual(d['connect-src'], ["'self'", 'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com', 'https://api.weather.gov']);
});

test('pages and scripts load nothing from the removed Google domains', () => {
  for (const f of pageFiles()) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!/googlesyndication|doubleclick|googletagservices|adsbygoogle|google-analytics|googletagmanager|gtag\(/.test(s), path.relative(root, f));
  }
});

test('Google Fonts stays allowed only while a page still loads it', () => {
  const uses = pageFiles().some(f => /fonts\.googleapis\.com\/css2/.test(fs.readFileSync(f, 'utf8')));
  const d = directives();
  assert.strictEqual(d['style-src'].includes('https://fonts.googleapis.com'), uses);
  assert.strictEqual(d['font-src'].includes('https://fonts.gstatic.com'), uses);
});

test('every absolute host a page fetches is in connect-src', () => {
  const allowed = directives()['connect-src'];
  for (const f of pageFiles()) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/fetch\(\s*'(https:\/\/[^/']+)/g)) assert.ok(allowed.includes(m[1]), path.relative(root, f) + ' ' + m[1]);
  }
  assert.ok(allowed.includes('https://api.open-meteo.com') && allowed.includes('https://api.weather.gov'));
});

test('sitemap lists /newsletter and the legal page with its current date', () => {
  const sm = fs.readFileSync(path.join(root, 'public/sitemap.xml'), 'utf8');
  assert.ok(sm.includes('<loc>https://tristatenewss.vercel.app/newsletter</loc>'));
  assert.ok(/vercel\.app\/legal<\/loc><lastmod>2026-10-22</.test(sm) && !sm.includes('legal.html'));
  assert.ok(fs.readFileSync(path.join(root, 'public/newsletter.html'), 'utf8').includes('rel="canonical" href="https://tristatenewss.vercel.app/newsletter"'));
});
