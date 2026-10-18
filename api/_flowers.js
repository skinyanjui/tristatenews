// GET /api/flowers: what the obituary "Send flowers" link needs (public/flowers.js has the rule). vercel.json
// rewrites it to /api/listings?__route=flowers; no new function.
//   homes      { key: https url } for funeral homes in data/funeral-homes.json with a checked florist page
//   affiliate  the affiliate link (data/flowers.json affiliateUrl with the ID), or null when no ID is set
//   fallbackUrl  data/flowers.json fallbackUrl (a florist's public page, no affiliate code, unpaid), or null when
//              it is empty; used only when there is no florist page and no affiliate link
// The ID comes from FLORIST_ONE_AFFILIATE_ID when set, else data/flowers.json affiliateId. It is a public tracking
// code (it ends up in the link), not a secret; anything that isn't 1-40 letters, digits, - or _ counts as unset.
const HOMES = require('../data/funeral-homes.json');
const CONFIG = require('../data/flowers.json');
const { key, httpsUrl } = require('../public/flowers.js');

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

function affiliateId(env) {
  const fromEnv = String((env && env.FLORIST_ONE_AFFILIATE_ID) || '').trim();
  const id = fromEnv || String(CONFIG.affiliateId || '').trim();
  return ID_RE.test(id) ? id : '';
}

function affiliateUrl(env, config) {
  const id = affiliateId(env);
  const tpl = String((config || CONFIG).affiliateUrl || '');
  if (!id || !tpl.includes('{id}')) return null;
  return httpsUrl(tpl.replace('{id}', encodeURIComponent(id))) || null;
}

function homesMap(list) {
  const out = {};
  for (const h of (list || HOMES).homes || []) {
    const k = key(h && h.name), u = httpsUrl(h && h.florist);
    if (k && u && !out[k]) out[k] = u;
  }
  return out;
}

function fallbackUrl(config) { return httpsUrl(String((config || CONFIG).fallbackUrl || '')) || null; }

function config(env) { return { homes: homesMap(), affiliate: affiliateUrl(env || process.env), fallbackUrl: fallbackUrl() }; }

function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Cache-Control', 'no-store'); return res.status(405).send(JSON.stringify({ error: 'method' })); }
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
  return res.status(200).send(req.method === 'HEAD' ? '' : JSON.stringify(config(process.env)));
}

module.exports = handler;
Object.assign(module.exports, { affiliateId, affiliateUrl, fallbackUrl, homesMap, config, ID_RE });
