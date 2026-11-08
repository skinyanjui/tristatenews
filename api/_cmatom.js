// Atomic comment index transitions. Production sends these Lua scripts as one Redis EVAL (Upstash pipeline).
// Local server.js and the test fake store run the matching JS (same keys/argv, same return shape) because they
// have no Lua VM. One EVAL is serialized per key; SET NX / ZADD / ZREM replace read-then-SET counts.
'use strict';

const SCRIPT_CREATE = [
  "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4])",
  "redis.call('ZADD', KEYS[2], ARGV[3], ARGV[2])",
  "redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[5])",
  'local n = redis.call(\'ZCARD\', KEYS[2])',
  'local cap = tonumber(ARGV[6])',
  'if n > cap then redis.call(\'ZREMRANGEBYRANK\', KEYS[2], 0, n - cap - 1) end',
  "redis.call('EXPIRE', KEYS[2], ARGV[4])",
  "return redis.call('ZCARD', KEYS[2])"
].join('\n');

const SCRIPT_REPORT = [
  "if redis.call('EXISTS', KEYS[1]) == 0 then return {0, 0, redis.call('ZCARD', KEYS[4])} end",
  "redis.call('SADD', KEYS[2], ARGV[1])",
  "redis.call('EXPIRE', KEYS[2], ARGV[4])",
  "local n = redis.call('SCARD', KEYS[2])",
  'local hid = 0',
  'if n >= tonumber(ARGV[5]) then',
  "  local ok = redis.call('SET', KEYS[3], '1', 'EX', ARGV[4], 'NX')",
  '  if ok then',
  '    hid = 1',
  "    redis.call('ZREM', KEYS[4], ARGV[2])",
  "    redis.call('ZADD', KEYS[5], ARGV[3], ARGV[2])",
  "    redis.call('EXPIRE', KEYS[5], ARGV[4])",
  '  end',
  'end',
  "return {n, hid, redis.call('ZCARD', KEYS[4])}"
].join('\n');

const SCRIPT_RESTORE = [
  "local rec = redis.call('GET', KEYS[3])",
  'if not rec then',
  "  redis.call('DEL', KEYS[1])",
  "  redis.call('DEL', KEYS[5])",
  "  redis.call('ZREM', KEYS[2], ARGV[1])",
  "  redis.call('ZREM', KEYS[4], ARGV[1])",
  "  return {0, redis.call('ZCARD', KEYS[2])}",
  'end',
  "local hidden = redis.call('DEL', KEYS[1])",
  "redis.call('DEL', KEYS[5])",
  "redis.call('ZREM', KEYS[4], ARGV[1])",
  'if hidden == 1 then',
  "  local ms = redis.call('PTTL', KEYS[3])",
  '  local ttl = tonumber(ARGV[2])',
  '  local exp = tonumber(ARGV[3]) + math.floor(((ms and ms > 0) and ms or (ttl * 1000)) / 1000)',
  "  redis.call('ZADD', KEYS[2], exp, ARGV[1])",
  "  redis.call('EXPIRE', KEYS[2], ARGV[2])",
  'end',
  "return {hidden, redis.call('ZCARD', KEYS[2])}"
].join('\n');

const SCRIPT_DELETE = [
  "redis.call('DEL', KEYS[1])",
  "redis.call('DEL', KEYS[2])",
  "redis.call('DEL', KEYS[3])",
  "redis.call('ZREM', KEYS[4], ARGV[1])",
  "redis.call('ZREM', KEYS[5], ARGV[1])",
  "return {1, redis.call('ZCARD', KEYS[4])}"
].join('\n');

const SCRIPT_PRUNE = [
  'local out = {}',
  'for i = 1, #KEYS do',
  "  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', ARGV[1])",
  "  out[i] = redis.call('ZCARD', KEYS[i])",
  'end',
  'return out'
].join('\n');

function truthy(v) { return v !== null && v !== undefined && v !== false && v !== 0 && v !== '0'; }

function create(r, keys, argv) {
  r.call('SET', keys[0], argv[0], 'EX', argv[3]);
  r.call('ZADD', keys[1], argv[2], argv[1]);
  r.call('ZREMRANGEBYSCORE', keys[1], '-inf', argv[4]);
  let n = Number(r.call('ZCARD', keys[1])) || 0;
  const cap = Number(argv[5]) || 0;
  if (cap && n > cap) r.call('ZREMRANGEBYRANK', keys[1], 0, n - cap - 1);
  r.call('EXPIRE', keys[1], argv[3]);
  return Number(r.call('ZCARD', keys[1])) || 0;
}

function report(r, keys, argv) {
  if (Number(r.call('EXISTS', keys[0])) === 0) return [0, 0, Number(r.call('ZCARD', keys[3])) || 0];
  r.call('SADD', keys[1], argv[0]);
  r.call('EXPIRE', keys[1], argv[3]);
  const n = Number(r.call('SCARD', keys[1])) || 0;
  let hid = 0;
  if (n >= Number(argv[4])) {
    const ok = r.call('SET', keys[2], '1', 'EX', argv[3], 'NX');
    if (truthy(ok)) {
      hid = 1;
      r.call('ZREM', keys[3], argv[1]);
      r.call('ZADD', keys[4], argv[2], argv[1]);
      r.call('EXPIRE', keys[4], argv[3]);
    }
  }
  return [n, hid, Number(r.call('ZCARD', keys[3])) || 0];
}

function restore(r, keys, argv) {
  const rec = r.call('GET', keys[2]);
  if (rec == null) {
    r.call('DEL', keys[0]);
    r.call('DEL', keys[4]);
    r.call('ZREM', keys[1], argv[0]);
    r.call('ZREM', keys[3], argv[0]);
    return [0, Number(r.call('ZCARD', keys[1])) || 0];
  }
  const hidden = Number(r.call('DEL', keys[0])) || 0;
  r.call('DEL', keys[4]);
  r.call('ZREM', keys[3], argv[0]);
  if (hidden === 1) {
    const ms = Number(r.call('PTTL', keys[2]));
    const ttl = Number(argv[1]);
    const exp = Number(argv[2]) + Math.floor(((ms && ms > 0) ? ms : ttl * 1000) / 1000);
    r.call('ZADD', keys[1], exp, argv[0]);
    r.call('EXPIRE', keys[1], argv[1]);
  }
  return [hidden, Number(r.call('ZCARD', keys[1])) || 0];
}

function del(r, keys, argv) {
  r.call('DEL', keys[0]);
  r.call('DEL', keys[1]);
  r.call('DEL', keys[2]);
  r.call('ZREM', keys[3], argv[0]);
  r.call('ZREM', keys[4], argv[0]);
  return [1, Number(r.call('ZCARD', keys[3])) || 0];
}

function prune(r, keys, argv) {
  return keys.map(k => {
    r.call('ZREMRANGEBYSCORE', k, '-inf', argv[0]);
    return Number(r.call('ZCARD', k)) || 0;
  });
}

const ATOMS = {};
ATOMS[SCRIPT_CREATE] = create;
ATOMS[SCRIPT_REPORT] = report;
ATOMS[SCRIPT_RESTORE] = restore;
ATOMS[SCRIPT_DELETE] = del;
ATOMS[SCRIPT_PRUNE] = prune;

function run(script, redis, keys, argv) {
  const fn = ATOMS[script];
  if (!fn) throw new Error('unknown comment script');
  return fn(redis, keys, argv);
}

function wrap(runCmd) {
  return {
    call: function (op) {
      const args = Array.prototype.slice.call(arguments, 1);
      const out = runCmd([op].concat(args));
      if (out && out.error) throw new Error(out.error);
      return out ? out.result : null;
    }
  };
}

module.exports = {
  SCRIPT_CREATE, SCRIPT_REPORT, SCRIPT_RESTORE, SCRIPT_DELETE, SCRIPT_PRUNE,
  run, wrap, create, report, restore, del, prune
};
