'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Ck = require('../api/_cmcookie.js');

test('ship119: loopback is not Secure/__Host-; canonical HTTPS + vercel is', () => {
  const local = { headers: { host: '127.0.0.1:3077' } };
  assert.equal(Ck.cookieSecure(local), false);
  assert.equal(Ck.cookieName(local), 'tsn_cm');
  const spoof = { headers: { host: 'evil.test', 'x-forwarded-proto': 'https' } };
  assert.equal(Ck.cookieSecure(spoof), false);
  const prod = { headers: { host: 'www.tristatenow.com', 'x-forwarded-proto': 'https', 'x-vercel-id': 'dev1' } };
  assert.equal(Ck.cookieSecure(prod), true);
  assert.equal(Ck.cookieName(prod), '__Host-tsn_cm');
  const canon = { headers: { host: 'www.tristatenow.com', 'x-forwarded-proto': 'https' } };
  assert.equal(Ck.cookieSecure(canon), true);
});

test('ship119: token is 32 bytes; hash is hex; duplicates and junk are rejected', () => {
  const t = Ck.newToken();
  assert.equal(Buffer.from(t, 'base64url').length, 32);
  assert.equal(Ck.tokenHash(t).length, 64);
  const req = { headers: { host: '127.0.0.1:3077', cookie: 'tsn_cm=' + t } };
  assert.equal(Ck.readToken(req), t);
  assert.equal(Ck.readToken({ headers: { host: '127.0.0.1:3077', cookie: 'tsn_cm=' + t + '; tsn_cm=' + t } }), null);
  assert.equal(Ck.readToken({ headers: { host: '127.0.0.1:3077', cookie: 'tsn_cm=short' } }), null);
  assert.equal(Ck.readToken({ headers: { host: '127.0.0.1:3077', cookie: 'tsn_cm=' + 'a'.repeat(80) } }), null);
  assert.equal(Ck.readToken({ headers: { host: '127.0.0.1:3077', cookie: 'x'.repeat(5000) } }), null);
  assert.equal(Ck.hashesEqual(Ck.tokenHash(t), Ck.tokenHash(t)), true);
  assert.equal(Ck.hashesEqual(Ck.tokenHash(t), Ck.tokenHash(Ck.newToken())), false);
});

test('ship119: prod accepts a legacy tsn_cm and migrates to __Host-; duplicates still fail', () => {
  const t = Ck.newToken();
  const prod = {
    headers: {
      host: 'www.tristatenow.com',
      'x-forwarded-proto': 'https',
      'x-vercel-id': 'sfo1',
      cookie: 'tsn_cm=' + t
    }
  };
  assert.equal(Ck.readToken(prod), t);
  assert.equal(Ck.shouldMigrate(prod), true);
  const both = { headers: Object.assign({}, prod.headers, { cookie: '__Host-tsn_cm=' + t + '; tsn_cm=' + t }) };
  assert.equal(Ck.readToken(both), t);
  assert.equal(Ck.shouldMigrate(both), false);
  const dup = { headers: Object.assign({}, prod.headers, { cookie: 'tsn_cm=' + t + '; tsn_cm=' + t }) };
  assert.equal(Ck.readToken(dup), null);
});
