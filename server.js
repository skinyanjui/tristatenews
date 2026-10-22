const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Local runs use the in-memory Redis below (caching snapshots, reactions, classifieds, jobs, deals, etc.), never a
// real database: any Upstash / Vercel KV credentials in the environment are ignored and removed before the API
// handlers load, so `npm run dev` can't touch production data. Set TSN_ALLOW_LIVE_REDIS=1 to use them on purpose.
const store = require('./scripts/dev-store.js').devStore(process.env, PORT);
if (store.mode === 'live') console.warn('TSN_ALLOW_LIVE_REDIS=1: using the real Redis from ' + store.vars.join(', ') + '. Reads and writes are live.');
else if (store.vars.length) console.warn('Ignoring ' + store.vars.join(', ') + ' and using the in-memory store. Set TSN_ALLOW_LIVE_REDIS=1 to use real Redis.');

const app = express();

// --- In-Memory Redis Store for Upstash REST Pipeline emulation ---
const kvStore = new Map();
const zStore = new Map();     // key -> Map(member -> score)
const setStore = new Map();   // key -> Set(member)
const listStore = new Map();  // key -> Array
const hashStore = new Map();  // key -> Map(field -> value)

function handleRedisCommand(cmd) {
  if (!Array.isArray(cmd) || cmd.length === 0) return { result: null };
  const op = String(cmd[0]).toUpperCase();
  const key = cmd[1];

  switch (op) {
    case 'GET': {
      return { result: kvStore.has(key) ? kvStore.get(key) : null };
    }
    case 'SET': {
      const val = cmd[2];
      const args = cmd.slice(3);
      let isNx = false;
      for (let i = 0; i < args.length; i++) {
        if (String(args[i]).toUpperCase() === 'NX') isNx = true;
      }
      if (isNx && kvStore.has(key)) {
        return { result: null };
      }
      kvStore.set(key, String(val));
      return { result: 'OK' };
    }
    case 'DEL': {
      let count = 0;
      for (let i = 1; i < cmd.length; i++) {
        const k = cmd[i];
        if (kvStore.delete(k)) count++;
        if (zStore.delete(k)) count++;
        if (setStore.delete(k)) count++;
        if (listStore.delete(k)) count++;
        if (hashStore.delete(k)) count++;
      }
      return { result: count };
    }
    case 'INCR': {
      const cur = Number(kvStore.get(key)) || 0;
      const nextVal = cur + 1;
      kvStore.set(key, String(nextVal));
      return { result: nextVal };
    }
    case 'EXPIRE': {
      return { result: 1 };
    }
    case 'MGET': {
      return { result: cmd.slice(1).map(k => (kvStore.has(k) ? kvStore.get(k) : null)) };
    }
    case 'HINCRBY': {
      const h = hashStore.get(key) || new Map(); hashStore.set(key, h);
      const n = (Number(h.get(cmd[2])) || 0) + (Number(cmd[3]) || 0);
      h.set(String(cmd[2]), String(n));
      return { result: n };
    }
    case 'HGETALL': {
      return { result: [...(hashStore.get(key) || new Map())].flat() };
    }
    case 'HSET': { // field/value pairs (admin county overrides)
      const h = hashStore.get(key) || new Map(); hashStore.set(key, h);
      let n = 0; for (let i = 2; i + 1 < cmd.length; i += 2) { if (!h.has(String(cmd[i]))) n++; h.set(String(cmd[i]), String(cmd[i + 1])); }
      return { result: n };
    }
    case 'HGET': {
      const h = hashStore.get(key); return { result: h && h.has(String(cmd[2])) ? h.get(String(cmd[2])) : null };
    }
    case 'HDEL': {
      const h = hashStore.get(key); let n = 0; for (const f of cmd.slice(2)) if (h && h.delete(String(f))) n++; return { result: n };
    }
    case 'PERSIST': { // no expiries in this dev store
      return { result: 0 };
    }
    case 'SADD': {
      if (!setStore.has(key)) setStore.set(key, new Set());
      const s = setStore.get(key);
      let added = 0;
      for (let i = 2; i < cmd.length; i++) {
        const m = String(cmd[i]);
        if (!s.has(m)) {
          s.add(m);
          added++;
        }
      }
      return { result: added };
    }
    case 'SREM': {
      if (!setStore.has(key)) return { result: 0 };
      const s = setStore.get(key);
      let removed = 0;
      for (let i = 2; i < cmd.length; i++) {
        if (s.delete(String(cmd[i]))) removed++;
      }
      return { result: removed };
    }
    case 'SCARD': {
      return { result: setStore.has(key) ? setStore.get(key).size : 0 };
    }
    case 'SMEMBERS': {
      return { result: setStore.has(key) ? Array.from(setStore.get(key)) : [] };
    }
    case 'SISMEMBER': {
      return { result: setStore.has(key) && setStore.get(key).has(String(cmd[2])) ? 1 : 0 };
    }
    case 'ZCARD': {
      return { result: zStore.has(key) ? zStore.get(key).size : 0 };
    }
    case 'ZADD': {
      if (!zStore.has(key)) zStore.set(key, new Map());
      const z = zStore.get(key);
      let added = 0;
      for (let i = 2; i < cmd.length; i += 2) {
        const score = Number(cmd[i]);
        const member = String(cmd[i + 1]);
        if (!z.has(member)) added++;
        z.set(member, score);
      }
      return { result: added };
    }
    case 'ZREM': {
      if (!zStore.has(key)) return { result: 0 };
      const z = zStore.get(key);
      let removed = 0;
      for (let i = 2; i < cmd.length; i++) {
        if (z.delete(String(cmd[i]))) removed++;
      }
      return { result: removed };
    }
    case 'ZREMRANGEBYSCORE': {
      if (!zStore.has(key)) return { result: 0 };
      const z = zStore.get(key);
      const minStr = String(cmd[2]);
      const maxStr = String(cmd[3]);
      const min = minStr === '-inf' ? -Infinity : Number(minStr);
      const max = maxStr === '+inf' ? Infinity : Number(maxStr);
      let removed = 0;
      for (const [member, score] of Array.from(z.entries())) {
        if (score >= min && score <= max) {
          z.delete(member);
          removed++;
        }
      }
      return { result: removed };
    }
    case 'ZRANGE': {
      if (!zStore.has(key)) return { result: [] };
      const z = zStore.get(key);
      const start = Number(cmd[2]);
      const stop = Number(cmd[3]);
      const sorted = Array.from(z.entries()).sort((a, b) => a[1] - b[1]);
      const sliced = stop === -1 ? sorted.slice(start) : sorted.slice(start, stop + 1);
      return { result: sliced.map(e => e[0]) };
    }
    case 'ZREVRANGE': {
      if (!zStore.has(key)) return { result: [] };
      const z = zStore.get(key);
      const start = Number(cmd[2]);
      const stop = Number(cmd[3]);
      const sorted = Array.from(z.entries()).sort((a, b) => b[1] - a[1]);
      const sliced = stop === -1 ? sorted.slice(start) : sorted.slice(start, stop + 1);
      return { result: sliced.map(e => e[0]) };
    }
    case 'LPUSH': {
      if (!listStore.has(key)) listStore.set(key, []);
      const list = listStore.get(key);
      for (let i = 2; i < cmd.length; i++) {
        list.unshift(String(cmd[i]));
      }
      return { result: list.length };
    }
    case 'LTRIM': {
      if (!listStore.has(key)) return { result: 'OK' };
      const start = Number(cmd[2]);
      const stop = Number(cmd[3]);
      const list = listStore.get(key);
      const trimmed = stop === -1 ? list.slice(start) : list.slice(start, stop + 1);
      listStore.set(key, trimmed);
      return { result: 'OK' };
    }
    case 'LRANGE': {
      if (!listStore.has(key)) return { result: [] };
      const list = listStore.get(key);
      const start = Number(cmd[2]);
      const stop = Number(cmd[3]);
      return { result: stop === -1 ? list.slice(start) : list.slice(start, stop + 1) };
    }
    default:
      return { result: null };
  }
}

// Emulate Upstash Redis REST pipeline endpoint
app.post('/_internal_redis/pipeline', express.json({ limit: '20mb' }), (req, res) => {
  const commands = Array.isArray(req.body) ? req.body : [];
  const results = commands.map(handleRedisCommand);
  res.json(results);
});

// Import API handlers
const newsHandler = require('./api/news.js');
const listingsHandler = require('./api/listings.js');
const inboxHandler = require('./api/inbox.js');
const reactHandler = require('./api/react.js');
const stripeWebhookHandler = require('./api/stripe-webhook.js');
const unsubscribeHandler = require('./api/unsubscribe.js');
const alertsHandler = require('./api/alerts.js');

// Mount Stripe webhook BEFORE body-parser so it can consume the raw request stream
app.all('/api/stripe-webhook', (req, res, next) => {
  Promise.resolve(stripeWebhookHandler(req, res)).catch(next);
});

// Standard body parsers for remaining endpoints
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Mount API routes
app.all('/api/news', (req, res, next) => {
  Promise.resolve(newsHandler(req, res)).catch(next);
});

app.all('/api/refresh', (req, res, next) => { // served by api/news.js (see vercel.json rewrites)
  Promise.resolve(newsHandler(req, res)).catch(next);
});

app.all(['/api/counties', '/api/regions'], (req, res, next) => { // served by api/news.js (see vercel.json rewrites)
  Promise.resolve(newsHandler(req, res)).catch(next);
});
app.all('/api/coverage', (req, res, next) => { // admin Sources & Coverage, served by api/news.js (see vercel.json rewrites)
  Promise.resolve(newsHandler(req, res)).catch(next);
});
app.all('/api/locations', (req, res, next) => { // admin county-classification report, served by api/news.js (see vercel.json rewrites)
  Promise.resolve(newsHandler(req, res)).catch(next);
});

app.all('/api/listings', (req, res, next) => {
  Promise.resolve(listingsHandler(req, res)).catch(next);
});

app.post('/api/adstats', express.text({ type: 'text/plain', limit: '2kb' })); // ad counts arrive by sendBeacon as text/plain
app.all(['/api/advertise', '/api/creative', '/api/campaigns', '/api/adstats', '/api/packages'], (req, res, next) => { // served by api/inbox.js (see vercel.json rewrites)
  Promise.resolve(inboxHandler(req, res)).catch(next);
});

app.all(['/api/checkout', '/api/catalog', '/api/orders', '/api/flowers'], (req, res, next) => { // served by api/listings.js (see vercel.json rewrites)
  Promise.resolve(listingsHandler(req, res)).catch(next);
});

app.all('/api/react', (req, res, next) => {
  Promise.resolve(reactHandler(req, res)).catch(next);
});

app.all('/api/submit', (req, res, next) => { // served by api/inbox.js (see vercel.json rewrites)
  Promise.resolve(inboxHandler(req, res)).catch(next);
});

app.all('/api/subscribe', (req, res, next) => { // served by api/unsubscribe.js (see vercel.json rewrites)
  Promise.resolve(unsubscribeHandler(req, res)).catch(next);
});
app.all('/api/unsubscribe', (req, res, next) => {
  Promise.resolve(unsubscribeHandler(req, res)).catch(next);
});
app.all('/api/alerts', (req, res, next) => {
  Promise.resolve(alertsHandler(req, res)).catch(next);
});

// The /advertise page (api/_adpage.js behind ADS_PAGE; vercel.json rewrites it to api/inbox.js)
const adPageHandler = require('./api/_adpage.js');
app.all(['/advertise', '/advertise/'], (req, res) => adPageHandler(req, res));

// Retired tab paths: 308 to "/" as vercel.json redirects them (/all, /liked, /news, /police-courts, /police, /courts).
const RT = require('./public/routes.js');
app.get(/.*/, (req, res, next) => {
  const p = req.path.replace(/\/+$/, '').toLowerCase();
  if (!RT.ALIASES[p]) return next();
  const qs = req.originalUrl.indexOf('?');
  return res.redirect(308, RT.ALIASES[p] + (qs >= 0 ? req.originalUrl.slice(qs) : ''));
});

// County and state pages and their sitemap (api/_geopage.js behind REGIONAL_ROUTES_ENABLED; vercel.json rewrites
// them to /api/news?__route=geopage). Flag off they get the 404 page, as before.
const geoPageHandler = require('./api/_geopage.js');
app.get(['/news/:state', '/news/:state/:county', '/sitemap-regions.xml'], (req, res) => {
  const r = Object.create(req, { query: { value: req.path === '/sitemap-regions.xml' ? { sitemap: '1' } : { p: req.path } } });
  return geoPageHandler(r, res);
});

// Serve static frontend files from /public
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));

// Specific page route aliases
app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// Tab paths (vercel.json rewrites them to index.html); everything else gets the 404 page, as on Vercel.
const TAB_PATHS = new Set(RT.ROUTES.map(r => r.path));
const notFoundHandler = require('./api/_notfound.js');
app.get(/.*/, (req, res, next) => {
  const p = req.path.replace(/\/+$/, '') || '/';
  return TAB_PATHS.has(p) ? res.sendFile(path.join(publicDir, 'index.html')) : next();
});
app.use((req, res) => notFoundHandler(req, res));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Start listening
const server = app.listen(PORT, HOST, () => {
  console.log(`Tri-State News server running at http://${HOST}:${PORT}`);

  // Warm up initial news snapshot in background so visitors get instant responses
  if (typeof newsHandler.refreshAll === 'function') {
    newsHandler.refreshAll({ tier: 'fast' })
      .then(() => console.log('Initial news cache warmed up successfully.'))
      .catch(err => console.warn('Initial news warm-up deferred to first request:', err.message));
  }
});

module.exports = server;
