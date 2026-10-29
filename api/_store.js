// The one Redis (Upstash REST) helper every function uses. Before ship 70 each file had its own copy, and the copies
// had drifted: timeouts of 5, 6 or 8 seconds, and only four of them noticed a command that failed inside a pipeline.
//   stored()           true when the store is configured
//   pipeline(commands) POST /pipeline; resolves to Upstash's [{ result } | { error }] array, one entry per command.
//                      Throws on a network error or timeout (TIMEOUT_MS), a non-2xx answer, a body that isn't that
//                      array, or any command answering { error } (so a half-applied write never looks like success).
// The variables are read on every call, in one order: UPSTASH_REDIS_REST_URL / _TOKEN, else KV_REST_API_URL / _TOKEN
// (Vercel's Upstash integration). The error messages carry no URL, token or command data.
'use strict';
const TIMEOUT_MS = 8000;

function config(env) {
  env = env || process.env;
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '';
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '';
  return url && token ? { url: String(url).replace(/\/$/, ''), token: String(token) } : null;
}
const stored = () => !!config();

async function pipeline(commands) {
  const c = config();
  if (!c) throw new Error('store not configured');
  const r = await fetch(c.url + '/pipeline', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!r.ok) throw new Error('store HTTP ' + r.status);
  const out = await r.json();
  if (!Array.isArray(out)) throw new Error('store bad reply');
  const bad = out.findIndex(x => x && x.error);
  if (bad >= 0) throw new Error('store command ' + bad + ' (' + String((commands[bad] || [])[0] || '?') + ') failed');
  return out;
}

module.exports = { pipeline, stored, config, TIMEOUT_MS };
