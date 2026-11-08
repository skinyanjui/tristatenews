'use strict';
// ship108: Vercel Speed Insights through the official framework-agnostic injector (@vercel/speed-insights,
// injectSpeedInsights), bundled by scripts/build-assets.js as assets/speed-insights.js for this plain-HTML site.
// The generated file runs here in a sandbox with a fake DOM: nothing loads and nothing is sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const B = require('../scripts/build-assets.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const SRC = read('public/assets/speed-insights.js');

function run(href, times = 1) {
  const head = { children: [], appendChild(n) { this.children.push(n); }, querySelector(sel) { const m = /script\[src\*="([^"]+)"\]/.exec(sel); return this.children.find(n => m && n.src.includes(m[1])) || null; } };
  const u = new URL(href);
  const listeners = {};
  const w = {
    location: { href: u.href, hostname: u.hostname, pathname: u.pathname },
    document: { head, createElement: tag => ({ tag, dataset: {}, src: '', defer: false }) },
    history: { pushState(s, t, url) { const n = new URL(url, w.location.href); Object.assign(w.location, { href: n.href, pathname: n.pathname }); }, replaceState(s, t, url) { this.pushState(s, t, url); } },
    addEventListener: (k, f) => { (listeners[k] = listeners[k] || []).push(f); },
    URL, Object, String, console: { log() {} }
  };
  w.window = w;
  const ctx = vm.createContext(w);
  for (let i = 0; i < times; i++) vm.runInContext(SRC, ctx);
  return { w, scripts: head.children, listeners };
}

test('ship108: the package is pinned and locked with bun, and no framework comes with it', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies['@vercel/speed-insights'], '2.1.0');
  for (const d of ['next', 'react', 'react-dom', 'vue']) assert.ok(!pkg.dependencies[d], d);
  assert.match(read('bun.lock'), /"@vercel\/speed-insights": \["@vercel\/speed-insights@2\.1\.0"/);
  assert.ok(!fs.existsSync(path.join(root, 'package-lock.json')), 'one lockfile');
  assert.match(pkg.scripts.lint, /public\/speed-insights\.js/);
});

test('ship108: assets/speed-insights.js is current and every page that loads it has its hash', () => {
  assert.equal(SRC, B.siSource(), 'run node scripts/build-assets.js');
  assert.match(SRC, /^\/\* @vercel\/speed-insights 2\.1\.0 \(dist\/index\.js, Apache-2\.0,/);
  assert.ok(!SRC.includes('sourceMappingURL'));
  const tag = B.siTag(B.hash(SRC));
  for (const f of B.SI_PAGES) assert.equal(fs.readFileSync(f, 'utf8').split(tag).length - 1, 1, path.relative(root, f));
  for (const f of ['public/admin.html', 'public/order.html', 'public/creative.html', 'public/unsubscribe.html', 'data/pages/404.html'])
    assert.ok(!read(f).includes('speed-insights'), f + ' does not load it');
  assert.match(read('.github/workflows/ci.yml'), /git diff --exit-code -- data\/pages\/index\.html data\/pages\/advertise\.html public\/legal\.html public\/newsletter\.html public\/assets /);
});

test('ship108: not on local hosts (no /_vercel routes there), unless a test forces it', () => {
  for (const h of ['http://localhost:3000/', 'http://127.0.0.1:3077/events', 'http://[::1]:3077/', 'http://tsn.localhost/'])
    assert.equal(run(h).scripts.length, 0, h);
});

test('ship108: on the site it adds one deferred first-party script with the SDK name, version and grouped route', () => {
  const { w, scripts } = run('https://www.tristatenow.com/news/kentucky/henderson?q=fire#top', 2);
  assert.equal(scripts.length, 1, 'once, even when the file runs twice');
  const s = scripts[0];
  assert.equal(s.src, '/_vercel/speed-insights/script.js');
  assert.equal(s.defer, true);
  assert.deepEqual({ ...s.dataset }, { sdkn: '@vercel/speed-insights', sdkv: '2.1.0', route: '/news/[state]/[county]' });
  assert.equal(w.TSNSpeedInsightsStarted, true);
  assert.equal(run('https://tristatenewss.vercel.app/news/indiana').scripts[0].dataset.route, '/news/[state]', 'previews and the Vercel host too');
});

test('ship108: tab switches update the route; the URL is sent without its query or hash', () => {
  const { w, scripts, listeners } = run('https://www.tristatenow.com/');
  const s = scripts[0];
  assert.equal(s.dataset.route, '/');
  w.history.pushState({}, '', '/events?town=newburgh');
  assert.equal(s.dataset.route, '/events');
  w.history.replaceState({}, '', '/news/indiana/vanderburgh/');
  assert.equal(s.dataset.route, '/news/[state]/[county]');
  w.location.pathname = '/jobs';
  listeners.popstate.forEach(f => f());
  assert.equal(s.dataset.route, '/jobs');
  const q = w.siq.find(e => e[0] === 'beforeSend');
  assert.ok(q, 'beforeSend is queued for the script');
  const out = q[1]({ type: 'vital', url: 'https://www.tristatenow.com/unsubscribe.html?email=a%40b.co#x', route: '/unsubscribe.html' });
  assert.deepEqual({ ...out }, { type: 'vital', url: 'https://www.tristatenow.com/unsubscribe.html', route: '/unsubscribe.html' });
  assert.equal(q[1]({ type: 'vital', url: 'http://[', route: '/' }), null, 'an unreadable URL is dropped');
});

test('ship108: CSP already allows it (same-origin script and intake); Privacy describes it', () => {
  const csp = JSON.parse(read('vercel.json')).headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  const legal = read('public/legal.html');
  for (const s of ['Page-speed measurements (Vercel Speed Insights)', 'the page address with anything after “?” or “#” removed', 'It sets no cookie, stores nothing in your browser, uses no ID',
    'Vercel Speed Insights (page speed, above) sets no cookies either.', 'receives the <a href="#privacy-speed">page-speed measurements</a>', 'Last updated November 8, 2026'])
    assert.ok(legal.includes(s), s);
  assert.equal(fs.readdirSync(path.join(root, 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_')).length, 8);
});
