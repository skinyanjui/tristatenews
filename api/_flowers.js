// GET /api/flowers: what the obituary action row needs ("Send flowers", "Plant a tree", "Donate"; public/flowers.js
// has the rules). vercel.json
// rewrites it to /api/listings?__route=flowers; no new function.
//   homes      { key: https url } for funeral homes in data/funeral-homes.json with a checked florist page
//   affiliate  the affiliate link (data/flowers.json affiliateUrl with the ID), or null when no ID is set
//   fallbackUrl  data/flowers.json fallbackUrl (a florist's public page, no affiliate code, unpaid), or null when
//              it is empty; used only when there is no florist page and no affiliate link
//   tree       { homes: { key: https url } from treeUrl, affiliate: url | null, fallbackUrl: url | null } (data/flowers.json
//              "tree"; the ID from TREE_AFFILIATE_ID, else tree.affiliateId; no affiliate without an affiliateUrl template)
//   donate     { homes: { key: https url } from donateUrl }. No default: Donate shows only for a home's own page or a
//              charity the obituary itself names (detected on the page), never an invented one.
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

function treeAffiliateId(env) {
  const id = String((env && env.TREE_AFFILIATE_ID) || '').trim() || String((CONFIG.tree && CONFIG.tree.affiliateId) || '').trim();
  return ID_RE.test(id) ? id : '';
}

function affiliateUrl(env, config, idFn) {
  const id = (idFn || affiliateId)(env);
  const tpl = String((config || CONFIG).affiliateUrl || '');
  if (!id || !tpl.includes('{id}')) return null;
  return httpsUrl(tpl.replace('{id}', encodeURIComponent(id))) || null;
}

function homesMap(list, field) {
  const out = {};
  for (const h of (list || HOMES).homes || []) {
    const k = key(h && h.name), u = httpsUrl(h && h[field || 'florist']);
    if (k && u && !out[k]) out[k] = u;
  }
  return out;
}

function fallbackUrl(config) { return httpsUrl(String((config || CONFIG).fallbackUrl || '')) || null; }

function treeConfig(env, config) {
  const t = (config || CONFIG).tree || {};
  return { homes: homesMap(null, 'treeUrl'), affiliate: affiliateUrl(env, t, treeAffiliateId), fallbackUrl: fallbackUrl(t) };
}

function config(env) {
  env = env || process.env;
  return { homes: homesMap(), affiliate: affiliateUrl(env), fallbackUrl: fallbackUrl(), tree: treeConfig(env), donate: { homes: homesMap(null, 'donateUrl') } };
}

function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Cache-Control', 'no-store'); return res.status(405).send(JSON.stringify({ error: 'method' })); }
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
  return res.status(200).send(req.method === 'HEAD' ? '' : JSON.stringify(config(process.env)));
}

module.exports = handler;
Object.assign(module.exports, { affiliateId, treeAffiliateId, affiliateUrl, fallbackUrl, homesMap, treeConfig, config, ID_RE });
