// One Vercel function can answer several public /api paths. The Hobby plan allows 12 functions per deployment,
// and every api/*.js file without a leading "_" is one function.
// vercel.json rewrites an old path to its host function with ?__route=<name> (for example /api/refresh ->
// /api/news?__route=refresh). host() hands the untouched request to that route's handler, so method, headers,
// query, body stream and response are exactly what the handler saw when it had its own file.
// The route also comes from the request path (/api/refresh), so the local server and any platform that keeps the
// original URL work the same. Route handlers are loaded on first use.
const PATH_RE = /^\/api\/([a-z][a-z-]*)\/?$/;

function routeOf(req) {
  const q = req && req.query && req.query.__route;
  if (q) return String(Array.isArray(q) ? q[0] : q);
  try { const m = PATH_RE.exec(new URL((req && req.url) || '/', 'http://x').pathname); return m ? m[1] : ''; } catch (_) { return ''; }
}

// routes: { name: () => handler }. fallback: the host file's own handler (used for its own path and for any route
// it does not host). Without a fallback an unknown route answers 404.
function host(routes, fallback) {
  return function dispatch(req, res) {
    const load = Object.prototype.hasOwnProperty.call(routes, routeOf(req)) ? routes[routeOf(req)] : null;
    if (load) return load()(req, res);
    if (fallback) return fallback(req, res);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'not found' });
  };
}

module.exports = { routeOf, host };
