// Store choice for the local dev server (server.js) only; nothing in api/ uses this.
// The handlers pick their Redis from UPSTASH_REDIS_REST_URL/TOKEN, else KV_REST_API_URL/TOKEN, when they load.
// A shell that happens to carry the production credentials would make `npm run dev` read and write live data
// (newsletter list, tips, the news snapshot). So server.js always uses its in-memory store unless
// TSN_ALLOW_LIVE_REDIS=1 is set on purpose.
const LIVE_VARS = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN', 'KV_URL', 'REDIS_URL'];

// Mutates env. Returns { mode: 'memory' | 'live', vars: [names of the Redis variables that were set] }.
function devStore(env, port) {
  const vars = LIVE_VARS.filter(k => env[k]);
  if (vars.length && env.TSN_ALLOW_LIVE_REDIS === '1') return { mode: 'live', vars };
  for (const k of LIVE_VARS) delete env[k];
  env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:' + port + '/_internal_redis';
  env.UPSTASH_REDIS_REST_TOKEN = 'internal_dev_token';
  return { mode: 'memory', vars };
}

module.exports = { devStore, LIVE_VARS };
