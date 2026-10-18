// api/_dispatch.js: picks the route from ?__route (vercel.json rewrite) or from the request path (local server).
const test = require('node:test');
const assert = require('node:assert');
const { routeOf, host } = require('../api/_dispatch.js');

test('routeOf reads ?__route first, then the /api/<name> path', () => {
  assert.equal(routeOf({ query: { __route: 'refresh' }, url: '/api/news?__route=refresh' }), 'refresh');
  assert.equal(routeOf({ query: { __route: ['submit', 'x'] } }), 'submit');
  assert.equal(routeOf({ query: {}, url: '/api/refresh?tier=fast' }), 'refresh');
  assert.equal(routeOf({ url: '/api/stripe-webhook/' }), 'stripe-webhook');
  assert.equal(routeOf({ url: '/news' }), '');
  assert.equal(routeOf({ query: {} }), '');
  assert.equal(routeOf({}), '');
});

test('host passes the same req and res to the route handler, falls back to its own handler, else 404', async () => {
  const seen = [];
  const a = (req, res) => { seen.push(['a', req, res]); return 'A'; };
  const own = (req, res) => { seen.push(['own', req, res]); return 'OWN'; };
  const h = host({ a: () => a }, own);
  const req1 = { query: { __route: 'a' }, method: 'POST' }, res1 = {};
  assert.equal(h(req1, res1), 'A'); assert.equal(seen[0][1], req1); assert.equal(seen[0][2], res1);
  assert.equal(h({ url: '/api/own' }, {}), 'OWN');
  assert.equal(h({ query: { __route: 'toString' } }, {}), 'OWN', 'prototype names are not routes');
  const r = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
  host({ a: () => a })({ query: { __route: 'zzz' } }, r);
  assert.equal(r.code, 404); assert.deepEqual(r.body, { error: 'not found' }); assert.equal(r.headers['Cache-Control'], 'no-store');
});
